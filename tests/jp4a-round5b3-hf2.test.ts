import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { summarizePosterBankInvariant } from '../src/poster-bank-invariant.ts';
import { LivePosterDiagRuntime } from '../src/xr/live-poster-diag-runtime.ts';
import { createJp4aHostBindings, JP4A_PRODUCTION_INTERACT_RANGE_FT } from '../src/xr/jp4a-diagnostic-lock.ts';
import {
  JP4A_HOLD_TRIGGER_MS,
  jp4aHudStep,
} from '../src/xr/jp4a-test-phase.ts';
import {
  emptyJp4aTriggerPressState,
  stepJp4aTrigger,
  type Jp4aTriggerPressState,
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

function drive(
  host: ReturnType<typeof createJp4aHostBindings>,
  diag: LivePosterDiagRuntime,
  press: Jp4aTriggerPressState,
  down: boolean,
  now: number,
  hit: MovieSlot | null,
): Jp4aTriggerPressState {
  const stepped = stepJp4aTrigger({
    prev: press,
    triggerDown: down,
    now,
    hit,
    phase: jp4aTestSnapshot()?.testPhase ?? 'BASELINE',
    hasLock: diag.hasLock(),
  });
  host.applyJp4aTriggerCommand(stepped.command);
  return stepped.press;
}

test('HF2 lock() does not cycle verdict on same-slot reentry', () => {
  withSession(() => {
    const slot = fakeSlot('same');
    const diag = testDiag([slot]);
    assert.equal(diag.lock(slot).verdict, 'UNKNOWN');
    assert.equal(currentVerdict(), 'UNKNOWN');
    const again = diag.lock(slot);
    assert.equal(again.changed, false);
    assert.equal(again.verdict, 'UNKNOWN');
    assert.equal(currentVerdict(), 'UNKNOWN');
    assert.equal(diag.cycleVerdict().verdict, 'BLACK');
    assert.equal(currentVerdict(), 'BLACK');
  });
});

test('HF2 A: initial lock tap locks only and leaves UNKNOWN', () => {
  withSession(() => {
    const slot = fakeSlot('a');
    const diag = testDiag([slot]);
    const host = createJp4aHostBindings(diag, () => {});
    let press = emptyJp4aTriggerPressState();
    press = drive(host, diag, press, true, 0, slot);
    assert.equal(diag.hasLock(), false);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'BASELINE');
    press = drive(host, diag, press, false, 120, slot);
    assert.equal(diag.hasLock(), true);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'LOCKED_LIVE_DIAG');
    assert.equal(currentVerdict(), 'UNKNOWN');
    assert.equal(host.productionSelectCount(), 0);
    assert.equal(press.down, false);
    assert.equal(press.consumedByHold, false);
  });
});

test('HF2 B: initial lock held too long still LOCK ONLY, no APPROACH', () => {
  withSession(() => {
    const slot = fakeSlot('b');
    const diag = testDiag([slot]);
    const host = createJp4aHostBindings(diag, () => {});
    let press = emptyJp4aTriggerPressState();
    press = drive(host, diag, press, true, 0, slot);
    press = drive(host, diag, press, true, JP4A_HOLD_TRIGGER_MS, slot);
    press = drive(host, diag, press, true, JP4A_HOLD_TRIGGER_MS + 400, slot);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'BASELINE');
    assert.equal(diag.hasLock(), false);
    press = drive(host, diag, press, false, JP4A_HOLD_TRIGGER_MS + 401, slot);
    assert.equal(diag.hasLock(), true);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'LOCKED_LIVE_DIAG');
    assert.equal(currentVerdict(), 'UNKNOWN');
    assert.equal(host.productionSelectCount(), 0);
  });
});

test('HF2 C: short taps cycle UNKNOWN → BLACK → CLEAN exactly once each', () => {
  withSession(() => {
    const slot = fakeSlot('c');
    const diag = testDiag([slot]);
    const host = createJp4aHostBindings(diag, () => {});
    let press = emptyJp4aTriggerPressState();
    press = drive(host, diag, press, true, 0, slot);
    press = drive(host, diag, press, false, 80, slot);
    press = drive(host, diag, press, true, 200, slot);
    press = drive(host, diag, press, false, 280, slot);
    assert.equal(currentVerdict(), 'BLACK');
    press = drive(host, diag, press, true, 400, slot);
    press = drive(host, diag, press, false, 480, slot);
    assert.equal(currentVerdict(), 'CLEAN');
    assert.equal(host.productionSelectCount(), 0);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'LOCKED_LIVE_DIAG');
  });
});

