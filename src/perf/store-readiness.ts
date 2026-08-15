// Progressive store readiness: CRITICAL_READY vs ALL_TEXTURES_SETTLED.
// Priority classes relate to visible/initial content, not a blind count.

export type PosterPriorityClass = 'P0' | 'P1' | 'P2' | 'P3';

export interface SlotPriorityInput {
  unitIdx: number;
  restingX: number;
  restingZ: number;
  key: string;
  libraryIdx: number;
  shelfIdx?: number;
}

export interface PriorityContext {
  spawnX: number;
  spawnZ: number;
  backWallUnitIdx: number;
  selectedKey?: string | null;
  selectedLibraryIdx?: number;
  /** Entrance / counter / spawn neighborhood, feet. */
  p0Radius: number;
  /** Adjacent browsing neighborhood, feet. */
  p1Radius: number;
  storeCenterX: number;
}

/** Matches XR_SPAWN / default entrance-overview landing. */
export const BOOT_SPAWN = { x: 13.0, z: 12.5 };

export const DEFAULT_PRIORITY_CONTEXT: Omit<PriorityContext, 'backWallUnitIdx'> = {
  spawnX: BOOT_SPAWN.x,
  spawnZ: BOOT_SPAWN.z,
  p0Radius: 16,
  p1Radius: 32,
  storeCenterX: 11,
};

export function posterPriorityNumber(cls: PosterPriorityClass): number {
  switch (cls) {
    case 'P0': return 5;
    case 'P1': return 3;
    case 'P2': return 1;
    case 'P3': return 0;
  }
}

export function classifySlotPriority(
  slot: SlotPriorityInput,
  ctx: PriorityContext,
): PosterPriorityClass {
  if (ctx.selectedKey && slot.key === ctx.selectedKey) return 'P0';
  const dx = slot.restingX - ctx.spawnX;
  const dz = slot.restingZ - ctx.spawnZ;
  const dist = Math.hypot(dx, dz);
  const isNewReleases = slot.unitIdx === ctx.backWallUnitIdx;
  if (dist <= ctx.p0Radius) return 'P0';
  // Featured New Releases wall is in the entrance overview sightline.
  if (isNewReleases && Math.abs(slot.restingX - ctx.storeCenterX) <= 8) return 'P0';
  if (isNewReleases) return 'P1';
  if (dist <= ctx.p1Radius) return 'P1';
  if (ctx.selectedLibraryIdx != null && slot.libraryIdx === ctx.selectedLibraryIdx) return 'P2';
  return 'P3';
}

export function navigationPriority(current: PosterPriorityClass): PosterPriorityClass {
  if (current === 'P3') return 'P1';
  if (current === 'P2') return 'P1';
  return current;
}

const RANK: Record<PosterPriorityClass, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export interface PriorityTitleInput {
  movieId: string;
  dist: number;
  cls: PosterPriorityClass;
}

export interface PriorityUniqueCounts {
  p0UniqueTitles: number;
  p1UniqueTitles: number;
  p2UniqueTitles: number;
  p3UniqueTitles: number;
  p0PlusP1UniqueTitles: number;
}

/** Best (highest-priority, then nearest) class per unique title. */
export function uniqueTitlePriority(
  items: PriorityTitleInput[],
): Map<string, { cls: PosterPriorityClass; dist: number }> {
  const best = new Map<string, { cls: PosterPriorityClass; dist: number }>();
  for (const item of items) {
    const prev = best.get(item.movieId);
    if (!prev) {
      best.set(item.movieId, { cls: item.cls, dist: item.dist });
      continue;
    }
    const betterClass = RANK[item.cls] < RANK[prev.cls];
    const closerSame = item.cls === prev.cls && item.dist < prev.dist;
    if (betterClass || closerSame) best.set(item.movieId, { cls: item.cls, dist: item.dist });
  }
  return best;
}

/**
 * P0 is the initial visible working set and must fit in the physical window.
 * Keep the nearest unique P0 titles up to `budget`; demote the rest to P1.
 */
export function capP0UniqueToBudget(
  best: Map<string, { cls: PosterPriorityClass; dist: number }>,
  budget: number,
): Map<string, PosterPriorityClass> {
  const out = new Map<string, PosterPriorityClass>();
  const p0: Array<{ id: string; dist: number }> = [];
  for (const [id, rec] of best) {
    if (rec.cls === 'P0') p0.push({ id, dist: rec.dist });
    else out.set(id, rec.cls);
  }
  p0.sort((a, b) => a.dist - b.dist || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const keep = Math.max(0, budget);
  for (let i = 0; i < p0.length; i++) {
    out.set(p0[i].id, i < keep ? 'P0' : 'P1');
  }
  return out;
}

export function countPriorityUniques(
  map: Map<string, PosterPriorityClass>,
): PriorityUniqueCounts {
  let p0 = 0, p1 = 0, p2 = 0, p3 = 0;
  for (const cls of map.values()) {
    if (cls === 'P0') p0++;
    else if (cls === 'P1') p1++;
    else if (cls === 'P2') p2++;
    else p3++;
  }
  return {
    p0UniqueTitles: p0,
    p1UniqueTitles: p1,
    p2UniqueTitles: p2,
    p3UniqueTitles: p3,
    p0PlusP1UniqueTitles: p0 + p1,
  };
}

export function criticalReadyFromCounts(input: {
  p0Total: number;
  p0Settled: number;
  geometryReady: boolean;
}): boolean {
  if (!input.geometryReady) return false;
  if (input.p0Total === 0) return true;
  return input.p0Settled >= input.p0Total;
}

export function revealMustNotWaitForAllTextures(input: {
  revealedAtSettledFraction: number;
}): boolean {
  return input.revealedAtSettledFraction < 1;
}

export function xrUploadBudget(input: {
  presenting: boolean;
  moving: boolean;
  highPriorityPending: boolean;
}): { budgetMs: number; maxPerFrame: number; bulkMaxPerFrame: number } {
  if (!input.presenting) {
    return { budgetMs: 4, maxPerFrame: 4, bulkMaxPerFrame: 4 };
  }
  if (input.moving) {
    return {
      budgetMs: 1,
      maxPerFrame: input.highPriorityPending ? 1 : 0,
      bulkMaxPerFrame: 0,
    };
  }
  return { budgetMs: 1.5, maxPerFrame: 2, bulkMaxPerFrame: 1 };
}
