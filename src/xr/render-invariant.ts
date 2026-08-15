// XR rendering invariant: a presenting WebXR manager must never go through
// desktop EffectComposer / N8AO / Bokeh. No transition frame may violate it.

export type XrRenderPath = 'direct' | 'composer';

export function desktopComposerForbidden(rendererPresenting: boolean): boolean {
  return rendererPresenting === true;
}

export function chooseXrRenderPath(input: {
  rendererPresenting: boolean;
  hasComposer: boolean;
}): XrRenderPath {
  if (desktopComposerForbidden(input.rendererPresenting)) return 'direct';
  return input.hasComposer ? 'composer' : 'direct';
}

/**
 * `phase === 'active'` is not sufficient and not necessary. Three.js
 * WebXRManager.setSession() can set `isPresenting` before its Promise
 * resolves, so Halcyon phase may still be `binding`.
 */
export function xrOwnsFrames(input: {
  rendererPresenting: boolean;
  xrLoopArmed?: boolean;
}): boolean {
  return input.rendererPresenting || input.xrLoopArmed === true;
}
