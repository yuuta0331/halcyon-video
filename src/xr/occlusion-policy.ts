// Page occlusion vs XR entry. Never use renderer.xr.isPresenting as the
// sole pause guard: Quest Browser can blur/hide the 2D page while phase is
// still requesting/binding and isPresenting is still false.

import type { XrSessionPhase } from './types.ts';

export const XR_RENDER_LOOP_PHASES: readonly XrSessionPhase[] = [
  'requesting',
  'binding',
  'projecting',
  'active',
  'ending',
];

export function xrPhaseOwnsRenderLoop(phase: XrSessionPhase | null | undefined): boolean {
  return !!phase && phase !== 'idle';
}

/**
 * True when desktop occlusion (blur / document hidden) may halt StoreScene.
 * False for the entire XR session transition, including pre-presenting phases.
 */
export function shouldPauseStoreRenderingOnOcclusion(input: {
  phase: XrSessionPhase | null | undefined;
  presenting?: boolean;
}): boolean {
  if (xrPhaseOwnsRenderLoop(input.phase)) return false;
  void input.presenting;
  return true;
}

/** Pre-Round-6 guard. True means the animation loop would be torn down. */
export function legacyPresentingOnlyPauseWouldFire(input: {
  presenting: boolean;
}): boolean {
  return !input.presenting;
}
