import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { summarizePosterBankInvariant } from '../src/poster-bank-invariant.ts';
import { snapshotControllersFromInputSources } from '../src/xr/input-policy.ts';
import { LivePosterDiagRuntime } from '../src/xr/live-poster-diag-runtime.ts';
import { createJp4aHostBindings, JP4A_DIAGNOSTIC_LOCK_RANGE_M, JP4A_PRODUCTION_INTERACT_RANGE_FT } from '../src/xr/jp4a-diagnostic-lock.ts';
import { JP4A_HOLD_TRIGGER_MS } from '../src/xr/jp4a-test-phase.ts';
import {
  bindJp4aControllerObjectEvents,
  clearJp4aControllerHand,
  jp4aHitFromActualController,
  pickJp4aControllerByHand,
  readJp4aControllerHand,
  setJp4aControllerHandFromConnection,
  unbindJp4aControllerObjectEvents,
  type Jp4aControllerObjectHandlers,
  type Jp4aHandTarget,
} from '../src/xr/jp4a-controller-association.ts';
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
    leftConnected?: boolean;
    rightConnected?: boolean;
  },
): Hands {
  const handed = stepJp4aHandedTrigger({
    press: hands.press,
    source: hands.source,
    leftTrigger: input.left,
    rightTrigger: input.right,
    prevLeftTrigger: hands.prevLeft,
    prevRightTrigger: hands.prevRight,
    leftConnected: input.leftConnected !== false,
    rightConnected: input.rightConnected !== false,
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

function controllerObject(): THREE.Group {
  return new THREE.Group();
}

function associationHandlers(): Jp4aControllerObjectHandlers {
  return {
    selectstart: () => {},
    connected: (event) => {
      setJp4aControllerHandFromConnection(event.target, event.data?.handedness, event.data);
    },
    disconnected: (event) => {
      clearJp4aControllerHand(event.target);
    },
  };
}

function connect(controller: THREE.Object3D, hand: 'left' | 'right'): void {
  controller.dispatchEvent({ type: 'connected', data: { handedness: hand } });
}

function disconnect(controller: THREE.Object3D): void {
  controller.dispatchEvent({ type: 'disconnected' });
}

function logicalReorder(controllerObjects: Jp4aHandTarget[]): void {
  const before = controllerObjects.map((c) => readJp4aControllerHand(c));
  snapshotControllersFromInputSources([
    { handedness: 'left', targetRayMode: 'tracked-pointer', gamepad: { buttons: [{ pressed: true }] } },
    { handedness: 'right', targetRayMode: 'tracked-pointer', gamepad: { buttons: [{ pressed: false }] } },
  ]);
  const after = controllerObjects.map((c) => readJp4aControllerHand(c));
  assert.deepEqual(after, before);
}

test('HF3-HF1 runtime no longer maps jp4aHand from inputSources[i]', () => {
  const src = readFileSync(new URL('../src/xr/runtime.ts', import.meta.url), 'utf8');
  assert.equal(src.includes('ordered[i]'), false);
  assert.doesNotMatch(src, /controllerObjects\[i\][\s\S]{0,120}jp4aHand/);
  assert.doesNotMatch(src, /jp4aHand[\s\S]{0,80}inputSources\[i\]/);
  assert.match(src, /setJp4aControllerHandFromConnection/);
  assert.match(src, /snapshotControllersFromInputSources/);
  assert.match(src, /bindJp4aControllerObjectEvents/);
  assert.match(src, /unbindJp4aControllerObjectEvents/);
});

test('HF3-HF1 A: connected event owns handedness', () => {
  const right = controllerObject();
  const left = controllerObject();
  const handlers = associationHandlers();
  bindJp4aControllerObjectEvents(right, handlers);
  bindJp4aControllerObjectEvents(left, handlers);
  connect(right, 'right');
  connect(left, 'left');
  assert.equal(right.userData.jp4aHand, 'right');
  assert.equal(left.userData.jp4aHand, 'left');
});

test('HF3-HF1 B: disconnected clears mapping', () => {
  const right = controllerObject();
  const handlers = associationHandlers();
  bindJp4aControllerObjectEvents(right, handlers);
  connect(right, 'right');
  disconnect(right);
  assert.equal(right.userData.jp4aHand, undefined);
  assert.equal(right.userData.jp4aInputSource, undefined);
});

test('HF3-HF1 C: session.inputSources order must not overwrite object hands', () => {
  const slot0 = controllerObject();
  const slot1 = controllerObject();
  const handlers = associationHandlers();
  bindJp4aControllerObjectEvents(slot0, handlers);
  bindJp4aControllerObjectEvents(slot1, handlers);
  connect(slot0, 'right');
  connect(slot1, 'left');
  const logical = snapshotControllersFromInputSources([
    { handedness: 'left', targetRayMode: 'tracked-pointer', gamepad: { buttons: [{ pressed: true }] } },
    { handedness: 'right', targetRayMode: 'tracked-pointer', gamepad: { buttons: [{ pressed: false }] } },
  ]);
  assert.equal(logical.controllers.left.connected, true);
  assert.equal(logical.controllers.left.select, true);
  assert.equal(logical.controllers.right.connected, true);
  assert.equal(logical.controllers.right.select, false);
  assert.equal(slot0.userData.jp4aHand, 'right');
  assert.equal(slot1.userData.jp4aHand, 'left');
  assert.equal(pickJp4aControllerByHand([slot0, slot1], 'right'), slot0);
  assert.equal(pickJp4aControllerByHand([slot0, slot1], 'left'), slot1);
});

test('HF3-HF1 D: reconnect into slot 0 stays RIGHT after active-list reorder', () => {
  const slot0 = controllerObject();
  const slot1 = controllerObject();
  const handlers = associationHandlers();
  bindJp4aControllerObjectEvents(slot0, handlers);
  bindJp4aControllerObjectEvents(slot1, handlers);
  connect(slot0, 'right');
  connect(slot1, 'left');
  disconnect(slot0);
  assert.equal(slot0.userData.jp4aHand, undefined);
  assert.equal(slot1.userData.jp4aHand, 'left');
  connect(slot0, 'right');
  logicalReorder([slot0, slot1]);
  assert.equal(slot0.userData.jp4aHand, 'right');
  assert.equal(slot1.userData.jp4aHand, 'left');
});

test('HF3-HF1 E: right Trigger after reorder uses actual RIGHT ray', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const b = fakeSlot('B');
    const slot0 = controllerObject();
    const slot1 = controllerObject();
    const handlers = associationHandlers();
    bindJp4aControllerObjectEvents(slot0, handlers);
    bindJp4aControllerObjectEvents(slot1, handlers);
    connect(slot0, 'right');
    connect(slot1, 'left');
    logicalReorder([slot0, slot1]);
    const objects = [slot0, slot1];
    const hits = [a, b];
    const diag = testDiag([a, b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, {
      left: false,
      right: true,
      leftHit: jp4aHitFromActualController(objects, 'left', hits),
      rightHit: jp4aHitFromActualController(objects, 'right', hits),
      now: 0,
    });
    hands = drive(host, diag, hands, {
      left: false,
      right: false,
      leftHit: jp4aHitFromActualController(objects, 'left', hits),
      rightHit: jp4aHitFromActualController(objects, 'right', hits),
      now: 80,
    });
    assert.equal(diag.lockedSlot(), a);
    assert.notEqual(diag.lockedSlot(), b);
  });
});

test('HF3-HF1 F: left Trigger after reorder uses actual LEFT ray', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const b = fakeSlot('B');
    const slot0 = controllerObject();
    const slot1 = controllerObject();
    const handlers = associationHandlers();
    bindJp4aControllerObjectEvents(slot0, handlers);
    bindJp4aControllerObjectEvents(slot1, handlers);
    connect(slot0, 'right');
    connect(slot1, 'left');
    logicalReorder([slot0, slot1]);
    const objects = [slot0, slot1];
    const hits = [a, b];
    const diag = testDiag([a, b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, {
      left: true,
      right: false,
      leftHit: jp4aHitFromActualController(objects, 'left', hits),
      rightHit: jp4aHitFromActualController(objects, 'right', hits),
      now: 0,
    });
    hands = drive(host, diag, hands, {
      left: false,
      right: false,
      leftHit: jp4aHitFromActualController(objects, 'left', hits),
      rightHit: jp4aHitFromActualController(objects, 'right', hits),
      now: 80,
    });
    assert.equal(diag.lockedSlot(), b);
    assert.notEqual(diag.lockedSlot(), a);
  });
});

