// Bounded XR_SAFE poster residency. Catalog IDs are logical; only a small
// physical window is resident in the shelf DataArrayTexture.
//
// Ownership rule: every physical index is owned by exactly one movie or is
// genuinely free. Eviction that reuses a slot must not return that index to
// the free list.

import type { PosterPriorityClass } from './perf/store-readiness';
import type { PosterPolicy } from './perf/resource-profile';

const MIP_FACTOR = 4 / 3;

export interface PosterByteEstimate {
  physicalPosterSlots: number;
  posterShelfResolution: { w: number; h: number };
  posterArrayCpuBytesEstimated: number;
  posterArrayGpuBytesEstimated: number;
  dualArrays: boolean;
}

export function estimatePosterArrayBytes(policy: PosterPolicy): PosterByteEstimate {
  const slots = Math.max(0, policy.physicalSlots);
  const { shelfWidth: w, shelfHeight: h } = policy;
  const layerBytes = w * h * 4 * slots;
  const cpu = policy.dualArrays
    ? layerBytes + Math.ceil(w / 2.5) * Math.ceil(h / 2.5) * 4 * slots
    : layerBytes;
  return {
    physicalPosterSlots: slots,
    posterShelfResolution: { w, h },
    posterArrayCpuBytesEstimated: cpu,
    posterArrayGpuBytesEstimated: Math.round(cpu * MIP_FACTOR),
    dualArrays: policy.dualArrays,
  };
}

export function desktopPosterArrayBytes(catalogTitles: number, bankSize: number): PosterByteEstimate {
  const titles = Math.max(1, catalogTitles);
  const highLayers = Math.min(bankSize, titles);
  const overflow = titles > bankSize;
  const lowLayers = overflow ? Math.max(1, titles - bankSize) : titles;
  const high = 160 * 240 * 4 * highLayers;
  const low = 64 * 96 * 4 * lowLayers;
  const cpu = high + low;
  return {
    physicalPosterSlots: highLayers + (overflow ? lowLayers : 0),
    posterShelfResolution: { w: 160, h: 240 },
    posterArrayCpuBytesEstimated: cpu,
    posterArrayGpuBytesEstimated: Math.round(cpu * MIP_FACTOR),
    dualArrays: true,
  };
}

const PRIORITY_RANK: Record<PosterPriorityClass, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

export interface PosterLease {
  movieId: string;
  index: number;
  generation: number;
}

export interface PosterAcquireResult {
  index: number;
  generation: number;
  evicted: string | null;
  ok: boolean;
}

export interface PosterResidencyInvariants {
  ok: boolean;
  residentCount: number;
  freeCount: number;
  slotCount: number;
  duplicateOwners: number;
  orphanMovieMappings: number;
  orphanSlotMappings: number;
  freeOwnedCollisions: number;
  duplicateRecencyEntries: number;
  outOfRangeIndices: number;
  duplicateFreeEntries: number;
  stalePriorityEntries: number;
}

export class PosterResidencyWindow {
  readonly slots: number;
  private readonly slotMovie: Array<string | null>;
  private readonly generation: number[];
  private readonly movieToSlot = new Map<string, number>();
  /** Resident-only. Evicted/released IDs are removed so this cannot grow with catalog walk. */
  private readonly priority = new Map<string, PosterPriorityClass>();
  private readonly recency: string[] = [];
  private free: number[] = [];
  private _highWater = 0;
  private _evictionCount = 0;

  constructor(slots: number) {
    this.slots = Math.max(1, slots);
    this.slotMovie = Array.from({ length: this.slots }, () => null);
    this.generation = Array.from({ length: this.slots }, () => 0);
    this.free = Array.from({ length: this.slots }, (_, i) => this.slots - 1 - i);
  }

  get residentCount(): number {
    return this.movieToSlot.size;
  }

  get freeCount(): number {
    return this.free.length;
  }

  get residentHighWaterMark(): number {
    return this._highWater;
  }

  get evictionCount(): number {
    return this._evictionCount;
  }

  peek(movieId: string): number | null {
    const idx = this.movieToSlot.get(movieId);
    return idx === undefined ? null : idx;
  }

  peekLease(movieId: string): PosterLease | null {
    const index = this.movieToSlot.get(movieId);
    if (index === undefined) return null;
    return { movieId, index, generation: this.generation[index] };
  }

  isLeaseCurrent(lease: PosterLease): boolean {
    if (lease.index < 0 || lease.index >= this.slots) return false;
    return this.movieToSlot.get(lease.movieId) === lease.index
      && this.generation[lease.index] === lease.generation
      && this.slotMovie[lease.index] === lease.movieId;
  }

  notePriority(movieId: string, cls: PosterPriorityClass): void {
    if (this.movieToSlot.has(movieId)) this.priority.set(movieId, cls);
  }

  acquire(
    movieId: string,
    cls: PosterPriorityClass = 'P2',
  ): PosterAcquireResult {
    const existing = this.movieToSlot.get(movieId);
    if (existing !== undefined) {
      this.priority.set(movieId, cls);
      this.touch(movieId);
      return {
        index: existing,
        generation: this.generation[existing],
        evicted: null,
        ok: true,
      };
    }
    const free = this.free.pop();
    if (free !== undefined) {
      this.bindNew(movieId, free, cls);
      return {
        index: free,
        generation: this.generation[free],
        evicted: null,
        ok: true,
      };
    }
    const victim = this.pickVictim(cls);
    if (victim == null) {
      return { index: 0, generation: 0, evicted: null, ok: false };
    }
    const index = this.movieToSlot.get(victim);
    if (index === undefined) {
      return { index: 0, generation: 0, evicted: null, ok: false };
    }
    this.evictAndBind(victim, movieId, index, cls);
    return {
      index,
      generation: this.generation[index],
      evicted: victim,
      ok: true,
    };
  }

