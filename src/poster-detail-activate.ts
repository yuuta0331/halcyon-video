// Production DETAIL activation: lease ≠ ready. CPU cache miss schedules the
// canonical posterQueue load. BASE stays visible until LUT promotion.
// Terminal load/upload/LUT failure MUST release the lease; it must not remain
// pendingPixels/loadInFlight forever.

import {
  posterDetailResidency,
  type PosterDetailLease,
  type PosterDetailResidency,
} from './poster-detail-residency.ts';
import { DetailRetryBook, posterDetailRetry } from './poster-detail-retry.ts';

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
  loadPoster(
    movie: DetailMovieRef,
    priority: number,
    onPixels: (pixels: Uint8Array) => void,
    onSettled?: () => void,
  ): void;
  queueUpload(run: () => void, movieId: string, generation: number): void;
  uploadLayer(slot: number, pixels: Uint8Array): boolean;
  setLut(globalIndex: number, slotPlusOne: number): boolean;
  clearLut(globalIndex: number): void;
  requestRender?: () => void;
  now?: () => number;
}

export const DETAIL_PIXEL_BYTES = 320 * 480 * 4;

function wanted(id: string, deps: DetailActivateDeps): boolean {
  return deps.isDesired(id) || deps.isSelected(id);
}

function loadPriority(id: string, deps: DetailActivateDeps): number {
  return deps.isSelected(id) ? 4 : 2;
}

function clock(deps: DetailActivateDeps): number {
  return deps.now?.() ?? Date.now();
}

function requestStillOwns(
  _movieId: string,
  lease: PosterDetailLease,
  generation: number,
  deps: DetailActivateDeps,
  residency: PosterDetailResidency,
): boolean {
  if (!residency.isLeaseCurrent(lease)) {
    residency.noteStaleDrop();
    return false;
  }
  if (generation !== deps.sceneGeneration()) {
    residency.noteStaleDrop();
    return false;
  }
  return true;
}

function settleFailure(
  movieId: string,
  lease: PosterDetailLease,
  generation: number,
  globalIndex: number,
  deps: DetailActivateDeps,
  residency: PosterDetailResidency,
  retry: DetailRetryBook,
  why: 'load' | 'upload' | 'lut' | 'malformed',
): void {
  if (!requestStillOwns(movieId, lease, generation, deps, residency)) return;
  const rec = residency.peekRecord(movieId);
  if (rec) {
    rec.loadInFlight = false;
    rec.uploadInFlight = false;
  }
  deps.clearLut(globalIndex);
  residency.release(movieId);
  if (why === 'upload') residency.noteUploadFailed();
  else if (why === 'lut') residency.noteLutFailed();
  else if (why === 'malformed') residency.noteMalformed();
  else residency.noteLoadFailed();
  retry.noteFailure(movieId, generation, clock(deps));
}

function finishUpload(
  movieId: string,
  pixels: Uint8Array,
  deps: DetailActivateDeps,
  residency: PosterDetailResidency,
  retry: DetailRetryBook,
): void {
  const rec = residency.peekRecord(movieId);
  if (!rec) return;
  const lease = rec.lease;
  const generation = rec.sceneGeneration;
  const globalIndex = rec.globalIndex;
  if (pixels.length < DETAIL_PIXEL_BYTES) {
    settleFailure(movieId, lease, generation, globalIndex, deps, residency, retry, 'malformed');
    return;
  }
  if (rec.uploadInFlight) return;
  rec.uploadInFlight = true;
  residency.markPendingUpload(movieId);
  deps.queueUpload(() => {
    rec.uploadInFlight = false;
    if (!requestStillOwns(movieId, lease, generation, deps, residency)) return;
    if (!wanted(movieId, deps)) {
      deps.clearLut(globalIndex);
      residency.release(movieId);
      return;
    }
    if (!deps.uploadLayer(lease.slot, pixels)) {
      settleFailure(movieId, lease, generation, globalIndex, deps, residency, retry, 'upload');
      return;
    }
    if (!deps.setLut(globalIndex, lease.slot + 1)) {
      settleFailure(movieId, lease, generation, globalIndex, deps, residency, retry, 'lut');
      return;
    }
    residency.markReady(movieId);
    residency.noteUploaded();
    retry.noteSuccess(movieId);
    deps.requestRender?.();
  }, movieId, generation);
}

