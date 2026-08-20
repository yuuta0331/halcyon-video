#!/usr/bin/env node
// Round 5B.3 HF3-HF4 built-in IWER gate.
//
// Drives the real JP-4A console with trusted Puppeteer input (page.click), not
// page.evaluate(() => btn.click()). It proves the software flow under the
// repository's own IWER route only.
//
// Classification: IWER_EMULATED / BROWSER_AUTOMATION.
// NOT_HARDWARE_VISUAL_PROOF. This never proves Quest activation or Quest visuals.
//
// Timing discipline: SUPPORT probing and STORE readiness are separate gates.
// Support has a strict small bound; store may take much longer but must never
// be displayed as, or accepted as, XR support checking.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'review', 'jp4a');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halcyon-jp4a-r5b3-hf3-hf4-'));
const port = Number(process.env.HALCYON_JP4A_PORT || 17441);
const base = `http://127.0.0.1:${port}`;
const logs = [];

// ─── SUPPORT PROBE TIMING (strict, small, independent) ──────────────────────
// The support-specific wait may NEVER be given a 60s / 240s gate.
const SUPPORT_BOUND_MS = 2_000;
// Allowance for observing the settled state from the harness side (page load,
// script eval round-trips). The measured supportProbeMs itself is what the gate
// checks; this only bounds how long we poll for the observation.
const SUPPORT_OBSERVE_MS = 20_000;

function kill(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
  else child.kill('SIGTERM');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    try { if ((await fetch(base)).ok) return; } catch { /* retry */ }
    await sleep(300);
  }
  throw new Error('JP4A HF3-HF4 harness server timeout');
}

async function poll(page, fn, timeoutMs, stepMs = 150) {
  const end = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < end) {
    try {
      last = await page.evaluate(fn);
    } catch (error) {
      if (!/Execution context was destroyed|detached Frame/i.test(String(error))) throw error;
    }
    if (last) return last;
    await sleep(stepMs);
  }
  return last;
}

/** Trusted browser input. Never page.evaluate(() => el.click()). */
async function browserClick(page, selector, timeoutMs = 20_000) {
  await page.waitForSelector(selector, { visible: true, timeout: timeoutMs });
  await page.click(selector);
  return { selector, method: 'puppeteer.page.click' };
}

function classifyInvariant(inv) {
  if (!inv) return 'NOT_EXERCISED';
  if (inv.verdict) return inv.verdict;
  if (!inv.checkedSlots) return 'NOT_EXERCISED';
  return inv.pass ? 'PASS' : 'FAIL';
}

