// Catalog bank count is independent of sampler count. Each shelf draw binds
// one sampler2DArray; instances that live in different banks are split into
// separate InstancedMesh batches sharing the global case materials.

import * as THREE from 'three';
import type { MovieSlot } from './store-layout';
import { textureArrayManager } from './poster-textures';

export interface PosterBankDrawScene {
  scene: THREE.Scene;
  meshes: THREE.Object3D[];
  slotsByPosition: Map<string, MovieSlot>;
  unitSideFrontMeshMap: Map<string, THREE.InstancedMesh>;
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

export function applyPosterBankDrawBatches(scene: PosterBankDrawScene): number {
  const bankCount = Math.max(1, textureArrayManager.bankCount);
  const bankSize = Math.max(1, textureArrayManager.bankSize);
  const fronts = [...scene.unitSideFrontMeshMap.values()];
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
  for (const [oldMesh, slots] of slotsByMesh) {
    const groups = new Map<number, MovieSlot[]>();
    for (const slot of slots) {
      const idx = textureArrayManager.peekIndex(slot.movie.id) ?? 0;
      const bank = Math.min(bankCount - 1, Math.max(0, Math.floor(idx / bankSize)));
      const list = groups.get(bank) ?? [];
      list.push(slot);
      groups.set(bank, list);
    }
    if (groups.size <= 1) {
      bindBank(oldMesh, [...groups.keys()][0] ?? 0);
      batches++;
      continue;
    }

    const key = [...scene.unitSideFrontMeshMap.entries()].find(([, mesh]) => mesh === oldMesh)?.[0];
    let first = true;
    for (const [bank, group] of groups) {
      const geo = resizeInstancedAttrs(oldMesh.geometry, group.length);
      const mesh = new THREE.InstancedMesh(geo, oldMesh.material, group.length);
      mesh.castShadow = oldMesh.castShadow;
      mesh.receiveShadow = oldMesh.receiveShadow;
      mesh.frustumCulled = oldMesh.frustumCulled;
      (mesh.instanceMatrix.array as Float32Array).fill(0);
      group.forEach((slot, i) => {
        oldMesh.getMatrixAt(slot.instanceIdx, scratchMatrix);
        mesh.setMatrixAt(i, scratchMatrix);
        copyInstancedAttr(
          oldMesh.geometry.getAttribute('aTextureIndex'),
          slot.instanceIdx,
          mesh.geometry.getAttribute('aTextureIndex') as THREE.BufferAttribute,
          i,
        );
        copyInstancedAttr(
          oldMesh.geometry.getAttribute('aSpineColor'),
          slot.instanceIdx,
          mesh.geometry.getAttribute('aSpineColor') as THREE.BufferAttribute,
          i,
        );
        copyInstancedAttr(
          oldMesh.geometry.getAttribute('aPosterCropSkip'),
          slot.instanceIdx,
          mesh.geometry.getAttribute('aPosterCropSkip') as THREE.BufferAttribute,
          i,
        );
        slot.frontMesh = mesh;
        slot.instanceIdx = i;
      });
      mesh.instanceMatrix.needsUpdate = true;
      for (const name of ['aTextureIndex', 'aSpineColor', 'aPosterCropSkip']) {
        const attr = mesh.geometry.getAttribute(name);
        if (attr) attr.needsUpdate = true;
      }
      bindBank(mesh, bank);
      scene.scene.add(mesh);
      scene.meshes.push(mesh);
      if (key && first) {
        scene.unitSideFrontMeshMap.set(key, mesh);
        first = false;
      }
      batches++;
    }
    scene.scene.remove(oldMesh);
    const idx = scene.meshes.indexOf(oldMesh);
    if (idx >= 0) scene.meshes.splice(idx, 1);
    oldMesh.geometry.dispose();
  }

  for (const mesh of scene.unitSideFrontMeshMap.values()) {
    if (mesh.userData.posterBank == null) bindBank(mesh, 0);
  }
  textureArrayManager.renderBatchCount = Math.max(1, batches);
  return textureArrayManager.renderBatchCount;
}
