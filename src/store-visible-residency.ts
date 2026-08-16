// STORE_VISIBLE_BASE: shelf-visible catalog art that must stay resident for
// one loaded store scene. Player pose / yaw / XR enter-exit must not evict it.

import {
  choosePosterBankLayout,
  stablePosterMapping,
  type PosterBankLayout,
} from './perf/poster-bank-layout.ts';

export type StoreVisibleClass = 'STORE_VISIBLE_BASE' | 'ON_DEMAND';

export interface StoreVisibleMapping {
  bank: number;
  layer: number;
  globalIndex: number;
}

export interface StoreVisibleInvariants {
  ok: boolean;
  expectedCount: number;
  mappedCount: number;
  missingCount: number;
  duplicateOwners: number;
  evictionCount: number;
  reacquisitionCount: number;
}

export class StoreVisibleResidency {
  layout: PosterBankLayout | null = null;
  private mapping = new Map<string, StoreVisibleMapping>();
  private ownerByKey = new Map<string, string>();
  evictionCount = 0;
  reacquisitionCount = 0;
  fallbackCount = 0;
  successfulCount = 0;
  failedRetryCount = 0;

  reset(): void {
    this.layout = null;
    this.mapping.clear();
    this.ownerByKey.clear();
    this.evictionCount = 0;
    this.reacquisitionCount = 0;
    this.fallbackCount = 0;
    this.successfulCount = 0;
    this.failedRetryCount = 0;
  }

  bindCatalog(
    movieIds: Iterable<string>,
    caps: { maxArrayTextureLayers: number },
    gpuBudgetBytes?: number,
  ): PosterBankLayout {
    const ids = [...new Set(movieIds)];
    this.layout = choosePosterBankLayout({
      uniqueTitles: ids.length,
      maxArrayTextureLayers: caps.maxArrayTextureLayers,
      gpuBudgetBytes,
    });
    const next = stablePosterMapping(ids, this.layout.layersPerBank);
    this.mapping = next;
    this.ownerByKey.clear();
    for (const [id, rec] of next) {
      this.ownerByKey.set(`${rec.bank}:${rec.layer}`, id);
    }
    return this.layout;
  }

  peek(movieId: string): StoreVisibleMapping | null {
    return this.mapping.get(movieId) ?? null;
  }

  expectedIds(): string[] {
    return [...this.mapping.keys()].sort();
  }

  get expectedCount(): number {
    return this.mapping.size;
  }

  /** Pose / selection / XR transitions must not call this for STORE_VISIBLE_BASE. */
  noteIllegalEviction(): void {
    this.evictionCount++;
  }

  noteIllegalReacquisition(): void {
    this.reacquisitionCount++;
  }

  noteSuccess(): void {
    this.successfulCount++;
  }

  noteFallback(): void {
    this.fallbackCount++;
  }

  noteFailedRetry(): void {
    this.failedRetryCount++;
  }

  mappingsUnchanged(previous: Map<string, StoreVisibleMapping>): boolean {
    if (previous.size !== this.mapping.size) return false;
    for (const [id, rec] of this.mapping) {
      const old = previous.get(id);
      if (!old) return false;
      if (old.bank !== rec.bank || old.layer !== rec.layer || old.globalIndex !== rec.globalIndex) {
        return false;
      }
    }
    return true;
  }

  cloneMappings(): Map<string, StoreVisibleMapping> {
    return new Map(this.mapping);
  }

  validate(): StoreVisibleInvariants {
    const seen = new Set<string>();
    let duplicateOwners = 0;
    for (const rec of this.mapping.values()) {
      const key = `${rec.bank}:${rec.layer}`;
      if (seen.has(key)) duplicateOwners++;
      else seen.add(key);
    }
    return {
      ok: duplicateOwners === 0 && this.evictionCount === 0,
      expectedCount: this.mapping.size,
      mappedCount: this.mapping.size,
      missingCount: 0,
      duplicateOwners,
      evictionCount: this.evictionCount,
      reacquisitionCount: this.reacquisitionCount,
    };
  }
}

export const storeVisibleResidency = new StoreVisibleResidency();
