// Catalog bank count is independent of sampler count. Each shelf draw binds
// one sampler2DArray; instances that live in different banks are split into
// separate InstancedMesh batches sharing the global case materials.

import * as THREE from 'three';
import type { MovieSlot } from './store-layout';
import { textureArrayManager } from './poster-textures';
import {
  groupSlotsByPosterBank,
} from './perf/poster-bank-batches';

export { groupSlotsByPosterBank, posterBankBatchUpperBound } from './perf/poster-bank-batches';

export interface PosterBankDrawScene {
  scene: THREE.Scene;
  meshes: THREE.Object3D[];
  slotsByPosition: Map<string, MovieSlot>;
  unitSideFrontMeshMap: Map<string, THREE.InstancedMesh>;
  unitSideBackMeshMap?: Map<string, THREE.InstancedMesh>;
}

const scratchMatrix = new THREE.Matrix4();

function bindBank(mesh: THREE.InstancedMesh, bank: number): void {
  mesh.userData.posterBank = bank;
  mesh.onBeforeRender = () => {
    textureArrayManager.bindDrawBank(bank);
  };
}

function copyInstancedAttr(
  src: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  srcIdx: number,
  dst: THREE.BufferAttribute | undefined,
  dstIdx: number,
): void {
  if (!src || !dst || !('itemSize' in src) || !src.array || !dst.array) return;
  const size = src.itemSize;
  const s = src.array as Float32Array;
  const d = dst.array as Float32Array;
  for (let k = 0; k < size; k++) d[dstIdx * size + k] = s[srcIdx * size + k];
}

function resizeInstancedAttrs(oldGeo: THREE.BufferGeometry, count: number): THREE.BufferGeometry {
  const geo = oldGeo.clone();
  for (const name of ['aTextureIndex', 'aSpineColor', 'aPosterCropSkip']) {
    const src = oldGeo.getAttribute(name) as THREE.InstancedBufferAttribute | undefined;
    if (!src) continue;
    geo.setAttribute(
      name,
      new THREE.InstancedBufferAttribute(new Float32Array(count * src.itemSize), src.itemSize),
    );
  }
  return geo;
}

function retireMesh(scene: PosterBankDrawScene, mesh: THREE.InstancedMesh): void {
  scene.scene.remove(mesh);
  const idx = scene.meshes.indexOf(mesh);
  if (idx >= 0) scene.meshes.splice(idx, 1);
  mesh.geometry.dispose();
}

function splitMeshGroup(
  scene: PosterBankDrawScene,
  oldMesh: THREE.InstancedMesh,
  group: MovieSlot[],
  bank: number,
  sourceIndex: (slot: MovieSlot) => number,
  assign: (slot: MovieSlot, mesh: THREE.InstancedMesh, i: number) => void,
): THREE.InstancedMesh {
  const geo = resizeInstancedAttrs(oldMesh.geometry, group.length);
  const mesh = new THREE.InstancedMesh(geo, oldMesh.material, group.length);
  mesh.castShadow = oldMesh.castShadow;
  mesh.receiveShadow = oldMesh.receiveShadow;
  mesh.frustumCulled = oldMesh.frustumCulled;
  (mesh.instanceMatrix.array as Float32Array).fill(0);
  group.forEach((slot, i) => {
    const src = sourceIndex(slot);
    oldMesh.getMatrixAt(src, scratchMatrix);
    mesh.setMatrixAt(i, scratchMatrix);
    copyInstancedAttr(
      oldMesh.geometry.getAttribute('aTextureIndex'),
      src,
      mesh.geometry.getAttribute('aTextureIndex') as THREE.BufferAttribute,
      i,
    );
    copyInstancedAttr(
      oldMesh.geometry.getAttribute('aSpineColor'),
      src,
      mesh.geometry.getAttribute('aSpineColor') as THREE.BufferAttribute,
      i,
    );
    copyInstancedAttr(
      oldMesh.geometry.getAttribute('aPosterCropSkip'),
      src,
      mesh.geometry.getAttribute('aPosterCropSkip') as THREE.BufferAttribute,
      i,
    );
    assign(slot, mesh, i);
  });
  mesh.instanceMatrix.needsUpdate = true;
  for (const name of ['aTextureIndex', 'aSpineColor', 'aPosterCropSkip']) {
    const attr = mesh.geometry.getAttribute(name);
    if (attr) attr.needsUpdate = true;
  }
  bindBank(mesh, bank);
  scene.scene.add(mesh);
  scene.meshes.push(mesh);
  return mesh;
}

