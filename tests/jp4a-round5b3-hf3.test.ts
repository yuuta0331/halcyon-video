import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { summarizePosterBankInvariant } from '../src/poster-bank-invariant.ts';
import { LivePosterDiagRuntime } from '../src/xr/live-poster-diag-runtime.ts';
import { createJp4aHostBindings, JP4A_DIAGNOSTIC_LOCK_RANGE_M, JP4A_PRODUCTION_INTERACT_RANGE_FT } from '../src/xr/jp4a-diagnostic-lock.ts';
import { JP4A_HOLD_TRIGGER_MS, jp4aHudStep } from '../src/xr/jp4a-test-phase.ts';
import {
  emptyJp4aTriggerPressState,
  emptyJp4aTriggerSourceState,
  jp4aHitForSource,
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

function currentVerdict(mode = jp4aTestSnapshot()?.mode ?? 'LIVE-NORMAL'): string {
  return jp4aTestSnapshot()?.modeVerdicts[mode] ?? 'UNKNOWN';
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

test('HF3 jp4aHitForSource never falls back to the opposite ray', () => {
  const a = fakeSlot('A');
  const b = fakeSlot('B');
  assert.equal(jp4aHitForSource('right', b, a), a);
  assert.equal(jp4aHitForSource('left', b, a), b);
  assert.equal(jp4aHitForSource('right', b, null), null);
  assert.equal(jp4aHitForSource('left', null, a), null);
  assert.equal(jp4aHitForSource(null, b, a), null);
});

test('HF3 A: right Trigger locks the right-ray poster, not left', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const b = fakeSlot('B');
    const diag = testDiag([a, b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 0 });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: 80 });
    assert.equal(diag.lockedSlot(), a);
    assert.notEqual(diag.lockedSlot(), b);
    assert.equal(currentVerdict(), 'UNKNOWN');
    assert.equal(host.productionSelectCount(), 0);
  });
});

test('HF3 B: left Trigger locks the left-ray poster, not right', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const b = fakeSlot('B');
    const diag = testDiag([a, b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, { left: true, right: false, leftHit: b, rightHit: a, now: 0 });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: 80 });
    assert.equal(diag.lockedSlot(), b);
    assert.notEqual(diag.lockedSlot(), a);
  });
});

test('HF3 C: opposite controller hit is never used as fallback', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const b = fakeSlot('B');
    const diag = testDiag([a, b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: null, now: 0 });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: null, now: 80 });
    assert.equal(diag.hasLock(), false);
    hands = drive(host, diag, hands, { left: true, right: false, leftHit: null, rightHit: a, now: 200 });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: null, rightHit: a, now: 280 });
    assert.equal(diag.hasLock(), false);
  });
});

test('HF3 D: source stays bound through HOLD while the other ray moves', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const b = fakeSlot('B');
    const diag = testDiag([a, b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 0 });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: 40 });
    assert.equal(diag.lockedSlot(), a);
    diag.cycleVerdict();
    diag.cycleVerdict();
    assert.equal(currentVerdict(), 'CLEAN');
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 100 });
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 100 + JP4A_HOLD_TRIGGER_MS });
    assert.equal(hands.source.source, 'right');
    assert.equal(jp4aTestSnapshot()?.testPhase, 'APPROACH');
    assert.equal(currentVerdict(), 'CLEAN');
    assert.equal(diag.lockedSlot(), a);
  });
});

test('HF3 E: second Trigger cannot steal an active press', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const b = fakeSlot('B');
    const diag = testDiag([a, b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 0 });
    hands = drive(host, diag, hands, { left: true, right: true, leftHit: b, rightHit: a, now: 80 });
    assert.equal(hands.source.source, 'right');
    hands = drive(host, diag, hands, { left: true, right: false, leftHit: b, rightHit: a, now: 160 });
    assert.equal(diag.lockedSlot(), a);
    assert.equal(hands.source.source, null);
  });
});

test('HF3 F: simultaneous first edges are ambiguous and lock nothing', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const b = fakeSlot('B');
    const diag = testDiag([a, b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, { left: true, right: true, leftHit: b, rightHit: a, now: 0 });
    assert.equal(hands.source.ambiguous, true);
    assert.equal(diag.hasLock(), false);
    hands = drive(host, diag, hands, { left: true, right: true, leftHit: b, rightHit: a, now: 80 });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: 160 });
    assert.equal(hands.source.ambiguous, false);
    assert.equal(diag.hasLock(), false);
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 240 });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: 320 });
    assert.equal(diag.lockedSlot(), a);
  });
});

