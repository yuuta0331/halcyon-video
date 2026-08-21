// Pure XR entry ordering. Frame-rate negotiation is not setup.
// makeXRCompatible is owned by Three.js r184 WebXRManager.setSession
// AFTER it installs session `inputsourceschange`. The app must not await
// it as a preflight before setSession.

export const XR_ENTRY_CRITICAL_PATH = [
  'requestSession',
  'selectReferenceSpaceType',
  'configureRendererPreSession',
  'renderer.setSession',
  'firstXrRender',
] as const;

export type XrEntryCriticalStep = (typeof XR_ENTRY_CRITICAL_PATH)[number];

export function targetFrameRateBlocksFirstFrame(marks: {
  firstWorldRenderCompletedAt: number | null;
  targetFrameRateRequestedAt?: number | null;
  targetFrameRateStart?: number | null;
}): boolean {
  const requested = marks.targetFrameRateRequestedAt ?? marks.targetFrameRateStart ?? null;
  if (requested == null || marks.firstWorldRenderCompletedAt == null) return false;
  return requested < marks.firstWorldRenderCompletedAt;
}

export function firstFrameBeforeTargetFrameRate(marks: {
  firstWorldRenderCompletedAt: number | null;
  targetFrameRateRequestedAt?: number | null;
  targetFrameRateStart?: number | null;
}): boolean {
  const requested = marks.targetFrameRateRequestedAt ?? marks.targetFrameRateStart ?? null;
  if (marks.firstWorldRenderCompletedAt == null) return false;
  if (requested == null) return true;
  return marks.firstWorldRenderCompletedAt <= requested;
}
