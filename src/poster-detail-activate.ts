// Production DETAIL activation: lease ≠ ready. CPU cache miss schedules the
// canonical posterQueue load. BASE stays visible until LUT promotion.

import {
  posterDetailResidency,
  type PosterDetailResidency,
} from './poster-detail-residency.ts';

export interface DetailMovieRef {
  id: string;
  posterUrl?: string;
}

export interface DetailActivateDeps {
  getMovie(id: string): DetailMovieRef | null;
  getGlobalIndex(id: string): number;
  isDesired(id: string): boolean;
  isSelected(id: string): boolean;
  sceneGeneration(): number;
  getPixels(id: string): Uint8Array | null;
  loadPoster(movie: DetailMovieRef, priority: number, onPixels: (pixels: Uint8Array) => void): void;
  queueUpload(run: () => void, movieId: string, generation: number): void;
  uploadLayer(slot: number, pixels: Uint8Array): boolean;
  setLut(globalIndex: number, slotPlusOne: number): boolean;
  clearLut(globalIndex: number): void;
  requestRender?: () => void;
}

const DETAIL_PIXELS = 320 * 480 * 4;

function wanted(id: string, deps: DetailActivateDeps): boolean {
  return deps.isDesired(id) || deps.isSelected(id);
}

function loadPriority(id: string, deps: DetailActivateDeps): number {
  return deps.isSelected(id) ? 4 : 2;
}

function finishUpload(
  movieId: string,
  pixels: Uint8Array,
  deps: DetailActivateDeps,
  residency: PosterDetailResidency,
): void {
  const rec = residency.peekRecord(movieId);
  if (!rec) return;
  if (pixels.length < DETAIL_PIXELS) return;
  if (rec.uploadInFlight) return;
  rec.uploadInFlight = true;
  residency.markPendingUpload(movieId);
  const lease = rec.lease;
  const generation = rec.sceneGeneration;
  const globalIndex = rec.globalIndex;
  deps.queueUpload(() => {
    rec.uploadInFlight = false;
    if (!residency.isLeaseCurrent(lease)) {
      residency.noteStaleDrop();
      return;
    }
    if (generation !== deps.sceneGeneration()) {
      residency.noteStaleDrop();
      return;
    }
    if (!wanted(movieId, deps)) {
      deps.clearLut(globalIndex);
      residency.release(movieId);
      return;
    }
    if (!deps.uploadLayer(lease.slot, pixels)) return;
    if (!deps.setLut(globalIndex, lease.slot + 1)) return;
    residency.markReady(movieId);
    residency.noteUploaded();
    deps.requestRender?.();
  }, movieId, generation);
}

function startLoad(
  movieId: string,
  deps: DetailActivateDeps,
  residency: PosterDetailResidency,
): void {
  const rec = residency.peekRecord(movieId);
  if (!rec || rec.loadInFlight || rec.phase === 'ready') return;
  const movie = deps.getMovie(movieId);
  if (!movie?.posterUrl) return;
  rec.loadInFlight = true;
  residency.markPendingPixels(movieId);
  const lease = rec.lease;
  const generation = rec.sceneGeneration;
  deps.loadPoster(movie, loadPriority(movieId, deps), (pixels) => {
    rec.loadInFlight = false;
    if (!residency.isLeaseCurrent(lease)) {
      residency.noteStaleDrop();
      return;
    }
    if (generation !== deps.sceneGeneration()) {
      residency.noteStaleDrop();
      return;
    }
    if (!wanted(movieId, deps)) {
      deps.clearLut(rec.globalIndex);
      residency.release(movieId);
      return;
    }
    residency.noteDecoded();
    finishUpload(movieId, pixels, deps, residency);
  });
}

export function activateDetailTitle(
  movieId: string,
  deps: DetailActivateDeps,
  residency: PosterDetailResidency = posterDetailResidency,
): void {
  if (!wanted(movieId, deps)) return;
  const existing = residency.peekRecord(movieId);
  if (existing?.phase === 'ready') return;
  if (existing?.loadInFlight || existing?.uploadInFlight) return;

  const pixelsHit = deps.getPixels(movieId);
  const movie = deps.getMovie(movieId);
  if (!pixelsHit && !movie?.posterUrl) return;

  if (!existing) residency.request(movieId);
  const got = residency.acquire(movieId, {
    sceneGeneration: deps.sceneGeneration(),
    globalIndex: deps.getGlobalIndex(movieId),
  });
  if (!got) return;
  if (got.evicted) {
    const prev = got.evicted;
    // Caller maps evicted id → globalIndex via getGlobalIndex.
    deps.clearLut(deps.getGlobalIndex(prev));
  }
  const rec = got.record;
  rec.sceneGeneration = deps.sceneGeneration();
  rec.globalIndex = deps.getGlobalIndex(movieId);

  if (pixelsHit && pixelsHit.length >= DETAIL_PIXELS) {
    if (existing?.phase !== 'pendingUpload') residency.noteDecoded();
    finishUpload(movieId, pixelsHit, deps, residency);
    return;
  }
  startLoad(movieId, deps, residency);
}

export function demoteDetailTitle(
  movieId: string,
  deps: DetailActivateDeps,
  residency: PosterDetailResidency = posterDetailResidency,
): void {
  const rec = residency.peekRecord(movieId);
  if (!rec) return;
  deps.clearLut(rec.globalIndex);
  residency.release(movieId);
}
