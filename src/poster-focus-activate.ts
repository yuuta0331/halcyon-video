// FOCUS activation: selected title first. BASE/NEAR remain visible until ready.
// Stale async results are rejected by lease generation.

import { posterFocusResidency, type FocusLease, type PosterFocusResidency } from './poster-focus-residency.ts';
import { POSTER_FOCUS_HEIGHT, POSTER_FOCUS_WIDTH } from './poster-quality.ts';
import { focusPixelsFromSourceRgba, type FocusDecodeResult } from './poster-focus-decode.ts';
import type { PosterFocusUploadTask } from './poster-focus-texture.ts';

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
  createUploadTask(slot: number, pixels: Uint8Array, width: number, height: number): PosterFocusUploadTask | null;
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
  rec.uploadProgress = 0;
  residency.markPendingUpload(movieId);
  const upload = deps.createUploadTask(
    lease.slot, decoded.pixels, POSTER_FOCUS_WIDTH, POSTER_FOCUS_HEIGHT,
  );
  if (!upload) {
    rec.uploadInFlight = false;
    deps.clearActive(rec.globalIndex);
    residency.release(movieId);
    return;
  }
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const failOrStale = () => {
    if (retryTimer != null) clearTimeout(retryTimer);
    retryTimer = null;
    upload.cancel();
    const live = residency.peekRecord(movieId);
    if (live) live.uploadInFlight = false;
  };
  const queueNext = () => {
    if (!stillOwns(lease, generation, deps, residency)) {
      failOrStale();
      return;
    }
    if (!deps.isSelected(movieId) && residency.selected() !== movieId) {
      failOrStale();
      deps.clearActive(rec.globalIndex);
      residency.release(movieId);
      return;
    }
    const admitted = deps.queueUpload(() => {
      if (!stillOwns(lease, generation, deps, residency)) {
        failOrStale();
        return;
      }
      try {
        const progress = upload.runChunk();
        rec.uploadProgress = progress.progress;
        if (!progress.done) {
          queueNext();
          return;
        }
      } catch {
        failOrStale();
        deps.clearActive(rec.globalIndex);
        residency.release(movieId);
        return;
      }
      rec.uploadInFlight = false;
      residency.markReady(movieId, {
        sourceW: decoded.sourceWidth,
        sourceH: decoded.sourceHeight,
        decodeW: decoded.decodeWidth,
        decodeH: decoded.decodeHeight,
      });
      // The sampler is switched only after the final actual texSubImage2D.
      deps.setActive(lease.slot, rec.globalIndex);
      deps.requestRender?.();
    }, movieId, generation);
    if (admitted && admitted.accepted === false) {
      deps.onUploadDeferred?.(movieId);
      // Capacity retry owns the decoded pixels and does not require head motion
      // or a second network/decode. This timer does not render or add a rAF.
      // HF1 OPTION A: this bounded FOCUS-local timer is what resumes the
      // retained pixels. Queue capacity notifications help DETAIL/FOCUS
      // reconcile, but they do not re-enter activateFocusTitle while
      // uploadInFlight is true.
      retryTimer = setTimeout(() => {
        retryTimer = null;
        queueNext();
      }, 80);
    }
  };
  queueNext();
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
