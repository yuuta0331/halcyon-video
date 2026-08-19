import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { summarizePosterBankInvariant } from '../src/poster-bank-invariant.ts';
import { STORE_UNITS_PER_METER } from '../src/platform/index.ts';
import { LivePosterDiagRuntime } from '../src/xr/live-poster-diag-runtime.ts';
import {
  createJp4aHostBindings,
  JP4A_PRODUCTION_INTERACT_RANGE_FT,
  jp4aDiagnosticLockRangeStoreUnits,
  jp4aLockInRange,
  jp4aSelectPickRange,
  metersToStoreUnits,
  pickNearestVisibleDiagnosticSlot,
} from '../src/xr/jp4a-diagnostic-lock.ts';
import {
  JP4A_HOLD_TRIGGER_MS,
  jp4aHoldTriggerAction,
  jp4aHudStep,
  jp4aLockReplacementAllowed,
  jp4aModeCycleAllowed,
  jp4aTelemetryPhase,
  nextJp4aTestPhaseFromFocus,
  type Jp4aTestPhase,
} from '../src/xr/jp4a-test-phase.ts';
import {
  jp4aBankInvariantVerdict,
  jp4aTestSnapshot,
  registerJp4aLiveDiagnosticReset,
  resetJp4aTest,
  startJp4aTest,
} from '../src/xr/jp4a-test-state.ts';
import {
  formatJp4aBuildLabels,
  resolveHalcyonBuildIdentity,
} from '../tools/halcyon-build-identity.mjs';
import type { MovieSlot } from '../src/store-layout.ts';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

function withSession<T>(fn: () => T): T {
  const oldStorage = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  registerJp4aLiveDiagnosticReset(null);
  try {
    startJp4aTest(1_700_000_000_000);
    return fn();
  } finally {
    registerJp4aLiveDiagnosticReset(null);
    (globalThis as { localStorage?: unknown }).localStorage = oldStorage;
  }
}

function fakeSlot(id: string, matrix = new THREE.Matrix4().setPosition(1, 2, 3)): MovieSlot {
  const geo = new THREE.BoxGeometry(1, 1, 0.1);
  geo.setAttribute('aTextureIndex', new THREE.InstancedBufferAttribute(new Float32Array([5, 5]), 1));
  const mat = new THREE.MeshBasicMaterial();
  const front = new THREE.InstancedMesh(geo, mat, 2);
  const back = new THREE.InstancedMesh(geo, mat, 2);
  front.userData.posterBank = 0;
  back.userData.posterBank = 0;
  front.setMatrixAt(0, matrix);
  back.setMatrixAt(0, matrix);
  return {
    movie: { id, title: 'SECRET_TITLE_MUST_NOT_LEAK' },
    frontMesh: front,
    backMesh: back,
    instanceIdx: 0,
    hidden: false,
  } as unknown as MovieSlot;
}

function testDiag(slots: MovieSlot[], shader: { index: number | null; mode: string } = { index: -1, mode: 'LIVE-NORMAL' }) {
  return new LivePosterDiagRuntime({
    slots: () => slots,
    peekIndex: () => 5,
    bankSize: () => 16,
    loadedFlag: () => 255,
    setShader: (index, mode) => { shader.index = index; shader.mode = mode; },
    inspectInvariant: () => summarizePosterBankInvariant([]),
    shaderSnapshot: () => ({ index: Number(shader.index ?? -1), mode: shader.mode as 'LIVE-NORMAL' }),
  });
}

function matricesClose(a: number[], b: number[], eps = 1e-5): boolean {
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < eps);
}

function matrixAt(slot: MovieSlot): number[] {
  const m = new THREE.Matrix4();
  slot.frontMesh.getMatrixAt(slot.instanceIdx, m);
  return m.toArray();
}

