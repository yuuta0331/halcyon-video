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

function requestedOptionalFeatures(payload) {
  const last = payload?.last;
  if (Array.isArray(last?.requestedOptionalFeatures) && last.requestedOptionalFeatures.length) {
    return last.requestedOptionalFeatures;
  }
  const d = payload?.d;
  if (Array.isArray(d?.requestedOptionalFeatures) && d.requestedOptionalFeatures.length) {
    return d.requestedOptionalFeatures;
  }
  for (const key of ['raw', 'threeBaseline', 'bare']) {
    const nested = d?.[key]?.requestedOptionalFeatures;
    if (Array.isArray(nested) && nested.length) return nested;
  }
  const journal = payload?.journal;
  if (Array.isArray(journal)) {
    const ev = [...journal].reverse().find((e) => e?.type === 'requestSession-start');
    const csv = ev?.detail?.requestedOptionalFeatures;
    if (typeof csv === 'string' && csv.length) return csv.split(',');
  }
  return Array.isArray(last?.requestedOptionalFeatures) ? last.requestedOptionalFeatures : [];
}

function diagnosticRequestClean(feats) {
  return Array.isArray(feats)
    && feats.includes('local-floor')
    && !feats.includes('layers')
    && !feats.includes('high-fixed-foveation-level');
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

async function runControlPage(browser, name, search, readyKey) {
  const page = await browser.newPage();
  attachConsole(page);
  const url = `${BASE}/${search}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const t0 = Date.now();
  let boot = null;
  while (Date.now() - t0 < 60_000) {
    boot = await page.evaluate((key) => ({
      ready: !!window[key],
      xrTest: !!window.__xrTest,
    }), readyKey).catch((err) => ({ error: String(err) }));
    if (boot?.ready && boot?.xrTest) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const xr = await page.evaluate(async () => {
    const api = window.__xrTest;
    const entered = api ? await api.enter() : { ok: false, error: 'no __xrTest' };
    const wait0 = Date.now();
    let d = window.__xrDiagnostics?.();
    while (Date.now() - wait0 < 8000) {
      d = window.__xrDiagnostics?.();
      if (d?.startup?.firstWorldRenderCompletedAt != null
        || d?.raw?.firstWorldRenderCompletedAt != null
        || d?.threeBaseline?.firstWorldRenderCompletedAt != null) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const last = window.__lastXrStartup?.() ?? null;
    const journal = window.__xrStartupJournal?.() ?? [];
    await api?.exit?.();
    return { entered, d, last, journal };
  });
  const world = xr.d?.startup?.firstWorldRenderCompletedAt != null
    || xr.d?.raw?.firstWorldRenderCompletedAt != null
    || xr.d?.threeBaseline?.firstWorldRenderCompletedAt != null;
  const feats = requestedOptionalFeatures(xr);
  const requestClean = diagnosticRequestClean(feats);
  await page.close();
  return {
    name,
    url,
    boot,
    pre: xr,
    requestedOptionalFeatures: feats,
    requestClean,
    pass: !!boot?.ready && !!xr.entered?.ok && world && requestClean,
  };
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
    protocolTimeout: 300_000,
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
      const last = window.__lastXrStartup?.() ?? null;
      const journal = window.__xrStartupJournal?.() ?? [];
      await xr?.exit?.();
      return { entered, d, gpu, last, journal };
    });
    const feats = requestedOptionalFeatures(bareXr);
    const requestClean = diagnosticRequestClean(feats);
    const barePass = !!bareReady?.bare && !!bareXr.entered?.ok
      && (bareXr.d?.startup?.firstWorldRenderCompletedAt != null || bareXr.d?.bare?.firstWorldRenderCompletedAt != null)
      && requestClean;
    evidence.scenarios.push({
      name: 'BARE',
      url: `${BASE}/?xrBare=1&xrEmu=1&nogate=1`,
      pass: barePass,
      boot: bareReady,
      pre: bareXr,
      requestedOptionalFeatures: feats,
      requestClean,
    });
    await barePage.close();

    evidence.scenarios.push(await runControlPage(
      browser, 'RAW_WEBXR', '?xrRaw=1&xrEmu=1&nogate=1', '__rawXr',
    ));
    evidence.scenarios.push(await runControlPage(
      browser, 'THREE_BASELINE', '?xrThreeBaseline=1&xrEmu=1&nogate=1', '__threeBaseline',
    ));

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
        const fpsAfterFirst = st?.targetFrameRateStart == null
          || st?.firstWorldRenderCompletedAt == null
          || st.firstWorldRenderCompletedAt <= st.targetFrameRateStart;
        const second = pre.entered2?.ok === true;
        return {
          pass: iwer && pre.entered?.ok && presenting && firstFrame && fpsAfterFirst && pre.exited?.ok && second,
          iwer, presenting, firstFrame, fpsAfterFirst, second, pre, shots: [shot1, shot2],
        };
      },
    ));

    evidence.scenarios.push(await runScenario(
      browser, 'BLUR_DURING_ENTRY', '?demo=1&nogate=1&xrEmu=1&xrMinimal=1',
      async (page) => {
        const pre = await page.evaluate(async () => {
          const until = Date.now() + 15000;
          while (!window.__xrTest && Date.now() < until) {
            await new Promise((r) => setTimeout(r, 150));
          }
          const xrNav = navigator.xr;
          if (!xrNav) return { entered: { ok: false, error: 'no navigator.xr' } };
          const orig = xrNav.requestSession.bind(xrNav);
          xrNav.requestSession = async (...args) => {
            window.dispatchEvent(new Event('blur'));
            return orig(...args);
          };
          const entered = await window.__xrTest.enter();
          const t0 = Date.now();
          let d = window.__xrDiagnostics?.();
          while (Date.now() - t0 < 8000) {
            d = window.__xrDiagnostics?.();
            if (d?.startup?.firstWorldRenderCompletedAt != null) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          const perf = window.storeScene?.getPerfInfo?.() ?? null;
          const frames0 = perf?.frames ?? 0;
          await new Promise((r) => setTimeout(r, 400));
          const frames1 = window.storeScene?.getPerfInfo?.()?.frames ?? 0;
          const journal = window.__xrStartupJournal?.() ?? [];
          await window.__xrTest?.exit?.();
          return {
            entered,
            world: d?.startup?.firstWorldRenderCompletedAt != null,
            firstWorldRenderCompletedAt: d?.startup?.firstWorldRenderCompletedAt ?? null,
            isRendering: perf?.isRendering === true,
            frameCount: d?.performance?.frameCount ?? 0,
            framesAdvanced: frames1 > frames0,
            blurLogged: journal.some((e) => e.type === 'window-blur'),
            fpsAfterFirst: d?.startup?.targetFrameRateStart == null
              || d?.startup?.firstWorldRenderCompletedAt == null
              || d.startup.firstWorldRenderCompletedAt <= d.startup.targetFrameRateStart,
          };
        });
        return {
          pass: !!pre.entered?.ok
            && pre.world
            && pre.isRendering
            && (pre.frameCount > 0 || pre.framesAdvanced)
            && pre.fpsAfterFirst !== false,
          pre,
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

    evidence.scenarios.push(await runScenario(
      browser, 'JP4A_UI', '?demo=1&nogate=1&xrEmu=1&xrSafe=1',
      async (page) => {
        const jp4aDir = path.join(root, 'docs', 'review', 'jp4a');
        fs.mkdirSync(jp4aDir, { recursive: true });
        const shotJp4a = async (name) => {
          const file = path.join(jp4aDir, name);
          await page.screenshot({ path: file, type: 'png' });
          return file;
        };
        const opened = await page.evaluate(async () => {
          const until = Date.now() + 15000;
          while (!window.__xrTest && Date.now() < until) {
            await new Promise((r) => setTimeout(r, 150));
          }
          const xr = window.__xrTest;
          const entered = xr ? await xr.enter() : { ok: false, error: 'no __xrTest' };
          const untilWorld = Date.now() + 8000;
          while (Date.now() < untilWorld) {
            const dWait = window.__xrDiagnostics?.();
            if (dWait?.startup?.firstWorldRenderCompletedAt != null) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          xr?.setControllerPose?.('right', { x: 0.2, y: 1.25, z: -0.25 });
          await new Promise((r) => setTimeout(r, 200));
          const d = window.__xrDiagnostics?.();
          const firstFrame = d?.startup?.firstWorldRenderCompletedAt != null;
          const ray = !!(window.storeScene?.scene?.getObjectByName?.('xr-target-ray'));
          const contentBefore = xr?.content?.() ?? window.__xrContent?.() ?? null;
          xr?.openMenu?.();
          await new Promise((r) => setTimeout(r, 250));
          const menuMode = xr?.uiMode?.();
          const rigBefore = window.storeScene?.xr?.rigPose ?? null;
          xr?.setStick?.('left', 0, -1);
          await new Promise((r) => setTimeout(r, 700));
          xr?.setStick?.('left', 0, 0);
          const rigDuringMenu = window.storeScene?.xr?.rigPose ?? null;
          const locomotionSuppressed = !!rigBefore && !!rigDuringMenu
            && rigBefore.x === rigDuringMenu.x && rigBefore.z === rigDuringMenu.z;
          xr?.openSettings?.();
          await new Promise((r) => setTimeout(r, 250));
          const settingsMode = xr?.uiMode?.();
          const localeBefore = localStorage.getItem('bb_locale');
          const outsideBefore = window.storeScene?.getOutsideMode?.();
          const draftLocale = xr?.settingsDraft?.()?.bb_locale;
          if (draftLocale !== 'en') {
            xr?.cycleSetting?.('bb_locale');
            xr?.applySettings?.();
            await new Promise((r) => setTimeout(r, 100));
          }
          xr?.cycleSetting?.('bb_locale');
          xr?.applySettings?.();
          await new Promise((r) => setTimeout(r, 200));
          const localeAfterApply = localStorage.getItem('bb_locale');
          const paintJa = xr?.uiPaint?.();
          xr?.cycleSetting?.('bb_outside');
          xr?.applySettings?.();
          await new Promise((r) => setTimeout(r, 200));
          const outsideAfterApply = window.storeScene?.getOutsideMode?.();
          const fpsBefore = localStorage.getItem('bb_fps_meter');
          xr?.cycleSetting?.('bb_fps_meter');
          xr?.applySettings?.();
          await new Promise((r) => setTimeout(r, 200));
          const fpsAfterApply = localStorage.getItem('bb_fps_meter');
          const fpsRuntime = window.__fpsMeter?.isOn?.() === true;
          const outsidePersisted = localStorage.getItem('bb_outside');
          return {
            entered,
            firstFrame,
            ray,
            menuMode,
            settingsMode,
            locomotionSuppressed,
            localeBefore,
            localeAfterApply,
            paintTitle: paintJa?.title ?? null,
            outsideBefore,
            outsideAfterApply,
            outsidePersisted,
            fpsBefore,
            fpsAfterApply,
            fpsRuntime,
            contentBefore,
          };
        });
        await shotJp4a('iwer-jp4a-settings.png');
        const closed = await page.evaluate(async () => {
          const xr = window.__xrTest;
          const localeBeforeCancel = localStorage.getItem('bb_locale');
          xr?.cycleSetting?.('bb_locale');
          xr?.cancelSettings?.();
          await new Promise((r) => setTimeout(r, 150));
          const localeAfterCancel = localStorage.getItem('bb_locale');
          const cancelDidNotPersist = localeAfterCancel === localeBeforeCancel;
          xr?.openMenu?.();
          await new Promise((r) => setTimeout(r, 150));
          xr?.squeeze?.('right', true);
          await new Promise((r) => setTimeout(r, 150));
          xr?.squeeze?.('right', false);
          await new Promise((r) => setTimeout(r, 250));
          const worldMode = xr?.uiMode?.();
          const rigWorld0 = window.storeScene?.xr?.rigPose ?? null;
          xr?.setStick?.('left', 0, -1);
          await new Promise((r) => setTimeout(r, 800));
          xr?.setStick?.('left', 0, 0);
          const rigWorld1 = window.storeScene?.xr?.rigPose ?? null;
          const locomotionResumed = !!rigWorld0 && !!rigWorld1
            && (rigWorld0.x !== rigWorld1.x || rigWorld0.z !== rigWorld1.z);
          xr?.openSettings?.();
          await new Promise((r) => setTimeout(r, 250));
          const localeReopen = localStorage.getItem('bb_locale');
          const outsideReopen = localStorage.getItem('bb_outside');
          const fpsReopen = localStorage.getItem('bb_fps_meter');
          const wrapsBeforeSelect = xr?.content?.()?.wraps ?? null;
          const selected = xr?.selectFirstTitle?.() ?? { ok: false };
          const untilWrap = Date.now() + 8000;
          let wrapsAfterSelect = xr?.content?.()?.wraps ?? null;
          while (Date.now() < untilWrap) {
            wrapsAfterSelect = xr?.content?.()?.wraps ?? null;
            if (wrapsAfterSelect?.activation === 'requested' && wrapsAfterSelect?.state === 'ready') break;
            await new Promise((r) => setTimeout(r, 150));
          }
          const content = xr?.content?.() ?? window.__xrContent?.() ?? null;
          const gpu = window.__gpuDiagnostics?.() ?? null;
          const worldReady = content?.worldReady === true;
          const decorativeDisabled = content?.decorativeFx?.state === 'disabled';
          const parity = worldReady && decorativeDisabled;
          await xr?.exit?.();
          return {
            worldMode,
            locomotionResumed,
            localeReopen,
            outsideReopen,
            fpsReopen,
            cancelDidNotPersist,
            wrapsBeforeSelect,
            selected,
            wrapsAfterSelect,
            content,
            worldReady,
            decorativeDisabled,
            parity,
            contextLost: gpu?.contextLost === true,
            posterPhysicalSlots: gpu?.posterPhysicalSlots ?? null,
            posterResidentTitles: gpu?.posterResidentTitles ?? null,
            posterHighWater: gpu?.posterResidentHighWaterMark ?? null,
            residencyOk: gpu?.posterResidencyInvariantOk ?? null,
            duplicateOwners: gpu?.posterDuplicatePhysicalOwners ?? null,
            freeOwnedCollisions: gpu?.posterFreeOwnedCollisions ?? null,
            framebufferScale: gpu?.xrFramebufferScaleRequested ?? null,
          };
        });
        await shotJp4a('iwer-jp4a-japanese.png');
        const pass = !!opened.entered?.ok
          && opened.firstFrame
          && opened.menuMode === 'MENU'
          && opened.settingsMode === 'SETTINGS'
          && closed.worldMode === 'WORLD'
          && opened.locomotionSuppressed === true
          && closed.locomotionResumed === true
          && opened.localeAfterApply === 'ja'
          && (opened.paintTitle === 'ストア設定' || /設定/.test(String(opened.paintTitle || '')))
          && closed.localeReopen === 'ja'
          && opened.outsideAfterApply != null
          && opened.outsideAfterApply !== opened.outsideBefore
          && opened.fpsRuntime === true
          && closed.cancelDidNotPersist === true
          && closed.worldReady === true
          && closed.decorativeDisabled === true
          && closed.parity === true
          && closed.contextLost !== true
          && closed.residencyOk !== false
          && (closed.posterPhysicalSlots == null || closed.posterPhysicalSlots >= (closed.content?.poster?.visible ?? 0))
          && (closed.framebufferScale == null || closed.framebufferScale === 0.8)
          && closed.wrapsBeforeSelect?.activation === 'idle'
          && closed.wrapsAfterSelect?.activation === 'requested'
          && closed.wrapsAfterSelect?.state === 'ready';
        fs.writeFileSync(path.join(jp4aDir, 'iwer-jp4a-ui.json'), JSON.stringify(scrub({
          classification: 'IWER_EMULATED',
          notQuestHardware: true,
          pass,
          opened,
          closed,
          shots: ['iwer-jp4a-settings.png', 'iwer-jp4a-japanese.png'],
        }), null, 2));
        return {
          pass,
          firstFrame: opened.firstFrame,
          menuMode: opened.menuMode,
          settingsMode: opened.settingsMode,
          worldMode: closed.worldMode,
          locomotionSuppressed: opened.locomotionSuppressed,
          locomotionResumed: closed.locomotionResumed,
          localeAfterApply: opened.localeAfterApply,
          outsideAfterApply: opened.outsideAfterApply,
          fpsRuntime: opened.fpsRuntime,
          cancelDidNotPersist: closed.cancelDidNotPersist,
          worldReady: closed.worldReady,
          wrapsAfterSelect: closed.wrapsAfterSelect,
          parity: closed.parity,
          content: closed.content,
        };
      },
    ));

    evidence.scenarios.push(await runScenario(
      browser, 'JP4A_NORMAL_STABLE_STORE', '?demo=1&nogate=1&xrEmu=1&xrSafe=1',
      async (page) => {
        const jp4aDir = path.join(root, 'docs', 'review', 'jp4a');
        fs.mkdirSync(jp4aDir, { recursive: true });
        const walked = await page.evaluate(async () => {
          const readiness = () => window.__storeReadiness?.() ?? null;
          const untilReady = Date.now() + 120000;
          while (Date.now() < untilReady) {
            const r = readiness();
            if (r?.visualReady) break;
            await new Promise((res) => setTimeout(res, 200));
          }
          const before = {
            ready: readiness(),
            gpu: window.__gpuDiagnostics?.(),
            ws: window.__posterWorkingSet?.(),
            perf: window.__xrPerfDiagnostics?.(),
          };
          const scene = window.storeScene;
          const cam = scene?.camera;
          const start = cam ? { x: cam.position.x, y: cam.position.y, z: cam.position.z } : null;
          const backZ = scene?.backWallZ ?? -20;
          if (cam) {
            cam.position.z = (start.z + backZ) / 2;
            scene.requestRender?.();
            await new Promise((r) => setTimeout(r, 400));
            cam.position.z = backZ + 2;
            cam.rotation.y = Math.PI;
            scene.requestRender?.();
            await new Promise((r) => setTimeout(r, 400));
            for (let i = 0; i < 8; i++) {
              cam.rotation.y += Math.PI / 4;
              scene.requestRender?.();
              await new Promise((r) => setTimeout(r, 80));
            }
            cam.position.x = start.x;
            cam.position.z = start.z;
            scene.requestRender?.();
          }
          await new Promise((r) => setTimeout(r, 10_000));
          const after = {
            ready: readiness(),
            gpu: window.__gpuDiagnostics?.(),
            ws: window.__posterWorkingSet?.(),
            perf: window.__xrPerfDiagnostics?.(),
            content: window.__xrContent?.() ?? window.__gpuDiagnostics?.()?.xrContent ?? null,
          };
          return {
            start,
            before,
            after,
            visualReady: after.ready?.visualReady === true,
            worldReady: after.ready?.worldReady === true || after.content?.worldReady === true,
            requiredReady: after.ready?.requiredReady === true || after.content?.requiredReady === true,
            content: after.content,
            evictionDelta: (after.gpu?.posterEvictionCount ?? 0) - (before.gpu?.posterEvictionCount ?? 0),
            reacqDelta: (after.gpu?.posterReacquisitionCount ?? 0) - (before.gpu?.posterReacquisitionCount ?? 0),
            decodeDelta: (after.ws?.posterDecodeJobsStarted ?? 0) - (before.ws?.posterDecodeJobsStarted ?? 0),
            uploadDelta: (after.ws?.posterUploadJobsStarted ?? 0) - (before.ws?.posterUploadJobsStarted ?? 0),
            baseUploadDelta: (after.ready?.pendingBaseUpload ?? after.perf?.STORE_VISIBLE_BASE?.pendingUpload ?? 0)
              - (before.ready?.pendingBaseUpload ?? before.perf?.STORE_VISIBLE_BASE?.pendingUpload ?? 0),
            baseDecodeDelta: (after.ready?.pendingBaseDecode ?? 0) - (before.ready?.pendingBaseDecode ?? 0),
            fallbackReplacementDelta: (after.ready?.fallbackReplacementCount ?? 0)
              - (before.ready?.fallbackReplacementCount ?? 0),
            pendingBaseAtReady: before.ready?.pendingBaseWork ?? before.perf?.STORE_VISIBLE_BASE?.pendingWork ?? null,
            pendingBaseUploadAtReady: before.ready?.pendingBaseUpload ?? null,
            residentBefore: before.gpu?.posterResidentTitles ?? null,
            residentAfter: after.gpu?.posterResidentTitles ?? null,
            posterWidth: after.gpu?.posterBaseWidth ?? after.gpu?.shelfWidth ?? null,
            posterHeight: after.gpu?.posterBaseHeight ?? after.gpu?.shelfHeight ?? null,
            cpuBytes: after.gpu?.posterCpuBytesAllocated ?? after.gpu?.posterArrayCpuBytesEstimated ?? null,
            cpuBytesActive: after.gpu?.posterCpuBytesActive ?? null,
            realUploads: after.ready?.postersUploaded ?? null,
            fallbacks: after.ready?.postersFallback ?? null,
            QUEST_HARDWARE: 'NOT_EXECUTED',
          };
        });
        fs.writeFileSync(path.join(jp4aDir, 'jp4a-normal-stable-store.json'), JSON.stringify(scrub(walked), null, 2));
        const pass = walked.visualReady === true
          && walked.worldReady === true
          && walked.requiredReady === true
          && walked.evictionDelta === 0
          && walked.reacqDelta === 0
          && walked.decodeDelta === 0
          && walked.uploadDelta === 0
          && (walked.baseUploadDelta ?? 0) === 0
          && (walked.fallbackReplacementDelta ?? 0) === 0
          && (walked.pendingBaseAtReady ?? 0) === 0
          && walked.residentBefore === walked.residentAfter
          && (walked.residentAfter ?? 0) > 0;
        return { pass, ...walked };
      },
    ));

    evidence.scenarios.push(await runScenario(
      browser, 'JP4A_ROUND4_XR', '?demo=1&nogate=1&xrEmu=1&xrSafe=1',
      async (page) => {
        const jp4aDir = path.join(root, 'docs', 'review', 'jp4a');
        fs.mkdirSync(jp4aDir, { recursive: true });
        const result = await page.evaluate(async () => {
          const untilReady = Date.now() + 120000;
          while (Date.now() < untilReady) {
            if (window.__storeReadiness?.()?.visualReady) break;
            await new Promise((r) => setTimeout(r, 200));
          }
          const visualReady = window.__storeReadiness?.()?.visualReady === true;
          const readySnap = window.__storeReadiness?.();
          const perfBefore = window.__xrPerfDiagnostics?.();
          const contentBefore = window.__xrContent?.() ?? window.__gpuDiagnostics?.()?.xrContent ?? null;
          const pendingBaseAtEntry = readySnap?.pendingBaseWork ?? perfBefore?.STORE_VISIBLE_BASE?.pendingWork ?? null;
          const pendingBaseUploadAtEntry = readySnap?.pendingBaseUpload
            ?? perfBefore?.STORE_VISIBLE_BASE?.pendingUpload ?? null;
          const xr = window.__xrTest;
          const entered = xr ? await xr.enter() : { ok: false, error: 'no __xrTest' };
          const untilWorld = Date.now() + 8000;
          while (Date.now() < untilWorld) {
            if (window.__xrDiagnostics?.()?.startup?.firstWorldRenderCompletedAt != null) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          const gpu0 = window.__gpuDiagnostics?.();
          const ws0 = window.__posterWorkingSet?.();
          xr?.setStick?.('left', 0, -1);
          await new Promise((r) => setTimeout(r, 1200));
          xr?.setStick?.('left', 0, 0);
          xr?.setStick?.('right', 1, 0);
          await new Promise((r) => setTimeout(r, 400));
          xr?.setStick?.('right', 0, 0);
          xr?.openMenu?.();
          await new Promise((r) => setTimeout(r, 200));
          const menuPaint = xr?.uiPaint?.();
          xr?.setStick?.('left', 0, -1);
          await new Promise((r) => setTimeout(r, 120));
          xr?.setStick?.('left', 0, 0);
          const menuAfterUp = xr?.uiPaint?.();
          xr?.setStick?.('left', 0, 1);
          await new Promise((r) => setTimeout(r, 120));
          xr?.setStick?.('left', 0, 0);
          const menuAfterDown = xr?.uiPaint?.();
          xr?.primaryButton?.('right', true);
          await new Promise((r) => setTimeout(r, 80));
          xr?.primaryButton?.('right', false);
          await new Promise((r) => setTimeout(r, 200));
          const afterPrimary = xr?.uiMode?.();
          xr?.openSettings?.();
          await new Promise((r) => setTimeout(r, 150));
          if (window.__fpsMeter?.isOn?.() !== true) {
            xr?.cycleSetting?.('bb_fps_meter');
            xr?.applySettings?.();
          }
          await new Promise((r) => setTimeout(r, 400));
          const fpsOn = window.__fpsMeter?.isOn?.() === true;
          const fpsHud = !!window.storeScene?.scene?.getObjectByName?.('xr-fps-hud')
            || !!window.storeScene?.xr?.rig?.xrOrigin?.getObjectByName?.('xr-fps-hud');
          xr?.squeeze?.('right', true);
          await new Promise((r) => setTimeout(r, 80));
          xr?.squeeze?.('right', false);
          await new Promise((r) => setTimeout(r, 150));
          xr?.squeeze?.('right', true);
          await new Promise((r) => setTimeout(r, 80));
          xr?.squeeze?.('right', false);
          await new Promise((r) => setTimeout(r, 200));
          for (let i = 0; i < 3 && xr?.uiMode?.() !== 'WORLD'; i++) {
            xr?.squeeze?.('right', true);
            await new Promise((r) => setTimeout(r, 80));
            xr?.squeeze?.('right', false);
            await new Promise((r) => setTimeout(r, 200));
          }
          const worldMode = xr?.uiMode?.();
          await new Promise((r) => setTimeout(r, 3000));
          const gpu1 = window.__gpuDiagnostics?.();
          const ws1 = window.__posterWorkingSet?.();
          const perf = window.__xrPerfDiagnostics?.();
          const content = xr?.content?.();
          await xr?.exit?.();
          return {
            visualReady,
            pendingBaseAtEntry,
            pendingBaseUploadAtEntry,
            worldReadyBefore: contentBefore?.worldReady === true || readySnap?.worldReady === true,
            requiredReadyBefore: contentBefore?.requiredReady === true || readySnap?.requiredReady === true,
            entered,
            framebufferScale: gpu1?.xrFramebufferScaleRequested ?? gpu0?.xrFramebufferScaleRequested,
            foveation: gpu1?.xrFoveationRequested ?? gpu0?.xrFoveationRequested,
            menuLegend: menuPaint?.legend ?? null,
            menuAfterUp,
            menuAfterDown,
            afterPrimary,
            fpsOn,
            fpsHud,
            worldMode,
            evictionDelta: (gpu1?.posterEvictionCount ?? 0) - (gpu0?.posterEvictionCount ?? 0),
            reacqDelta: (gpu1?.posterReacquisitionCount ?? 0) - (gpu0?.posterReacquisitionCount ?? 0),
            decodeDelta: (ws1?.posterDecodeJobsStarted ?? 0) - (ws0?.posterDecodeJobsStarted ?? 0),
            contextLost: gpu1?.contextLost === true,
            content,
            perf,
            classification: 'IWER_EMULATED',
            QUEST_HARDWARE: 'NOT_EXECUTED',
          };
        });
        fs.writeFileSync(path.join(jp4aDir, 'iwer-jp4a-round4.json'), JSON.stringify(scrub(result), null, 2));
        fs.writeFileSync(path.join(jp4aDir, 'iwer-jp4a-round4.1.json'), JSON.stringify(scrub({
          ...result,
          round: '4.1',
          classification: 'IWER_EMULATED',
          QUEST_HARDWARE: 'NOT_EXECUTED',
        }), null, 2));
        const pass = result.visualReady === true
          && result.worldReadyBefore === true
          && result.requiredReadyBefore === true
          && (result.pendingBaseAtEntry ?? 0) === 0
          && (result.pendingBaseUploadAtEntry ?? 0) === 0
          && !!result.entered?.ok
          && result.framebufferScale === 0.8
          && result.foveation === 0.5
          && result.evictionDelta === 0
          && result.reacqDelta === 0
          && result.fpsOn === true
          && result.worldMode === 'WORLD'
          && result.contextLost !== true
          && Array.isArray(result.menuLegend) && result.menuLegend.length >= 4;
        return { pass, ...result };
      },
    ));

    evidence.scenarios.push(await runScenario(
      browser, 'JP4A_ROUND5A_XR', '?demo=1&nogate=1&xrEmu=1&xrSafe=1',
      async (page) => {
        const jp4aDir = path.join(root, 'docs', 'review', 'jp4a');
        fs.mkdirSync(jp4aDir, { recursive: true });
        const result = await page.evaluate(async () => {
          const untilReady = Date.now() + 120000;
          while (Date.now() < untilReady) {
            if (window.__storeReadiness?.()?.visualReady) break;
            await new Promise((r) => setTimeout(r, 200));
          }
          const xr = window.__xrTest;
          const entered = xr ? await xr.enter() : { ok: false, error: 'no __xrTest' };
          const untilWorld = Date.now() + 8000;
          while (Date.now() < untilWorld) {
            if (window.__xrDiagnostics?.()?.startup?.firstWorldRenderCompletedAt != null) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          xr?.openMenu?.();
          await new Promise((r) => setTimeout(r, 200));
          const paint1 = xr?.uiPaint?.();
          const pose1 = xr?.getHeadsetPose?.();
          xr?.setHeadsetPose?.({ y: (pose1?.y ?? 1.6), qy: 0.707, qw: 0.707 });
          xr?.openMenu?.();
          await new Promise((r) => setTimeout(r, 200));
          const paint2 = xr?.uiPaint?.();
          const stereo = window.__stereoSignage?.() ?? null;
          const closeRange = window.__closeRangeProbe?.() ?? null;
          const detail = window.__posterDetail?.() ?? null;
          const perf = window.__xrPerfDiagnostics?.() ?? null;
          const gpu = window.__gpuDiagnostics?.() ?? null;
          const ready = window.__storeReadiness?.() ?? null;
          return {
            entered,
            visualReady: ready?.visualReady === true,
            worldReady: gpu?.xrContent?.worldReady === true,
            uiOpen: paint1?.title != null && paint2?.title != null,
            stereoPass: stereo?.pass === true,
            stereoNegative: stereo?.negativeControl === true,
            stereoSampleCount: stereo?.samples?.length ?? 0,
            closeRangeHidden: (closeRange?.samples ?? []).reduce((n, s) => n + (s.hidden ?? 0), 0),
            closeRangeDisposed: (closeRange?.samples ?? []).reduce((n, s) => n + (s.disposedMaterials ?? 0), 0),
            detailLimit: detail?.slotLimit ?? null,
            detailResident: detail?.resident ?? null,
            detailWidth: detail?.width ?? null,
            detailHeight: detail?.height ?? null,
            baseWidth: gpu?.posterBaseWidth ?? null,
            baseHeight: gpu?.posterBaseHeight ?? null,
            contextLost: gpu?.contextLost === true,
            framebufferScale: 0.8,
            classification: 'IWER_EMULATED',
            QUEST_HARDWARE: 'NOT_EXECUTED',
            frame: perf?.FRAME ?? null,
            highRes: perf?.HIGH_RES ?? detail,
          };
        });
        fs.writeFileSync(
          path.join(jp4aDir, 'jp4a-round5a-iwer.json'),
          JSON.stringify(scrub(result), null, 2),
        );
        const pass = !!result.entered?.ok
          && result.visualReady === true
          && result.worldReady === true
          && result.stereoPass === true
          && result.stereoNegative === true
          && (result.closeRangeHidden ?? 1) === 0
          && (result.closeRangeDisposed ?? 1) === 0
          && (result.detailLimit ?? 0) === 64
          && result.contextLost !== true
          && result.baseWidth !== 8
          && result.detailWidth === 320;
        return { pass, ...result };
      },
    ));

    evidence.scenarios.push(await runScenario(
      browser, 'JP4A_ROUND5A1_XR', '?demo=1&nogate=1&xrEmu=1&xrSafe=1',
      async (page) => {
        const jp4aDir = path.join(root, 'docs', 'review', 'jp4a');
        fs.mkdirSync(jp4aDir, { recursive: true });
        const result = await page.evaluate(async () => {
          const untilReady = Date.now() + 120000;
          while (Date.now() < untilReady) {
            if (window.__storeReadiness?.()?.visualReady) break;
            await new Promise((r) => setTimeout(r, 200));
          }
          const xr = window.__xrTest;
          const entered = xr ? await xr.enter() : { ok: false, error: 'no __xrTest' };
          const untilWorld = Date.now() + 8000;
          while (Date.now() < untilWorld) {
            if (window.__xrDiagnostics?.()?.startup?.firstWorldRenderCompletedAt != null) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          xr?.selectFirstTitle?.();
          window.__posterDetailForceMiss?.();
          const untilDetail = Date.now() + 45000;
          let detail = window.__posterDetail?.() ?? null;
          while (Date.now() < untilDetail) {
            detail = window.__posterDetail?.() ?? null;
            if ((detail?.decoded ?? 0) > 0 && (detail?.uploaded ?? 0) > 0 && (detail?.readyResident ?? 0) > 0) break;
            await new Promise((r) => setTimeout(r, 200));
          }
          xr?.openMenu?.();
          await new Promise((r) => setTimeout(r, 200));
          const paint1 = xr?.uiPaint?.();
          const pose1 = xr?.getHeadsetPose?.();
          xr?.setHeadsetPose?.({ y: (pose1?.y ?? 1.6), qy: 0.707, qw: 0.707 });
          xr?.openMenu?.();
          await new Promise((r) => setTimeout(r, 200));
          const paint2 = xr?.uiPaint?.();
          const stereo = window.__stereoSignage?.() ?? null;
          const closeRange = window.__closeRangeProbe?.() ?? null;
          const perf = window.__xrPerfDiagnostics?.() ?? null;
          const gpu = window.__gpuDiagnostics?.() ?? null;
          const ready = window.__storeReadiness?.() ?? null;
          return {
            entered,
            visualReady: ready?.visualReady === true,
            worldReady: gpu?.xrContent?.worldReady === true,
            uiOpen: paint1?.title != null && paint2?.title != null,
            stereoPass: stereo?.pass === true,
            stereoNegative: stereo?.negativeControl === true,
            stereoSampleCount: stereo?.samples?.length ?? 0,
            closeRangeHidden: (closeRange?.samples ?? []).reduce((n, s) => n + (s.hidden ?? 0), 0),
            closeRangeDisposed: (closeRange?.samples ?? []).reduce((n, s) => n + (s.disposedMaterials ?? 0), 0),
            detailLimit: detail?.slotLimit ?? null,
            leased: detail?.leased ?? detail?.resident ?? null,
            pendingPixels: detail?.pendingPixels ?? null,
            pendingUpload: detail?.pendingUpload ?? null,
            decoded: detail?.decoded ?? null,
            uploaded: detail?.uploaded ?? null,
            readyResident: detail?.readyResident ?? null,
            promoted: detail?.promoted ?? null,
            demoted: detail?.demoted ?? null,
            evicted: detail?.evicted ?? null,
            reacquired: detail?.reacquired ?? null,
            staleDropped: detail?.staleDropped ?? null,
            requested: detail?.requested ?? null,
            detailWidth: detail?.width ?? null,
            detailHeight: detail?.height ?? null,
            lutCapacity: detail?.lutCapacity ?? null,
            lutOk: detail?.lutOk ?? null,
            textureCreates: detail?.textureCreates ?? null,
            textureDisposals: detail?.textureDisposals ?? null,
            baseWidth: gpu?.posterBaseWidth ?? null,
            baseHeight: gpu?.posterBaseHeight ?? null,
            contextLost: gpu?.contextLost === true,
            framebufferScale: 0.8,
            foveation: 0.5,
            classification: 'IWER_EMULATED',
            QUEST_HARDWARE: 'NOT_EXECUTED',
            frame: perf?.FRAME ?? null,
            highRes: perf?.HIGH_RES ?? detail,
          };
        });
        fs.writeFileSync(
          path.join(jp4aDir, 'jp4a-round5a1-iwer.json'),
          JSON.stringify(scrub(result), null, 2),
        );
        const pass = !!result.entered?.ok
          && result.visualReady === true
          && result.worldReady === true
          && result.stereoPass === true
          && result.stereoNegative === true
          && (result.closeRangeHidden ?? 1) === 0
          && (result.closeRangeDisposed ?? 1) === 0
          && (result.detailLimit ?? 0) === 64
          && (result.decoded ?? 0) > 0
          && (result.uploaded ?? 0) > 0
          && (result.readyResident ?? 0) > 0
          && result.contextLost !== true
          && result.detailWidth === 320
          && result.QUEST_HARDWARE === 'NOT_EXECUTED'
          && result.classification === 'IWER_EMULATED';
        return { pass, ...result };
      },
    ));

    evidence.scenarios.push(await runScenario(
      browser, 'JP4A_ROUND5A2_XR', '?demo=1&nogate=1&xrEmu=1&xrSafe=1',
      async (page) => {
        const jp4aDir = path.join(root, 'docs', 'review', 'jp4a');
        fs.mkdirSync(jp4aDir, { recursive: true });
        const result = await page.evaluate(async () => {
          const untilReady = Date.now() + 120000;
          while (Date.now() < untilReady) {
            if (window.__storeReadiness?.()?.visualReady) break;
            await new Promise((r) => setTimeout(r, 200));
          }
          const xr = window.__xrTest;
          const entered = xr ? await xr.enter() : { ok: false, error: 'no __xrTest' };
          const untilWorld = Date.now() + 8000;
          while (Date.now() < untilWorld) {
            if (window.__xrDiagnostics?.()?.startup?.firstWorldRenderCompletedAt != null) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          xr?.selectFirstTitle?.();
          window.__posterDetailForceMiss?.();
          const untilDetail = Date.now() + 45000;
          let detail = window.__posterDetail?.() ?? null;
          while (Date.now() < untilDetail) {
            detail = window.__posterDetail?.() ?? null;
            if ((detail?.decoded ?? 0) > 0 && (detail?.uploaded ?? 0) > 0 && (detail?.readyResident ?? 0) > 0
              && (detail?.pendingPixels ?? 1) === 0 && (detail?.pendingUpload ?? 1) === 0) break;
            await new Promise((r) => setTimeout(r, 200));
          }
          xr?.openMenu?.();
          await new Promise((r) => setTimeout(r, 200));
          const stereo = window.__stereoSignage?.() ?? null;
          const closeRange = window.__closeRangeProbe?.() ?? null;
          const gpu = window.__gpuDiagnostics?.() ?? null;
          const ready = window.__storeReadiness?.() ?? null;
          const perf = window.__xrPerfDiagnostics?.() ?? null;
          return {
            entered,
            visualReady: ready?.visualReady === true,
            worldReady: gpu?.xrContent?.worldReady === true,
            stereoPass: stereo?.pass === true,
            stereoNegative: stereo?.negativeControl === true,
            stereoSampleCount: stereo?.samples?.length ?? 0,
            closeRangeHidden: (closeRange?.samples ?? []).reduce((n, s) => n + (s.hidden ?? 0), 0),
            closeRangeDisposed: (closeRange?.samples ?? []).reduce((n, s) => n + (s.disposedMaterials ?? 0), 0),
            decoded: detail?.decoded ?? null,
            uploaded: detail?.uploaded ?? null,
            readyResident: detail?.readyResident ?? null,
            pendingPixels: detail?.pendingPixels ?? null,
            pendingUpload: detail?.pendingUpload ?? null,
            leased: detail?.leased ?? null,
            loadFailed: detail?.loadFailed ?? null,
            detailWidth: detail?.width ?? null,
            detailHeight: detail?.height ?? null,
            detailLimit: detail?.slotLimit ?? null,
            lutCapacity: detail?.lutCapacity ?? null,
            baseWidth: gpu?.posterBaseWidth ?? null,
            baseHeight: gpu?.posterBaseHeight ?? null,
            contextLost: gpu?.contextLost === true,
            framebufferScale: 0.8,
            foveation: 0.5,
            classification: 'IWER_EMULATED',
            QUEST_HARDWARE: 'NOT_EXECUTED',
            frame: perf?.FRAME ?? null,
            highRes: perf?.HIGH_RES ?? detail,
          };
        });
        fs.writeFileSync(
          path.join(jp4aDir, 'jp4a-round5a2-iwer.json'),
          JSON.stringify(scrub(result), null, 2),
        );
        const pass = !!result.entered?.ok
          && result.visualReady === true
          && result.worldReady === true
          && result.stereoPass === true
          && result.stereoNegative === true
          && (result.closeRangeHidden ?? 1) === 0
          && (result.closeRangeDisposed ?? 1) === 0
          && (result.decoded ?? 0) > 0
          && (result.uploaded ?? 0) > 0
          && (result.readyResident ?? 0) > 0
          && (result.pendingPixels ?? 1) === 0
          && (result.pendingUpload ?? 1) === 0
          && result.detailWidth === 320
          && result.detailHeight === 480
          && result.framebufferScale === 0.8
          && result.foveation === 0.5
          && (result.baseWidth == null || result.baseWidth === 96)
          && result.contextLost !== true
          && result.QUEST_HARDWARE === 'NOT_EXECUTED'
          && result.classification === 'IWER_EMULATED';
        return { pass, ...result };
      },
    ));

    evidence.scenarios.push(await runScenario(
      browser, 'JP4A_ROUND5B_XR', '?demo=1&nogate=1&xrEmu=1&xrSafe=1&xrPosterHwDiag=1',
      async (page) => {
        const jp4aDir = path.join(root, 'docs', 'review', 'jp4a');
        fs.mkdirSync(jp4aDir, { recursive: true });
        const result = await page.evaluate(async () => {
          const untilReady = Date.now() + 120000;
          while (Date.now() < untilReady) {
            if (window.__storeReadiness?.()?.visualReady) break;
            await new Promise((r) => setTimeout(r, 200));
          }
          const xr = window.__xrTest;
          const entered = xr ? await xr.enter() : { ok: false, error: 'no __xrTest' };
          const untilWorld = Date.now() + 8000;
          while (Date.now() < untilWorld) {
            if (window.__xrDiagnostics?.()?.startup?.firstWorldRenderCompletedAt != null) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          xr?.setHeadsetPose?.({ x: 0, y: 1.6, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 });
          await new Promise((r) => setTimeout(r, 200));
          xr?.openMenu();
          const untilMenu = Date.now() + 2000;
          let pose = window.__xrViewerPose?.() ?? null;
          let placed = window.__xrUiPlacement?.() ?? null;
          while (Date.now() < untilMenu) {
            pose = window.__xrViewerPose?.() ?? null;
            placed = window.__xrUiPlacement?.() ?? null;
            if (pose?.source === 'XR_VIEWER_POSE' && placed?.source === 'XR_VIEWER_POSE') break;
            await new Promise((r) => setTimeout(r, 50));
          }
          const stereo = window.__stereoSignage?.() ?? null;
          const modes = [];
          let mode = window.__hwPosterDiag?.()?.mode ?? null;
          modes.push(mode);
          for (let i = 0; i < 4; i++) {
            window.__cycleHwPosterDiag?.();
            await new Promise((r) => setTimeout(r, 50));
            modes.push(window.__hwPosterDiag?.()?.mode ?? null);
          }
          const gpu = window.__gpuDiagnostics?.() ?? null;
          const detail = window.__posterDetail?.() ?? null;
          const focus = window.__posterFocus?.() ?? null;
          const normalLaunch = window.__hardwarePosterDiagProbe
            ? null
            : null;
          const last = window.__hwPosterDiag?.() ?? null;
          return {
            entered,
            stereoPass: stereo?.pass === true,
            stereoNegative: stereo?.negativeControl === true,
            poseSource: pose?.source ?? null,
            poseValid: pose?.valid === true,
            menuSource: placed?.source ?? null,
            menuDistance: placed?.distanceFromViewer ?? null,
            diagModes: modes,
            diagEnabled: window.__hwPosterDiag?.()?.enabled === true,
            diagObserved: last?.observed ?? null,
            diagProduction: last?.production ?? null,
            diagWorldStable: last?.worldStable === true,
            contextLost: gpu?.contextLost === true,
            detailWidth: detail?.width ?? null,
            focusSlots: focus?.slotLimit ?? null,
            classification: 'IWER_EMULATED',
            QUEST_HARDWARE: 'NOT_EXECUTED',
            note: 'IWER_EMULATED logic only. Not hardware visual proof.',
          };
        });
        fs.writeFileSync(
          path.join(jp4aDir, 'jp4a-round5b-iwer.json'),
          JSON.stringify(scrub(result), null, 2),
        );
        fs.writeFileSync(
          path.join(jp4aDir, 'jp4a-round5b1-iwer.json'),
          JSON.stringify(scrub(result), null, 2),
        );
        const pass = !!result.entered?.ok
          && result.stereoPass === true
          && result.stereoNegative === true
          && result.poseSource === 'XR_VIEWER_POSE'
          && result.menuSource === 'XR_VIEWER_POSE'
          && result.diagEnabled === true
          && (result.diagModes ?? []).includes('A')
          && (result.diagModes ?? []).includes('E')
          && result.contextLost !== true
          && result.QUEST_HARDWARE === 'NOT_EXECUTED'
          && result.classification === 'IWER_EMULATED';
        return { pass, ...result };
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
        requestedOptionalFeatures: s.requestedOptionalFeatures ?? s.pre?.last?.requestedOptionalFeatures,
        requestClean: s.requestClean,
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
    scenarios: evidence.scenarios.map((s) => ({
      name: s.name,
      pass: s.pass,
      requestedOptionalFeatures: s.requestedOptionalFeatures,
      requestClean: s.requestClean,
    })),
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
