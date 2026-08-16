// Bound XR_SAFE poster residency to unique titles after stock is placed.
// Boot P0 is pinned until critical-ready; afterwards a player-relative
// working set rotates through the physical window.

import { BACK_WALL_UNIT_IDX, type MovieSlot } from './store-layout';
import {
  classifySlotPriority,
  capP0UniqueToBudget,
  countPriorityUniques,
  DEFAULT_PRIORITY_CONTEXT,
  uniqueTitlePriority,
  posterPriorityNumber,
  type PosterPriorityClass,
  type PriorityUniqueCounts,
} from './perf/store-readiness';
import { textureArrayManager, posterPixelCache, lowResCache } from './video-case';
import { posterUploadJobsStarted } from './poster-textures';
import { setGpuLiveState } from './xr/gpu-diagnostics';
import type { StoreScene } from './three-scene';
import {
  computeDesiredWorkingSet,
  hashIdList,
  reconcilePosterWindow,
  selectGpuWorkingSet,
  PosterWorkingSetTracker,
  type SpatialTitle,
  type WorkingSetQuery,
} from './poster-working-set';

let lastTitlePriority = new Map<string, PosterPriorityClass>();
let lastUniques: PriorityUniqueCounts = {
  p0UniqueTitles: 0,
  p1UniqueTitles: 0,
  p2UniqueTitles: 0,
  p3UniqueTitles: 0,
  p0PlusP1UniqueTitles: 0,
};
let spatialCache: SpatialTitle[] = [];
const tracker = new PosterWorkingSetTracker();
let decodeJobsStarted = 0;

export function posterPriorityUniques(): PriorityUniqueCounts {
  return { ...lastUniques };
}

export function titlePosterClass(movieId: string): PosterPriorityClass | undefined {
  return lastTitlePriority.get(movieId);
}

export function notePosterDecodeJob(): void {
  decodeJobsStarted++;
}

export function posterDecodeJobsStarted(): number {
  return decodeJobsStarted;
}

export function posterWorkingSetSnapshot() {
  const mem = textureArrayManager.memorySnapshot();
  const st = tracker.state;
  return {
    bootPinsActive: st.bootPinsActive,
    bootPinsReleasedAt: st.bootPinsReleasedAt,
    posterPinnedCount: mem.pinnedCount ?? textureArrayManager.pinnedCount(),
    posterWorkingSetVersion: st.version,
    posterWorkingSetUpdates: st.updates,
    posterDesiredCount: st.lastDesired.length,
    posterInitialP0Count: st.initialP0Count,
    posterInitialP1ResidentCount: st.initialP1ResidentCount,
    posterInitialP1CandidateCount: st.initialP1CandidateCount,
    posterInitialWorkingSetCount: st.initialWorkingSetCount,
    p1ScheduledAtBoot: st.p1ScheduledAtBoot,
    p1RejectedAtBoot: st.p1RejectedAtBoot,
    posterEnteredWorkingSetCount: st.enteredCount,
    posterLeftWorkingSetCount: st.leftCount,
    posterAcquisitionCount: mem.acquisitionCount,
    posterReacquisitionCount: mem.reacquisitionCount,
    posterEvictionCount: mem.evictionCount,
    posterResidentHighWaterMark: mem.residentHighWaterMark,
    posterResidentCount: mem.residentCount,
    posterPhysicalSlots: mem.physicalSlots,
    posterStaleUploadDrops: mem.staleUploadDrops,
    posterDecodeJobsStarted: decodeJobsStarted,
    posterUploadJobsStarted: posterUploadJobsStarted(),
    lastDesiredHash: hashIdList(st.lastDesired),
    lastTransition: st.lastTransition,
    residencyInvariantOk: mem.residencyInvariantOk,
    duplicatePhysicalOwners: mem.duplicatePhysicalOwners,
    freeOwnedCollisions: mem.freeOwnedCollisions,
  };
}

