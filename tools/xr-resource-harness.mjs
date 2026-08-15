#!/usr/bin/env node
// Isolated Chromium + IWER resource harness. Never attaches to the owner's Chrome.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import {
  isAllowlisted,
  isSamplerOrGlFatal,
  populatedWindowImpossible,
  residencyImpossible,
} from './xr-harness-log.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'review', 'jp3');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halcyon-xr-resource-'));
const PORT = Number(process.env.HALCYON_XR_RESOURCE_PORT || 17426);
const BASE = `http://127.0.0.1:${PORT}`;
fs.mkdirSync(outDir, { recursive: true });

const consoleLog = [];
function attachConsole(page) {
  page.on('console', (msg) => consoleLog.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', (err) => consoleLog.push({ type: 'pageerror', text: String(err) }));
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

function killChild(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
  } else child.kill('SIGTERM');
}

function unexpectedSerious() {
  return consoleLog.filter((e) => e.type === 'pageerror' || e.type === 'error')
    .filter((e) => !isAllowlisted(e, consoleLog));
}

async function waitForPort(ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`dev server did not start on ${BASE}`);
}

async function ensureDevServer() {
  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: root, stdio: 'pipe', shell: process.platform === 'win32', env: { ...process.env, BROWSER: 'none' } },
  );
  await waitForPort();
  try { await fetch(`${BASE}/src/dev/iwer-runtime.ts`, { signal: AbortSignal.timeout(120_000) }); } catch { /* preload */ }
  return { child };
}

async function waitReady(page, { bare = false } = {}, ms = 240_000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await page.evaluate((wantBare) => {
      const boot = document.getElementById('boot-overlay');
      return {
        overlayHidden: boot ? !boot.classList.contains('visible') : true,
        scene: !!window.storeScene,
        xrTest: !!window.__xrTest,
        bare: !!window.__bareXr,
        tti: window.__bootDiagnostics?.()?.timeToInteractive ?? null,
      };
    }, bare).catch((err) => ({ error: String(err) }));
    if (bare) {
      if (last.bare && last.xrTest) return last;
    } else if (last.overlayHidden && last.scene && last.xrTest) return last;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`ready timeout: ${JSON.stringify(last)}`);
}

