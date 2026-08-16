// STORE_VISIBLE_BASE residency after stock is placed.
// Player pose / yaw must not unload shelf-visible catalog art.

import {
  classifySlotPriority,
  DEFAULT_PRIORITY_CONTEXT,
  uniqueTitlePriority,
  type PosterPriorityClass,
  type PriorityUniqueCounts,
} from './perf/store-readiness';
import { BACK_WALL_UNIT_IDX, type MovieSlot } from './store-layout';
import { textureArrayManager, posterPixelCache, lowResCache } from './video-case';
import { posterUploadJobsStarted } from './poster-textures';
import { storeVisibleResidency } from './store-visible-residency';
import { setGpuLiveState } from './xr/gpu-diagnostics';
import type { StoreScene } from './three-scene';
import {
  hashIdList,
  selectGpuWorkingSet,
  PosterWorkingSetTracker,
  type SpatialTitle,
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
      cpuBytesActive: mem.cpuBytesActive,
      cpuBytesAllocated: mem.cpuBytesAllocated,
      expectedTitles: mem.expectedTitles,
      logicalMappedTitles: mem.logicalMappedTitles,
      actuallyRenderableTitles: mem.actuallyRenderableTitles,
      bankCount: mem.bankCount,
      layersPerBank: mem.layersPerBank,
      renderBatchCount: mem.renderBatchCount,
      samplersPerDraw: mem.samplersPerDraw,
      arrayLayerCeiling: mem.arrayLayerCeiling,
      capacityInvariantOk: mem.capacityInvariantOk,
      shelfWidth: mem.shelfWidth,
      shelfHeight: mem.shelfHeight,
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

function stampResidentIndices(slots: MovieSlot[]): void {
  for (const slot of slots) {
    const peeked = textureArrayManager.peekIndex(slot.movie.id);
    if (peeked == null) continue;
    writeSlotIndex(slot, peeked);
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
 * Map every unique STORE_VISIBLE_BASE title to a stable bank/layer and pin
 * the mapping for the store scene. Pose-driven reconcile is not used.
 */
export function bindBoundedPosterWindow(_scene: StoreScene, slots: MovieSlot[]): void {
  if (!textureArrayManager.residencyBound) return;
  tracker.reset();
  decodeJobsStarted = 0;
  cacheSpatial(slots);
  const uniqueIds = [...new Set(slots.map((slot) => slot.movie.id))].sort();
  storeVisibleResidency.bindCatalog(uniqueIds, {
    maxArrayTextureLayers: textureArrayManager.arrayLayerCeiling,
  });

  for (const id of uniqueIds) {
    textureArrayManager.notePriority(id, 'P0');
    textureArrayManager.getIndex(id, true);
    textureArrayManager.pin(id);
  }
  textureArrayManager.freezeStableMappings();
  lastTitlePriority = new Map(uniqueIds.map((id) => [id, 'P0' as PosterPriorityClass]));
  lastUniques = {
    p0UniqueTitles: uniqueIds.length,
    p1UniqueTitles: 0,
    p2UniqueTitles: 0,
    p3UniqueTitles: 0,
    p0PlusP1UniqueTitles: uniqueIds.length,
  };
  const desired = selectGpuWorkingSet(
    uniqueTitlePriority(uniqueIds.map((id) => ({ movieId: id, dist: 0, cls: 'P0' as PosterPriorityClass }))),
    textureArrayManager.maxMovies,
  );
  tracker.noteBoot(desired);
  stampResidentIndices(slots);
  publishGpuPosterState();
  publishWorkingSetWindow();
}

export function releaseBootPosterPins(): void {
  if (!textureArrayManager.residencyBound) return;
  if (!tracker.state.bootPinsActive) return;
  tracker.releaseBootPins();
  publishGpuPosterState();
  publishWorkingSetWindow();
}

export function updatePosterWorkingSet(_scene: StoreScene, _opts: { force?: boolean } = {}): void {
  // Pose / yaw / region must not control STORE_VISIBLE_BASE residency.
}

export function promoteSelectedPoster(scene: StoreScene, movieId: string): void {
  if (!textureArrayManager.residencyBound) return;
  textureArrayManager.notePriority(movieId, 'P0');
  const slots = scene.slotsByMovieId.get(movieId);
  if (slots) {
    for (const slot of slots) {
      const idx = textureArrayManager.peekIndex(movieId);
      if (idx != null) writeSlotIndex(slot, idx);
    }
  }
}

export function slotStreamingClass(slot: MovieSlot, scene: StoreScene): PosterPriorityClass {
  return lastTitlePriority.get(slot.movie.id)
    ?? classifySlotPriority(slot, priorityContext(scene));
}

export function initialWorkingSetSlots(allSlots: MovieSlot[]): { p0: MovieSlot[]; p1: MovieSlot[] } {
  const seen = new Set<string>();
  const p0: MovieSlot[] = [];
  for (const slot of allSlots) {
    if (seen.has(slot.movie.id)) continue;
    seen.add(slot.movie.id);
    p0.push(slot);
  }
  return { p0, p1: [] };
}
