// Optional compositor UI must never abort projection XR.
// First valid world frame happens before any layer mutation.

export type CompositorInitResult =
  | { path: 'layer'; error: null }
  | { path: 'mesh-fallback'; error: string | null };

export function compositorFailureFallsBack(error: unknown): CompositorInitResult {
  const message = error instanceof Error ? error.message : error == null ? null : String(error);
  return { path: 'mesh-fallback', error: message };
}

export function shouldInitOptionalCompositor(input: {
  worldRenderCompleted: boolean;
  setSessionResolved: boolean;
  minimal: boolean;
  layersRequested: boolean;
}): boolean {
  if (input.minimal || !input.layersRequested) return false;
  return input.worldRenderCompleted && input.setSessionResolved;
}

export function layerConstructionMustNotAbortSession(threw: boolean, sessionStillActive: boolean): boolean {
  return threw ? sessionStillActive : sessionStillActive;
}