test('HF3 G: initial right lock held too long remains LOCK ONLY', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const b = fakeSlot('B');
    const diag = testDiag([a, b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 0 });
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: JP4A_HOLD_TRIGGER_MS + 40 });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: JP4A_HOLD_TRIGGER_MS + 41 });
    assert.equal(diag.lockedSlot(), a);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'LOCKED_LIVE_DIAG');
    assert.equal(currentVerdict(), 'UNKNOWN');
  });
});

test('HF3 H: short right TAP cycles verdict once; left ray cannot affect it', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const b = fakeSlot('B');
    const diag = testDiag([a, b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 0 });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: 40 });
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 100 });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: 180 });
    assert.equal(currentVerdict(), 'BLACK');
    assert.equal(diag.lockedSlot(), a);
  });
});

test('HF3 I/J: HOLD APPROACH then FOCUS still select production once', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const b = fakeSlot('B');
    const diag = testDiag([a, b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 0 });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: 40 });
    diag.cycleVerdict();
    diag.cycleVerdict();
    assert.equal(currentVerdict(), 'CLEAN');
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 100 });
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 100 + JP4A_HOLD_TRIGGER_MS });
    assert.equal(jp4aTestSnapshot()?.testPhase, 'APPROACH');
    assert.equal(currentVerdict(), 'CLEAN');
    assert.equal(host.productionSelectCount(), 0);
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: 900 });
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 1000 });
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 1000 + JP4A_HOLD_TRIGGER_MS });
    assert.equal(jp4aTestSnapshot()?.testPhase, 'FOCUS_REQUESTED');
    assert.equal(host.productionSelectCount(), 1);
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 1800 });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: 1840 });
    assert.equal(host.productionSelectCount(), 1);
    assert.equal(currentVerdict(), 'CLEAN');
  });
});

test('HF3 K: active source clears on release so a new left press is independent', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const b = fakeSlot('B');
    const diag = testDiag([a, b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 0 });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: 40 });
    assert.equal(hands.source.source, null);
    assert.equal(hands.press.down, false);
    hands = drive(host, diag, hands, { left: true, right: false, leftHit: b, rightHit: a, now: 200 });
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: b, rightHit: a, now: 280 });
    assert.equal(currentVerdict(), 'BLACK');
    assert.equal(diag.lockedSlot(), a);
  });
});

test('HF3 L: session-end style reset clears source and press', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const diag = testDiag([a]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: null, rightHit: a, now: 0 });
    assert.equal(hands.source.source, 'right');
    hands = emptyHands();
    assert.equal(hands.source.source, null);
    assert.equal(hands.press.down, false);
    hands = drive(host, diag, hands, { left: false, right: false, leftHit: null, rightHit: a, now: 40 });
    assert.equal(diag.hasLock(), false);
  });
});

test('HF3 M: active controller disappearance cancels without TAP/HOLD/select', () => {
  withSession(() => {
    const a = fakeSlot('A');
    const b = fakeSlot('B');
    const diag = testDiag([a, b]);
    const host = createJp4aHostBindings(diag, () => {});
    let hands = emptyHands();
    hands = drive(host, diag, hands, { left: false, right: true, leftHit: b, rightHit: a, now: 0 });
    assert.equal(hands.press.down, true);
    hands = drive(host, diag, hands, {
      left: false, right: true, leftHit: b, rightHit: a, now: 80, rightConnected: false,
    });
    assert.equal(diag.hasLock(), false);
    assert.equal(host.productionSelectCount(), 0);
    assert.equal(hands.source.source, null);
    assert.equal(hands.press.down, false);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'BASELINE');
  });
});

test('HF3 HUD names same-controller ray and production reach stays 14 ft / 12 m', () => {
  const step2 = jp4aHudStep('BASELINE', true);
  assert.match(step2.hint, /SAME CONTROLLER/);
  assert.equal(JP4A_PRODUCTION_INTERACT_RANGE_FT, 14);
  assert.equal(JP4A_DIAGNOSTIC_LOCK_RANGE_M, 12);
});
