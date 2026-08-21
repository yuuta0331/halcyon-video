import * as THREE from 'three';

export const LIVE_POSTER_DEPTH_OFFSET_STORE_UNITS = 0.025;

export function depthIsolatedPosterMatrix(
  original: THREE.Matrix4,
  offsetStoreUnits = LIVE_POSTER_DEPTH_OFFSET_STORE_UNITS,
): THREE.Matrix4 {
  return original.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, offsetStoreUnits));
}
