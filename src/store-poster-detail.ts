// Reconcile the ON_DEMAND poster detail cache from pose / selection.
// Never evicts STORE_VISIBLE_BASE. Tiny HMD motion is gated by hysteresis.

import * as THREE from 'three';
import { posterPixelCache } from './video-case';
import { storeVisibleResidency } from './store-visible-residency';
import { queueTextureUpload, textureArrayManager } from './poster-textures';
import { storeVisibleWork } from './perf/store-visible-work';
import {
  chooseDetailSet,
  POSTER_DETAIL_MOVE_FEET,
  POSTER_DETAIL_SLOT_LIMIT,
  POSTER_DETAIL_YAW_RAD,
  posterDetailResidency,
  type DetailCandidate,
} from './poster-detail-residency';
import {
  clearPosterDetailLut,
  initPosterDetailGpu,
  setPosterDetailLut,
  uploadPosterDetailLayer,
} from './poster-detail-gpu';
import type { StoreScene } from './three-scene';
import type { MovieSlot } from './store-layout';

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

let lastX = NaN;
let lastZ = NaN;
let lastYaw = NaN;
let lastSelected: string | null = null;
const spatial: DetailCandidate[] = [];

export function resetPosterDetailReconcileForTests(): void {
  lastX = NaN;
  lastZ = NaN;
  lastYaw = NaN;
  lastSelected = null;
  spatial.length = 0;
}

export function cachePosterDetailSpatial(slots: MovieSlot[]): void {
  spatial.length = 0;
  const seen = new Set<string>();
  for (const slot of slots) {
    const id = slot.movie.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const rec = storeVisibleResidency.peek(id);
    spatial.push({
      movieId: id,
      x: slot.restingX,
      z: slot.restingZ,
      globalIndex: rec?.globalIndex ?? 0,
    });
  }
}

function selectedMovieId(scene: StoreScene): string | null {
  const lib = scene.selectedLibraryIdx;
  const unit = scene.selectedUnitIdx;
  const shelf = scene.selectedShelf;
  const col = scene.selectedCol;
  for (const slot of scene.slotsByPosition.values()) {
    if (slot.libraryIdx === lib && slot.unitIdx === unit && slot.shelfIdx === shelf && slot.col === col) {
      return slot.movie.id;
    }
  }
  return null;
}

function playerPose(scene: StoreScene): { x: number; z: number; yaw: number } {
  scene.camera.getWorldPosition(_pos);
  scene.camera.getWorldQuaternion(_quat);
  _euler.setFromQuaternion(_quat, 'YXZ');
  return { x: _pos.x, z: _pos.z, yaw: _euler.y };
}

function shouldReconcile(x: number, z: number, yaw: number, selected: string | null, force: boolean): boolean {
  if (force) return true;
  if (!Number.isFinite(lastX)) return true;
  if (selected !== lastSelected) return true;
  const d = Math.hypot(x - lastX, z - lastZ);
  let dy = yaw - lastYaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  return d >= POSTER_DETAIL_MOVE_FEET || Math.abs(dy) >= POSTER_DETAIL_YAW_RAD;
}

function promote(scene: StoreScene, movieId: string, globalIndex: number): void {
  posterDetailResidency.request(movieId);
  const got = posterDetailResidency.acquire(movieId);
  if (!got) return;
  if (got.evicted) {
    const prev = storeVisibleResidency.peek(got.evicted);
    if (prev) clearPosterDetailLut(prev.globalIndex);
  }
  const pixels = posterPixelCache.get(movieId);
  if (!pixels) return;
  posterDetailResidency.noteDecoded();
  const lease = got.lease;
  const generation = storeVisibleWork.currentGeneration();
  queueTextureUpload(() => {
    if (!posterDetailResidency.isLeaseCurrent(lease)) {
      posterDetailResidency.noteStaleDrop();
      return;
    }
    if (!uploadPosterDetailLayer(scene.renderer, lease.slot, pixels)) return;
    setPosterDetailLut(globalIndex, lease.slot + 1);
    posterDetailResidency.noteUploaded();
  }, 'priority', { scope: 'ON_DEMAND', generation, movieId });
}

export function bindPosterDetailTier(_scene: StoreScene, slots: MovieSlot[]): void {
  if (!textureArrayManager.residencyBound) return;
  initPosterDetailGpu(POSTER_DETAIL_SLOT_LIMIT);
  resetPosterDetailReconcileForTests();
  cachePosterDetailSpatial(slots);
}

export function reconcilePosterDetail(scene: StoreScene, opts: { force?: boolean } = {}): void {
  if (!textureArrayManager.residencyBound) return;
  const pose = playerPose(scene);
  const selected = selectedMovieId(scene);
  if (!shouldReconcile(pose.x, pose.z, pose.yaw, selected, !!opts.force)) return;
  lastX = pose.x;
  lastZ = pose.z;
  lastYaw = pose.yaw;
  lastSelected = selected;
  if (spatial.length === 0) cachePosterDetailSpatial([...scene.slotsByPosition.values()]);
  const resident = new Set(posterDetailResidency.residentIds());
  const desired = chooseDetailSet(spatial, {
    playerX: pose.x,
    playerZ: pose.z,
    yaw: pose.yaw,
    selectedId: selected,
    resident,
    limit: POSTER_DETAIL_SLOT_LIMIT,
  });
  const want = new Set(desired);
  for (const id of resident) {
    if (want.has(id)) continue;
    const rec = storeVisibleResidency.peek(id);
    if (rec) clearPosterDetailLut(rec.globalIndex);
    posterDetailResidency.release(id);
  }
  for (const id of desired) {
    if (posterDetailResidency.peek(id)) continue;
    const rec = storeVisibleResidency.peek(id);
    promote(scene, id, rec?.globalIndex ?? 0);
  }
}

export function promoteSelectedPosterDetail(scene: StoreScene, movieId: string): void {
  if (!textureArrayManager.residencyBound) return;
  const rec = storeVisibleResidency.peek(movieId);
  promote(scene, movieId, rec?.globalIndex ?? 0);
}