test('HF3-HF1 G: no-hit after reorder does not fall back to the other ray', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const b = fakeSlot('B');
    const slot0 = controllerObject();
    const slot1 = controllerObject();
    const handlers = associationHandlers();
    bindJp4aControllerObjectEvents(slot0, handlers);
    bindJp4aControllerObjectEvents(slot1, handlers);
    connect(slot0, 'right');
    connect(slot1, 'left');
    logicalReorder([slot0, slot1]);
    const objects = [slot0, slot1];
    const hits = [null, b];
    const diag = testDiag([a, b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, {
      left: false,
      right: true,
      leftHit: jp4aHitFromActualController(objects, 'left', hits),
      rightHit: jp4aHitFromActualController(objects, 'right', hits),
      now: 0,
    });
    hands = drive(host, diag, hands, {
      left: false,
      right: false,
      leftHit: jp4aHitFromActualController(objects, 'left', hits),
      rightHit: jp4aHitFromActualController(objects, 'right', hits),
      now: 80,
    });
    assert.equal(diag.hasLock(), false);
  });
});

test('HF3-HF1 H: active disconnect remains cancel', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const b = fakeSlot('B');
    const slot0 = controllerObject();
    const slot1 = controllerObject();
    const handlers = associationHandlers();
    bindJp4aControllerObjectEvents(slot0, handlers);
    bindJp4aControllerObjectEvents(slot1, handlers);
    connect(slot0, 'right');
    connect(slot1, 'left');
    const diag = testDiag([a, b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 0 });
    disconnect(slot0);
    hands = drive(host, diag, hands, {
      left: false, right: true, leftHit: b, rightHit: a, now: 80, rightConnected: false,
    });
    assert.equal(slot0.userData.jp4aHand, undefined);
    assert.equal(slot1.userData.jp4aHand, 'left');
    assert.equal(diag.hasLock(), false);
    assert.equal(host.productionSelectCount(), 0);
    assert.equal(hands.source.source, null);
    assert.equal(hands.press.down, false);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'BASELINE');
  });
});

