import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { summarizePosterBankInvariant } from '../src/poster-bank-invariant.ts';
import { snapshotControllersFromInputSources } from '../src/xr/input-policy.ts';
import { LivePosterDiagRuntime } from '../src/xr/live-poster-diag-runtime.ts';
import { createJp4aHostBindings, JP4A_DIAGNOSTIC_LOCK_RANGE_M, JP4A_PRODUCTION_INTERACT_RANGE_FT } from '../src/xr/jp4a-diagnostic-lock.ts';
import {
  bindJp4aControllerObjectEvents,
  jp4aHitFromActualController,
  pickJp4aControllerByHand,
  readJp4aControllerHand,
  type Jp4aControllerObjectHandlers,
} from '../src/xr/jp4a-controller-association.ts';
import {
  awaitedIdentifiersBetween,
  createStartupRaceController,
  defaultStartupRaceHandlers,
  installStartupRaceControllerListeners,
  pickFailsClosedWhenUnmapped,
  runtimeAwaitsEnsureXrCompatibleBeforeSetSession,
  simulateThreeR184SetSessionWithInitialSources,
  THREE_R184_SET_SESSION_ORDER,
} from '../src/xr/webxr-set-session-order.ts';
import {
  emptyJp4aTriggerPressState,
  emptyJp4aTriggerSourceState,
  stepJp4aHandedTrigger,
  type Jp4aTriggerPressState,
  type Jp4aTriggerSourceState,
} from '../src/xr/jp4a-trigger-input.ts';
import {
  jp4aTestSnapshot,
  registerJp4aLiveDiagnosticReset,
  startJp4aTest,
} from '../src/xr/jp4a-test-state.ts';
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