async function enterAndWaitWorld(page, { store = false } = {}) {
  return page.evaluate(async (wantStore) => {
    const until = Date.now() + 15000;
    while (!window.__xrTest && Date.now() < until) await new Promise((r) => setTimeout(r, 150));
    const xr = window.__xrTest;
    const entered = xr ? await xr.enter() : { ok: false, error: 'no __xrTest' };
    const t0 = Date.now();
    let d = window.__xrDiagnostics?.();
    while (Date.now() - t0 < 8000) {
      d = window.__xrDiagnostics?.();
      const gpu = window.__gpuDiagnostics?.();
      if (d?.startup?.firstWorldRenderCompletedAt != null) {
        if (!wantStore || gpu?.firstStoreXrRenderAt != null) break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const gpu = window.__gpuDiagnostics?.() ?? null;
    const heap = performance.memory ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
    } : null;
    return { entered, d, gpu, heap, tti: window.__bootDiagnostics?.()?.timeToInteractive ?? null };
  }, store);
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
    const bareBoot = await waitReady(barePage, { bare: true });
    const bareXr = await enterAndWaitWorld(barePage);
    const probes = {};
    const populated = {};
    for (const n of [200, 1000, 2000, 4000]) {
      probes[n] = await barePage.evaluate(async (count) => {
        const fn = window.__posterResourceProbe;
        return fn ? fn(count) : { error: 'no probe' };
      }, n);
      populated[n] = await barePage.evaluate(async (count) => {
        const fn = window.__posterResidencyProbe;
        return fn ? fn(count) : { error: 'no probe' };
      }, n);
    }
    await barePage.evaluate(async () => { await window.__xrTest?.exit?.(); });
    const bytes = [200, 1000, 2000, 4000].map((n) => probes[n]?.cpuBytes ?? null);
    const bounded = bytes.every((b) => typeof b === 'number')
      && bytes[3] <= bytes[1] * 1.1
      && bytes[0] === bytes[1];
    evidence.scenarios.push({
      name: 'BARE',
      pass: !!bareXr.entered?.ok && bareXr.d?.startup?.firstWorldRenderCompletedAt != null,
      boot: bareBoot,
      xr: bareXr,
    });
    for (const n of [200, 1000, 2000, 4000]) {
      const probe = probes[n];
      const pop = populated[n];
      evidence.scenarios.push({
        name: `XR_SAFE_${n}`,
        pass: bounded
          && typeof probe?.cpuBytes === 'number'
          && (probe.physicalSlots ?? 0) <= 256
          && probe.dualArrays === false
          && probe.cpuBytes === probes[200]?.cpuBytes
          && !populatedWindowImpossible(pop)
          && (pop.residentCount ?? 0) <= (pop.physicalSlots ?? 0)
          && (pop.uniqueOwners ?? 0) === (pop.residentCount ?? 0)
          && (pop.residentHighWaterMark ?? 0) <= (pop.physicalSlots ?? 0),
        probe,
        populated: pop,
      });
    }
    evidence.scenarios.push({
      name: 'POSTER_WINDOW',
      pass: bounded && [200, 1000, 2000, 4000].every((n) => !populatedWindowImpossible(populated[n])),
      probes,
      populated,
      bytes,
    });
    await barePage.close();

    const storePage = await browser.newPage();
    attachConsole(storePage);
    await storePage.goto(`${BASE}/?demo=1&nogate=1&xrEmu=1&xrSafe=1&xrMinimal=1`, {
      waitUntil: 'domcontentloaded', timeout: 60_000,
    });
    const storeBoot = await waitReady(storePage);
    const storeXr = await enterAndWaitWorld(storePage, { store: true });
    const locomotion = await storePage.evaluate(async () => {
      const xr = window.__xrTest;
      const gpu0 = window.__gpuDiagnostics?.() ?? null;
      const before = window.storeScene?.xr?.rigPose ?? null;
      const walk = async (x, y, ms) => {
        xr?.setStick?.('left', x, y);
        await new Promise((r) => setTimeout(r, ms));
        xr?.setStick?.('left', 0, 0);
      };
      await walk(0, -1, 800);
      xr?.setStick?.('right', 1, 0);
      await new Promise((r) => setTimeout(r, 400));
      xr?.setStick?.('right', 0, 0);
      await walk(1, 0, 700);
      await walk(-1, 0, 700);
      await walk(0, -1, 900);
      await walk(1, 0, 800);
      xr?.setStick?.('right', -1, 0);
      await new Promise((r) => setTimeout(r, 400));
      xr?.setStick?.('right', 0, 0);
      xr?.trigger?.('right', true);
      await new Promise((r) => setTimeout(r, 150));
      xr?.trigger?.('right', false);
      const after = window.storeScene?.xr?.rigPose ?? null;
      const gpu = window.__gpuDiagnostics?.() ?? null;
      const xrDiag = window.__xrDiagnostics?.() ?? null;
      await xr?.exit?.();
      return { before, after, gpu0, gpu, xrDiag };
    });
    const moved = locomotion.after && locomotion.before
      && (locomotion.after.x !== locomotion.before.x || locomotion.after.z !== locomotion.before.z);
    const gpu = locomotion.gpu ?? storeXr.gpu;
    const q = locomotion.xrDiag?.quality ?? storeXr.d?.quality;
    const storeResidencyOk = !residencyImpossible(gpu)
      && (gpu?.posterResidentTitles ?? 0) <= (gpu?.posterPhysicalSlots ?? 0)
      && (gpu?.posterDuplicatePhysicalOwners ?? 0) === 0
      && (gpu?.posterFreeOwnedCollisions ?? 0) === 0
      && gpu?.posterResidencyInvariantOk !== false
      && (gpu?.p0UniqueTitles ?? 0) <= (gpu?.posterPhysicalSlots ?? 0);
    const qualityAgrees = q?.n8ao === false
      && q?.postprocessing === 'none'
      && q?.framebufferScale === 0.5
      && gpu?.n8aoAllocated === false
      && gpu?.composerAllocated === false
      && gpu?.xrFramebufferScaleRequested === 0.5;
    evidence.scenarios.push({
      name: 'XR_SAFE_STORE',
      pass: !!storeXr.entered?.ok
        && storeXr.d?.startup?.firstWorldRenderCompletedAt != null
        && !!moved
        && (gpu?.posterPhysicalSlots ?? 0) <= 256
        && (gpu?.resourceProfile === 'XR_SAFE')
        && gpu?.composerAllocated === false
        && gpu?.n8aoAllocated === false
        && (gpu?.firstStoreXrRenderAt != null || gpu?.xrFrameCount >= 3)
        && storeResidencyOk
        && qualityAgrees,
      boot: storeBoot,
      xr: storeXr,
      locomotion,
      storeResidencyOk,
      qualityAgrees,
    });
    await storePage.close();
  } finally {
    fs.writeFileSync(path.join(outDir, 'xr-resource.json'), JSON.stringify({
      console: consoleLog.slice(-80).map((e) => ({ ...e, text: redact(e.text) })),
      scenarios: evidence.scenarios,
      sampler: consoleLog.filter(isSamplerOrGlFatal).map((e) => ({ ...e, text: redact(e.text) })),
      unexpectedSerious: unexpectedSerious().map((e) => ({ ...e, text: redact(e.text) })),
    }, null, 2));
    await browser.close();
    killChild(child);
  }

  const scenarioFailures = evidence.scenarios.filter((s) => !s.pass);
  const sampler = consoleLog.filter(isSamplerOrGlFatal);
  const unexpected = unexpectedSerious();
  const storeGpu = evidence.scenarios.find((s) => s.name === 'XR_SAFE_STORE')?.locomotion?.gpu
    ?? evidence.scenarios.find((s) => s.name === 'XR_SAFE_STORE')?.xr?.gpu;
  const impossible = residencyImpossible(storeGpu);
  const pass = scenarioFailures.length === 0 && sampler.length === 0 && unexpected.length === 0 && !impossible;
  console.log(JSON.stringify({
    pass,
    scenarioFailures: scenarioFailures.length,
    samplerWarnings: sampler.length,
    unexpectedSeriousErrors: unexpected.length,
    scenarios: evidence.scenarios.map((s) => ({ name: s.name, pass: s.pass })),
  }, null, 2));
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  console.error(JSON.stringify(consoleLog.slice(-40), null, 2));
  process.exit(1);
});