export function publishGpuPosterState(): void {
  const mem = textureArrayManager.memorySnapshot();
  const ws = posterWorkingSetSnapshot();
  setGpuLiveState({
    poster: {
      catalogTitleCount: mem.catalogTitleCount,
      physicalSlots: mem.physicalSlots,
      residentCount: mem.residentCount,
      freeCount: mem.freeCount,
      uniqueOwners: mem.uniqueOwners,
      residentHighWaterMark: mem.residentHighWaterMark,
      evictionCount: mem.evictionCount,
      acquisitionCount: mem.acquisitionCount,
      reacquisitionCount: mem.reacquisitionCount,
      pinnedCount: mem.pinnedCount,
      staleUploadDrops: mem.staleUploadDrops,
      residencyInvariantOk: mem.residencyInvariantOk,
      duplicatePhysicalOwners: mem.duplicatePhysicalOwners,
      freeOwnedCollisions: mem.freeOwnedCollisions,
      orphanMovieMappings: mem.orphanMovieMappings,
      orphanSlotMappings: mem.orphanSlotMappings,
      cpuBytes: mem.cpuBytes,
      gpuBytes: mem.gpuBytes,
      cacheBytes: posterPixelCache.byteSize + lowResCache.byteSize,
      cacheBudget: posterPixelCache.budget + lowResCache.budget,
      cacheHits: posterPixelCache.hits + lowResCache.hits,
      cacheMisses: posterPixelCache.misses + lowResCache.misses,
      p0UniqueTitles: lastUniques.p0UniqueTitles,
      p1UniqueTitles: lastUniques.p1UniqueTitles,
      p2UniqueTitles: lastUniques.p2UniqueTitles,
      p3UniqueTitles: lastUniques.p3UniqueTitles,
      p0PlusP1UniqueTitles: lastUniques.p0PlusP1UniqueTitles,
      posterWorkingSetUpdates: ws.posterWorkingSetUpdates,
      posterWorkingSetVersion: ws.posterWorkingSetVersion,
      posterDesiredCount: ws.posterDesiredCount,
      posterPinnedCount: ws.posterPinnedCount,
      bootPinsActive: ws.bootPinsActive,
      bootPinsReleasedAt: ws.bootPinsReleasedAt,
      posterInitialP0Count: ws.posterInitialP0Count,
      posterInitialP1ResidentCount: ws.posterInitialP1ResidentCount,
      posterEnteredWorkingSetCount: ws.posterEnteredWorkingSetCount,
      posterLeftWorkingSetCount: ws.posterLeftWorkingSetCount,
      posterDecodeJobsStarted: ws.posterDecodeJobsStarted,
      lastWorkingSetTransition: ws.lastTransition,
    },
  });
}

export function posterArtSample(): { residentCount: number; withArtCount: number } {
  const ids = textureArrayManager.residencyWindow()?.residentIds() ?? [];
  let withArt = 0;
  for (const id of ids) {
    if (textureArrayManager.hasArt(id)) withArt++;
  }
  return { residentCount: ids.length, withArtCount: withArt };
}

export function bootWorkingSetIds(): { p0: string[]; p1: string[] } {
  return {
    p0: [...tracker.state.bootP0Ids],
    p1: [...tracker.state.initialP1Ids],
  };
}

function priorityContext(scene: StoreScene) {
  return {
    ...DEFAULT_PRIORITY_CONTEXT,
    backWallUnitIdx: BACK_WALL_UNIT_IDX,
    selectedKey: `${scene.selectedLibraryIdx}_${scene.selectedUnitIdx}_front_${scene.selectedShelf}_${scene.selectedCol}`,
    selectedLibraryIdx: scene.selectedLibraryIdx,
  };
}

function writeSlotIndex(slot: MovieSlot, index: number): void {
  const fIdx = slot.frontMesh.geometry.getAttribute('aTextureIndex') as { setX(i: number, v: number): void } | undefined;
  if (fIdx) fIdx.setX(slot.instanceIdx, index);
  const bIdx = slot.backMesh.geometry.getAttribute('aTextureIndex') as { setX(i: number, v: number): void } | undefined;
  if (bIdx) bIdx.setX(slot.instanceIdx, index);
}

