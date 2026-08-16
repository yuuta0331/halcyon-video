// Three.js WebXRManager assigns layer 1 to the left eye and layer 2 to the
// right eye (see WebXRManager.js: "enable eye layers (1 = left, 2 = right)").
// World content that used layers.set(1) to skip mirrors therefore vanished
// from the right eye on Quest. Mirror-skip lives on layer 3 instead.

export const XR_LEFT_EYE_LAYER = 1;
export const XR_RIGHT_EYE_LAYER = 2;
export const MIRROR_SKIP_LAYER = 3;

export function markMirrorSkip(obj: { layers: { set(n: number): void } }): void {
  obj.layers.set(MIRROR_SKIP_LAYER);
}

export function enableViewerWorldLayers(camera: { layers: { enable(n: number): void } }): void {
  camera.layers.enable(XR_LEFT_EYE_LAYER);
  camera.layers.enable(MIRROR_SKIP_LAYER);
}

/** Mask Three.js will apply to the left/right XR cameras given a user-camera mask. */
export function xrEyeLayerMask(userMask: number, eye: 'left' | 'right'): number {
  const xr = userMask | 0b110;
  return eye === 'left' ? xr & ~0b100 : xr & ~0b010;
}

export function layerMaskHas(mask: number, layer: number): boolean {
  return (mask & (1 << layer)) !== 0;
}

export function bothXrEyesSeeLayer(userMask: number, objectLayer: number): boolean {
  const obj = 1 << objectLayer;
  const left = xrEyeLayerMask(userMask, 'left');
  const right = xrEyeLayerMask(userMask, 'right');
  return (left & obj) !== 0 && (right & obj) !== 0;
}