  release(movieId: string): number | null {
    const idx = this.movieToSlot.get(movieId);
    if (idx === undefined) return null;
    this.movieToSlot.delete(movieId);
    this.priority.delete(movieId);
    this.slotMovie[idx] = null;
    this.generation[idx]++;
    this.free.push(idx);
    this.removeRecency(movieId);
    return idx;
  }

  uniquePhysicalOwners(): number {
    return new Set(this.movieToSlot.values()).size;
  }

  validateInvariants(): PosterResidencyInvariants {
    const slotCount = this.slots;
    const residentCount = this.movieToSlot.size;
    const freeCount = this.free.length;
    const ownersByIndex = new Map<number, string[]>();
    let orphanMovieMappings = 0;
    let outOfRangeIndices = 0;
    for (const [movieId, index] of this.movieToSlot) {
      if (index < 0 || index >= slotCount) {
        outOfRangeIndices++;
        continue;
      }
      const list = ownersByIndex.get(index);
      if (list) list.push(movieId);
      else ownersByIndex.set(index, [movieId]);
      if (this.slotMovie[index] !== movieId) orphanMovieMappings++;
    }
    let duplicateOwners = 0;
    for (const owners of ownersByIndex.values()) {
      if (owners.length > 1) duplicateOwners += owners.length - 1;
    }
    let orphanSlotMappings = 0;
    for (let i = 0; i < slotCount; i++) {
      const owner = this.slotMovie[i];
      if (owner == null) continue;
      if (this.movieToSlot.get(owner) !== i) orphanSlotMappings++;
    }
    const owned = new Set(this.movieToSlot.values());
    const freeSet = new Set<number>();
    let duplicateFreeEntries = 0;
    let freeOwnedCollisions = 0;
    for (const idx of this.free) {
      if (idx < 0 || idx >= slotCount) outOfRangeIndices++;
      if (freeSet.has(idx)) duplicateFreeEntries++;
      freeSet.add(idx);
      if (owned.has(idx) || this.slotMovie[idx] != null) freeOwnedCollisions++;
    }
    const recencySeen = new Set<string>();
    let duplicateRecencyEntries = 0;
    for (const id of this.recency) {
      if (recencySeen.has(id)) duplicateRecencyEntries++;
      recencySeen.add(id);
      if (!this.movieToSlot.has(id)) orphanMovieMappings++;
    }
    let stalePriorityEntries = 0;
    for (const id of this.priority.keys()) {
      if (!this.movieToSlot.has(id)) stalePriorityEntries++;
    }
    const ok = residentCount <= slotCount
      && freeCount + residentCount === slotCount
      && duplicateOwners === 0
      && orphanMovieMappings === 0
      && orphanSlotMappings === 0
      && freeOwnedCollisions === 0
      && duplicateRecencyEntries === 0
      && outOfRangeIndices === 0
      && duplicateFreeEntries === 0
      && stalePriorityEntries === 0
      && this.uniquePhysicalOwners() === residentCount;
    return {
      ok,
      residentCount,
      freeCount,
      slotCount,
      duplicateOwners,
      orphanMovieMappings,
      orphanSlotMappings,
      freeOwnedCollisions,
      duplicateRecencyEntries,
      outOfRangeIndices,
      duplicateFreeEntries,
      stalePriorityEntries,
    };
  }

  /**
   * Transfer a physical index from victim to incoming without touching `free`.
   * The index stays allocated; generation bumps so in-flight uploads for the
   * victim cannot commit into the new owner's layer.
   */
  private evictAndBind(
    victimId: string,
    incomingId: string,
    index: number,
    cls: PosterPriorityClass,
  ): void {
    this.movieToSlot.delete(victimId);
    this.priority.delete(victimId);
    this.removeRecency(victimId);
    this._evictionCount++;
    this.bindNew(incomingId, index, cls);
  }

  private bindNew(movieId: string, index: number, cls: PosterPriorityClass): void {
    this.generation[index]++;
    this.slotMovie[index] = movieId;
    this.movieToSlot.set(movieId, index);
    this.priority.set(movieId, cls);
    this.touch(movieId);
    if (this.movieToSlot.size > this._highWater) this._highWater = this.movieToSlot.size;
  }

  private touch(movieId: string): void {
    this.removeRecency(movieId);
    this.recency.push(movieId);
  }

  private removeRecency(movieId: string): void {
    const at = this.recency.indexOf(movieId);
    if (at >= 0) this.recency.splice(at, 1);
  }

  private pickVictim(incomingCls: PosterPriorityClass): string | null {
    const incomingRank = PRIORITY_RANK[incomingCls];
    let best: { id: string; rank: number; age: number } | null = null;
    for (let i = 0; i < this.recency.length; i++) {
      const id = this.recency[i];
      const rank = PRIORITY_RANK[this.priority.get(id) ?? 'P3'];
      // P2/P3 cannot evict protected P0/P1.
      if (rank <= 1 && incomingRank > 1) continue;
      // Cannot evict a strictly higher-priority resident.
      if (rank < incomingRank) continue;
      // P0 must not evict P0 (and P1 must not evict P1) or critical-ready
      // working-set titles steal slots from each other.
      if (rank === incomingRank && rank <= 1) continue;
      if (!best || rank > best.rank || (rank === best.rank && i < best.age)) {
        best = { id, rank, age: i };
      }
    }
    return best?.id ?? null;
  }
}