function cacheSpatial(slots: MovieSlot[]): SpatialTitle[] {
  spatialCache = slots.map((slot) => ({
    movieId: slot.movie.id,
    x: slot.restingX,
    z: slot.restingZ,
    unitIdx: slot.unitIdx,
    libraryIdx: slot.libraryIdx,
    key: slot.key,
  }));
  return spatialCache;
}

function playerPose(scene: StoreScene): {
  x: number;
  z: number;
  yaw: number;
  selectedMovieId: string | null;
  selectedKey: string | null;
  selectedLibraryIdx: number;
} {
  const presenting = !!scene.xr?.presenting;
  const rig = presenting ? scene.xr?.rigPose : null;
  const x = rig?.x ?? scene.camera.position.x;
  const z = rig?.z ?? scene.camera.position.z;
  const yaw = rig?.yaw ?? 0;
  const selected = scene.getSelectedMovie?.() ?? null;
  return {
    x,
    z,
    yaw,
    selectedMovieId: selected?.id ?? null,
    selectedKey: `${scene.selectedLibraryIdx}_${scene.selectedUnitIdx}_front_${scene.selectedShelf}_${scene.selectedCol}`,
    selectedLibraryIdx: scene.selectedLibraryIdx,
  };
}

function queryFromPose(
  pose: ReturnType<typeof playerPose>,
): WorkingSetQuery {
  return {
    playerX: pose.x,
    playerZ: pose.z,
    yaw: pose.yaw,
    selectedMovieId: pose.selectedMovieId,
    selectedLibraryIdx: pose.selectedLibraryIdx,
    selectedKey: pose.selectedKey,
    backWallUnitIdx: BACK_WALL_UNIT_IDX,
    p0Radius: DEFAULT_PRIORITY_CONTEXT.p0Radius,
    p1Radius: DEFAULT_PRIORITY_CONTEXT.p1Radius,
    storeCenterX: DEFAULT_PRIORITY_CONTEXT.storeCenterX,
    budget: textureArrayManager.maxMovies,
  };
}

function stampResidentIndices(slots: MovieSlot[]): void {
  for (const slot of slots) {
    const peeked = textureArrayManager.peekIndex(slot.movie.id);
    if (peeked == null) continue;
    writeSlotIndex(slot, peeked);
  }
}

function loadEntered(scene: StoreScene, movieIds: Iterable<string>, priority: number): void {
  const seen = new Set<string>();
  for (const id of movieIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const slots = scene.slotsByMovieId.get(id);
    const slot = slots?.[0];
    slot?.loadShelfDetails(priority);
  }
}

function publishWorkingSetWindow(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as {
    __posterWorkingSet?: unknown;
    __posterArtSample?: unknown;
  };
  w.__posterWorkingSet = posterWorkingSetSnapshot;
  w.__posterArtSample = posterArtSample;
}

/**
 * Classify unique titles from boot spawn, cap P0, pin boot P0, acquire only
 * enough nearest P1 to fill remaining slots, stamp resident indices.
 */
export function bindBoundedPosterWindow(scene: StoreScene, slots: MovieSlot[]): void {
  if (!textureArrayManager.residencyBound) return;
  tracker.reset();
  decodeJobsStarted = 0;
  cacheSpatial(slots);
  const ctx = priorityContext(scene);
  const items = slots.map((slot) => {
    const dx = slot.restingX - ctx.spawnX;
    const dz = slot.restingZ - ctx.spawnZ;
    return {
      movieId: slot.movie.id,
      dist: Math.hypot(dx, dz),
      cls: classifySlotPriority(slot, ctx),
    };
  });
  const budget = textureArrayManager.maxMovies;
  const best = uniqueTitlePriority(items);
  lastTitlePriority = capP0UniqueToBudget(best, budget);
  lastUniques = countPriorityUniques(lastTitlePriority);
  const desired = selectGpuWorkingSet(best, budget);
  tracker.noteBoot(desired);

  for (const id of desired.p0Ids) {
    textureArrayManager.notePriority(id, 'P0');
    textureArrayManager.getIndex(id, true);
    textureArrayManager.pin(id);
  }
  for (const id of desired.p1Ids) {
    textureArrayManager.notePriority(id, 'P1');
    textureArrayManager.getIndex(id, true);
  }
  stampResidentIndices(slots);
  publishGpuPosterState();
  publishWorkingSetWindow();
}