export function applyPosterBankDrawBatches(scene: PosterBankDrawScene): number {
  const bankCount = Math.max(1, textureArrayManager.bankCount);
  const bankSize = Math.max(1, textureArrayManager.bankSize);
  const fronts = [...new Set(scene.unitSideFrontMeshMap.values())];
  textureArrayManager.sourcePosterMeshCount = fronts.length;
  if (bankCount <= 1) {
    for (const mesh of fronts) bindBank(mesh, 0);
    textureArrayManager.renderBatchCount = Math.max(1, fronts.length);
    return textureArrayManager.renderBatchCount;
  }

  const slotsByMesh = new Map<THREE.InstancedMesh, MovieSlot[]>();
  for (const slot of scene.slotsByPosition.values()) {
    const list = slotsByMesh.get(slot.frontMesh) ?? [];
    list.push(slot);
    slotsByMesh.set(slot.frontMesh, list);
  }

  let batches = 0;
  for (const [oldFront, slots] of slotsByMesh) {
    const groups = groupSlotsByPosterBank(
      slots,
      (id) => textureArrayManager.peekIndex(id),
      bankSize,
      bankCount,
    );
    if (groups.size <= 1) {
      bindBank(oldFront, [...groups.keys()][0] ?? 0);
      const back = slots[0]?.backMesh;
      if (back && back !== oldFront) bindBank(back, [...groups.keys()][0] ?? 0);
      batches++;
      continue;
    }

    const srcIdx = new Map<MovieSlot, number>();
    for (const slot of slots) srcIdx.set(slot, slot.instanceIdx);
    const frontKey = [...scene.unitSideFrontMeshMap.entries()].find(([, mesh]) => mesh === oldFront)?.[0];
    const oldBack = slots[0]?.backMesh;
    const backKey = oldBack && scene.unitSideBackMeshMap
      ? [...scene.unitSideBackMeshMap.entries()].find(([, mesh]) => mesh === oldBack)?.[0]
      : undefined;
    let first = true;
    for (const [bank, group] of groups) {
      const sourceIndex = (slot: MovieSlot) => srcIdx.get(slot) ?? slot.instanceIdx;
      const front = splitMeshGroup(scene, oldFront, group, bank, sourceIndex, (slot, mesh, i) => {
        slot.frontMesh = mesh;
        slot.instanceIdx = i;
      });
      if (frontKey && first) {
        scene.unitSideFrontMeshMap.set(frontKey, front);
      }
      if (oldBack && oldBack !== oldFront) {
        const back = splitMeshGroup(scene, oldBack, group, bank, sourceIndex, (slot, mesh) => {
          slot.backMesh = mesh;
        });
        if (backKey && first && scene.unitSideBackMeshMap) {
          scene.unitSideBackMeshMap.set(backKey, back);
        }
      }
      first = false;
      batches++;
    }
    retireMesh(scene, oldFront);
    if (oldBack && oldBack !== oldFront && scene.meshes.includes(oldBack)) {
      retireMesh(scene, oldBack);
    }
  }

  for (const mesh of scene.unitSideFrontMeshMap.values()) {
    if (mesh.userData.posterBank == null) bindBank(mesh, 0);
  }
  textureArrayManager.renderBatchCount = Math.max(1, batches);
  return textureArrayManager.renderBatchCount;
}
