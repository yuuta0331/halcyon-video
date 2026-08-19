#!/usr/bin/env node
// Round 5B.3 HF3-HF2 IWER harness: initial controller connection race
// plus HF3-HF1 association. This is not Quest visual proof.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'review', 'jp4a');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halcyon-jp4a-r5b3-hf3-hf2-'));
const port = Number(process.env.HALCYON_JP4A_PORT || 17438);
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
  throw new Error('JP4A HF3-HF2 harness server timeout');
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
  await page.screenshot({ path: path.join(outDir, 'jp4a-round5b3-hf3-hf2-console.png') });
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
    const HOLD = 700;
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
    const seam = 'jp4a_initial_inputsourceschange_during_three_compat';
    const raceApi = live?.startupRace?.();
    const startupRace = raceApi?.simulateInitialSourcesDuringCompat
      ? await raceApi.simulateInitialSourcesDuringCompat(['right', 'left'])
      : { ok: false, error: 'no startupRace seam' };
    const assocApi = live?.controllerAssociation?.();
    const association = (() => {
      if (!assocApi) return { ok: false, error: 'no controllerAssociation seam' };
      assocApi.injectDisconnection(0);
      assocApi.injectDisconnection(1);
      const rightSlot0 = assocApi.injectConnection(0, 'right');
      const leftSlot1 = assocApi.injectConnection(1, 'left');
      const afterInject = {
        slotHands: [...assocApi.slotHands],
        pickRight: assocApi.pickIndex('right'),
        pickLeft: assocApi.pickIndex('left'),
      };
      const reorder = assocApi.simulateReorderedInputSources(['left', 'right']);
      assocApi.injectDisconnection(0);
      const afterRightDisconnect = {
        slotHands: [...assocApi.slotHands],
        pickRight: assocApi.pickIndex('right'),
        pickLeft: assocApi.pickIndex('left'),
      };
      assocApi.injectConnection(0, 'right');
      assocApi.injectDisconnection(1);
      assocApi.injectConnection(1, 'left');
      const afterRepeat = {
        slotHands: [...assocApi.slotHands],
        pickRight: assocApi.pickIndex('right'),
        pickLeft: assocApi.pickIndex('left'),
      };
      const reorder2 = assocApi.simulateReorderedInputSources(['left', 'right']);
      return {
        ok: true,
        classification: assocApi.classification,
        NOT_HARDWARE_VISUAL_PROOF: assocApi.NOT_HARDWARE_VISUAL_PROOF,
        injected: { rightSlot0, leftSlot1 },
        afterInject,
        reorder,
        afterRightDisconnect,
        afterRepeat,
        reorder2,
        iwerCannotProveQuestPose: true,
      };
    })();
    let t = 1;
    const step = (leftTrigger, rightTrigger, leftHit, rightHit) => {
      const result = live.stepHandedTrigger({
        leftTrigger, rightTrigger, leftHit, rightHit, now: t,
      });
      t += 40;
      return result;
    };
    const tapRight = () => {
      const down = step(false, true, 1, 0);
      t += 40;
      const up = step(false, false, 1, 0);
      t += 40;
      return { down, up };
    };
    const tapLeft = () => {
      const down = step(true, false, 1, 0);
      t += 40;
      const up = step(false, false, 1, 0);
      t += 40;
      return { down, up };
    };
    const holdRight = () => {
      const down = step(false, true, 1, 0);
      t += HOLD - 40;
      const crossed = step(false, true, 1, 0);
      t += 40;
      const up = step(false, false, 1, 0);
      t += 40;
      return { down, crossed, up };
    };

    const both = step(true, true, 1, 0);
    const simultaneous = { locked: !!both.locked, ambiguous: !!both.ambiguous, source: both.source };
    live.resetTrigger();
    t += 40;
    const bothUp = step(false, false, 1, 0);
    const fallback = (() => {
      const down = step(false, true, 1, null);
      t += 40;
      const up = step(false, false, 1, null);
      return { locked: !!up.locked, source: down.source };
    })();
    live.resetTrigger();
    t += 40;
    step(false, false, 1, 0);
    const rightLock = tapRight();
    const rightSource = {
      lockedIndex: rightLock.up.lockedIndex,
      source: rightLock.down.source,
      locked: !!rightLock.up.locked,
    };
    live.reset();
    live.resetTrigger();
    t += 40;
    const leftLock = tapLeft();
    const leftSource = {
      lockedIndex: leftLock.up.lockedIndex,
      source: leftLock.down.source,
      locked: !!leftLock.up.locked,
    };
    live.reset();
    live.resetTrigger();
    t += 40;

    const lockTap = tapRight();
    const afterLock = {
      locked: !!lockTap.up.locked,
      phase: lockTap.up.phase,
      verdict: lockTap.up.verdicts?.['LIVE-NORMAL'],
      selects: lockTap.up.productionSelectCount,
      source: lockTap.down.source,
    };
    const modes = [window.__jp4aTestSnapshot().mode];
    for (let i = 0; i < 8; i++) modes.push(cycle(1));
    for (let i = 0; i < 8; i++) cycle(-1);
    const blackTap = tapRight();
    const afterBlack = {
      verdict: blackTap.up.verdicts?.['LIVE-NORMAL'],
      phase: blackTap.up.phase,
      selects: blackTap.up.productionSelectCount,
      mode: blackTap.up.mode,
    };
    const cleanTap = tapRight();
    const afterClean = {
      verdict: cleanTap.up.verdicts?.['LIVE-NORMAL'],
      phase: cleanTap.up.phase,
    };
    const beforeApproach = step(false, true, 1, 0);
    t += HOLD - 80;
    const belowHold = step(false, true, 1, 0);
    t += 40;
    const approachHold = step(false, true, 1, 0);
    t += 40;
    const approachUp = step(false, false, 1, 0);
    t += 40;
    const afterApproach = {
      command: approachHold.command,
      phase: approachHold.phase,
      verdictBefore: belowHold.verdicts?.['LIVE-NORMAL'],
      verdictAfter: approachHold.verdicts?.['LIVE-NORMAL'],
      selects: approachHold.productionSelectCount,
      releaseSelects: approachUp.productionSelectCount,
      source: beforeApproach.source,
    };
    await waitUntil(() => (window.__jp4aTestSnapshot?.()?.samples ?? [])
      .some((s) => s.phase === 'approach'), 5_000);
    const approachSamples = (window.__jp4aTestSnapshot?.()?.samples ?? [])
      .filter((s) => s.phase === 'approach').length;
    const focusHold = holdRight();
    const afterFocus = {
      command: focusHold.crossed.command,
      phase: focusHold.crossed.phase,
      verdict: focusHold.crossed.verdicts?.['LIVE-NORMAL'],
      selectsAtFire: focusHold.crossed.productionSelectCount,
      selectsWhileHeld: focusHold.up.productionSelectCount,
    };
    const extraHold = holdRight();
    const afterExtra = {
      phase: extraHold.up.phase,
      selects: extraHold.up.productionSelectCount,
      verdict: extraHold.up.verdicts?.[extraHold.up.mode],
    };
    const iwerTrigger = { attempted: true, mutatedVerdict: false };
    try {
      api?.trigger?.('right', true);
      await new Promise((resolve) => setTimeout(resolve, 120));
      api?.trigger?.('right', false);
      await new Promise((resolve) => setTimeout(resolve, 120));
      const snap = window.__jp4aTestSnapshot?.();
      iwerTrigger.mutatedVerdict = snap?.modeVerdicts?.[snap.mode] !== afterExtra.verdict;
    } catch (error) {
      iwerTrigger.error = String(error).slice(0, 160);
    }
    const liveAfter = live?.snapshot?.() ?? window.__livePosterDiag?.();
    const active = window.__jp4aTestSnapshot();
    await api?.exit?.();
    const completed = await waitUntil(() => window.__jp4aTestSnapshot?.()?.completedAt
      ? window.__jp4aTestSnapshot() : null, 5_000);
    return {
      entered, firstWorldRender: !!world, seam, startupRace, association,
      simultaneous, fallback, rightSource, leftSource,
      afterLock, afterBlack, afterClean, modes, afterApproach, approachSamples,
      afterFocus, afterExtra, iwerTrigger, beforeApproachCommand: beforeApproach.command,
      invariant: liveAfter?.bankInvariant ?? active?.bankInvariant ?? null,
      active, completed,
      result: window.__jp4aTestResult(),
      competingLoops: window.__xrDiagnostics?.()?.scheduler?.competingLoops ?? null,
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
    const live = window.__jp4aLiveControl;
    const entered = api ? await api.enter() : { ok: false, error: 'no second __xrTest' };
    const world = await waitUntil(() => {
      const d = window.__xrDiagnostics?.();
      return d?.startup?.firstWorldRenderCompletedAt != null ? d : null;
    }, 15_000);
    const stalePress = live?.triggerPress?.();
    const secondTap = live?.stepHandedTrigger?.({
      leftTrigger: false, rightTrigger: true, leftHit: 1, rightHit: 0, now: 10,
    });
    const secondUp = live?.stepHandedTrigger?.({
      leftTrigger: false, rightTrigger: false, leftHit: 1, rightHit: 0, now: 90,
    });
    await api?.exit?.();
    const completed = await waitUntil(() => window.__jp4aTestSnapshot?.()?.completedAt
      ? window.__jp4aTestSnapshot() : null, 5_000);
    return {
      entered, firstWorldRender: !!world,
      stalePressDown: !!stalePress?.down,
      secondLock: !!secondUp?.locked,
      secondPhase: secondUp?.phase,
      secondVerdict: secondUp?.verdicts?.['LIVE-NORMAL'],
      completed: !!completed?.completedAt,
      copyResult: window.__jp4aTestResult(),
      hasCopyResult: [...document.querySelectorAll('#jp4a-test-console button')].some((b) => b.textContent === 'COPY RESULT'),
      hasCopyJson: [...document.querySelectorAll('#jp4a-test-console button')].some((b) => b.textContent === 'COPY JSON'),
    };
  });

  const normal = await browser.newPage();
  await normal.goto(`${base}/?fps=0`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const normalControl = await normal.evaluate(() => ({
    consoleAbsent: !document.getElementById('jp4a-test-console'),
    liveControlAbsent: !window.__jp4aLiveControl,
    associationAbsent: window.__jp4aLiveControl?.controllerAssociation?.() == null,
    startupRaceAbsent: window.__jp4aLiveControl?.startupRace?.() == null,
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
  const sourceOk = firstRun.simultaneous?.locked === false
    && firstRun.simultaneous?.ambiguous === true
    && firstRun.fallback?.locked === false
    && firstRun.rightSource?.locked === true
    && firstRun.rightSource?.lockedIndex === 0
    && firstRun.rightSource?.source === 'right'
    && firstRun.leftSource?.locked === true
    && firstRun.leftSource?.lockedIndex === 1
    && firstRun.leftSource?.source === 'left';
  const controllerOk = sourceOk
    && firstRun.afterLock?.locked === true
    && firstRun.afterLock?.phase === 'LOCKED_LIVE_DIAG'
    && firstRun.afterLock?.verdict === 'UNKNOWN'
    && firstRun.afterLock?.selects === 0
    && firstRun.afterBlack?.verdict === 'BLACK'
    && firstRun.afterClean?.verdict === 'CLEAN'
    && firstRun.afterApproach?.verdictBefore === 'CLEAN'
    && firstRun.afterApproach?.phase === 'APPROACH'
    && firstRun.afterApproach?.verdictBefore === firstRun.afterApproach?.verdictAfter
    && firstRun.afterApproach?.selects === 0
    && firstRun.approachSamples > 0
    && firstRun.afterFocus?.phase === 'FOCUS_REQUESTED'
    && firstRun.afterFocus?.selectsAtFire === 1
    && firstRun.afterFocus?.selectsWhileHeld === 1
    && firstRun.afterExtra?.selects === 1
    && firstRun.iwerTrigger?.mutatedVerdict === false
    && secondRun.stalePressDown === false
    && secondRun.secondLock === true
    && secondRun.secondVerdict === 'UNKNOWN';
  const assoc = firstRun.association;
  const associationOk = assoc?.ok === true
    && assoc.classification === 'IWER_EMULATED'
    && assoc.NOT_HARDWARE_VISUAL_PROOF === true
    && assoc.injected?.rightSlot0 === true
    && assoc.injected?.leftSlot1 === true
    && assoc.afterInject?.slotHands?.[0] === 'right'
    && assoc.afterInject?.slotHands?.[1] === 'left'
    && assoc.afterInject?.pickRight === 0
    && assoc.afterInject?.pickLeft === 1
    && assoc.reorder?.unchanged === true
    && assoc.reorder?.pickRight === 0
    && assoc.reorder?.pickLeft === 1
    && assoc.reorder?.before?.[0] === 'right'
    && assoc.reorder?.before?.[1] === 'left'
    && assoc.reorder?.after?.[0] === 'right'
    && assoc.reorder?.after?.[1] === 'left'
    && assoc.reorder?.logicalLeftConnected === true
    && assoc.reorder?.logicalRightConnected === true
    && assoc.afterRightDisconnect?.slotHands?.[0] == null
    && assoc.afterRightDisconnect?.slotHands?.[1] === 'left'
    && assoc.afterRepeat?.slotHands?.[0] === 'right'
    && assoc.afterRepeat?.slotHands?.[1] === 'left'
    && assoc.reorder2?.unchanged === true
    && assoc.reorder2?.pickRight === 0
    && assoc.reorder2?.pickLeft === 1;
  const race = firstRun.startupRace;
  const startupRaceOk = race?.listenerInstalledBeforeCompatAwait === true
    && race?.capturedInitialEvent === true
    && race?.slotHands?.[0] === 'right'
    && race?.slotHands?.[1] === 'left'
    && race?.pickRight === 0
    && race?.pickLeft === 1
    && Array.isArray(race?.events)
    && race.events.indexOf('installControllers') === 0
    && race.events.indexOf('setSession-enter') === 1
    && race.events.indexOf('three-session-listeners-installed') > race.events.indexOf('setSession-enter')
    && race.events.indexOf('optional-compatibility-await') > race.events.indexOf('three-session-listeners-installed');
  const pass = before.heading === 'JP-4A TEST' && before.start
    && /Source HEAD: [0-9a-f]{40}/.test(before.meta)
    && /Build: [0-9a-f]{40}/.test(before.meta)
    && firstRun.entered?.ok && firstRun.firstWorldRender
    && firstRun.modes.length === 9 && new Set(firstRun.modes).size === 9
    && controllerOk
    && afterReset.started?.active === true
    && cleanReset
    && secondRun.entered?.ok && secondRun.completed
    && secondRun.hasCopyResult && secondRun.hasCopyJson
    && associationOk
    && startupRaceOk
    && truthfulInvariant
    && normalControl.consoleAbsent
    && normalControl.liveControlAbsent
    && normalControl.associationAbsent
    && normalControl.startupRaceAbsent;

  const sourceHeadMatch = before.meta.match(/Source HEAD: ([0-9a-f]{40})/);
  const evidence = {
    phase: 'ROUND5B3_HF3_HF2_INITIAL_CONTROLLER_CONNECTION_RACE_CORRECTION',
    classification: 'IWER_EMULATED',
    scope: 'INITIAL_INPUTSOURCESCHANGE_BEFORE_THREE_COMPAT_AWAIT',
    NOT_HARDWARE_VISUAL_PROOF: true,
    QUEST_HARDWARE: 'NOT_EXECUTED',
    implementationTestedHead: sourceHeadMatch?.[1] ?? null,
    evidenceCommitHead: 'NEWER_THAN_TESTED_SOURCE',
    sourceHead: sourceHeadMatch?.[1] ?? null,
    ciCheckoutSha: (before.meta.match(/CI checkout: ([0-9a-f]{40}|same as source)/) || [])[1] ?? null,
    pass,
    url: '/xr-test/jp4a',
    controllerSeam: firstRun.seam,
    associationSeam: 'window.__jp4aLiveControl.controllerAssociation',
    startupRaceSeam: 'window.__jp4aLiveControl.startupRace.simulateInitialSourcesDuringCompat',
    simultaneousTriggerPolicy: 'AMBIGUOUS_NO_ACTION_UNTIL_BOTH_RELEASED',
    iwerRayPickBoundary: 'Headless IWER cannot prove Quest physical initial inputsourceschange timing. This run installs controller-object listeners, then uses a Three.js r184-like fake setSession that attaches inputsourceschange immediately and emits the initial RIGHT+LEFT sources during a fake compatibility await. NOT_HARDWARE_VISUAL_PROOF.',
    before,
    firstRun: {
      entered: firstRun.entered,
      firstWorldRender: firstRun.firstWorldRender,
      startupRace: firstRun.startupRace,
      association: firstRun.association,
      simultaneous: firstRun.simultaneous,
      fallback: firstRun.fallback,
      rightSource: firstRun.rightSource,
      leftSource: firstRun.leftSource,
      afterLock: firstRun.afterLock,
      afterBlack: firstRun.afterBlack,
      afterClean: firstRun.afterClean,
      modes: firstRun.modes,
      afterApproach: firstRun.afterApproach,
      approachSamples: firstRun.approachSamples,
      afterFocus: firstRun.afterFocus,
      afterExtra: firstRun.afterExtra,
      iwerTrigger: firstRun.iwerTrigger,
      completed: !!firstRun.completed?.completedAt,
      competingLoops: firstRun.competingLoops,
    },
    liveShelfInvariant,
    invariant: firstRun.invariant,
    afterReset,
    secondRun: {
      entered: secondRun.entered,
      firstWorldRender: secondRun.firstWorldRender,
      stalePressDown: secondRun.stalePressDown,
      secondLock: secondRun.secondLock,
      secondVerdict: secondRun.secondVerdict,
      completed: secondRun.completed,
      hasCopyResult: secondRun.hasCopyResult,
      hasCopyJson: secondRun.hasCopyJson,
    },
    privacy: {
      containsTitle: /SECRET_TITLE|posterUrl|token/i.test(firstRun.result || ''),
      opaqueOnly: /opaque-/.test(firstRun.result || ''),
    },
    normalConsoleAbsent: normalControl.consoleAbsent,
    normalLiveControlAbsent: normalControl.liveControlAbsent,
    normalAssociationAbsent: normalControl.associationAbsent,
    normalStartupRaceAbsent: normalControl.startupRaceAbsent,
    seriousErrors: logs.filter((x) => x.type === 'pageerror'
      || (x.type === 'error' && !/Failed to load resource:.*500/i.test(x.text))),
    knownDemoResourceErrors: logs.filter((x) => x.type === 'error'
      && /Failed to load resource:.*500/i.test(x.text)).length,
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'jp4a-round5b3-hf3-hf2-iwer.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({
    pass,
    evidence: 'docs/review/jp4a/jp4a-round5b3-hf3-hf2-iwer.json',
    liveShelfInvariant,
    associationOk,
    startupRaceOk,
    implementationTestedHead: evidence.implementationTestedHead,
  }));
  if (!pass) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  kill(server);
  fs.rmSync(profileDir, { recursive: true, force: true });
}
