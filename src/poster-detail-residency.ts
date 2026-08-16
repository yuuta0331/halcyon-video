// Bounded ON_DEMAND high-resolution poster detail. Does not own BASE
// STORE_VISIBLE_BASE slots. Eviction here never blanks a poster: the shader
// falls back to the stable base layer when the LUT is 0.

export const POSTER_DETAIL_WIDTH = 320;
export const POSTER_DETAIL_HEIGHT = 480;
export const POSTER_DETAIL_SLOT_LIMIT = 64;
export const POSTER_DETAIL_ENTER_FEET = 5.5;
export const POSTER_DETAIL_KEEP_FEET = 8.5;
export const POSTER_DETAIL_MOVE_FEET = 0.55;
export const POSTER_DETAIL_YAW_RAD = 0.18;
export const POSTER_DETAIL_LUT_WIDTH = 2048;

export type PosterDetailPriority = 'selected' | 'near' | 'visible';

export interface PosterDetailLease {
  movieId: string;
  slot: number;
  generation: number;
}

export interface PosterDetailStats {
  requested: number;
  decoded: number;
  uploaded: number;
  resident: number;
  slotLimit: number;
  highWater: number;
  promoted: number;
  demoted: number;
  evicted: number;
  reacquired: number;
  staleDropped: number;
  cpuBytesEstimated: number;
  gpuBytesEstimated: number;
  width: number;
  height: number;
}

const MIP = 4 / 3;

export function estimatePosterDetailBytes(
  slots = POSTER_DETAIL_SLOT_LIMIT,
  w = POSTER_DETAIL_WIDTH,
  h = POSTER_DETAIL_HEIGHT,
): { cpu: number; gpu: number } {
  const cpu = Math.max(0, slots) * w * h * 4;
  return { cpu, gpu: Math.round(cpu * MIP) };
}

export interface DetailCandidate {
  movieId: string;
  x: number;
  z: number;
  globalIndex: number;
}

export function scoreDetailCandidate(
  c: DetailCandidate,
  playerX: number,
  playerZ: number,
  yaw: number,
  selectedId: string | null,
): { dist: number; facing: number; selected: boolean; score: number } {
  const dx = c.x - playerX;
  const dz = c.z - playerZ;
  const dist = Math.hypot(dx, dz);
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const len = dist > 1e-4 ? dist : 1;
  const facing = (dx / len) * forwardX + (dz / len) * forwardZ;
  const selected = selectedId != null && c.movieId === selectedId;
  const score = (selected ? 1_000_000 : 0) + facing * 40 - dist;
  return { dist, facing, selected, score };
}

export function chooseDetailSet(
  candidates: readonly DetailCandidate[],
  opts: {
    playerX: number;
    playerZ: number;
    yaw: number;
    selectedId: string | null;
    resident: ReadonlySet<string>;
    limit: number;
    enterFeet?: number;
    keepFeet?: number;
  },
): string[] {
  const enter = opts.enterFeet ?? POSTER_DETAIL_ENTER_FEET;
  const keep = opts.keepFeet ?? POSTER_DETAIL_KEEP_FEET;
  const ranked: Array<{ id: string; score: number; selected: boolean }> = [];
  for (const c of candidates) {
    const s = scoreDetailCandidate(c, opts.playerX, opts.playerZ, opts.yaw, opts.selectedId);
    const eligible = s.selected
      || s.dist <= enter
      || (opts.resident.has(c.movieId) && s.dist <= keep);
    if (!eligible) continue;
    ranked.push({ id: c.movieId, score: s.score, selected: s.selected });
  }
  ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of ranked) {
    if (out.length >= opts.limit) break;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row.id);
  }
  return out;
}

