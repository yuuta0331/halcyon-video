// Deterministic close-range HMD sweep evidence. Does not claim Quest pixels.

import * as THREE from 'three';
import { storeVisibleResidency } from '../store-visible-residency';
import { textureArrayManager } from '../poster-textures';

export interface CloseRangeSweepSample {
  step: string;
  eye: 'left' | 'right' | 'mono';
  postersVisible: number;
  postersWithLiveTexture: number;
  disposedMaterials: number;
  hidden: number;
}

const STEPS = ['center', 'left', 'right', 'up', 'down', 'near', 'yaw', 'pitch'] as const;

function posterMeshes(root: THREE.Object3D): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.InstancedMesh && o.userData.posterBank != null) out.push(o);
  });
  return out;
}

function materialDisposed(mat: THREE.Material): boolean {
  return !!(mat as unknown as { disposed?: boolean }).disposed;
}

export function inspectCloseRangePosters(
  scene: THREE.Scene,
  step: string,
  eye: CloseRangeSweepSample['eye'] = 'mono',
): CloseRangeSweepSample {
  const meshes = posterMeshes(scene);
  let live = 0;
  let disposed = 0;
  let hidden = 0;
  for (const mesh of meshes) {
    if (!mesh.visible) hidden++;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (materialDisposed(mat)) disposed++;
    }
    if (textureArrayManager.highResArray) live++;
  }
  return {
    step,
    eye,
    postersVisible: meshes.filter((m) => m.visible).length,
    postersWithLiveTexture: live,
    disposedMaterials: disposed,
    hidden,
  };
}

export function closeRangeSweepPlan(): readonly string[] {
  return STEPS;
}

export function closeRangeSweepPass(samples: CloseRangeSweepSample[]): boolean {
  if (samples.length < STEPS.length) return false;
  return samples.every((s) =>
    s.postersVisible > 0
    && s.disposedMaterials === 0
    && s.hidden === 0
    && storeVisibleResidency.validate().ok,
  );
}
