#!/usr/bin/env node
// Round 5B.3 HF1 IWER harness: same-page RESET/re-run plus truthful bank
// invariant evidence. This is not Quest visual proof.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'review', 'jp4a');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halcyon-jp4a-r5b3-hf1-'));
const port = Number(process.env.HALCYON_JP4A_PORT || 17434);
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
  throw new Error('JP4A HF1 harness server timeout');
}

function classifyInvariant(inv) {
  if (!inv) return 'NOT_EXERCISED';
  if (inv.verdict) return inv.verdict;
  if (!inv.checkedSlots) return 'NOT_EXERCISED';
  return inv.pass ? 'PASS' : 'FAIL';
}

const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: root, stdio: 'pipe', shell: process.platform === 'win32', env: { ...process.env, BROWSER: 'none' } });

let browser;
try {
  await waitForServer();
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
  await page.screenshot({ path: path.join(outDir, 'jp4a-round5b3-hf1-console.png') });
  await page.evaluate(() => {
    [...document.querySelectorAll('#jp4a-test-console button')]
      .find((b) => b.textContent === 'START JP-4A TEST')?.click();
  });

  let storeStatus = null;
  const storeDeadline = Date.now() + 240_000;
  while (Date.now() < storeDeadline) {
    try {
      storeStatus = await page.evaluate(() => {
        const boot = window.__bootDiagnostics?.();
        [...document.querySelectorAll('#jp4a-test-console button')]
          .find((b) => b.textContent === 'CONTINUE TO STORE')?.click();
        return {
          storeScene: !!window.storeScene,
          xrTest: !!window.__xrTest,
          diagnostics: !!window.__xrDiagnostics,
          interactive: boot?.timeToInteractive != null,
          liveControl: !!window.__jp4aLiveControl,
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

  const firstRun = await page.evaluate(async () => {
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
    const live = window.__jp4aLiveControl;
    const entered = api ? await api.enter() : { ok: false, error: 'no __xrTest' };
    const world = await waitUntil(() => {
      const d = window.__xrDiagnostics?.();
      return d?.startup?.firstWorldRenderCompletedAt != null ? d : null;
    }, 15_000);
    await waitUntil(() => (window.__jp4aTestSnapshot?.()?.samples?.length ?? 0) >= 2, 5_000);
    const h = window.__jp4aTestHarness;
    const cycle = (direction) => (live?.cycle?.(direction) ?? h.cycleMode(direction));
    const realLock = live?.lockFirstVisible?.() ?? null;
    if (!realLock) h.lockOpaque('opaque-browser-fixture');
    const modes = [window.__jp4aTestSnapshot().mode];
    for (let i = 0; i < 8; i++) modes.push(cycle(1));
    h.markVerdict();
    live?.beginApproach?.();
    const liveAfter = live?.snapshot?.() ?? window.__livePosterDiag?.();
    const active = window.__jp4aTestSnapshot();
    await api?.exit?.();
    const completed = await waitUntil(() => window.__jp4aTestSnapshot?.()?.completedAt
      ? window.__jp4aTestSnapshot() : null, 5_000);
    return {
      entered, firstWorldRender: !!world, realLock: !!realLock, modes, liveAfter,
      invariant: liveAfter?.bankInvariant ?? active?.bankInvariant ?? null,
      active, completed,
      result: window.__jp4aTestResult(),
    };
  });

  const afterReset = await page.evaluate(async () => {
    const waitUntil = async (fn, timeout = 15_000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const value = fn();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return null;
    };
    [...document.querySelectorAll('#jp4a-test-console button')]
      .find((b) => b.textContent === 'RESET TEST')?.click();
    const resetSession = await waitUntil(() => {
      const s = window.__jp4aTestSnapshot?.();
      return s && !s.active && !s.completedAt ? s : null;
    }, 5_000);
    const live = window.__jp4aLiveControl?.snapshot?.() ?? window.__livePosterDiag?.();
    [...document.querySelectorAll('#jp4a-test-console button')]
      .find((b) => b.textContent === 'START JP-4A TEST')?.click();
    const started = await waitUntil(() => {
      const s = window.__jp4aTestSnapshot?.();
      return s?.active ? s : null;
    }, 5_000);
    return {
      heading: document.querySelector('#jp4a-test-console h1')?.textContent,
      resetSession, started,
      liveAfterReset: live,
      shader: live?.shader ?? null,
      locked: live?.locked ?? started?.lockedPoster != null,
      mode: live?.mode ?? started?.mode,
      testPhase: started?.testPhase ?? live?.testPhase,
    };
  });

  const secondRun = await page.evaluate(async () => {
    const waitUntil = async (fn, timeout = 15_000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const value = fn();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return null;
    };
    const api = window.__xrTest;
    const entered = api ? await api.enter() : { ok: false, error: 'no second __xrTest' };
    const world = await waitUntil(() => {
      const d = window.__xrDiagnostics?.();
      return d?.startup?.firstWorldRenderCompletedAt != null ? d : null;
    }, 15_000);
    const live = window.__jp4aLiveControl?.snapshot?.() ?? window.__livePosterDiag?.();
    await api?.exit?.();
    const completed = await waitUntil(() => window.__jp4aTestSnapshot?.()?.completedAt
      ? window.__jp4aTestSnapshot() : null, 5_000);
    return {
      entered, firstWorldRender: !!world, live, completed: !!completed?.completedAt,
      copyResult: window.__jp4aTestResult(),
      hasCopyResult: [...document.querySelectorAll('#jp4a-test-console button')].some((b) => b.textContent === 'COPY RESULT'),
      hasCopyJson: [...document.querySelectorAll('#jp4a-test-console button')].some((b) => b.textContent === 'COPY JSON'),
    };
  });

  const normal = await browser.newPage();
  await normal.goto(`${base}/?fps=0`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const normalControl = await normal.evaluate(() => ({
    consoleAbsent: !document.getElementById('jp4a-test-console'),
    shaderSource: [...document.querySelectorAll('script')].some((s) => /LIVE-DEPTH-ISOLATED|livePosterDiagMode/.test(s.textContent || '')),
  }));

  const invariantClass = classifyInvariant(firstRun.invariant);
  const zeroSlotPass = firstRun.invariant?.checkedSlots === 0 && firstRun.invariant?.pass === true;
  const liveShelfInvariant = zeroSlotPass ? 'INVALID_VACUOUS_PASS' : invariantClass;
  const cleanReset = afterReset.locked === false
    && afterReset.mode === 'LIVE-NORMAL'
    && (afterReset.testPhase === 'BASELINE' || afterReset.testPhase == null)
    && (afterReset.shader == null || afterReset.shader.mode === 'LIVE-NORMAL');
  const truthfulInvariant = !zeroSlotPass
    && (liveShelfInvariant !== 'PASS' || (firstRun.invariant?.checkedSlots > 0));
  const pass = before.heading === 'JP-4A TEST' && before.start
    && /Source HEAD: [0-9a-f]{40}/.test(before.meta)
    && /Build: [0-9a-f]{40}/.test(before.meta)
    && firstRun.entered?.ok && firstRun.firstWorldRender
    && firstRun.modes.length === 9 && new Set(firstRun.modes).size === 9
    && afterReset.started?.active === true
    && cleanReset
    && secondRun.entered?.ok && secondRun.completed
    && secondRun.hasCopyResult && secondRun.hasCopyJson
    && truthfulInvariant
    && normalControl.consoleAbsent;

  const evidence = {
    phase: 'ROUND5B3_HF1_DIAGNOSTIC_HARNESS_CORRECTION',
    classification: 'IWER_EMULATED',
    scope: 'SAME_PAGE_RESET_RERUN_LOCK_SEPARATION_AND_TRUTHFUL_INVARIANT',
    NOT_HARDWARE_VISUAL_PROOF: true,
    QUEST_HARDWARE: 'NOT_EXECUTED',
    pass,
    url: '/xr-test/jp4a',
    before,
    firstRun: {
      entered: firstRun.entered,
      firstWorldRender: firstRun.firstWorldRender,
      realLock: firstRun.realLock,
      modes: firstRun.modes,
      completed: !!firstRun.completed?.completedAt,
    },
    liveShelfInvariant,
    invariant: firstRun.invariant,
    afterReset,
    secondRun: {
      entered: secondRun.entered,
      firstWorldRender: secondRun.firstWorldRender,
      completed: secondRun.completed,
      hasCopyResult: secondRun.hasCopyResult,
      hasCopyJson: secondRun.hasCopyJson,
    },
    privacy: {
      containsTitle: /SECRET_TITLE|posterUrl|token/i.test(firstRun.result || ''),
      opaqueOnly: /opaque-/.test(firstRun.result || ''),
    },
    normalConsoleAbsent: normalControl.consoleAbsent,
    seriousErrors: logs.filter((x) => x.type === 'pageerror'
      || (x.type === 'error' && !/Failed to load resource:.*500/i.test(x.text))),
    knownDemoResourceErrors: logs.filter((x) => x.type === 'error'
      && /Failed to load resource:.*500/i.test(x.text)).length,
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'jp4a-round5b3-hf1-iwer.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ pass, evidence: 'docs/review/jp4a/jp4a-round5b3-hf1-iwer.json', liveShelfInvariant }));
  if (!pass) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  kill(server);
  fs.rmSync(profileDir, { recursive: true, force: true });
}
