// Bounded XR_SAFE poster residency. Catalog IDs are logical; only a small
// physical window is resident in the shelf DataArrayTexture.

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

export class PosterResidencyWindow {
  readonly slots: number;
  private readonly slotMovie: Array<string | null>;
  private readonly movieToSlot = new Map<string, number>();
  private readonly priority = new Map<string, PosterPriorityClass>();
  private readonly recency: string[] = [];
  private free: number[] = [];

  constructor(slots: number) {
    this.slots = Math.max(1, slots);
    this.slotMovie = Array.from({ length: this.slots }, () => null);
    this.free = Array.from({ length: this.slots }, (_, i) => this.slots - 1 - i);
  }

  get residentCount(): number {
    return this.movieToSlot.size;
  }

  peek(movieId: string): number | null {
    const idx = this.movieToSlot.get(movieId);
    return idx === undefined ? null : idx;
  }

  notePriority(movieId: string, cls: PosterPriorityClass): void {
    this.priority.set(movieId, cls);
  }

  acquire(
    movieId: string,
    cls: PosterPriorityClass = 'P2',
  ): { index: number; evicted: string | null; ok: boolean } {
    this.priority.set(movieId, cls);
    const existing = this.movieToSlot.get(movieId);
    if (existing !== undefined) {
      this.touch(movieId);
      return { index: existing, evicted: null, ok: true };
    }
    const free = this.free.pop();
    if (free !== undefined) {
      this.bind(movieId, free);
      return { index: free, evicted: null, ok: true };
    }
    const victim = this.pickVictim(movieId);
    if (victim == null) {
      return { index: 0, evicted: null, ok: false };
    }
    const index = this.movieToSlot.get(victim)!;
    this.release(victim);
    this.bind(movieId, index);
    return { index, evicted: victim, ok: true };
  }

  release(movieId: string): number | null {
    const idx = this.movieToSlot.get(movieId);
    if (idx === undefined) return null;
    this.movieToSlot.delete(movieId);
    this.slotMovie[idx] = null;
    this.free.push(idx);
    const at = this.recency.indexOf(movieId);
    if (at >= 0) this.recency.splice(at, 1);
    return idx;
  }

  private bind(movieId: string, index: number): void {
    this.slotMovie[index] = movieId;
    this.movieToSlot.set(movieId, index);
    this.touch(movieId);
  }

  private touch(movieId: string): void {
    const at = this.recency.indexOf(movieId);
    if (at >= 0) this.recency.splice(at, 1);
    this.recency.push(movieId);
  }

  private pickVictim(incoming: string): string | null {
    const incomingRank = PRIORITY_RANK[this.priority.get(incoming) ?? 'P3'];
    let best: { id: string; rank: number; age: number } | null = null;
    for (let i = 0; i < this.recency.length; i++) {
      const id = this.recency[i];
      if (id === incoming) continue;
      const rank = PRIORITY_RANK[this.priority.get(id) ?? 'P3'];
      if (rank <= 1 && incomingRank > 1) continue;
      if (rank < incomingRank) continue;
      if (!best || rank > best.rank || (rank === best.rank && i < best.age)) {
        best = { id, rank, age: i };
      }
    }
    if (!best) {
      if (incomingRank <= 1) {
        return this.recency[0] && this.recency[0] !== incoming ? this.recency[0] : null;
      }
      return null;
    }
    return best.id;
  }
}