function startLoad(
  movieId: string,
  deps: DetailActivateDeps,
  residency: PosterDetailResidency,
  retry: DetailRetryBook,
): void {
  const rec = residency.peekRecord(movieId);
  if (!rec || rec.loadInFlight || rec.phase === 'ready') return;
  const movie = deps.getMovie(movieId);
  const lease = rec.lease;
  const generation = rec.sceneGeneration;
  const globalIndex = rec.globalIndex;
  if (!movie?.posterUrl) {
    settleFailure(movieId, lease, generation, globalIndex, deps, residency, retry, 'load');
    retry.exhaust(movieId, generation);
    return;
  }
  rec.loadInFlight = true;
  residency.markPendingPixels(movieId);
  let gotUsablePixels = false;
  let failed = false;
  deps.loadPoster(movie, loadPriority(movieId, deps), (pixels) => {
    if (failed) return;
    rec.loadInFlight = false;
    if (!requestStillOwns(movieId, lease, generation, deps, residency)) {
      failed = true;
      return;
    }
    if (!wanted(movieId, deps)) {
      failed = true;
      deps.clearLut(globalIndex);
      residency.release(movieId);
      return;
    }
    if (pixels.length < DETAIL_PIXEL_BYTES) {
      failed = true;
      settleFailure(movieId, lease, generation, globalIndex, deps, residency, retry, 'malformed');
      return;
    }
    gotUsablePixels = true;
    residency.noteDecoded();
    finishUpload(movieId, pixels, deps, residency, retry);
  }, () => {
    if (gotUsablePixels || failed) return;
    rec.loadInFlight = false;
    settleFailure(movieId, lease, generation, globalIndex, deps, residency, retry, 'load');
  });
}

export function activateDetailTitle(
  movieId: string,
  deps: DetailActivateDeps,
  residency: PosterDetailResidency = posterDetailResidency,
  retry: DetailRetryBook = posterDetailRetry,
): void {
  if (!wanted(movieId, deps)) return;
  const gen = deps.sceneGeneration();
  const now = clock(deps);
  if (!retry.canAttempt(movieId, gen, now)) return;
  const existing = residency.peekRecord(movieId);
  if (existing?.phase === 'ready') return;
  if (existing?.loadInFlight || existing?.uploadInFlight) return;

  const pixelsHit = deps.getPixels(movieId);
  const movie = deps.getMovie(movieId);
  if (!pixelsHit && !movie?.posterUrl) return;

  if (!existing) residency.request(movieId);
  const got = residency.acquire(movieId, {
    sceneGeneration: gen,
    globalIndex: deps.getGlobalIndex(movieId),
  });
  if (!got) return;
  if (got.evicted) deps.clearLut(deps.getGlobalIndex(got.evicted));
  const rec = got.record;
  rec.sceneGeneration = gen;
  rec.globalIndex = deps.getGlobalIndex(movieId);

  if (pixelsHit && pixelsHit.length >= DETAIL_PIXEL_BYTES) {
    if (existing?.phase !== 'pendingUpload') residency.noteDecoded();
    finishUpload(movieId, pixelsHit, deps, residency, retry);
    return;
  }
  if (pixelsHit && pixelsHit.length < DETAIL_PIXEL_BYTES) {
    settleFailure(movieId, rec.lease, gen, rec.globalIndex, deps, residency, retry, 'malformed');
    return;
  }
  startLoad(movieId, deps, residency, retry);
}

export function demoteDetailTitle(
  movieId: string,
  deps: DetailActivateDeps,
  residency: PosterDetailResidency = posterDetailResidency,
): void {
  const rec = residency.peekRecord(movieId);
  if (!rec) return;
  rec.loadInFlight = false;
  rec.uploadInFlight = false;
  deps.clearLut(rec.globalIndex);
  residency.release(movieId);
}