export class PosterDetailResidency {
  readonly slotLimit: number;
  readonly width: number;
  readonly height: number;
  private readonly owners: Array<string | null>;
  private readonly gens: number[];
  private readonly byMovie = new Map<string, PosterDetailLease>();
  private generation = 1;
  private requested = 0;
  private decoded = 0;
  private uploaded = 0;
  private highWater = 0;
  private promoted = 0;
  private demoted = 0;
  private evicted = 0;
  private reacquired = 0;
  private staleDropped = 0;

  constructor(
    slotLimit = POSTER_DETAIL_SLOT_LIMIT,
    width = POSTER_DETAIL_WIDTH,
    height = POSTER_DETAIL_HEIGHT,
  ) {
    this.slotLimit = Math.max(1, Math.floor(slotLimit));
    this.width = width;
    this.height = height;
    this.owners = Array.from({ length: this.slotLimit }, () => null);
    this.gens = Array.from({ length: this.slotLimit }, () => 0);
  }

  peek(movieId: string): PosterDetailLease | null {
    return this.byMovie.get(movieId) ?? null;
  }

  isLeaseCurrent(lease: PosterDetailLease): boolean {
    const live = this.byMovie.get(lease.movieId);
    return !!live && live.slot === lease.slot && live.generation === lease.generation;
  }

  request(_movieId: string): void {
    this.requested++;
  }

  noteDecoded(): void {
    this.decoded++;
  }

  noteUploaded(): void {
    this.uploaded++;
    if (this.residentCount() > this.highWater) this.highWater = this.residentCount();
  }

  noteStaleDrop(): void {
    this.staleDropped++;
  }

  acquire(movieId: string): { lease: PosterDetailLease; evicted: string | null } | null {
    const existing = this.byMovie.get(movieId);
    if (existing) {
      this.reacquired++;
      return { lease: existing, evicted: null };
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
    const lease: PosterDetailLease = { movieId, slot, generation: this.generation };
    this.owners[slot] = movieId;
    this.gens[slot] = this.generation;
    this.byMovie.set(movieId, lease);
    this.promoted++;
    if (this.residentCount() > this.highWater) this.highWater = this.residentCount();
    return { lease, evicted };
  }

  release(movieId: string): boolean {
    const live = this.byMovie.get(movieId);
    if (!live) return false;
    this.releaseSlot(live.slot, 'demote');
    return true;
  }

  reset(): void {
    this.byMovie.clear();
    this.owners.fill(null);
    this.gens.fill(0);
    this.generation = 1;
    this.requested = 0;
    this.decoded = 0;
    this.uploaded = 0;
    this.highWater = 0;
    this.promoted = 0;
    this.demoted = 0;
    this.evicted = 0;
    this.reacquired = 0;
    this.staleDropped = 0;
  }

  residentIds(): string[] {
    return [...this.byMovie.keys()];
  }

  residentCount(): number {
    return this.byMovie.size;
  }

  snapshot(): PosterDetailStats {
    const bytes = estimatePosterDetailBytes(this.slotLimit, this.width, this.height);
    return {
      requested: this.requested,
      decoded: this.decoded,
      uploaded: this.uploaded,
      resident: this.residentCount(),
      slotLimit: this.slotLimit,
      highWater: this.highWater,
      promoted: this.promoted,
      demoted: this.demoted,
      evicted: this.evicted,
      reacquired: this.reacquired,
      staleDropped: this.staleDropped,
      cpuBytesEstimated: bytes.cpu,
      gpuBytesEstimated: bytes.gpu,
      width: this.width,
      height: this.height,
    };
  }

  private pickVictim(keepId: string): number {
    for (let i = 0; i < this.owners.length; i++) {
      if (this.owners[i] && this.owners[i] !== keepId) return i;
    }
    return -1;
  }

  private releaseSlot(slot: number, why: 'evict' | 'demote'): void {
    const id = this.owners[slot];
    if (!id) return;
    this.byMovie.delete(id);
    this.owners[slot] = null;
    this.gens[slot]++;
    if (why === 'evict') this.evicted++;
    else this.demoted++;
  }
}

export const posterDetailResidency = new PosterDetailResidency();