test('HF1 reset restores DEPTH-ISOLATED matrix, shader, lock, and second START', () => {
  withSession(() => {
    const original = new THREE.Matrix4().makeRotationY(0.4).setPosition(2, 3, 4);
    const slot = fakeSlot('poster-a', original.clone());
    const shader = { index: -1 as number | null, mode: 'LIVE-NORMAL' };
    const diag = testDiag([slot], shader);
    diag.lock(slot);
    diag.setMode('LIVE-DEPTH-ISOLATED');
    assert.equal(diag.hasLock(), true);
    assert.equal(diag.currentMode(), 'LIVE-DEPTH-ISOLATED');
    assert.equal(diag.depthIsolationActive(), true);
    assert.ok(!matricesClose(matrixAt(slot), original.toArray()));
    assert.equal(shader.mode, 'LIVE-DEPTH-ISOLATED');

    registerJp4aLiveDiagnosticReset(() => diag.reset());
    resetJp4aTest();
    assert.ok(matricesClose(matrixAt(slot), original.toArray()));
    assert.equal(diag.depthIsolationActive(), false);
    assert.equal(diag.hasLock(), false);
    assert.equal(diag.currentMode(), 'LIVE-NORMAL');
    assert.equal(shader.mode, 'LIVE-NORMAL');
    assert.equal(shader.index, null);

    startJp4aTest();
    assert.equal(jp4aTestSnapshot()?.testPhase, 'BASELINE');
    assert.equal(jp4aTestSnapshot()?.mode, 'LIVE-NORMAL');
    assert.equal(jp4aTestSnapshot()?.lockedPoster, null);
    diag.lock(slot);
    assert.equal(diag.currentMode(), 'LIVE-NORMAL');
    assert.equal(jp4aTestSnapshot()?.testPhase, 'LOCKED_LIVE_DIAG');
  });
});

test('HF1 diagnostic lock does not select production; explicit FOCUS does once', () => {
  withSession(() => {
    const slot = fakeSlot('poster-b');
    const diag = testDiag([slot]);
    let selected = 0;
    const host = createJp4aHostBindings(diag, () => { selected += 1; });
    host.onJp4aLockSlot(slot);
    assert.equal(selected, 0);
    assert.equal(diag.hasLock(), true);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'LOCKED_LIVE_DIAG');
    host.cycleJp4aMode(1);
    host.cycleJp4aMode(1);
    assert.equal(selected, 0);
    assert.notEqual(jp4aTestSnapshot()?.testPhase, 'FOCUS_REQUESTED');
    assert.equal(host.beginJp4aFocus(), false);
    assert.equal(selected, 0);
    host.advanceJp4aTestPhase();
    assert.equal(jp4aTestSnapshot()?.testPhase, 'APPROACH');
    assert.equal(selected, 0);
    host.cycleJp4aMode(1);
    assert.equal(diag.currentMode(), 'LIVE-NORMAL');
    assert.equal(host.beginJp4aFocus(), true);
    assert.equal(selected, 1);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'FOCUS_REQUESTED');
    assert.equal(host.beginJp4aFocus(), false);
    assert.equal(selected, 1);
  });
});

test('HF1 telemetry phase marker is explicit and FOCUS cannot steal APPROACH', () => {
  const order: Jp4aTestPhase[] = [
    'BASELINE', 'LOCKED_LIVE_DIAG', 'APPROACH', 'FOCUS_REQUESTED', 'FOCUS_TRANSITION', 'FOCUS_SETTLED',
  ];
  assert.deepEqual(order.map(jp4aTelemetryPhase), [
    'baseline', 'live_mode', 'approach', 'focus_transition', 'focus_transition', 'focus_settled',
  ]);
  assert.equal(jp4aTelemetryPhase('APPROACH'), 'approach');
  assert.equal(nextJp4aTestPhaseFromFocus('APPROACH', 'pendingUpload'), 'APPROACH');
  assert.equal(nextJp4aTestPhaseFromFocus('APPROACH', 'ready'), 'APPROACH');
  assert.equal(nextJp4aTestPhaseFromFocus('LOCKED_LIVE_DIAG', 'ready'), 'LOCKED_LIVE_DIAG');
  assert.equal(nextJp4aTestPhaseFromFocus('FOCUS_REQUESTED', 'pendingPixels'), 'FOCUS_TRANSITION');
  assert.equal(nextJp4aTestPhaseFromFocus('FOCUS_TRANSITION', 'ready'), 'FOCUS_SETTLED');
  assert.equal(jp4aModeCycleAllowed('APPROACH'), false);
  assert.equal(jp4aLockReplacementAllowed('APPROACH'), false);
  assert.equal(jp4aHudStep('APPROACH', true).instruction.includes('APPROACH'), true);
  const skip = jp4aHoldTriggerAction({
    triggerDown: true, heldMs: JP4A_HOLD_TRIGGER_MS, alreadyFired: false,
    ignoreThisPress: false, testPhase: 'LOCKED_LIVE_DIAG',
  });
  assert.equal(skip.fire, 'BEGIN_APPROACH');
  const focus = jp4aHoldTriggerAction({
    triggerDown: true, heldMs: JP4A_HOLD_TRIGGER_MS, alreadyFired: false,
    ignoreThisPress: false, testPhase: 'APPROACH',
  });
  assert.equal(focus.fire, 'BEGIN_FOCUS');
  const ignoredLockPress = jp4aHoldTriggerAction({
    triggerDown: true, heldMs: JP4A_HOLD_TRIGGER_MS, alreadyFired: false,
    ignoreThisPress: true, testPhase: 'LOCKED_LIVE_DIAG',
  });
  assert.equal(ignoredLockPress.fire, null);
});