const ENTER = '#jp4a-test-console [data-jp4a-action="enter-vr"]';
const START = '#jp4a-test-console [data-jp4a-action="start"]';
const RESET = '#jp4a-test-console [data-jp4a-action="reset"]';
const COPY_RESULT = '#jp4a-test-console [data-jp4a-action="copy-result"]';
const COPY_JSON = '#jp4a-test-console [data-jp4a-action="copy-json"]';

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
  await page.setViewport({ width: 1280, height: 800 });
  page.on('console', (msg) => logs.push({ type: msg.type(), text: msg.text().slice(0, 300) }));
  page.on('pageerror', (err) => logs.push({ type: 'pageerror', text: String(err).slice(0, 300) }));

  const url = `${base}/xr-test/jp4a?demo=1&xrEmu=1&nogate=1`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('#jp4a-test-console', { timeout: 30_000 });

  const before = await page.evaluate(() => ({
    heading: document.querySelector('#jp4a-test-console h1')?.textContent,
    start: !!document.querySelector('#jp4a-test-console [data-jp4a-action="start"]'),
    meta: [...document.querySelectorAll('#jp4a-test-console div')]
      .find((el) => /Source HEAD:/.test(el.textContent || ''))?.textContent ?? '',
  }));
  await page.screenshot({ path: path.join(outDir, 'jp4a-round5b3-hf3-hf4-console.png') });

  // ─── SUPPORT PROBE GATE ───────────────────────────────────────────────────
  // Independent of the store. Fails if the probe is still pending, or if the
  // measured probe time exceeds the strict bound.
  const support = await poll(page, () => {
    const s = window.__xrSupportProbe?.();
    if (!s) return null;
    return s.state === 'PROBING' || s.state === 'NOT_STARTED' ? null : s;
  }, SUPPORT_OBSERVE_MS);

  const supportProbeMs = support?.elapsedMs ?? null;
  const supportGate = {
    observed: !!support,
    state: support?.state ?? null,
    reason: support?.reason ?? null,
    invoked: support?.invoked ?? null,
    supportProbeMs,
    boundMs: SUPPORT_BOUND_MS,
    softTimeoutMs: support?.softTimeoutMs ?? null,
    stillPending: !support || support.state === 'PROBING' || support.state === 'NOT_STARTED',
    pass: !!support
      && support.state !== 'PROBING'
      && support.state !== 'NOT_STARTED'
      && supportProbeMs != null
      && supportProbeMs <= SUPPORT_BOUND_MS,
  };

  // The console must never label pre-probe boot as XR support checking.
  const supportWording = await page.evaluate(() => {
    const status = document.getElementById('jp4a-entry-status');
    const s = window.__xrSupportProbe?.();
    return {
      text: status?.textContent ?? '',
      readiness: status?.dataset.readiness ?? null,
      supportState: status?.dataset.support ?? s?.state ?? null,
    };
  });
  const checkingOnlyWhileProbing = !/Checking XR support/i.test(supportWording.text)
    || supportWording.supportState === 'PROBING';

  // ─── START via trusted browser input ─────────────────────────────────────
  const startClick = await browserClick(page, START);
  const started = await page.evaluate(() => ({
    consoleHidden: document.getElementById('jp4a-test-console')?.hidden === true,
    reopenVisible: document.getElementById('jp4a-test-reopen')?.hidden === false,
    hasEnterWithoutReopen: !!document.querySelector('#jp4a-test-console [data-jp4a-action="enter-vr"]'),
    active: !!window.__jp4aTestSnapshot?.()?.active,
    sessionId: window.__jp4aTestSnapshot?.()?.sessionId ?? null,
    environment: window.__jp4aTestSnapshot?.()?.environment ?? null,
  }));

  // ─── STORE READINESS (separate, larger, independently reported) ──────────
  const storeStartedAt = Date.now();
  const storeReady = await poll(page, () => (
    window.storeScene && window.__xrTest && window.__xrDiagnostics ? true : null
  ), 240_000, 300);
  const storeWaitMs = Date.now() - storeStartedAt;

  const enterReady = await poll(page, () => {
    const btn = document.querySelector('#jp4a-test-console [data-jp4a-action="enter-vr"]');
    const status = document.getElementById('jp4a-entry-status');
    if (!btn || btn.disabled) return null;
    return {
      label: btn.textContent ?? null,
      readiness: status?.dataset.readiness ?? null,
      status: status?.textContent ?? null,
      support: status?.dataset.support ?? null,
      neverSaidCheckingWhileEnabled: !/Checking XR support/i.test(status?.textContent ?? ''),
    };
  }, 120_000, 200);

  // ─── ENTER VR via trusted browser input ──────────────────────────────────
  const enterStartedAt = Date.now();
  const enterClick = await browserClick(page, ENTER);
  const entered = await poll(page, () => {
    const d = window.__xrDiagnostics?.();
    const s = window.__jp4aTestSnapshot?.();
    if (!s?.xrStartedAt || d?.startup?.firstWorldRenderCompletedAt == null) return null;
    return {
      xrStartedAt: s.xrStartedAt,
      xrStartedEvent: s.events.some((e) => e.type === 'xr_started'),
      environment: s.environment,
      firstWorldRender: true,
      presenting: !!d?.session?.presenting || !!window.storeScene?.xr?.presenting,
      startup: {
        requestSessionStart: d?.startup?.requestSessionStart ?? null,
        requestSessionEnd: d?.startup?.requestSessionEnd ?? null,
        rendererSetSessionStart: d?.startup?.rendererSetSessionStart ?? null,
        rendererSetSessionEnd: d?.startup?.rendererSetSessionEnd ?? null,
        firstWorldRenderCompletedAt: d?.startup?.firstWorldRenderCompletedAt ?? null,
      },
    };
  }, 60_000, 150);
  const enterActionWallMs = Date.now() - enterStartedAt;

  // ─── console must be out of the way of the emulated XR canvas ────────────
  const overlay = await page.evaluate(() => {
    const consoleEl = document.getElementById('jp4a-test-console');
    const reopen = document.getElementById('jp4a-test-reopen');
    const canvas = document.querySelector('canvas');
    const rect = canvas?.getBoundingClientRect?.() ?? null;
    const cx = rect ? Math.round(rect.left + rect.width / 2) : 0;
    const cy = rect ? Math.round(rect.top + rect.height / 2) : 0;
    const hit = rect ? document.elementFromPoint(cx, cy) : null;
    const style = consoleEl ? getComputedStyle(consoleEl) : null;
    const occludedBy = hit && consoleEl && (hit === consoleEl || consoleEl.contains(hit)) ? 'jp4a-test-console' : null;
    return {
      consoleHidden: consoleEl?.hidden === true,
      consoleDisplay: style?.display ?? null,
      reopenVisible: reopen?.hidden === false,
      canvasPresent: !!canvas,
      canvasRect: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      centerElement: hit?.tagName ?? null,
      occludedBy,
      canvasUnobstructed: !!rect && rect.width > 0 && rect.height > 0 && occludedBy === null,
    };
  });
  await page.screenshot({ path: path.join(outDir, 'jp4a-round5b3-hf3-hf4-inxr.png') });

  // ─── telemetry / bank invariant ──────────────────────────────────────────
  const telemetry = await poll(page, () => {
    const s = window.__jp4aTestSnapshot?.();
    return s && s.samples.length > 0 ? { samples: s.samples.length, timings: s.timings } : null;
  }, 60_000, 250);

  await page.evaluate(() => {
    // Observation/setup only: exercise the live diagnostic so the bank
    // invariant is computed over real slots instead of a vacuous zero.
    window.__jp4aLiveControl?.lockFirstVisible?.();
    window.__jp4aLiveControl?.beginApproach?.();
  });
  const invariant = await poll(page, () => {
    // __livePosterDiag() recomputes the invariant over the live slot set and
    // publishes it into the session; snapshot() only reads the cache.
    const inv = window.__livePosterDiag?.()?.bankInvariant
      ?? window.__jp4aTestSnapshot?.()?.bankInvariant
      ?? null;
    return inv && inv.checkedSlots > 0 ? inv : null;
  }, 30_000, 250) ?? await page.evaluate(() => (
    window.__livePosterDiag?.()?.bankInvariant
    ?? window.__jp4aTestSnapshot?.()?.bankInvariant
    ?? null
  ));

  // ─── exit: console must come back on its own ─────────────────────────────
  await page.evaluate(async () => { await window.__xrTest?.exit?.(); });
  const afterExit = await poll(page, () => {
    const consoleEl = document.getElementById('jp4a-test-console');
    return consoleEl && consoleEl.hidden === false ? {
      consoleVisible: true,
      reopenHidden: document.getElementById('jp4a-test-reopen')?.hidden === true,
      readiness: document.getElementById('jp4a-entry-status')?.dataset.readiness ?? null,
    } : null;
  }, 20_000, 150);

  // ─── COPY via trusted browser input ──────────────────────────────────────
  await browserClick(page, COPY_RESULT);
  await sleep(120);
  const copyResultLabel = await page.evaluate((sel) =>
    document.querySelector(sel)?.textContent ?? null, COPY_RESULT);
  await browserClick(page, COPY_JSON);
  await sleep(120);
  const copyJsonLabel = await page.evaluate((sel) =>
    document.querySelector(sel)?.textContent ?? null, COPY_JSON);
  const copyText = await page.evaluate(() => window.__jp4aTestResult?.() ?? '');
  const copies = {
    resultLabel: copyResultLabel,
    jsonLabel: copyJsonLabel,
    resultOk: copyResultLabel === 'COPIED RESULT' || copyResultLabel === 'COPY FALLBACK READY',
    jsonOk: copyJsonLabel === 'COPIED JSON' || copyJsonLabel === 'COPY FALLBACK READY',
    text: copyText.slice(0, 4000),
  };

  // ─── RESET + second entry, both via trusted browser input ────────────────
  await browserClick(page, RESET);
  const afterReset = await poll(page, () => {
    const s = window.__jp4aTestSnapshot?.();
    return s && !s.active && !s.completedAt ? { sessionId: s.sessionId, active: s.active } : null;
  }, 10_000, 100);
  await browserClick(page, START);
  await poll(page, () => {
    const btn = document.querySelector('#jp4a-test-console [data-jp4a-action="enter-vr"]');
    return btn && !btn.disabled ? true : null;
  }, 120_000, 150);
  await browserClick(page, ENTER);
  const secondEntered = await poll(page, () => {
    const d = window.__xrDiagnostics?.();
    const s = window.__jp4aTestSnapshot?.();
    if (!s?.xrStartedAt || d?.startup?.firstWorldRenderCompletedAt == null) return null;
    return {
      xrStartedAt: s.xrStartedAt,
      xrStartedEvent: s.events.some((e) => e.type === 'xr_started'),
      firstWorldRender: true,
      sessionId: s.sessionId,
    };
  }, 60_000, 150);
  const secondHidden = await page.evaluate(() => ({
    consoleHidden: document.getElementById('jp4a-test-console')?.hidden === true,
    reopenVisible: document.getElementById('jp4a-test-reopen')?.hidden === false,
  }));
  await page.evaluate(async () => { await window.__xrTest?.exit?.(); });

  // ─── negative control: the normal URL stays clean ────────────────────────
  const normal = await browser.newPage();
  await normal.goto(`${base}/?fps=0`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const normalControl = await normal.evaluate(() => ({
    consoleAbsent: !document.getElementById('jp4a-test-console'),
    reopenAbsent: !document.getElementById('jp4a-test-reopen'),
    liveControlAbsent: !window.__jp4aLiveControl,
    hasHudEnter: !!document.getElementById('xr-enter-btn'),
    hasMenuEnter: !!document.getElementById('btn-enter-vr'),
  }));

  const sessionTimings = telemetry?.timings ?? null;
  const startup = entered?.startup ?? null;
  const timings = {
    supportProbeMs,
    supportBoundMs: SUPPORT_BOUND_MS,
    storeReadyMs: sessionTimings?.storeReadyMs ?? null,
    storeWaitObservedMs: storeWaitMs,
    enterActionMs: sessionTimings?.enterActionMs ?? enterActionWallMs,
    requestSessionMs: startup && startup.requestSessionStart != null && startup.requestSessionEnd != null
      ? startup.requestSessionEnd - startup.requestSessionStart : null,
    setSessionMs: startup && startup.rendererSetSessionStart != null && startup.rendererSetSessionEnd != null
      ? startup.rendererSetSessionEnd - startup.rendererSetSessionStart : null,
    firstWorldRenderMs: startup && startup.requestSessionStart != null && startup.firstWorldRenderCompletedAt != null
      ? startup.firstWorldRenderCompletedAt - startup.requestSessionStart : null,
  };

  const invariantClass = classifyInvariant(invariant);
  const zeroSlotPass = invariant?.checkedSlots === 0 && invariant?.pass === true;
  const liveShelfInvariant = zeroSlotPass ? 'INVALID_VACUOUS_PASS' : invariantClass;

  const pass = before.heading === 'JP-4A TEST'
    && before.start
    && /Source HEAD: [0-9a-f]{40}/.test(before.meta)
    && supportGate.pass
    && checkingOnlyWhileProbing
    && started.active === true
    // START must not have cost a reopen step.
    && started.consoleHidden === false
    && started.hasEnterWithoutReopen === true
    && started.environment === 'IWER_EMULATED'
    && storeReady === true
    && !!enterReady
    && enterReady.neverSaidCheckingWhileEnabled
    && !!entered
    && entered.xrStartedAt != null
    && entered.xrStartedEvent === true
    && entered.firstWorldRender === true
    && entered.presenting === true
    && entered.environment === 'IWER_EMULATED'
    && overlay.consoleHidden === true
    && overlay.reopenVisible === true
    && overlay.canvasUnobstructed === true
    && !!telemetry && telemetry.samples > 0
    && !zeroSlotPass
    && invariant != null
    && invariant.checkedSlots > 0
    && !!afterExit && afterExit.consoleVisible === true
    && copies.resultOk && copies.jsonOk
    && !!afterReset
    && !!secondEntered
    && secondEntered.xrStartedAt != null
    && secondEntered.xrStartedEvent === true
    && secondEntered.firstWorldRender === true
    && secondEntered.sessionId !== started.sessionId
    && secondHidden.consoleHidden === true
    && timings.firstWorldRenderMs != null
    && normalControl.consoleAbsent
    && normalControl.reopenAbsent
    && normalControl.liveControlAbsent
    && normalControl.hasHudEnter
    && normalControl.hasMenuEnter;

  const sourceHeadMatch = before.meta.match(/Source HEAD: ([0-9a-f]{40})/);
  const evidence = {
    phase: 'ROUND5B3_HF3_HF4_XR_SUPPORT_AND_EMULATED_ENTRY_TRUTH_CORRECTION',
    classification: 'IWER_EMULATED',
    inputMethod: 'BROWSER_AUTOMATION',
    scope: 'BUILT_IN_IWER_JP4A_CONSOLE_TRUSTED_BROWSER_INPUT',
    NOT_HARDWARE_VISUAL_PROOF: true,
    QUEST_HARDWARE: 'ATTEMPTED_BUT_DIAGNOSTIC_NOT_STARTED',
    hardwareAttempt: {
      attempted: true,
      xrSessionEntered: false,
      visualDiagnosticExecuted: false,
      reason: 'XR_SUPPORT_CHECK_STALLED',
      source: 'USER_SUPPLIED_HARDWARE_OBSERVATION',
      sourceHead: 'b4ee8e033fc2ad03ef1c0522d007560716f778de',
    },
    desktopEmulatedAttempt: {
      result: 'ENTRY_NOT_USABLE',
      observed: ['support check slow', 'VR ACTIVE shown', 'no usable visible XR scene'],
      copiedState: { xrStartedAt: null, samples: 0, bankInvariant: null, xrStartedEvent: false },
      source: 'USER_SUPPLIED_DESKTOP_OBSERVATION',
    },
    newQuestRunAfterHf4: 'NOT_EXECUTED',
    implementationTestedHead: sourceHeadMatch?.[1] ?? null,
    evidenceCommitHead: 'NEWER_THAN_TESTED_SOURCE',
    sourceHead: sourceHeadMatch?.[1] ?? null,
    ciCheckoutSha: (before.meta.match(/CI checkout: ([0-9a-f]{40}|same as source)/) || [])[1] ?? null,
    pass,
    url: '/xr-test/jp4a?demo=1&xrEmu=1&nogate=1',
    usedXrTestEnter: false,
    usedJsClickForEnter: false,
    inputProof: { startClick, enterClick },
    iwerCannotProveQuestUserActivation: true,
    before,
    supportGate,
    supportWording,
    checkingOnlyWhileProbing,
    started,
    storeReady,
    enterReady,
    entered,
    overlay,
    telemetry,
    timings,
    afterExit,
    copies: { ...copies, text: undefined },
    afterReset,
    secondEntered,
    secondHidden,
    liveShelfInvariant,
    invariant,
    normalControl,
    privacy: {
      containsTitle: /SECRET_TITLE|posterUrl|token/i.test(copies.text || ''),
      opaqueOnly: true,
    },
    seriousErrors: logs.filter((x) => x.type === 'pageerror'
      || (x.type === 'error' && !/Failed to load resource:.*500/i.test(x.text))),
    knownDemoResourceErrors: logs.filter((x) => x.type === 'error'
      && /Failed to load resource:.*500/i.test(x.text)).length,
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'jp4a-round5b3-hf3-hf4-iwer.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({
    pass,
    evidence: 'docs/review/jp4a/jp4a-round5b3-hf3-hf4-iwer.json',
    supportProbeMs,
    supportGate: supportGate.pass,
    xrStartedAt: entered?.xrStartedAt ?? null,
    samples: telemetry?.samples ?? 0,
    checkedSlots: invariant?.checkedSlots ?? 0,
    consoleAutoHidden: overlay.consoleHidden,
    canvasUnobstructed: overlay.canvasUnobstructed,
    liveShelfInvariant,
    implementationTestedHead: evidence.implementationTestedHead,
  }));
  if (!pass) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  kill(server);
  fs.rmSync(profileDir, { recursive: true, force: true });
}
