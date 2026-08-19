#!/usr/bin/env node
// Round 5B.3 HF3-HF3 IWER harness: actual JP-4A console ENTER VR / COPY / RESET.
// This is not Quest visual proof and does not prove Quest user-activation.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'review', 'jp4a');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halcyon-jp4a-r5b3-hf3-hf3-'));
const port = Number(process.env.HALCYON_JP4A_PORT || 17439);
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
  throw new Error('JP4A HF3-HF3 harness server timeout');
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
    start: !!document.querySelector('#jp4a-test-console [data-jp4a-action="start"]'),
    meta: [...document.querySelectorAll('#jp4a-test-console div')].find((el) => /Source HEAD:/.test(el.textContent || ''))?.textContent ?? '',
  }));
  await page.screenshot({ path: path.join(outDir, 'jp4a-round5b3-hf3-hf3-console.png') });

  const started = await page.evaluate(() => {
    const btn = document.querySelector('#jp4a-test-console [data-jp4a-action="start"]');
    btn?.click();
    return {
      clicked: btn?.textContent ?? null,
      usedXrTestEnter: false,
      consoleHidden: document.getElementById('jp4a-test-console')?.hidden === true,
      reopenVisible: document.getElementById('jp4a-test-reopen')?.hidden === false,
      active: !!window.__jp4aTestSnapshot?.()?.active,
      sessionId: window.__jp4aTestSnapshot?.()?.sessionId ?? null,
    };
  });

  const storeDeadline = Date.now() + 240_000;
  let storeReady = false;
  while (Date.now() < storeDeadline) {
    try {
      storeReady = await page.evaluate(() => !!(window.storeScene && window.__xrTest && window.__xrDiagnostics));
    } catch (error) {
      if (!/Execution context was destroyed|detached Frame/i.test(String(error))) throw error;
    }
    if (storeReady) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const reopened = await page.evaluate(() => {
    document.getElementById('jp4a-test-reopen')?.click();
    return {
      consoleHidden: document.getElementById('jp4a-test-console')?.hidden === true,
      reopenHidden: document.getElementById('jp4a-test-reopen')?.hidden === true,
      hasEnter: !!document.querySelector('#jp4a-test-console [data-jp4a-action="enter-vr"]'),
    };
  });

  const enterReadyDeadline = Date.now() + 240_000;
  let enterReady = null;
  while (Date.now() < enterReadyDeadline) {
    enterReady = await page.evaluate(() => {
      const btn = document.querySelector('#jp4a-test-console [data-jp4a-action="enter-vr"]');
      const status = document.getElementById('jp4a-entry-status');
      return {
        exists: !!btn,
        disabled: btn?.disabled ?? true,
        label: btn?.textContent ?? null,
        status: status?.textContent ?? null,
        readiness: status?.dataset.readiness ?? null,
      };
    });
    if (enterReady.exists && enterReady.disabled === false) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const firstEnter = await page.evaluate(async () => {
    const waitUntil = async (fn, timeout = 20_000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const value = fn();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return null;
    };
    const btn = document.querySelector('#jp4a-test-console [data-jp4a-action="enter-vr"]');
    const usedXrTestEnter = false;
    btn?.click();
    const world = await waitUntil(() => {
      const d = window.__xrDiagnostics?.();
      return d?.startup?.firstWorldRenderCompletedAt != null ? d : null;
    }, 20_000);
    const status = document.getElementById('jp4a-entry-status');
    return {
      usedXrTestEnter,
      clickedLabel: btn?.textContent ?? null,
      enterCalls: Number(status?.dataset.enterCalls ?? 0),
      readiness: status?.dataset.readiness ?? null,
      status: status?.textContent ?? null,
      firstWorldRender: !!world,
      presenting: !!window.__xrDiagnostics?.()?.session?.presenting
        || !!window.storeScene?.xr?.presenting,
    };
  });

  const continueReopen = await page.evaluate(() => {
    const sessionId = window.__jp4aTestSnapshot?.()?.sessionId ?? null;
    document.querySelector('#jp4a-test-console [data-jp4a-action="continue"]')?.click();
    const hidden = {
      consoleHidden: document.getElementById('jp4a-test-console')?.hidden === true,
      reopenVisible: document.getElementById('jp4a-test-reopen')?.hidden === false,
      sessionId,
    };
    document.getElementById('jp4a-test-reopen')?.click();
    return {
      ...hidden,
      restored: document.getElementById('jp4a-test-console')?.hidden === false,
      sessionUnchanged: window.__jp4aTestSnapshot?.()?.sessionId === sessionId,
      active: !!window.__jp4aTestSnapshot?.()?.active,
    };
  });

  const copies = await page.evaluate(async () => {
    const click = (id) => document.querySelector(`#jp4a-test-console [data-jp4a-action="${id}"]`)?.click();
    click('copy-result');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const resultLabel = document.querySelector('#jp4a-test-console [data-jp4a-action="copy-result"]')?.textContent;
    const fallback1 = document.getElementById('jp4a-copy-fallback');
    const resultOk = resultLabel === 'COPIED RESULT' || resultLabel === 'COPY FALLBACK READY';
    click('copy-json');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const jsonLabel = document.querySelector('#jp4a-test-console [data-jp4a-action="copy-json"]')?.textContent;
    const fallback2 = document.getElementById('jp4a-copy-fallback');
    const jsonOk = jsonLabel === 'COPIED JSON' || jsonLabel === 'COPY FALLBACK READY';
    return {
      resultLabel, jsonLabel, resultOk, jsonOk,
      fallbackVisible: fallback1?.hidden === false || fallback2?.hidden === false,
      fallbackText: fallback2?.hidden === false ? fallback2.value : fallback1?.value ?? '',
    };
  });

  await page.evaluate(async () => {
    await window.__xrTest?.exit?.();
  });

  const afterReset = await page.evaluate(async () => {
    const waitUntil = async (fn, timeout = 8_000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const value = fn();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return null;
    };
    document.querySelector('#jp4a-test-console [data-jp4a-action="reset"]')?.click();
    const resetSession = await waitUntil(() => {
      const s = window.__jp4aTestSnapshot?.();
      return s && !s.active && !s.completedAt ? s : null;
    }, 5_000);
    document.querySelector('#jp4a-test-console [data-jp4a-action="start"]')?.click();
    const startedSession = await waitUntil(() => window.__jp4aTestSnapshot?.()?.active
      ? window.__jp4aTestSnapshot() : null, 5_000);
    document.getElementById('jp4a-test-reopen')?.click();
    return { resetSession, startedSession, heading: document.querySelector('#jp4a-test-console h1')?.textContent };
  });

  const secondEnter = await page.evaluate(async () => {
    const waitUntil = async (fn, timeout = 20_000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const value = fn();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return null;
    };
    const readyDeadline = Date.now() + 60_000;
    while (Date.now() < readyDeadline) {
      const btn = document.querySelector('#jp4a-test-console [data-jp4a-action="enter-vr"]');
      if (btn && !btn.disabled) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const btn = document.querySelector('#jp4a-test-console [data-jp4a-action="enter-vr"]');
    btn?.click();
    const world = await waitUntil(() => {
      const d = window.__xrDiagnostics?.();
      return d?.startup?.firstWorldRenderCompletedAt != null ? d : null;
    }, 20_000);
    const status = document.getElementById('jp4a-entry-status');
    await window.__xrTest?.exit?.();
    return {
      usedXrTestEnter: false,
      firstWorldRender: !!world,
      enterCalls: Number(status?.dataset.enterCalls ?? 0),
      status: status?.textContent ?? null,
    };
  });

  const invariant = await page.evaluate(() => (
    window.__jp4aLiveControl?.snapshot?.()?.bankInvariant
    ?? window.__jp4aTestSnapshot?.()?.bankInvariant
    ?? null
  ));

  const normal = await browser.newPage();
  await normal.goto(`${base}/?fps=0`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const normalControl = await normal.evaluate(() => ({
    consoleAbsent: !document.getElementById('jp4a-test-console'),
    reopenAbsent: !document.getElementById('jp4a-test-reopen'),
    liveControlAbsent: !window.__jp4aLiveControl,
    hasHudEnter: !!document.getElementById('xr-enter-btn'),
    hasMenuEnter: !!document.getElementById('btn-enter-vr'),
  }));

  const invariantClass = classifyInvariant(invariant);
  const zeroSlotPass = invariant?.checkedSlots === 0 && invariant?.pass === true;
  const liveShelfInvariant = zeroSlotPass ? 'INVALID_VACUOUS_PASS' : invariantClass;
  const pass = before.heading === 'JP-4A TEST' && before.start
    && /Source HEAD: [0-9a-f]{40}/.test(before.meta)
    && started.active && started.consoleHidden && started.reopenVisible
    && started.usedXrTestEnter === false
    && storeReady
    && reopened.hasEnter && reopened.consoleHidden === false
    && enterReady?.disabled === false
    && firstEnter.usedXrTestEnter === false
    && firstEnter.firstWorldRender
    && firstEnter.enterCalls >= 1
    && continueReopen.restored && continueReopen.sessionUnchanged
    && copies.resultOk && copies.jsonOk
    && afterReset.startedSession?.active === true
    && secondEnter.usedXrTestEnter === false
    && secondEnter.firstWorldRender
    && !zeroSlotPass
    && (liveShelfInvariant !== 'PASS' || invariant?.checkedSlots > 0)
    && normalControl.consoleAbsent
    && normalControl.reopenAbsent
    && normalControl.liveControlAbsent
    && normalControl.hasHudEnter
    && normalControl.hasMenuEnter;

  const sourceHeadMatch = before.meta.match(/Source HEAD: ([0-9a-f]{40})/);
  const evidence = {
    phase: 'ROUND5B3_HF3_HF3_JP4A_CONSOLE_ENTRY_UI_CORRECTION',
    classification: 'IWER_EMULATED',
    scope: 'JP4A_CONSOLE_ACTUAL_DOM_ENTER_VR',
    NOT_HARDWARE_VISUAL_PROOF: true,
    QUEST_HARDWARE: 'ATTEMPTED_BUT_DIAGNOSTIC_NOT_STARTED',
    hardwareAttempt: {
      attempted: true,
      xrSessionEntered: false,
      visualDiagnosticExecuted: false,
      reason: 'JP4A_TEST_CONSOLE_ENTRY_UI_BLOCKED',
      source: 'USER_SUPPLIED_HARDWARE_OBSERVATION',
    },
    newHardwareRunAfterFix: 'NOT_EXECUTED_AFTER_FIX',
    implementationTestedHead: sourceHeadMatch?.[1] ?? null,
    evidenceCommitHead: 'NEWER_THAN_TESTED_SOURCE',
    sourceHead: sourceHeadMatch?.[1] ?? null,
    ciCheckoutSha: (before.meta.match(/CI checkout: ([0-9a-f]{40}|same as source)/) || [])[1] ?? null,
    pass,
    url: '/xr-test/jp4a',
    usedXrTestEnter: false,
    iwerCannotProveQuestUserActivation: true,
    before,
    started,
    storeReady,
    reopened,
    enterReady,
    firstEnter,
    continueReopen,
    copies,
    afterReset,
    secondEnter,
    liveShelfInvariant,
    invariant,
    normalControl,
    privacy: {
      containsTitle: /SECRET_TITLE|posterUrl|token/i.test(copies.fallbackText || ''),
      opaqueOnly: true,
    },
    seriousErrors: logs.filter((x) => x.type === 'pageerror'
      || (x.type === 'error' && !/Failed to load resource:.*500/i.test(x.text))),
    knownDemoResourceErrors: logs.filter((x) => x.type === 'error'
      && /Failed to load resource:.*500/i.test(x.text)).length,
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'jp4a-round5b3-hf3-hf3-iwer.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({
    pass,
    evidence: 'docs/review/jp4a/jp4a-round5b3-hf3-hf3-iwer.json',
    liveShelfInvariant,
    usedXrTestEnter: false,
    implementationTestedHead: evidence.implementationTestedHead,
  }));
  if (!pass) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  kill(server);
  fs.rmSync(profileDir, { recursive: true, force: true });
}
