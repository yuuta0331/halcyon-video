import * as THREE from 'three';
import { setPosterIndexNotify, setPosterLoadedNotify } from './video-case';
import { recordResourceSnapshot, setGpuLiveState } from './xr/gpu-diagnostics';
import type { StoreScene } from './three-scene';

/** Cover-loaded / residency-index callbacks that re-dirty the wearing slots. */
export function bindStorePosterNotifies(scene: StoreScene): void {
  setPosterLoadedNotify((movieId) => {
    const slots = scene.slotsByMovieId.get(movieId);
    if (!slots) return;
    for (const slot of slots) {
      slot.needsInitialMatrixUpdate = true;
      scene.dirtySlots.add(slot);
    }
  });
  setPosterIndexNotify((movieId, index) => {
    const slots = scene.slotsByMovieId.get(movieId);
    if (!slots) return;
    for (const slot of slots) {
      const fIdx = slot.frontMesh.geometry.getAttribute('aTextureIndex') as THREE.InstancedBufferAttribute | undefined;
      if (fIdx) { fIdx.setX(slot.instanceIdx, index); fIdx.needsUpdate = true; }
      const bIdx = slot.backMesh.geometry.getAttribute('aTextureIndex') as THREE.InstancedBufferAttribute | undefined;
      if (bIdx) { bIdx.setX(slot.instanceIdx, index); bIdx.needsUpdate = true; }
      slot.needsInitialMatrixUpdate = true;
      scene.dirtySlots.add(slot);
    }
  });
}

export function markStoreReady(scene: StoreScene, n8aoAllocated: boolean): void {
  setGpuLiveState({
    renderer: scene.renderer as never,
    composerAllocated: !!scene.composer,
    n8aoAllocated,
    gtaoAllocated: false,
    mirrorCount: scene.mirrors?.length ?? 0,
    reflectionProbeCount: scene.resourceProfile.reflectionProbes ? 5 : 0,
  });
  recordResourceSnapshot('store-ready');
}