test('HF3-HF1 I: repeated disconnect/reconnect leaves one LEFT and one RIGHT', () => {
  const slot0 = controllerObject();
  const slot1 = controllerObject();
  const handlers = associationHandlers();
  bindJp4aControllerObjectEvents(slot0, handlers);
  bindJp4aControllerObjectEvents(slot1, handlers);
  connect(slot0, 'right');
  connect(slot1, 'left');
  for (let i = 0; i < 2; i++) {
    disconnect(slot0);
    assert.equal(readJp4aControllerHand(slot0), undefined);
    assert.equal(readJp4aControllerHand(slot1), 'left');
    connect(slot0, 'right');
    disconnect(slot1);
    assert.equal(readJp4aControllerHand(slot1), undefined);
    assert.equal(readJp4aControllerHand(slot0), 'right');
    connect(slot1, 'left');
  }
  logicalReorder([slot0, slot1]);
  const hands = [slot0, slot1].map((c) => readJp4aControllerHand(c));
  assert.deepEqual(hands, ['right', 'left']);
  assert.equal(hands.filter((h) => h === 'right').length, 1);
  assert.equal(hands.filter((h) => h === 'left').length, 1);
});

test('HF3-HF1 J: HF2 TAP/HOLD and HF3 source rules remain after association', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const b = fakeSlot('B');
    const diag = testDiag([a, b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, { left: true, right: true, leftHit: b, rightHit: a, now: 0 });
    assert.equal(hands.source.ambiguous, true);
    assert.equal(diag.hasLock(), false);
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: 80 });
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 160 });
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 160 + JP4A_HOLD_TRIGGER_MS });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: 160 + JP4A_HOLD_TRIGGER_MS + 1 });
    assert.equal(diag.lockedSlot(), a);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'LOCKED_LIVE_DIAG');
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 900 });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: 940 });
    assert.equal(jp4aTestSnapshot()?.modeVerdicts['LIVE-NORMAL'], 'BLACK');
    diag.cycleVerdict();
    assert.equal(jp4aTestSnapshot()?.modeVerdicts['LIVE-NORMAL'], 'CLEAN');
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 1000 });
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 1000 + JP4A_HOLD_TRIGGER_MS });
    assert.equal(jp4aTestSnapshot()?.testPhase, 'APPROACH');
    assert.equal(jp4aTestSnapshot()?.modeVerdicts['LIVE-NORMAL'], 'CLEAN');
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: 1800 });
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 1900 });
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 1900 + JP4A_HOLD_TRIGGER_MS });
    assert.equal(jp4aTestSnapshot()?.testPhase, 'FOCUS_REQUESTED');
    assert.equal(host.productionSelectCount(), 1);
    assert.equal(JP4A_PRODUCTION_INTERACT_RANGE_FT, 14);
    assert.equal(JP4A_DIAGNOSTIC_LOCK_RANGE_M, 12);
  });
});

test('HF3-HF1 listeners are removed on teardown and do not duplicate', () => {
  const controller = controllerObject();
  const seen: string[] = [];
  const handlers: Jp4aControllerObjectHandlers = {
    selectstart: () => seen.push('selectstart'),
    connected: (event) => {
      seen.push(`connected:${String(event.data?.handedness)}`);
      setJp4aControllerHandFromConnection(event.target, event.data?.handedness, event.data);
    },
    disconnected: (event) => {
      seen.push('disconnected');
      clearJp4aControllerHand(event.target);
    },
  };
  bindJp4aControllerObjectEvents(controller, handlers);
  unbindJp4aControllerObjectEvents(controller, handlers);
  bindJp4aControllerObjectEvents(controller, handlers);
  connect(controller, 'right');
  assert.deepEqual(seen, ['connected:right']);
  unbindJp4aControllerObjectEvents(controller, handlers);
  seen.length = 0;
  connect(controller, 'left');
  disconnect(controller);
  controller.dispatchEvent({ type: 'selectstart' });
  assert.deepEqual(seen, []);
  assert.equal(controller.userData.jp4aHand, undefined);
});