test('HF2 D: hold BEGIN APPROACH does not change a CLEAN verdict', () => {
  withSession(() => {
    const slot = fakeSlot('d');
    const diag = testDiag([slot]);
    const host = createJp4aHostBindings(diag, () => {});
    let press = emptyJp4aTriggerPressState();
    press = drive(host, diag, press, true, 0, slot);
    press = drive(host, diag, press, false, 50, slot);
    press = drive(host, diag, press, true, 100, slot);
    press = drive(host, diag, press, false, 150, slot);
    press = drive(host, diag, press, true, 200, slot);
    press = drive(host, diag, press, false, 250, slot);
    assert.equal(currentVerdict(), 'CLEAN');
    press = drive(host, diag, press, true, 1000, slot);
    press = drive(host, diag, press, true, 1000 + JP4A_HOLD_TRIGGER_MS - 1, slot);
    assert.equal(currentVerdict(), 'CLEAN');
    assert.equal(jp4aTestSnapshot()?.testPhase, 'LOCKED_LIVE_DIAG');
    press = drive(host, diag, press, true, 1000 + JP4A_HOLD_TRIGGER_MS, slot);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'APPROACH');
    assert.equal(currentVerdict(), 'CLEAN');
    press = drive(host, diag, press, true, 1000 + JP4A_HOLD_TRIGGER_MS + 200, slot);
    press = drive(host, diag, press, false, 1000 + JP4A_HOLD_TRIGGER_MS + 201, slot);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'APPROACH');
    assert.equal(currentVerdict(), 'CLEAN');
    assert.equal(host.productionSelectCount(), 0);
  });
});

test('HF2 E: APPROACH hold BEGIN FOCUS selects production exactly once', () => {
  withSession(() => {
    const slot = fakeSlot('e');
    const diag = testDiag([slot]);
    let selected = 0;
    const host = createJp4aHostBindings(diag, () => { selected += 1; });
    let press = emptyJp4aTriggerPressState();
    press = drive(host, diag, press, true, 0, slot);
    press = drive(host, diag, press, false, 40, slot);
    diag.beginApproach();
    assert.equal(selected, 0);
    assert.equal(host.productionSelectCount(), 0);
    press = drive(host, diag, press, true, 100, slot);
    press = drive(host, diag, press, true, 100 + JP4A_HOLD_TRIGGER_MS, slot);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'FOCUS_REQUESTED');
    assert.equal(host.productionSelectCount(), 1);
    assert.equal(selected, 1);
    press = drive(host, diag, press, true, 100 + JP4A_HOLD_TRIGGER_MS + 16, slot);
    press = drive(host, diag, press, true, 100 + JP4A_HOLD_TRIGGER_MS + 32, slot);
    press = drive(host, diag, press, true, 100 + JP4A_HOLD_TRIGGER_MS + 48, slot);
    assert.equal(host.productionSelectCount(), 1);
    press = drive(host, diag, press, false, 100 + JP4A_HOLD_TRIGGER_MS + 49, slot);
    assert.equal(host.productionSelectCount(), 1);
    assert.equal(currentVerdict(), 'UNKNOWN');
  });
});

test('HF2 F: Trigger during FOCUS does not mutate verdict or select again', () => {
  withSession(() => {
    const slot = fakeSlot('f');
    const diag = testDiag([slot]);
    const host = createJp4aHostBindings(diag, () => {});
    let press = emptyJp4aTriggerPressState();
    press = drive(host, diag, press, true, 0, slot);
    press = drive(host, diag, press, false, 40, slot);
    diag.cycleVerdict();
    assert.equal(currentVerdict(), 'BLACK');
    diag.beginApproach();
    press = drive(host, diag, press, true, 100, slot);
    press = drive(host, diag, press, true, 100 + JP4A_HOLD_TRIGGER_MS, slot);
    assert.equal(host.productionSelectCount(), 1);
    press = drive(host, diag, press, false, 900, slot);
    press = drive(host, diag, press, true, 1000, slot);
    press = drive(host, diag, press, false, 1080, slot);
    assert.equal(currentVerdict(), 'BLACK');
    assert.equal(host.productionSelectCount(), 1);
    press = drive(host, diag, press, true, 1200, slot);
    press = drive(host, diag, press, true, 1200 + JP4A_HOLD_TRIGGER_MS, slot);
    press = drive(host, diag, press, false, 2000, slot);
    assert.equal(currentVerdict(), 'BLACK');
    assert.equal(host.productionSelectCount(), 1);
  });
});

test('HF2 G: 699 ms is short; 700 ms is hold with no short verdict', () => {
  withSession(() => {
    const slot = fakeSlot('g');
    const diag = testDiag([slot]);
    const host = createJp4aHostBindings(diag, () => {});
    let press = emptyJp4aTriggerPressState();
    press = drive(host, diag, press, true, 0, slot);
    press = drive(host, diag, press, false, 40, slot);
    press = drive(host, diag, press, true, 100, slot);
    press = drive(host, diag, press, true, 100 + JP4A_HOLD_TRIGGER_MS - 1, slot);
    press = drive(host, diag, press, false, 100 + JP4A_HOLD_TRIGGER_MS - 1, slot);
    assert.equal(currentVerdict(), 'BLACK');
    assert.equal(jp4aTestSnapshot()?.testPhase, 'LOCKED_LIVE_DIAG');
    press = drive(host, diag, press, true, 1000, slot);
    press = drive(host, diag, press, true, 1000 + JP4A_HOLD_TRIGGER_MS, slot);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'APPROACH');
    assert.equal(currentVerdict(), 'BLACK');
    press = drive(host, diag, press, false, 1800, slot);
    assert.equal(currentVerdict(), 'BLACK');
  });
});

