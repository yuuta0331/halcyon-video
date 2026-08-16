// Stereo visibility of WORLD_REQUIRED signage. Negative control uses layer 1
// (Three.js left-eye-only) to prove the checker would fail.

import * as THREE from 'three';
import {
  bothXrEyesSeeLayer,
  MIRROR_SKIP_LAYER,
  XR_LEFT_EYE_LAYER,
  xrEyeLayerMask,
} from '../scene-layers.ts';

export interface StereoSignSample {
  name: string;
  layer: number;
  left: boolean;
  right: boolean;
  both: boolean;
}

export function primaryLayer(obj: { layers: { mask: number } }): number {
  const mask = obj.layers.mask >>> 0;
  for (let i = 0; i < 32; i++) {
    if (mask & (1 << i)) return i;
  }
  return 0;
}

export function userCameraMask(camera: { layers: { mask: number } }): number {
  return camera.layers.mask >>> 0;
}

export function sampleSignageStereo(
  root: THREE.Object3D,
  userMask: number,
): StereoSignSample[] {
  const out: StereoSignSample[] = [];
  const leftMask = xrEyeLayerMask(userMask, 'left');
  const rightMask = xrEyeLayerMask(userMask, 'right');
  root.traverse((obj) => {
    if (!obj.userData?.isSign) return;
    const layer = primaryLayer(obj);
    const bit = 1 << layer;
    const left = (leftMask & bit) !== 0;
    const right = (rightMask & bit) !== 0;
    out.push({
      name: obj.name || obj.parent?.name || 'sign',
      layer,
      left,
      right,
      both: left && right,
    });
  });
  return out;
}

export function stereoSignagePass(samples: StereoSignSample[]): boolean {
  if (samples.length === 0) return false;
  return samples.every((s) => s.both);
}

export function negativeControlLeftEyeOnly(userMask: number): boolean {
  return bothXrEyesSeeLayer(userMask, XR_LEFT_EYE_LAYER) === false
    && bothXrEyesSeeLayer(userMask, MIRROR_SKIP_LAYER) === true;
}