function fakeSlot(id: string): MovieSlot {
  const geo = new THREE.BoxGeometry(1, 1, 0.1);
  geo.setAttribute('aTextureIndex', new THREE.InstancedBufferAttribute(new Float32Array([5, 5]), 1));
  const mat = new THREE.MeshBasicMaterial();
  const front = new THREE.InstancedMesh(geo, mat, 2);
  const back = new THREE.InstancedMesh(geo, mat, 2);
  front.userData.posterBank = 0;
  back.userData.posterBank = 0;
  const matrix = new THREE.Matrix4().setPosition(1, 2, 3);
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

function testDiag(slots: MovieSlot[]) {
  return new LivePosterDiagRuntime({
    slots: () => slots,
    peekIndex: () => 5,
    bankSize: () => 16,
    loadedFlag: () => 255,
    setShader: () => {},
    inspectInvariant: () => summarizePosterBankInvariant([]),
  });
}

interface Hands {
  press: Jp4aTriggerPressState;
  source: Jp4aTriggerSourceState;
  prevLeft: boolean;
  prevRight: boolean;
}

function emptyHands(): Hands {
  return {
    press: emptyJp4aTriggerPressState(),
    source: emptyJp4aTriggerSourceState(),
    prevLeft: false,
    prevRight: false,
  };
}

function drive(
  host: ReturnType<typeof createJp4aHostBindings>,
  diag: LivePosterDiagRuntime,
  hands: Hands,
  input: {
    left: boolean;
    right: boolean;
    leftHit: MovieSlot | null;
    rightHit: MovieSlot | null;
    now: number;
  },
): Hands {
  const handed = stepJp4aHandedTrigger({
    press: hands.press,
    source: hands.source,
    leftTrigger: input.left,
    rightTrigger: input.right,
    prevLeftTrigger: hands.prevLeft,
    prevRightTrigger: hands.prevRight,
    leftConnected: true,
    rightConnected: true,
    leftHit: input.leftHit,
    rightHit: input.rightHit,
    now: input.now,
    phase: jp4aTestSnapshot()?.testPhase ?? 'BASELINE',
    hasLock: diag.hasLock(),
  });
  host.applyJp4aTriggerCommand(handed.command);
  return {
    press: handed.press,
    source: handed.source,
    prevLeft: input.left,
    prevRight: input.right,
  };
}

function associationHandlers(): Jp4aControllerObjectHandlers {
  return defaultStartupRaceHandlers();
}

test('HF3-HF2 A: runtime does not await ensureXrCompatible between installControllers and setSession', () => {
  const runtime = readFileSync(new URL('../src/xr/runtime.ts', import.meta.url), 'utf8');
  assert.equal(runtimeAwaitsEnsureXrCompatibleBeforeSetSession(runtime), false);
  const awaits = awaitedIdentifiersBetween(
    runtime,
    'this.installControllers(xrMgr)',
    'await xrMgr.setSession(session)',
  );
  assert.deepEqual(awaits, []);
  assert.equal(runtime.includes('await ensureXrCompatible'), false);
});

test('HF3-HF2 B: listener installation precedes setSession in source', () => {
  const runtime = readFileSync(new URL('../src/xr/runtime.ts', import.meta.url), 'utf8');
  const install = runtime.indexOf('this.installControllers(xrMgr)');
  const bind = runtime.indexOf('bindJp4aControllerObjectEvents');
  const setSession = runtime.indexOf('await xrMgr.setSession(session)');
  assert.ok(install > 0 && bind > 0 && setSession > install);
  assert.ok(bind < setSession);
});

test('HF3-HF2 C: Three r184 order installs session listener before compat await', async () => {
  assert.deepEqual([...THREE_R184_SET_SESSION_ORDER], [
    'assignSession',
    'installInputSourcesChange',
    'optionalMakeXRCompatible',
  ]);
  const slot0 = createStartupRaceController();
  const slot1 = createStartupRaceController();
  installStartupRaceControllerListeners([slot0, slot1]);
  const result = await simulateThreeR184SetSessionWithInitialSources({
    controllerObjects: [slot0, slot1],
    initialSources: [{ handedness: 'right' }, { handedness: 'left' }],
  });
  const install = result.events.indexOf('installControllers');
  const enter = result.events.indexOf('setSession-enter');
  const listeners = result.events.indexOf('three-session-listeners-installed');
  const compat = result.events.indexOf('optional-compatibility-await');
  assert.ok(install >= 0 && enter === install + 1);
  assert.ok(listeners > enter && compat > listeners);
});

test('HF3-HF2 D: initial inputsourceschange during fake compat is captured', async () => {
  const slot0 = createStartupRaceController();
  const slot1 = createStartupRaceController();
  installStartupRaceControllerListeners([slot0, slot1]);
  const result = await simulateThreeR184SetSessionWithInitialSources({
    controllerObjects: [slot0, slot1],
    initialSources: [{ handedness: 'right' }, { handedness: 'left' }],
    emitDuringCompat: true,
  });
  assert.equal(result.listenerInstalledBeforeCompatAwait, true);
  assert.equal(result.capturedInitialEvent, true);
  assert.equal(slot0.userData.jp4aHand, 'right');
  assert.equal(slot1.userData.jp4aHand, 'left');
});

test('HF3-HF2 E: initial RIGHT source marks an actual RIGHT controller object', async () => {
  const a = fakeSlot('A');
  const slot0 = createStartupRaceController();
  const slot1 = createStartupRaceController();
  installStartupRaceControllerListeners([slot0, slot1]);
  await simulateThreeR184SetSessionWithInitialSources({
    controllerObjects: [slot0, slot1],
    initialSources: [{ handedness: 'right' }],
  });
  assert.equal(readJp4aControllerHand(slot0), 'right');
  assert.equal(pickJp4aControllerByHand([slot0, slot1], 'right'), slot0);
  withSession(() => {
    const diag = testDiag([a]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    const objects = [slot0, slot1];
    const hits = [a, null];
    hands = drive(host, diag, hands, {
      left: false, right: true, now: 0,
      leftHit: jp4aHitFromActualController(objects, 'left', hits),
      rightHit: jp4aHitFromActualController(objects, 'right', hits),
    });
    hands = drive(host, diag, hands, {
      left: false, right: false, now: 80,
      leftHit: jp4aHitFromActualController(objects, 'left', hits),
      rightHit: jp4aHitFromActualController(objects, 'right', hits),
    });
    assert.equal(diag.lockedSlot(), a);
  });
});

test('HF3-HF2 F: initial LEFT source marks an actual LEFT controller object', async () => {
  const b = fakeSlot('B');
  const slot0 = createStartupRaceController();
  const slot1 = createStartupRaceController();
  installStartupRaceControllerListeners([slot0, slot1]);
  await simulateThreeR184SetSessionWithInitialSources({
    controllerObjects: [slot0, slot1],
    initialSources: [{ handedness: 'left' }],
  });
  assert.equal(readJp4aControllerHand(slot0), 'left');
  withSession(() => {
    const diag = testDiag([b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    const objects = [slot0, slot1];
    const hits = [b, null];
    hands = drive(host, diag, hands, {
      left: true, right: false, now: 0,
      leftHit: jp4aHitFromActualController(objects, 'left', hits),
      rightHit: jp4aHitFromActualController(objects, 'right', hits),
    });
    hands = drive(host, diag, hands, {
      left: false, right: false, now: 80,
      leftHit: jp4aHitFromActualController(objects, 'left', hits),
      rightHit: jp4aHitFromActualController(objects, 'right', hits),
    });
    assert.equal(diag.lockedSlot(), b);
  });
});

test('HF3-HF2 G: both initial controllers associate without index guessing', async () => {
  const slot0 = createStartupRaceController();
  const slot1 = createStartupRaceController();
  installStartupRaceControllerListeners([slot0, slot1]);
  const result = await simulateThreeR184SetSessionWithInitialSources({
    controllerObjects: [slot0, slot1],
    initialSources: [{ handedness: 'right' }, { handedness: 'left' }],
  });
  assert.deepEqual(result.slotHands, ['right', 'left']);
  assert.equal(pickJp4aControllerByHand([slot0, slot1], 'right'), slot0);
  assert.equal(pickJp4aControllerByHand([slot0, slot1], 'left'), slot1);
  snapshotControllersFromInputSources([
    { handedness: 'left' },
    { handedness: 'right' },
  ]);
  assert.equal(readJp4aControllerHand(slot0), 'right');
  assert.equal(readJp4aControllerHand(slot1), 'left');
});

test('HF3-HF2 H: reconnect/reorder still preserves connected-lifecycle mapping', () => {
  const slot0 = createStartupRaceController();
  const slot1 = createStartupRaceController();
  const handlers = associationHandlers();
  bindJp4aControllerObjectEvents(slot0, handlers);
  bindJp4aControllerObjectEvents(slot1, handlers);
  slot0.dispatchEvent({ type: 'connected', data: { handedness: 'right' } });
  slot1.dispatchEvent({ type: 'connected', data: { handedness: 'left' } });
  slot0.dispatchEvent({ type: 'disconnected' });
  slot0.dispatchEvent({ type: 'connected', data: { handedness: 'right' } });
  snapshotControllersFromInputSources([
    { handedness: 'left', targetRayMode: 'tracked-pointer' },
    { handedness: 'right', targetRayMode: 'tracked-pointer' },
  ]);
  assert.equal(slot0.userData.jp4aHand, 'right');
  assert.equal(slot1.userData.jp4aHand, 'left');
});

test('HF3-HF2 I: runtime still has no inputSources[i] object-hand mapping', () => {
  const src = readFileSync(new URL('../src/xr/runtime.ts', import.meta.url), 'utf8');
  assert.equal(src.includes('ordered[i]'), false);
  assert.doesNotMatch(src, /controllerObjects\[i\][\s\S]{0,120}jp4aHand/);
  assert.doesNotMatch(src, /jp4aHand[\s\S]{0,80}inputSources\[i\]/);
  assert.match(src, /setJp4aControllerHandFromConnection/);
});

test('HF3-HF2 unknown mapping fails closed and ranges stay 14 ft / 12 m', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const empty = createStartupRaceController();
    assert.equal(pickFailsClosedWhenUnmapped([empty], 'right'), true);
    const diag = testDiag([a]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: a, rightHit: null, now: 0 });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: a, rightHit: null, now: 80 });
    assert.equal(diag.hasLock(), false);
    assert.equal(JP4A_PRODUCTION_INTERACT_RANGE_FT, 14);
    assert.equal(JP4A_DIAGNOSTIC_LOCK_RANGE_M, 12);
  });
});
