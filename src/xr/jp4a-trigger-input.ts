// JP-4A Trigger lifecycle: DOWN → maybe HOLD → UP.
// Hold never mutates LIVE verdicts. Short actions commit only on release.

import type { MovieSlot } from '../store-layout.ts';
import {
  JP4A_HOLD_TRIGGER_MS,
  jp4aHoldTriggerAction,
  type Jp4aTestPhase,
} from './jp4a-test-phase.ts';

export interface Jp4aTriggerPressState {
  down: boolean;
  downAt: number | null;
  target: MovieSlot | null;
  holdFired: boolean;
  consumedByHold: boolean;
  wasInitialLock: boolean;
}

export type Jp4aTriggerCommand =
  | { type: 'LOCK'; slot: MovieSlot }
  | { type: 'CYCLE_VERDICT' }
  | { type: 'BEGIN_APPROACH' }
  | { type: 'BEGIN_FOCUS' };

export function emptyJp4aTriggerPressState(): Jp4aTriggerPressState {
  return {
    down: false,
    downAt: null,
    target: null,
    holdFired: false,
    consumedByHold: false,
    wasInitialLock: false,
  };
}

export type Jp4aTriggerHand = 'left' | 'right';

export interface Jp4aTriggerSourceState {
  source: Jp4aTriggerHand | null;
  ambiguous: boolean;
}

export function emptyJp4aTriggerSourceState(): Jp4aTriggerSourceState {
  return { source: null, ambiguous: false };
}

/** Same-frame LEFT+RIGHT rising edges are ambiguous and must not lock either poster. */
export function chooseJp4aTriggerSource(input: {
  prev: Jp4aTriggerSourceState;
  leftTrigger: boolean;
  rightTrigger: boolean;
  prevLeftTrigger: boolean;
  prevRightTrigger: boolean;
  leftConnected: boolean;
  rightConnected: boolean;
}): { next: Jp4aTriggerSourceState; triggerDown: boolean; cancel: boolean } {
  const prev = input.prev;

  if (prev.ambiguous) {
    if (!input.leftTrigger && !input.rightTrigger) {
      return { next: emptyJp4aTriggerSourceState(), triggerDown: false, cancel: false };
    }
    return { next: { source: null, ambiguous: true }, triggerDown: false, cancel: false };
  }

  if (prev.source) {
    const connected = prev.source === 'left' ? input.leftConnected : input.rightConnected;
    if (!connected) {
      return { next: emptyJp4aTriggerSourceState(), triggerDown: false, cancel: true };
    }
    const down = prev.source === 'left' ? input.leftTrigger : input.rightTrigger;
    return { next: { source: prev.source, ambiguous: false }, triggerDown: down, cancel: false };
  }

  const leftRise = input.leftTrigger && !input.prevLeftTrigger;
  const rightRise = input.rightTrigger && !input.prevRightTrigger;
  if (leftRise && rightRise) {
    return { next: { source: null, ambiguous: true }, triggerDown: false, cancel: false };
  }
  if (leftRise) return { next: { source: 'left', ambiguous: false }, triggerDown: true, cancel: false };
  if (rightRise) return { next: { source: 'right', ambiguous: false }, triggerDown: true, cancel: false };
  return { next: emptyJp4aTriggerSourceState(), triggerDown: false, cancel: false };
}

export function jp4aHitForSource(
  source: Jp4aTriggerHand | null,
  leftHit: MovieSlot | null,
  rightHit: MovieSlot | null,
): MovieSlot | null {
  if (source === 'left') return leftHit;
  if (source === 'right') return rightHit;
  return null;
}

export function stepJp4aHandedTrigger(input: {
  press: Jp4aTriggerPressState;
  source: Jp4aTriggerSourceState;
  leftTrigger: boolean;
  rightTrigger: boolean;
  prevLeftTrigger: boolean;
  prevRightTrigger: boolean;
  leftConnected: boolean;
  rightConnected: boolean;
  leftHit: MovieSlot | null;
  rightHit: MovieSlot | null;
  now: number;
  phase: Jp4aTestPhase;
  hasLock: boolean;
}): {
  press: Jp4aTriggerPressState;
  source: Jp4aTriggerSourceState;
  command: Jp4aTriggerCommand | null;
  cancelled: boolean;
} {
  const chosen = chooseJp4aTriggerSource({
    prev: input.source,
    leftTrigger: input.leftTrigger,
    rightTrigger: input.rightTrigger,
    prevLeftTrigger: input.prevLeftTrigger,
    prevRightTrigger: input.prevRightTrigger,
    leftConnected: input.leftConnected,
    rightConnected: input.rightConnected,
  });
  if (chosen.cancel) {
    return {
      press: emptyJp4aTriggerPressState(),
      source: emptyJp4aTriggerSourceState(),
      command: null,
      cancelled: true,
    };
  }
  const rising = chosen.triggerDown && !input.press.down;
  const hit = rising
    ? jp4aHitForSource(chosen.next.source, input.leftHit, input.rightHit)
    : input.press.target;
  const stepped = stepJp4aTrigger({
    prev: input.press,
    triggerDown: chosen.triggerDown,
    now: input.now,
    hit,
    phase: input.phase,
    hasLock: input.hasLock,
  });
  let source = chosen.next;
  if (!source.ambiguous && !stepped.press.down) source = emptyJp4aTriggerSourceState();
  return { press: stepped.press, source, command: stepped.command, cancelled: false };
}

export function stepJp4aTrigger(input: {
  prev: Jp4aTriggerPressState;
  triggerDown: boolean;
  now: number;
  hit: MovieSlot | null;
  phase: Jp4aTestPhase;
  hasLock: boolean;
}): { press: Jp4aTriggerPressState; command: Jp4aTriggerCommand | null } {
  const prev = input.prev;

  if (input.triggerDown && !prev.down) {
    return {
      press: {
        down: true,
        downAt: input.now,
        target: input.hit,
        holdFired: false,
        consumedByHold: false,
        wasInitialLock: !input.hasLock && input.hit != null,
      },
      command: null,
    };
  }

  if (input.triggerDown && prev.down) {
    const heldMs = prev.downAt == null ? 0 : input.now - prev.downAt;
    const hold = jp4aHoldTriggerAction({
      triggerDown: true,
      heldMs,
      alreadyFired: prev.holdFired,
      ignoreThisPress: prev.wasInitialLock,
      testPhase: input.phase,
    });
    let command: Jp4aTriggerCommand | null = null;
    if (hold.fire === 'BEGIN_APPROACH' && input.hasLock) command = { type: 'BEGIN_APPROACH' };
    else if (hold.fire === 'BEGIN_FOCUS' && input.hasLock) command = { type: 'BEGIN_FOCUS' };
    return {
      press: {
        ...prev,
        down: true,
        holdFired: hold.fired,
        consumedByHold: prev.consumedByHold || command != null,
      },
      command,
    };
  }

  if (!input.triggerDown && prev.down) {
    let command: Jp4aTriggerCommand | null = null;
    if (!prev.consumedByHold) {
      if (prev.wasInitialLock && prev.target) {
        command = { type: 'LOCK', slot: prev.target };
      } else if (input.hasLock && input.phase === 'LOCKED_LIVE_DIAG' && prev.target != null) {
        command = { type: 'CYCLE_VERDICT' };
      }
    }
    return { press: emptyJp4aTriggerPressState(), command };
  }

  return { press: prev.down ? emptyJp4aTriggerPressState() : prev, command: null };
}

export { JP4A_HOLD_TRIGGER_MS };