test('HF2 H: no-hit hold does not mutate verdict or start FOCUS from baseline', () => {
  withSession(() => {
    const slot = fakeSlot('h');
    const diag = testDiag([slot]);
    const host = createJp4aHostBindings(diag, () => {});
    let press = emptyJp4aTriggerPressState();
    press = drive(host, diag, press, true, 0, null);
    press = drive(host, diag, press, true, JP4A_HOLD_TRIGGER_MS, null);
    press = drive(host, diag, press, false, JP4A_HOLD_TRIGGER_MS + 1, null);
    assert.equal(diag.hasLock(), false);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'BASELINE');
    assert.equal(host.productionSelectCount(), 0);
    press = drive(host, diag, press, true, 2000, slot);
    press = drive(host, diag, press, false, 2040, slot);
    diag.cycleVerdict();
    assert.equal(currentVerdict(), 'BLACK');
    press = drive(host, diag, press, true, 3000, null);
    press = drive(host, diag, press, false, 3050, null);
    assert.equal(currentVerdict(), 'BLACK');
    assert.equal(jp4aTestSnapshot()?.testPhase, 'LOCKED_LIVE_DIAG');
  });
});

test('HF2 I: release clears press flags so the next press is independent', () => {
  withSession(() => {
    const slot = fakeSlot('i');
    const diag = testDiag([slot]);
    const host = createJp4aHostBindings(diag, () => {});
    let press = emptyJp4aTriggerPressState();
    press = drive(host, diag, press, true, 0, slot);
    press = drive(host, diag, press, true, JP4A_HOLD_TRIGGER_MS + 10, slot);
    press = drive(host, diag, press, false, JP4A_HOLD_TRIGGER_MS + 11, slot);
    assert.deepEqual(press, emptyJp4aTriggerPressState());
    press = drive(host, diag, press, true, 2000, slot);
    press = drive(host, diag, press, false, 2080, slot);
    assert.equal(currentVerdict(), 'BLACK');
    assert.deepEqual(press, emptyJp4aTriggerPressState());
  });
});

test('HF2 J: XR session end while held does not leak into a second session', () => {
  withSession(() => {
    const slot = fakeSlot('j');
    const diag = testDiag([slot]);
    const host = createJp4aHostBindings(diag, () => {});
    let press = emptyJp4aTriggerPressState();
    press = drive(host, diag, press, true, 0, slot);
    assert.equal(press.down, true);
    press = emptyJp4aTriggerPressState();
    press = drive(host, diag, press, false, 50, slot);
    assert.equal(diag.hasLock(), false);
    press = drive(host, diag, press, true, 100, slot);
    press = drive(host, diag, press, false, 160, slot);
    assert.equal(diag.hasLock(), true);
    assert.equal(currentVerdict(), 'UNKNOWN');
    assert.equal(host.productionSelectCount(), 0);
  });
});

test('HF2 same hold cannot APPROACH then FOCUS; production select stays 0 until a new hold', () => {
  withSession(() => {
    const slot = fakeSlot('phase-hold');
    const diag = testDiag([slot]);
    const host = createJp4aHostBindings(diag, () => {});
    let press = emptyJp4aTriggerPressState();
    press = drive(host, diag, press, true, 0, slot);
    press = drive(host, diag, press, false, 40, slot);
    press = drive(host, diag, press, true, 100, slot);
    press = drive(host, diag, press, true, 100 + JP4A_HOLD_TRIGGER_MS, slot);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'APPROACH');
    press = drive(host, diag, press, true, 100 + JP4A_HOLD_TRIGGER_MS * 2, slot);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'APPROACH');
    assert.equal(host.productionSelectCount(), 0);
    press = drive(host, diag, press, false, 1600, slot);
    press = drive(host, diag, press, true, 1700, slot);
    press = drive(host, diag, press, true, 1700 + JP4A_HOLD_TRIGGER_MS, slot);
    assert.equal(jp4aTestSnapshot()?.testPhase, 'FOCUS_REQUESTED');
    assert.equal(host.productionSelectCount(), 1);
  });
});

test('HF2 HUD states TAP/HOLD unambiguously and production reach stays 14 ft', () => {
  const step2 = jp4aHudStep('BASELINE', true);
  assert.match(step2.instruction, /TAP = LOCK ONLY/);
  const step3 = jp4aHudStep('LOCKED_LIVE_DIAG', true);
  assert.match(step3.instruction, /TAP = BLACK\/CLEAN/);
  assert.match(step3.hint, /HOLD DOES NOT CHANGE BLACK\/CLEAN/);
  const step4 = jp4aHudStep('APPROACH', true);
  assert.match(step4.hint, /HOLD TRIGGER = BEGIN FOCUS/);
  assert.match(step4.hint, /NO VERDICT CHANGE/);
  assert.equal(JP4A_PRODUCTION_INTERACT_RANGE_FT, 14);
});
