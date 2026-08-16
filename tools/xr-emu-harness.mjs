#!/usr/bin/env node
// Isolated IWER + Puppeteer harness. Never attaches to the owner's Chrome profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

import {
  isAllowlisted,
  isSamplerOrGlFatal,
} from './xr-harness-log.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'review', 'jp3');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halcyon-xr-puppeteer-'));
const PORT = Number(process.env.HALCYON_XR_EMU_PORT || 17425);
const BASE = `http://127.0.0.1:${PORT}`;

fs.mkdirSync(outDir, { recursive: true });

const consoleLog = [];
function attachConsole(page) {
  page.on('console', (msg) => {
    consoleLog.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => {
    consoleLog.push({ type: 'pageerror', text: String(err) });
  });
  page.on('requestfailed', (req) => {
    consoleLog.push({ type: 'requestfailed', text: `${req.url()} ${req.failure()?.errorText ?? ''}` });
  });
  page.on('response', (res) => {
    if (res.status() >= 500) {
      consoleLog.push({ type: 'error', text: `HTTP ${res.status()} ${res.url()}` });
    }
  });
}

function redact(text) {
  return String(text ?? '')
    .replace(/\[StaffPicks\][^\n]*/g, '[StaffPicks] (redacted)')
    .replace(/Endcap order candidates:[^\n]*/g, 'Endcap order candidates: (redacted)');
}

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'overlayText') continue;
      if (k === 'text' && typeof v === 'string') out[k] = redact(v);
      else out[k] = scrub(v);
    }
    return out;
  }
  return value;
}

function killChild(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function isSerious(entry) {
  if (entry.type === 'pageerror') return true;
  if (entry.type === 'error') return true;
  return false;
}

function samplerWarnings() {
  return consoleLog.filter(isSamplerOrGlFatal);
}

function seriousErrors() {
  return consoleLog.filter(isSerious);
}

function unexpectedSeriousErrors() {
  return seriousErrors().filter((e) => !isAllowlisted(e, consoleLog));
}

async function waitForPort(ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
      if (r.ok) {
        const html = await r.text();
        if (html.includes('/@vite/client') || html.includes('vite/dist/client')) return true;
        throw new Error(`${BASE} is up but is not a Vite dev server (IWER requires import.meta.env.DEV)`);
      }
    } catch (err) {
      if (err instanceof Error && /not a Vite/.test(err.message)) throw err;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`dev server did not start on ${BASE}`);
}

async function ensureDevServer() {
  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: root, stdio: 'pipe', shell: process.platform === 'win32',
      env: { ...process.env, BROWSER: 'none' },
    },
  );
  child.stderr.on('data', (buf) => {
    const text = String(buf);
    if (/error|Error|failed/i.test(text)) console.error('[vite]', text.slice(0, 500));
  });
  await waitForPort();
  // Pre-transform the emulator graph so the first page load is not stuck on
  // Vite optimizeDeps of iwer while the store boot clock is already running.
  try {
    await fetch(`${BASE}/src/dev/iwer-runtime.ts`, { signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    console.warn('[harness] iwer preload failed:', err);
  }
  return { child };
}

async function waitStoreReady(page, ms = 240_000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    const ready = await page.evaluate(() => {
      const boot = document.getElementById('boot-overlay');
      const diag = typeof window.__bootDiagnostics === 'function' ? window.__bootDiagnostics() : null;
      return {
        overlayHidden: boot ? !boot.classList.contains('visible') : true,
        overlayText: boot ? (boot.innerText || '').slice(0, 180) : null,
        interactive: diag?.timeToInteractive != null,
        scene: !!window.storeScene,
        xrTest: !!window.__xrTest,
        diag,
      };
    }).catch((err) => ({ error: String(err) }));
    last = ready;
    if (ready.overlayHidden && ready.scene) return ready;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`store did not become interactive in time: ${JSON.stringify(last)}`);
}

async function shot(page, name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, type: 'png' });
  return file;
}

