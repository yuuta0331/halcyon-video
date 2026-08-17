// Reconcile the ON_DEMAND poster detail cache from pose / selection.
// Never evicts STORE_VISIBLE_BASE. Tiny HMD motion is gated by hysteresis.
// CPU posterPixelCache MISS schedules the canonical posterQueue load.

import * as THREE from 'three';
import { posterPixelCache, posterQueue } from './video-case';
import { storeVisibleResidency } from './store-visible-residency';
import { dropQueuedUploadsForMovie, queueTextureUpload, textureArrayManager } from './poster-textures';
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
  getPosterDetailLutLayout,
  initPosterDetailGpu,
  posterDetailResourceSnapshot,
  setPosterDetailLut,
  uploadPosterDetailLayer,
} from './poster-detail-gpu';
import { activateDetailTitle, demoteDetailTitle, type DetailActivateDeps } from './poster-detail-activate';
import { posterDetailRetry } from './poster-detail-retry';
import { runPosterDetailActivationProbe } from './perf/poster-detail-activation-probe';
import { runPosterDetailFailureProbe } from './perf/poster-detail-failure-probe';
import type { StoreScene } from './three-scene';
import type { MovieSlot } from './store-layout';

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

let lastX = NaN;
let lastZ = NaN;
let lastYaw = NaN;
let lastSelected: string | null = null;
let lastDesired = new Set<string>();
const spatial: DetailCandidate[] = [];
const movies = new Map<string, { id: string; posterUrl?: string }>();

export function resetPosterDetailReconcileForTests(): void {
  lastX = NaN;
  lastZ = NaN;
  lastYaw = NaN;
  lastSelected = null;
  lastDesired.clear();
  spatial.length = 0;
  movies.clear();
  posterDetailRetry.reset();
}

export function cachePosterDetailSpatial(slots: MovieSlot[]): void {
  spatial.length = 0;
  movies.clear();
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
    movies.set(id, { id, posterUrl: slot.movie.posterUrl });
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

function catalogCountFromSpatial(): number {
  let maxIdx = 0;
  for (const c of spatial) if (c.globalIndex > maxIdx) maxIdx = c.globalIndex;
  return Math.max(spatial.length, maxIdx + 1, 1);
}

function makeDeps(scene: StoreScene): DetailActivateDeps {
  return {
    getMovie: (id) => movies.get(id) ?? null,
    getGlobalIndex: (id) => storeVisibleResidency.peek(id)?.globalIndex
      ?? spatial.find((c) => c.movieId === id)?.globalIndex
      ?? 0,
    isDesired: (id) => lastDesired.has(id),
    isSelected: (id) => lastSelected === id,
    sceneGeneration: () => storeVisibleWork.currentGeneration(),
    getPixels: (id) => posterPixelCache.get(id) ?? null,
    loadPoster: (movie, priority, onPixels, onSettled) => {
      posterQueue.load(movie as never, priority, onPixels, onSettled);
    },
    queueUpload: (run, movieId, generation) => {
      queueTextureUpload(run, 'priority', { scope: 'ON_DEMAND', generation, movieId });
    },
    uploadLayer: (slot, pixels) => uploadPosterDetailLayer(scene.renderer, slot, pixels),
    setLut: (globalIndex, slotPlusOne) => setPosterDetailLut(globalIndex, slotPlusOne),
    clearLut: (globalIndex) => { clearPosterDetailLut(globalIndex); },
    requestRender: () => scene.requestRender(),
  };
}

export function bindPosterDetailTier(scene: StoreScene, slots: MovieSlot[]): void {
  if (!textureArrayManager.residencyBound) return;
  resetPosterDetailReconcileForTests();
  cachePosterDetailSpatial(slots);
  posterDetailRetry.reset();
  initPosterDetailGpu({
    slotLimit: POSTER_DETAIL_SLOT_LIMIT,
    catalogCount: catalogCountFromSpatial(),
    renderer: scene.renderer,
  });
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
  const leased = new Set(posterDetailResidency.residentIds());
  const desired = chooseDetailSet(spatial, {
    playerX: pose.x,
    playerZ: pose.z,
    yaw: pose.yaw,
    selectedId: selected,
    resident: leased,
    limit: POSTER_DETAIL_SLOT_LIMIT,
  });
  lastDesired = new Set(desired);
  const deps = makeDeps(scene);
  for (const id of leased) {
    if (lastDesired.has(id) || id === selected) continue;
    dropQueuedUploadsForMovie(id);
    demoteDetailTitle(id, deps);
  }
  for (const id of lastDesired) {
    activateDetailTitle(id, deps);
  }
}

export function promoteSelectedPosterDetail(scene: StoreScene, movieId: string): void {
  if (!textureArrayManager.residencyBound) return;
  lastSelected = movieId;
  lastDesired.add(movieId);
  if (spatial.length === 0) cachePosterDetailSpatial([...scene.slotsByPosition.values()]);
  activateDetailTitle(movieId, makeDeps(scene));
}

export function forcePosterDetailCacheMiss(movieId: string): boolean {
  return posterPixelCache.delete(movieId);
}

export function installPosterDetailTestHooks(scene: StoreScene): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as {
    __posterDetail?: () => unknown;
    __posterDetailForceMiss?: (movieId?: string) => { ok: boolean };
    __posterDetailActivationProbe?: () => Promise<unknown>;
    __posterDetailFailureProbe?: () => Promise<unknown>;
  };
  w.__posterDetail = () => posterDetailResourceSnapshot();
  w.__posterDetailForceMiss = (movieId?: string) => {
    const id = movieId ?? selectedMovieId(scene) ?? spatial[0]?.movieId;
    if (!id) return { ok: false };
    posterPixelCache.delete(id);
    promoteSelectedPosterDetail(scene, id);
    reconcilePosterDetail(scene, { force: true });
    return { ok: true };
  };
  const restoreDetailGpu = () => {
    const prev = getPosterDetailLutLayout();
    initPosterDetailGpu({
      slotLimit: POSTER_DETAIL_SLOT_LIMIT,
      catalogCount: Math.max(prev.needed, catalogCountFromSpatial()),
      renderer: scene.renderer,
    });
    posterDetailRetry.reset();
    reconcilePosterDetail(scene, { force: true });
  };
  w.__posterDetailActivationProbe = async () => {
    try {
      return await runPosterDetailActivationProbe(scene.renderer);
    } finally {
      restoreDetailGpu();
    }
  };
  w.__posterDetailFailureProbe = async () => {
    try {
      return await runPosterDetailFailureProbe(scene.renderer);
    } finally {
      restoreDetailGpu();
    }
  };
}