test('HF1 long-range lock is JP-4A-only and prefers the nearest valid poster', () => {
  const walkSrc = readFileSync(new URL('../src/store-walk.ts', import.meta.url), 'utf8');
  assert.match(walkSrc, /export const WALK_INTERACT_RANGE = 14;/);
  assert.equal(JP4A_PRODUCTION_INTERACT_RANGE_FT, 14);
  assert.equal(jp4aSelectPickRange(false), 14);
  const diagRange = jp4aDiagnosticLockRangeStoreUnits();
  assert.ok(diagRange > 14);
  assert.ok(metersToStoreUnits(8) > 14);
  assert.equal(jp4aLockInRange(metersToStoreUnits(8), false), false);
  assert.equal(jp4aLockInRange(metersToStoreUnits(8), true), true);
  assert.equal(jp4aLockInRange(metersToStoreUnits(12), true), true);
  assert.equal(jp4aLockInRange(metersToStoreUnits(12.5), true), false);
  const near = fakeSlot('near');
  const far = fakeSlot('far');
  const hidden = fakeSlot('hidden');
  hidden.hidden = true;
  const hits = [
    { distance: metersToStoreUnits(5), instanceId: 0, object: hidden.frontMesh },
    { distance: metersToStoreUnits(8), instanceId: 0, object: near.frontMesh },
    { distance: metersToStoreUnits(10), instanceId: 0, object: far.frontMesh },
  ];
  const slots = new Map<unknown, MovieSlot>([
    [hidden.frontMesh, hidden], [near.frontMesh, near], [far.frontMesh, far],
  ]);
  const picked = pickNearestVisibleDiagnosticSlot(
    hits,
    (object) => slots.get(object) ?? null,
    jp4aSelectPickRange(true),
  );
  assert.equal(picked, near);
  assert.equal(pickNearestVisibleDiagnosticSlot(
    [{ distance: metersToStoreUnits(13), instanceId: 0, object: far.frontMesh }],
    () => far,
    jp4aSelectPickRange(true),
  ), null);
  void STORE_UNITS_PER_METER;
});

test('HF1 bank invariant zero-slot is NOT_EXERCISED and never PASS', () => {
  const empty = summarizePosterBankInvariant([]);
  assert.equal(empty.checkedSlots, 0);
  assert.equal(empty.pass, false);
  assert.equal(empty.verdict, 'NOT_EXERCISED');
  assert.equal(jp4aBankInvariantVerdict(empty), 'NOT_EXERCISED');
  assert.notEqual(jp4aBankInvariantVerdict({
    checkedSlots: 0, bankMismatchCount: 0, layerOutOfRangeCount: 0,
    missingIndexCount: 0, invalidLoadedFlagCount: 0, pass: true,
  }), 'PASS');
});

test('HF1 build identity distinguishes PR head from merge-ref SHA', () => {
  const pr = resolveHalcyonBuildIdentity({
    HALCYON_SOURCE_HEAD_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    GITHUB_SHA: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  }, 'cccccccccccccccccccccccccccccccccccccccc');
  assert.equal(pr.sourceHeadSha, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(pr.testedSha, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(pr.sourceIsExactHead, false);
  const labels = formatJp4aBuildLabels(pr);
  assert.equal(labels.exactSourceHeadClaim, false);
  assert.equal(labels.checkoutLabel, pr.testedSha);

  const local = resolveHalcyonBuildIdentity({}, 'cccccccccccccccccccccccccccccccccccccccc');
  assert.equal(local.sourceHeadSha, 'cccccccccccccccccccccccccccccccccccccccc');
  assert.equal(local.testedSha, 'cccccccccccccccccccccccccccccccccccccccc');
  assert.equal(local.sourceIsExactHead, true);
  assert.equal(formatJp4aBuildLabels(local).checkoutLabel, 'same as source');

  const mergeOnly = resolveHalcyonBuildIdentity({
    GITHUB_SHA: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  }, '');
  assert.equal(mergeOnly.sourceHeadSha, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(mergeOnly.testedSha, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
});
