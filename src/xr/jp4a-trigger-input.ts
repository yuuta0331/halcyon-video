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
