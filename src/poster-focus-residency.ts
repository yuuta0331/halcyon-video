// Bounded FOCUS residency. Independent of catalog size. BASE/NEAR stay visible.

export const FOCUS_SLOT_LIMIT = 2;

export type FocusPhase = 'pendingPixels' | 'pendingUpload' | 'ready';

export interface FocusLease {
  movieId: string;
  slot: number;
  generation: number;
}

export interface FocusRecord {
  lease: FocusLease;
  phase: FocusPhase;
  globalIndex: number;
  sceneGeneration: number;
  loadInFlight: boolean;
  uploadInFlight: boolean;
  sourceWidth: number;
  sourceHeight: number;
  decodeWidth: number;
  decodeHeight: number;
}

export interface FocusStats {
  slotLimit: number;
  resident: number;
  readyResident: number;
  pendingPixels: number;
  pendingUpload: number;
  promoted: number;
  demoted: number;
  evicted: number;
  staleDropped: number;
  selectedId: string | null;
  width: number;
  height: number;
}

export class PosterFocusResidency {
  readonly slotLimit: number;
  readonly width: number;
  readonly height: number;
  private readonly owners: Array<string | null>;
  private readonly records = new Map<string, FocusRecord>();
  private generation = 1;
  private promoted = 0;
  private demoted = 0;
  private evicted = 0;
  private staleDropped = 0;
  private selectedId: string | null = null;

  constructor(slotLimit = FOCUS_SLOT_LIMIT, width = 640, height = 960) {
    this.slotLimit = Math.max(1, Math.min(4, Math.floor(slotLimit)));
    this.width = width;
    this.height = height;
    this.owners = Array.from({ length: this.slotLimit }, () => null);
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
  }

  selected(): string | null {
    return this.selectedId;
  }

  peek(movieId: string): FocusLease | null {
    return this.records.get(movieId)?.lease ?? null;
  }

  peekRecord(movieId: string): FocusRecord | null {
    return this.records.get(movieId) ?? null;
  }

  isReady(movieId: string): boolean {
    return this.records.get(movieId)?.phase === 'ready';
  }

  isLeaseCurrent(lease: FocusLease): boolean {
    const live = this.records.get(lease.movieId);
    return !!live
      && live.lease.slot === lease.slot
      && live.lease.generation === lease.generation;
  }

  noteStaleDrop(): void {
    this.staleDropped++;
  }

  acquire(
    movieId: string,
    opts: { sceneGeneration?: number; globalIndex?: number } = {},
  ): { lease: FocusLease; evicted: string | null; record: FocusRecord } | null {
    const existing = this.records.get(movieId);
    if (existing) {
      if (opts.globalIndex != null) existing.globalIndex = opts.globalIndex;
      if (opts.sceneGeneration != null) existing.sceneGeneration = opts.sceneGeneration;
      return { lease: existing.lease, evicted: null, record: existing };
    }
    let slot = this.owners.indexOf(null);
    let evicted: string | null = null;
    if (slot < 0) {
      slot = this.pickVictim(movieId);
      if (slot < 0) return null;
      evicted = this.owners[slot];
      if (evicted) this.releaseSlot(slot, 'evict');
    }
    this.generation++;
    const lease: FocusLease = { movieId, slot, generation: this.generation };
    this.owners[slot] = movieId;
    const record: FocusRecord = {
      lease,
      phase: 'pendingPixels',
      globalIndex: opts.globalIndex ?? 0,
      sceneGeneration: opts.sceneGeneration ?? 0,
      loadInFlight: false,
      uploadInFlight: false,
      sourceWidth: 0,
      sourceHeight: 0,
      decodeWidth: this.width,
      decodeHeight: this.height,
    };
    this.records.set(movieId, record);
    this.promoted++;
    return { lease, evicted, record };
  }

  release(movieId: string): boolean {
    const live = this.records.get(movieId);
    if (!live) return false;
    this.releaseSlot(live.lease.slot, 'demote');
    return true;
  }

  markReady(movieId: string, dims?: { sourceW: number; sourceH: number; decodeW: number; decodeH: number }): boolean {
    const rec = this.records.get(movieId);
    if (!rec) return false;
    rec.phase = 'ready';
    rec.loadInFlight = false;
    rec.uploadInFlight = false;
    if (dims) {
      rec.sourceWidth = dims.sourceW;
      rec.sourceHeight = dims.sourceH;
      rec.decodeWidth = dims.decodeW;
      rec.decodeHeight = dims.decodeH;
    }
    return true;
  }

  markPendingPixels(movieId: string): void {
    const rec = this.records.get(movieId);
    if (rec && rec.phase !== 'ready') rec.phase = 'pendingPixels';
  }

  markPendingUpload(movieId: string): void {
    const rec = this.records.get(movieId);
    if (rec && rec.phase !== 'ready') rec.phase = 'pendingUpload';
  }

  reset(): void {
    this.records.clear();
    this.owners.fill(null);
    this.generation = 1;
    this.promoted = 0;
    this.demoted = 0;
    this.evicted = 0;
    this.staleDropped = 0;
    this.selectedId = null;
  }

  residentIds(): string[] {
    return [...this.records.keys()];
  }

  snapshot(): FocusStats {
    let pendingPixels = 0;
    let pendingUpload = 0;
    let readyResident = 0;
    for (const rec of this.records.values()) {
      if (rec.phase === 'pendingPixels') pendingPixels++;
      else if (rec.phase === 'pendingUpload') pendingUpload++;
      else if (rec.phase === 'ready') readyResident++;
    }
    return {
      slotLimit: this.slotLimit,
      resident: this.records.size,
      readyResident,
      pendingPixels,
      pendingUpload,
      promoted: this.promoted,
      demoted: this.demoted,
      evicted: this.evicted,
      staleDropped: this.staleDropped,
      selectedId: this.selectedId,
      width: this.width,
      height: this.height,
    };
  }

  private pickVictim(keepId: string): number {
    for (let i = this.owners.length - 1; i >= 0; i--) {
      const id = this.owners[i];
      if (id && id !== keepId && id !== this.selectedId) return i;
    }
    for (let i = this.owners.length - 1; i >= 0; i--) {
      if (this.owners[i] && this.owners[i] !== keepId) return i;
    }
    return -1;
  }

  private releaseSlot(slot: number, why: 'evict' | 'demote'): void {
    const id = this.owners[slot];
    if (!id) return;
    this.records.delete(id);
    this.owners[slot] = null;
    if (why === 'evict') this.evicted++;
    else this.demoted++;
  }
}

export const posterFocusResidency = new PosterFocusResidency();