export function releaseBootPosterPins(): void {
  if (!textureArrayManager.residencyBound) return;
  if (!tracker.state.bootPinsActive) return;
  textureArrayManager.unpinAll();
  tracker.releaseBootPins();
  publishGpuPosterState();
  publishWorkingSetWindow();
}

export function updatePosterWorkingSet(scene: StoreScene, opts: { force?: boolean } = {}): void {
  if (!textureArrayManager.residencyBound) return;
  if (tracker.state.bootPinsActive && !opts.force) return;
  if (spatialCache.length === 0) {
    cacheSpatial(Array.from(scene.slotsByPosition.values()));
  }
  const pose = playerPose(scene);
  if (!tracker.needsUpdate(pose, !!opts.force)) return;
  const q = queryFromPose(pose);
  const desired = computeDesiredWorkingSet(spatialCache, q);
  lastTitlePriority = new Map<string, PosterPriorityClass>();
  for (const [id, rec] of desired.classified) lastTitlePriority.set(id, rec.cls);
  for (const [id, cls] of desired.desired) lastTitlePriority.set(id, cls);
  lastUniques = countPriorityUniques(lastTitlePriority);

  const beforeResident = textureArrayManager.residencyResidentCount();
  const win = textureArrayManager.residencyWindow();
  if (!win) return;
  const result = reconcilePosterWindow(win, desired.desired, []);
  for (const id of result.left) textureArrayManager.afterWorkingSetEvict(id);
  for (const [id, cls] of desired.desired) {
    textureArrayManager.notePriority(id, cls);
    textureArrayManager.syncIndexFromResidency(id);
  }
  stampResidentIndices(Array.from(scene.slotsByPosition.values()));
  loadEntered(scene, result.entered, posterPriorityNumber('P1'));
  if (pose.selectedMovieId && desired.desired.has(pose.selectedMovieId)) {
    loadEntered(scene, [pose.selectedMovieId], posterPriorityNumber('P0'));
  }
  const near = desired.p0Ids.length + desired.p1Ids.length;
  tracker.commitUpdate(pose, result, {
    beforeResidentCount: beforeResident,
    afterResidentCount: textureArrayManager.residencyResidentCount(),
    nearResidentCount: near,
    desiredIds: [...desired.desired.keys()],
  });
  publishGpuPosterState();
  scene.requestRender?.();
  publishWorkingSetWindow();
}

export function promoteSelectedPoster(scene: StoreScene, movieId: string): void {
  if (!textureArrayManager.residencyBound) return;
  textureArrayManager.notePriority(movieId, 'P0');
  textureArrayManager.getIndex(movieId, true);
  const slots = scene.slotsByMovieId.get(movieId);
  if (slots) {
    for (const slot of slots) {
      const idx = textureArrayManager.peekIndex(movieId);
      if (idx != null) writeSlotIndex(slot, idx);
    }
  }
  loadEntered(scene, [movieId], posterPriorityNumber('P0'));
  updatePosterWorkingSet(scene, { force: true });
}

export function slotStreamingClass(slot: MovieSlot, scene: StoreScene): PosterPriorityClass {
  return lastTitlePriority.get(slot.movie.id)
    ?? classifySlotPriority(slot, priorityContext(scene));
}

export function initialWorkingSetSlots(allSlots: MovieSlot[]): { p0: MovieSlot[]; p1: MovieSlot[] } {
  const p0Ids = new Set(tracker.state.bootP0Ids);
  const p1Ids = new Set(tracker.state.initialP1Ids);
  const seen0 = new Set<string>();
  const seen1 = new Set<string>();
  const p0: MovieSlot[] = [];
  const p1: MovieSlot[] = [];
  for (const slot of allSlots) {
    const id = slot.movie.id;
    if (p0Ids.has(id) && !seen0.has(id)) {
      seen0.add(id);
      p0.push(slot);
    } else if (p1Ids.has(id) && !seen1.has(id)) {
      seen1.add(id);
      p1.push(slot);
    }
  }
  return { p0, p1 };
}
