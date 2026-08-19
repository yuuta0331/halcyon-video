#!/usr/bin/env node
// Isolated short-route/browser persistence harness. The IWER query validates
// diagnostic wiring only; it is explicitly not Quest visual evidence.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'review', 'jp4a');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halcyon-jp4a-r5b3-'));
const port = Number(process.env.HALCYON_JP4A_PORT || 17433);
const base = `http://127.0.0.1:${port}`;
const logs = [];

function kill(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function waitForServer() {
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    try { if ((await fetch(base)).ok) return; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('JP4A harness server timeout');
}

const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: root, stdio: 'pipe', shell: process.platform === 'win32', env: { ...process.env, BROWSER: 'none' } });

let browser;
try {
  await waitForServer();
  // Avoid counting Vite's first optimizeDeps pass for IWER as application
  // startup; the shared XR harness uses the same warm-up.
  await fetch(`${base}/src/dev/iwer-runtime.ts`).catch(() => null);
  browser = await puppeteer.launch({
    headless: true, userDataDir: profileDir, protocolTimeout: 300_000,
    args: ['--no-sandbox', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage();
  page.on('console', (msg) => logs.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (err) => logs.push({ type: 'pageerror', text: String(err).slice(0, 300) }));
  const url = `${base}/xr-test/jp4a?demo=1&xrEmu=1&nogate=1`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('#jp4a-test-console', { timeout: 30_000 });
  const before = await page.evaluate(() => ({
    heading: document.querySelector('#jp4a-test-console h1')?.textContent,
    start: [...document.querySelectorAll('#jp4a-test-console button')].some((b) => b.textContent === 'START JP-4A TEST'),
    meta: document.querySelector('#jp4a-test-console div div')?.textContent ?? '',
  }));
  await page.screenshot({ path: path.join(outDir, 'jp4a-round5b3-console.png') });
  await page.evaluate(() => {
    const start = [...document.querySelectorAll('#jp4a-test-console button')]
      .find((b) => b.textContent === 'START JP-4A TEST');
    start?.click();
  });
  let storeStatus = null;
  const storeDeadline = Date.now() + 240_000;
  while (Date.now() < storeDeadline) {
    try {
      storeStatus = await page.evaluate(() => {
        const boot = window.__bootDiagnostics?.();
        const keepGoing = [...document.querySelectorAll('#jp4a-test-console button')]
          .find((b) => b.textContent === 'CONTINUE TO STORE');
        keepGoing?.click();
        return {
          storeScene: !!window.storeScene,
          xrTest: !!window.__xrTest,
          diagnostics: !!window.__xrDiagnostics,
          interactive: boot?.timeToInteractive != null,
          bootOverlayVisible: document.getElementById('boot-overlay')?.classList.contains('visible') ?? false,
        };
      });
    } catch (error) {
      if (!/Execution context was destroyed|detached Frame/i.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    if (storeStatus.storeScene && storeStatus.xrTest && storeStatus.diagnostics) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const exercised = await page.evaluate(async () => {
    const waitUntil = async (fn, timeout = 60_000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const value = fn();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return null;
    };
    const api = window.__xrTest;
    const entered = api ? await api.enter() : { ok: false, error: 'no __xrTest' };
    const world = await waitUntil(() => {
      const d = window.__xrDiagnostics?.();
      return d?.startup?.firstWorldRenderCompletedAt != null ? d : null;
    }, 15_000);
    await waitUntil(() => (window.__jp4aTestSnapshot?.()?.samples?.length ?? 0) >= 2, 5_000);
    const h = window.__jp4aTestHarness;
    h.lockOpaque('opaque-browser-fixture');
    const modes = [window.__jp4aTestSnapshot().mode];
    for (let i = 0; i < 8; i++) modes.push(h.cycleMode(1));
    h.markVerdict();
    h.recordSyntheticSample();
    const active = window.__jp4aTestSnapshot();
    await api?.exit?.();
    const completed = await waitUntil(() => window.__jp4aTestSnapshot?.()?.completedAt
      ? window.__jp4aTestSnapshot() : null, 5_000);
    return {
      entered, firstWorldRender: !!world, active, completed, modes,
      result: window.__jp4aTestResult(), json: window.__jp4aTestJson(),
    };
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('#jp4a-test-console', { timeout: 30_000 });
  const restored = await page.evaluate(() => ({
    heading: document.querySelector('#jp4a-test-console h1')?.textContent,
    session: window.__jp4aTestSnapshot(),
    result: window.__jp4aTestResult(),
    hasCopyResult: [...document.querySelectorAll('#jp4a-test-console button')].some((b) => b.textContent === 'COPY RESULT'),
    hasCopyJson: [...document.querySelectorAll('#jp4a-test-console button')].some((b) => b.textContent === 'COPY JSON'),
  }));
  const normal = await browser.newPage();
  await normal.goto(`${base}/?fps=0`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const normalConsoleAbsent = await normal.evaluate(() => !document.getElementById('jp4a-test-console'));
  const pass = before.heading === 'JP-4A TEST' && before.start && /Build: [0-9a-f]{40}/.test(before.meta)
    && exercised.entered?.ok && exercised.firstWorldRender
    && exercised.active.active === true
    && exercised.modes.length === 9 && new Set(exercised.modes).size === 9
    && restored.heading === 'TEST COMPLETE'
    && restored.session.samples.length >= 1
    && restored.hasCopyResult && restored.hasCopyJson
    && /opaque-browser-fixture/.test(restored.result)
    && normalConsoleAbsent;
  const evidence = {
    phase: 'ROUND5B.3_LIVE_SHELF_BLACK_AND_FRAME_HITCH_FIX',
    classification: 'IWER_EMULATED',
    scope: 'QUICK_TEST_CONSOLE_IWER_ENTRY_TELEMETRY_AND_PERSISTENCE',
    NOT_HARDWARE_VISUAL_PROOF: true,
    QUEST_HARDWARE: 'NOT_EXECUTED',
    pass,
    url: '/xr-test/jp4a',
    before,
    modeCycle: exercised.modes,
    iwerSession: {
      storeStatus,
      entered: exercised.entered,
      firstWorldRender: exercised.firstWorldRender,
      completed: !!exercised.completed?.completedAt,
    },
    activeSession: exercised.active,
    restored,
    normalConsoleAbsent,
    privacy: {
      containsTitle: /title|posterUrl|token/i.test(exercised.result),
      opaqueOnly: /opaque-browser-fixture/.test(exercised.result),
    },
    seriousErrors: logs.filter((x) => x.type === 'pageerror'
      || (x.type === 'error' && !/Failed to load resource:.*500/i.test(x.text))),
    knownDemoResourceErrors: logs.filter((x) => x.type === 'error'
      && /Failed to load resource:.*500/i.test(x.text)).length,
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'jp4a-round5b3-iwer.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ pass, evidence: 'docs/review/jp4a/jp4a-round5b3-iwer.json' }));
  if (!pass) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  kill(server);
  fs.rmSync(profileDir, { recursive: true, force: true });
}
