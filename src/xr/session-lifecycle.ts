// Explicit XR session lifecycle. `active` is not set until projection
// rendering is established; optional compositor UI starts even later.

import type { XrSessionPhase } from './types.ts';

export type XrStartupStage =
  | 'requestSessionStart'
  | 'requestSessionEnd'
  | 'referenceSpaceStart'
  | 'referenceSpaceEnd'
  | 'makeXRCompatibleStart'
  | 'makeXRCompatibleEnd'
  | 'targetFrameRateStart'
  | 'targetFrameRateEnd'
  | 'rendererSetSessionStart'
  | 'rendererSetSessionEnd'
  | 'firstAnimationCallbackAt'
  | 'firstDirectRenderStart'
  | 'firstDirectRenderEnd'
  | 'firstWorldRenderCompletedAt'
  | 'firstVisibleFrameAt'
  | 'optionalLayersStart'
  | 'optionalLayersEnd';

export interface XrStartupTrace {
  requestSessionStart: number | null;
  requestSessionEnd: number | null;
  referenceSpaceStart: number | null;
  referenceSpaceEnd: number | null;
  makeXRCompatibleStart: number | null;
  makeXRCompatibleEnd: number | null;
  makeXRCompatibleError: string | null;
  targetFrameRateStart: number | null;
  targetFrameRateEnd: number | null;
  targetFrameRateRequestedAt: number | null;
  targetFrameRateResolvedAt: number | null;
  targetFrameRateError: string | null;
  frameratechangeCount: number;
  rendererSetSessionStart: number | null;
  rendererSetSessionEnd: number | null;
  firstAnimationCallbackAt: number | null;
  firstDirectRenderStart: number | null;
  firstDirectRenderEnd: number | null;
  firstWorldRenderCompletedAt: number | null;
  firstVisibleFrameAt: number | null;
  lastCompletedStage: XrStartupStage | null;
  lastError: string | null;
  contextXrCompatibleBefore: boolean | null;
  compositorBackend: 'projection-layer' | 'xr-webgl-layer' | 'unknown' | null;
  enabledFeatures: string[];
}

export function blankStartupTrace(): XrStartupTrace {
  return {
    requestSessionStart: null,
    requestSessionEnd: null,
    referenceSpaceStart: null,
    referenceSpaceEnd: null,
    makeXRCompatibleStart: null,
    makeXRCompatibleEnd: null,
    makeXRCompatibleError: null,
    targetFrameRateStart: null,
    targetFrameRateEnd: null,
    targetFrameRateRequestedAt: null,
    targetFrameRateResolvedAt: null,
    targetFrameRateError: null,
    frameratechangeCount: 0,
    rendererSetSessionStart: null,
    rendererSetSessionEnd: null,
    firstAnimationCallbackAt: null,
    firstDirectRenderStart: null,
    firstDirectRenderEnd: null,
    firstWorldRenderCompletedAt: null,
    firstVisibleFrameAt: null,
    lastCompletedStage: null,
    lastError: null,
    contextXrCompatibleBefore: null,
    compositorBackend: null,
    enabledFeatures: [],
  };
}

export function markStartupStage(
  trace: XrStartupTrace,
  stage: XrStartupStage,
  at: number,
): XrStartupTrace {
  return {
    ...trace,
    [stage]: at,
    lastCompletedStage: stage,
  };
}

export function recordStartupError(trace: XrStartupTrace, error: unknown): XrStartupTrace {
  const message = error instanceof Error ? error.message : String(error);
  return { ...trace, lastError: message };
}

export function canExitPhase(phase: XrSessionPhase): boolean {
  return phase !== 'idle' && phase !== 'ending';
}

/** True when an in-flight enter() should stop after an await (session ended). */
export function startupAborted(input: {
  expectedSession: unknown;
  currentSession: unknown;
  phase: XrSessionPhase;
  ending: boolean;
}): boolean {
  if (input.ending) return true;
  if (input.phase === 'idle' || input.phase === 'ending') return true;
  return input.currentSession !== input.expectedSession;
}

export function sessionReadyForOptionalLayers(input: {
  phase: XrSessionPhase;
  firstWorldRenderCompletedAt: number | null;
  setSessionResolved: boolean;
  minimal: boolean;
}): boolean {
  if (input.minimal) return false;
  if (!input.setSessionResolved) return false;
  if (input.firstWorldRenderCompletedAt == null) return false;
  return input.phase === 'projecting' || input.phase === 'active';
}

/**
 * Simulate the Three.js setSession race: presentation can begin before the
 * returned Promise resolves. The first XR callback must already be a direct
 * render.
 */
export async function bindSessionWithPresentingRace(opts: {
  setSession: (onPresenting: () => void) => Promise<void>;
  now?: () => number;
}): Promise<{
  presentingBeforeResolve: boolean;
  firstCallbackPath: 'direct' | 'composer' | null;
  phaseAtFirstCallback: XrSessionPhase;
  phaseAfterResolve: XrSessionPhase;
}> {
  const now = opts.now ?? (() => 0);
  void now;
  let presenting = false;
  let firstCallbackPath: 'direct' | 'composer' | null = null;
  let phase: XrSessionPhase = 'binding';
  let phaseAtFirstCallback: XrSessionPhase = phase;

  const pending = opts.setSession(() => {
    presenting = true;
    phaseAtFirstCallback = phase;
    firstCallbackPath = presenting ? 'direct' : 'composer';
  });

  const presentingBeforeResolve = presenting;
  await pending;
  phase = 'projecting';
  return {
    presentingBeforeResolve,
    firstCallbackPath,
    phaseAtFirstCallback,
    phaseAfterResolve: phase,
  };
}