async function runScenario(browser, name, search, body) {
  const page = await browser.newPage();
  attachConsole(page);
  const url = `${BASE}/${search}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const boot = await waitStoreReady(page);
  const result = await body(page, boot);
  await page.close();
  return { name, url, boot, ...result };
}

async function main() {
  const { child } = await ensureDevServer();
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: profileDir,
    args: ['--no-first-run', '--no-default-browser-check', '--mute-audio'],
  });

  const evidence = { startedAt: new Date().toISOString(), scenarios: [] };

  try {
    const barePage = await browser.newPage();
    attachConsole(barePage);
    await barePage.goto(`${BASE}/?xrBare=1&xrEmu=1&nogate=1`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const bareBootT0 = Date.now();
    let bareReady = null;
    while (Date.now() - bareBootT0 < 60_000) {
      bareReady = await barePage.evaluate(() => ({
        bare: !!window.__bareXr,
        xrTest: !!window.__xrTest,
      })).catch((err) => ({ error: String(err) }));
      if (bareReady?.bare && bareReady?.xrTest) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    const bareXr = await barePage.evaluate(async () => {
      const xr = window.__xrTest;
      const entered = xr ? await xr.enter() : { ok: false, error: 'no __xrTest' };
      const t0 = Date.now();
      let d = window.__xrDiagnostics?.();
      while (Date.now() - t0 < 8000) {
        d = window.__xrDiagnostics?.();
        if (d?.startup?.firstWorldRenderCompletedAt != null || d?.bare?.firstWorldRenderCompletedAt != null) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const gpu = window.__gpuDiagnostics?.() ?? null;
      await xr?.exit?.();
      return { entered, d, gpu };
    });
    const barePass = !!bareReady?.bare && !!bareXr.entered?.ok
      && (bareXr.d?.startup?.firstWorldRenderCompletedAt != null || bareXr.d?.bare?.firstWorldRenderCompletedAt != null);
    evidence.scenarios.push({
      name: 'BARE',
      url: `${BASE}/?xrBare=1&xrEmu=1&nogate=1`,
      pass: barePass,
      boot: bareReady,
      pre: bareXr,
    });
    await barePage.close();

    evidence.scenarios.push(await runScenario(
      browser, 'CORE_XR', '?demo=1&nogate=1&xrEmu=1&xrMinimal=1',
      async (page) => {
        const shot1 = await shot(page, 'iwer-core-xr.png');
        const pre = await page.evaluate(async () => {
          const until = Date.now() + 15000;
          while (!window.__xrTest && Date.now() < until) {
            await new Promise((r) => setTimeout(r, 150));
          }
          const xr = window.__xrTest;
          const d0 = window.__xrDiagnostics?.();
          const status = xr?.status?.();
          const native = !!navigator.xr;
          const entered = xr ? await xr.enter() : { ok: false, error: 'no __xrTest' };
          const waitWorld = async () => {
            const until = Date.now() + 5000;
            while (Date.now() < until) {
              const d = window.__xrDiagnostics?.();
              if (d?.startup?.firstWorldRenderCompletedAt != null && d?.startup?.firstDirectRenderEnd != null) return d;
              await new Promise((r) => setTimeout(r, 100));
            }
            return window.__xrDiagnostics?.();
          };
          const d1 = await waitWorld();
          const pose0 = xr?.getHeadsetPose?.() ?? null;
          xr?.setHeadsetPose?.({ y: 1.7, z: 0.2 });
          await new Promise((r) => setTimeout(r, 400));
          const pose1 = xr?.getHeadsetPose?.() ?? null;
          const exited = xr ? await xr.exit() : { ok: false };
          await new Promise((r) => setTimeout(r, 600));
          const d2 = window.__xrDiagnostics?.();
          const entered2 = xr ? await xr.enter() : { ok: false };
          await new Promise((r) => setTimeout(r, 1200));
          const d3 = window.__xrDiagnostics?.();
          const exited2 = xr ? await xr.exit() : { ok: false };
          return { d0, entered, d1, pose0, pose1, exited, d2, entered2, d3, exited2, status, native };
        });
        const shot2 = await shot(page, 'iwer-second-entry.png');
        const iwer = pre.status?.classification === 'IWER_EMULATED' || pre.d1?.classification === 'IWER_EMULATED';
        const presenting = !!pre.d1?.session?.rendererPresenting || pre.d1?.session?.phase === 'active' || pre.d1?.session?.phase === 'projecting';
        const st = pre.d1?.startup;
        const firstFrame = st?.firstWorldRenderCompletedAt != null
          && st?.firstDirectRenderStart != null
          && st?.firstDirectRenderEnd != null
          && st.firstDirectRenderEnd >= st.firstDirectRenderStart
          && (st.firstAnimationCallbackAt == null || st.firstDirectRenderStart >= st.firstAnimationCallbackAt);
        const second = pre.entered2?.ok === true;
        return {
          pass: iwer && pre.entered?.ok && presenting && firstFrame && pre.exited?.ok && second,
          iwer, presenting, firstFrame, second, pre, shots: [shot1, shot2],
        };
      },
    ));

    evidence.scenarios.push(await runScenario(
      browser, 'NO_LAYERS', '?demo=1&nogate=1&xrEmu=1&xrLayers=0',
      async (page) => {
        const pre = await page.evaluate(async () => {
          const until = Date.now() + 15000;
          while (!window.__xrTest && Date.now() < until) {
            await new Promise((r) => setTimeout(r, 150));
          }
          const xr = window.__xrTest;
          const entered = xr ? await xr.enter() : { ok: false, error: 'no __xrTest' };
          const untilWorld = Date.now() + 5000;
          while (Date.now() < untilWorld) {
            const dWait = window.__xrDiagnostics?.();
            if (dWait?.startup?.firstWorldRenderCompletedAt != null) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          await new Promise((r) => setTimeout(r, 400));
          xr?.setControllerPose?.('left', { x: -0.25, y: 1.2, z: -0.3 });
          xr?.setControllerPose?.('right', { x: 0.25, y: 1.2, z: -0.3 });
          const rigBefore = window.storeScene?.xr?.rigPose ?? null;
          xr?.setStick?.('left', 0, -1);
          await new Promise((r) => setTimeout(r, 800));
          xr?.setStick?.('left', 0, 0);
          const rigAfterMove = window.storeScene?.xr?.rigPose ?? null;
          xr?.setStick?.('right', 1, 0);
          await new Promise((r) => setTimeout(r, 450));
          xr?.setStick?.('right', 0, 0);
          const rigAfterTurn = window.storeScene?.xr?.rigPose ?? null;
          xr?.trigger?.('right', true);
          await new Promise((r) => setTimeout(r, 150));
          xr?.trigger?.('right', false);
          const d = window.__xrDiagnostics?.();
          const hmd = xr?.getHeadsetPose?.();
          const exited = xr ? await xr.exit() : { ok: false };
          await new Promise((r) => setTimeout(r, 400));
          const entered2 = xr ? await xr.enter() : { ok: false };
          await new Promise((r) => setTimeout(r, 800));
          await xr?.exit?.();
          return { entered, rigBefore, rigAfterMove, rigAfterTurn, d, hmd, exited, entered2 };
        });
        await shot(page, 'iwer-locomotion.png');
        await shot(page, 'iwer-controller-select.png');
        const moved = pre.rigAfterMove && pre.rigBefore &&
          (pre.rigAfterMove.x !== pre.rigBefore.x || pre.rigAfterMove.z !== pre.rigBefore.z);
        const turned = pre.rigAfterTurn && pre.rigAfterMove &&
          pre.rigAfterTurn.yaw !== pre.rigAfterMove.yaw;
        const world = pre.d?.startup?.firstWorldRenderCompletedAt != null
          && pre.d?.startup?.firstDirectRenderEnd != null;
        const layersAfterWorld = pre.d?.startup?.optionalLayersStart == null
          || (pre.d.startup.firstWorldRenderCompletedAt != null
            && pre.d.startup.optionalLayersStart >= pre.d.startup.firstWorldRenderCompletedAt);
        return {
          pass: !!pre.entered?.ok && !!pre.exited?.ok && !!pre.entered2?.ok && !!moved && !!turned && world && layersAfterWorld,
          moved: !!moved, turned: !!turned, layers: pre.d?.flags?.layers === false, world, layersAfterWorld, pre,
        };
      },
    ));

    evidence.scenarios.push(await runScenario(
      browser, 'FULL_XR', '?demo=1&nogate=1&xrEmu=1',
      async (page) => {
        await page.evaluate(() => localStorage.setItem('bb_locale', 'ja'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitStoreReady(page);
        const pre = await page.evaluate(async () => {
          const until = Date.now() + 15000;
          while (!window.__xrTest && Date.now() < until) {
            await new Promise((r) => setTimeout(r, 150));
          }
          const xr = window.__xrTest;
          const entered = xr ? await xr.enter() : { ok: false, error: 'no __xrTest' };
          const untilWorld = Date.now() + 5000;
          while (Date.now() < untilWorld) {
            const dWait = window.__xrDiagnostics?.();
            if (dWait?.startup?.firstWorldRenderCompletedAt != null) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          const d = window.__xrDiagnostics?.();
          xr?.trigger?.('right', true);
          await new Promise((r) => setTimeout(r, 200));
          xr?.trigger?.('right', false);
          await xr?.exit?.();
          return { entered, d, compositor: d?.compositorUi, layersFeature: d?.layersFeature };
        });
        await shot(page, 'iwer-japanese-ui.png');
        const world = pre.d?.startup?.firstWorldRenderCompletedAt != null
          && pre.d?.startup?.firstDirectRenderEnd != null;
        const layersAfterWorld = pre.d?.startup?.optionalLayersStart == null
          || (pre.d.startup.firstWorldRenderCompletedAt != null
            && pre.d.startup.optionalLayersStart >= pre.d.startup.firstWorldRenderCompletedAt);
        return {
          pass: !!pre.entered?.ok && world && layersAfterWorld,
          compositor: pre.compositor ?? 'unknown',
          layersFeature: pre.layersFeature,
          world, layersAfterWorld,
          iwerLayersBoundary: 'IWER Meta Quest 3 supportedFeatures do not include `layers`; compositor is mesh-fallback.',
          pre,
        };
      },
    ));

    // XR_SAFE TTI on the IWER GPU. `?demo=1&nogate=1` without xrEmu selects
    // DESKTOP_FULL, which overflows this Chromium's 16 texture units (26+
    // samplers) and is not the JP-3 measurement.
    evidence.scenarios.push(await runScenario(
      browser, 'BOOT_PERF', '?demo=1&nogate=1&xrEmu=1',
      async (page, boot) => {
        const t0 = Date.now();
        let diag = await page.evaluate(() => window.__bootDiagnostics?.());
        while (Date.now() - t0 < 180_000 && diag?.timeToFullTextures == null) {
          await new Promise((r) => setTimeout(r, 500));
          diag = await page.evaluate(() => window.__bootDiagnostics?.());
        }
        await shot(page, 'boot-performance.png');
        return {
          pass: diag?.timeToInteractive != null,
          waitedForFullTextures: diag?.timeToFullTextures != null,
          diag, boot,
        };
      },
    ));
  } finally {
    const xrDiag = evidence.scenarios.find((s) => s.name === 'CORE_XR');
    fs.writeFileSync(path.join(outDir, 'xr-diagnostics.json'), JSON.stringify(scrub({
      console: consoleLog.slice(-80).map((e) => ({ ...e, text: redact(e.text) })),
      serious: seriousErrors().map((e) => ({ ...e, text: redact(e.text) })),
      scenarios: evidence.scenarios.map((s) => ({
        name: s.name, pass: s.pass, url: s.url,
        iwer: s.iwer, presenting: s.presenting, firstFrame: s.firstFrame,
        moved: s.moved, turned: s.turned,
        compositor: s.compositor, layersFeature: s.layersFeature,
        iwerLayersBoundary: s.iwerLayersBoundary,
        waitedForFullTextures: s.waitedForFullTextures,
        diag: s.pre?.d1 ?? s.pre?.d ?? s.diag,
      })),
      unexpectedSerious: unexpectedSeriousErrors().map((e) => ({ ...e, text: redact(e.text) })),
    }), null, 2));
    fs.writeFileSync(path.join(outDir, 'boot-performance.json'), JSON.stringify(
      scrub(evidence.scenarios.find((s) => s.name === 'BOOT_PERF') ?? {}), null, 2));
    fs.writeFileSync(path.join(outDir, 'iwer-core-xr.json'), JSON.stringify(
      scrub(evidence.scenarios.find((s) => s.name === 'CORE_XR') ?? {}), null, 2));
    const noLayers = evidence.scenarios.find((s) => s.name === 'NO_LAYERS');
    fs.writeFileSync(path.join(outDir, 'iwer-locomotion.json'), JSON.stringify(scrub({
      name: 'NO_LAYERS',
      pass: noLayers?.pass,
      moved: noLayers?.moved,
      turned: noLayers?.turned,
      rigBefore: noLayers?.pre?.rigBefore,
      rigAfterMove: noLayers?.pre?.rigAfterMove,
      rigAfterTurn: noLayers?.pre?.rigAfterTurn,
    }), null, 2));
    await browser.close();
    killChild(child);
  }

  const scenarioFailures = evidence.scenarios.filter((s) => !s.pass);
  const unexpected = unexpectedSeriousErrors();
  const sampler = samplerWarnings();
  const pass = scenarioFailures.length === 0 && unexpected.length === 0 && sampler.length === 0;
  console.log(JSON.stringify({
    pass,
    scenarioFailures: scenarioFailures.length,
    unexpectedSeriousErrors: unexpected.length,
    samplerWarnings: sampler.length,
    scenarios: evidence.scenarios.map((s) => ({ name: s.name, pass: s.pass })),
    unexpectedSerious: unexpected.slice(0, 20).map((e) => ({ ...e, text: redact(e.text) })),
    sampler: sampler.slice(0, 20).map((e) => ({ ...e, text: redact(e.text) })),
  }, null, 2));
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  console.error(JSON.stringify(consoleLog.slice(-50), null, 2));
  process.exit(1);
});
