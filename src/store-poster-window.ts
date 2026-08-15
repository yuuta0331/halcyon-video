// Bound XR_SAFE poster residency to unique titles after stock is placed.
// P0 is capped to physical slots so critical-ready cannot evict itself.

import { BACK_WALL_UNIT_IDX, type MovieSlot } from './store-layout';
import {
  classifySlotPriority,
  capP0UniqueToBudget,
  countPriorityUniques,
  DEFAULT_PRIORITY_CONTEXT,
  uniqueTitlePriority,
  type PosterPriorityClass,
  type PriorityUniqueCounts,
} from './perf/store-readiness';
import { textureArrayManager } from './video-case';
import type { StoreScene } from './three-scene';

let lastTitlePriority = new Map<string, PosterPriorityClass>();
let lastUniques: PriorityUniqueCounts = {
  p0UniqueTitles: 0,
  p1UniqueTitles: 0,
  p2UniqueTitles: 0,
  p3UniqueTitles: 0,
  p0PlusP1UniqueTitles: 0,
};

export function posterPriorityUniques(): PriorityUniqueCounts {
  return { ...lastUniques };
}

export function titlePosterClass(movieId: string): PosterPriorityClass | undefined {
  return lastTitlePriority.get(movieId);
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

/**
 * Classify unique titles, cap P0 to the physical window, acquire P0 then P1,
 * and stamp instance texture indices. Desktop unbounded catalogs skip this.
 */
export function bindBoundedPosterWindow(scene: StoreScene, slots: MovieSlot[]): void {
  if (!textureArrayManager.residencyBound) return;
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
  lastTitlePriority = capP0UniqueToBudget(uniqueTitlePriority(items), budget);
  lastUniques = countPriorityUniques(lastTitlePriority);

  const p0: string[] = [];
  const p1: string[] = [];
  for (const [id, cls] of lastTitlePriority) {
    if (cls === 'P0') p0.push(id);
    else if (cls === 'P1') p1.push(id);
  }
  for (const id of p0) {
    textureArrayManager.notePriority(id, 'P0');
    textureArrayManager.getIndex(id, true);
  }
  for (const id of p1) {
    textureArrayManager.notePriority(id, 'P1');
    textureArrayManager.getIndex(id, true);
  }
  for (const slot of slots) {
    const cls = lastTitlePriority.get(slot.movie.id) ?? 'P3';
    textureArrayManager.notePriority(slot.movie.id, cls);
    writeSlotIndex(slot, textureArrayManager.getIndex(slot.movie.id, false));
  }
}

export function slotStreamingClass(slot: MovieSlot, scene: StoreScene): PosterPriorityClass {
  return lastTitlePriority.get(slot.movie.id)
    ?? classifySlotPriority(slot, priorityContext(scene));
}
