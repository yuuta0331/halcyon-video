// FOCUS activation: selected title first. BASE/NEAR remain visible until ready.
// Stale async results are rejected by lease generation.

import { posterFocusResidency, type FocusLease, type PosterFocusResidency } from './poster-focus-residency.ts';
import { POSTER_FOCUS_HEIGHT, POSTER_FOCUS_WIDTH } from './poster-quality.ts';
import { focusPixelsFromSourceRgba, type FocusDecodeResult } from './poster-focus-decode.ts';

export interface FocusActivateDeps {
  getGlobalIndex(id: string): number;
  isSelected(id: string): boolean;
  sceneGeneration(): number;
  getSourcePixels(id: string): { pixels: Uint8Array; width: number; height: number } | null;
  loadSource(
    id: string,
    onDecoded: (result: FocusDecodeResult) => void,
    onSettled?: () => void,
  ): void;
  queueUpload(run: () => void, movieId: string, generation: number): { accepted: boolean } | void;
  uploadFocus(slot: number, pixels: Uint8Array, width: number, height: number): boolean;
  setActive(slot: number, globalIndex: number): void;
  clearActive(globalIndex: number): void;
  requestRender?: () => void;
  onUploadDeferred?: (movieId: string) => void;
}

function stillOwns(
  lease: FocusLease,
  generation: number,
  deps: FocusActivateDeps,
  residency: PosterFocusResidency,
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

function finish(
  movieId: string,
  decoded: FocusDecodeResult,
  deps: FocusActivateDeps,
  residency: PosterFocusResidency,
): void {
  const rec = residency.peekRecord(movieId);
  if (!rec) return;
  const lease = rec.lease;
  const generation = rec.sceneGeneration;
  if (decoded.upscaledFromNear) {
    deps.clearActive(rec.globalIndex);
    residency.release(movieId);
    return;
  }
  if (decoded.decodeWidth < POSTER_FOCUS_WIDTH && !decoded.nativeLimited) {
    deps.clearActive(rec.globalIndex);
    residency.release(movieId);
    return;
  }
  if (rec.uploadInFlight) return;
  rec.uploadInFlight = true;
  residency.markPendingUpload(movieId);
  const admitted = deps.queueUpload(() => {
    rec.uploadInFlight = false;
    if (!stillOwns(lease, generation, deps, residency)) return;
    if (!deps.isSelected(movieId) && residency.selected() !== movieId) {
      deps.clearActive(rec.globalIndex);
      residency.release(movieId);
      return;
    }
    if (!deps.uploadFocus(lease.slot, decoded.pixels, POSTER_FOCUS_WIDTH, POSTER_FOCUS_HEIGHT)) {
      deps.clearActive(rec.globalIndex);
      residency.release(movieId);
      return;
    }
    residency.markReady(movieId, {
      sourceW: decoded.sourceWidth,
      sourceH: decoded.sourceHeight,
      decodeW: decoded.decodeWidth,
      decodeH: decoded.decodeHeight,
    });
    deps.setActive(lease.slot, rec.globalIndex);
    deps.requestRender?.();
  }, movieId, generation);
  if (admitted && admitted.accepted === false) {
    rec.uploadInFlight = false;
    residency.markPendingPixels(movieId);
    deps.onUploadDeferred?.(movieId);
  }
}

export function activateFocusTitle(
  movieId: string,
  deps: FocusActivateDeps,
  residency: PosterFocusResidency = posterFocusResidency,
): void {
  residency.setSelected(movieId);
  const gen = deps.sceneGeneration();
  const existing = residency.peekRecord(movieId);
  if (existing?.phase === 'ready') {
    deps.setActive(existing.lease.slot, existing.globalIndex);
    return;
  }
  if (existing?.loadInFlight || existing?.uploadInFlight) return;
  const got = residency.acquire(movieId, {
    sceneGeneration: gen,
    globalIndex: deps.getGlobalIndex(movieId),
  });
  if (!got) return;
  if (got.evicted) deps.clearActive(deps.getGlobalIndex(got.evicted));
  const rec = got.record;
  rec.sceneGeneration = gen;
  rec.globalIndex = deps.getGlobalIndex(movieId);

  const hit = deps.getSourcePixels(movieId);
  if (hit) {
    finish(movieId, focusPixelsFromSourceRgba(hit.pixels, hit.width, hit.height), deps, residency);
    return;
  }
  rec.loadInFlight = true;
  let done = false;
  deps.loadSource(movieId, (decoded) => {
    if (done) return;
    rec.loadInFlight = false;
    if (!stillOwns(rec.lease, gen, deps, residency)) {
      done = true;
      return;
    }
    done = true;
    finish(movieId, decoded, deps, residency);
  }, () => {
    if (done) return;
    rec.loadInFlight = false;
    deps.clearActive(rec.globalIndex);
    residency.release(movieId);
  });
}

export function demoteFocusTitle(
  movieId: string,
  deps: FocusActivateDeps,
  residency: PosterFocusResidency = posterFocusResidency,
): void {
  const rec = residency.peekRecord(movieId);
  if (!rec) return;
  rec.loadInFlight = false;
  rec.uploadInFlight = false;
  deps.clearActive(rec.globalIndex);
  residency.release(movieId);
}
