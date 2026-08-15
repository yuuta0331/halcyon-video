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
