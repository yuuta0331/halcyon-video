// Explicit JP-4A diagnostic test progression. Telemetry phases are derived
// from this marker, not from incidental FOCUS residency.

export type Jp4aTestPhase =
  | 'BASELINE'
  | 'LOCKED_LIVE_DIAG'
  | 'APPROACH'
  | 'FOCUS_REQUESTED'
  | 'FOCUS_TRANSITION'
  | 'FOCUS_SETTLED';

export type Jp4aTelemetryPhase =
  | 'baseline'
  | 'live_mode'
  | 'approach'
  | 'focus_transition'
  | 'focus_settled';

export const JP4A_HOLD_TRIGGER_MS = 700;

export function jp4aTelemetryPhase(testPhase: Jp4aTestPhase): Jp4aTelemetryPhase {
  switch (testPhase) {
    case 'BASELINE': return 'baseline';
    case 'LOCKED_LIVE_DIAG': return 'live_mode';
    case 'APPROACH': return 'approach';
    case 'FOCUS_REQUESTED':
    case 'FOCUS_TRANSITION': return 'focus_transition';
    case 'FOCUS_SETTLED': return 'focus_settled';
  }
}

export function jp4aModeCycleAllowed(testPhase: Jp4aTestPhase): boolean {
  return testPhase === 'LOCKED_LIVE_DIAG';
}

export function jp4aLockReplacementAllowed(testPhase: Jp4aTestPhase): boolean {
  return testPhase === 'BASELINE' || testPhase === 'LOCKED_LIVE_DIAG';
}

export function jp4aHoldTriggerAction(input: {
  triggerDown: boolean;
  heldMs: number;
  alreadyFired: boolean;
  ignoreThisPress: boolean;
  testPhase: Jp4aTestPhase;
}): { fire: 'BEGIN_APPROACH' | 'BEGIN_FOCUS' | null; fired: boolean } {
  if (!input.triggerDown) return { fire: null, fired: false };
  if (input.alreadyFired || input.ignoreThisPress) {
    return { fire: null, fired: input.alreadyFired };
  }
  if (input.heldMs < JP4A_HOLD_TRIGGER_MS) return { fire: null, fired: false };
  if (input.testPhase === 'LOCKED_LIVE_DIAG') return { fire: 'BEGIN_APPROACH', fired: true };
  if (input.testPhase === 'APPROACH') return { fire: 'BEGIN_FOCUS', fired: true };
  return { fire: null, fired: true };
}

export function nextJp4aTestPhaseFromFocus(
  testPhase: Jp4aTestPhase,
  focusPhase: string | null,
): Jp4aTestPhase {
  if (testPhase !== 'FOCUS_REQUESTED' && testPhase !== 'FOCUS_TRANSITION') return testPhase;
  if (focusPhase === 'ready') return 'FOCUS_SETTLED';
  if (focusPhase === 'pendingPixels' || focusPhase === 'pendingUpload') return 'FOCUS_TRANSITION';
  return 'FOCUS_REQUESTED';
}

export function jp4aHudStep(testPhase: Jp4aTestPhase, baselineReady: boolean): {
  index: number;
  title: string;
  instruction: string;
  hint: string;
} {
  switch (testPhase) {
    case 'BASELINE':
      return baselineReady
        ? {
          index: 1,
          title: 'STEP 2 / 6',
          instruction: 'TRIGGER TAP = LOCK ONLY',
          hint: 'LOCK DOES NOT START FOCUS',
        }
        : {
          index: 0,
          title: 'STEP 1 / 6',
          instruction: 'STAND STILL — BASELINE FPS',
          hint: 'THEN POINT AT A BLACK POSTER',
        };
    case 'LOCKED_LIVE_DIAG':
      return {
        index: 2,
        title: 'STEP 3 / 6',
        instruction: 'STICK/GRIP CYCLE  •  TAP = BLACK/CLEAN',
        hint: 'HOLD = APPROACH  •  HOLD DOES NOT CHANGE BLACK/CLEAN',
      };
    case 'APPROACH':
      return {
        index: 3,
        title: 'STEP 4 / 6',
        instruction: 'WALK TOWARD POSTER — APPROACH FPS',
        hint: 'HOLD TRIGGER = BEGIN FOCUS  •  NO VERDICT CHANGE',
      };
    case 'FOCUS_REQUESTED':
    case 'FOCUS_TRANSITION':
      return {
        index: 4,
        title: 'STEP 5 / 6',
        instruction: 'STAND STILL — FOCUS UPLOAD',
        hint: 'NO EXTRA MOVEMENT REQUIRED',
      };
    case 'FOCUS_SETTLED':
      return {
        index: 5,
        title: 'STEP 6 / 6',
        instruction: 'MENU FRONT / 90 / 180 — THEN EXIT VR',
        hint: 'STEREO CHECK, THEN COPY RESULT',
      };
  }
}
