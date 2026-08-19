// Dedicated FOCUS 2D textures. No array, no CPU mip chain, catalog-independent.

import * as THREE from 'three';
import {
  POSTER_FOCUS_HEIGHT,
  POSTER_FOCUS_SLOT_LIMIT,
  POSTER_FOCUS_WIDTH,
} from './poster-quality.ts';
import { posterFocusResidency } from './poster-focus-residency.ts';
import { noteGpuSubmit, noteScheduledUpload } from './perf/xr-upload-metrics.ts';
import { pixelStorei, withRestoredGlTextureState } from './xr/gl-state.ts';

let textures: Array<THREE.DataTexture | null> = [];
let dummy: THREE.DataTexture | null = null;
let activeSlot = -1;
let activeIndex = -1;
let creates = 0;
let disposals = 0;
let uploadState = {
  status: 'idle' as 'idle' | 'uploading' | 'complete' | 'cancelled' | 'failed',
  slot: -1,
  bytesTotal: 0,
  bytesUploaded: 0,
  chunksTotal: 0,
  chunksComplete: 0,
  submitMs: 0,
  lastError: null as string | null,
  uploadId: 0,
};
let nextUploadId = 1;

export interface PosterFocusUploadTask {
  runChunk(): { done: boolean; progress: number; bytesUploaded: number };
  cancel(): void;
  snapshot(): typeof uploadState;
}

function ensureDummy(): THREE.DataTexture {
  if (dummy) return dummy;
  dummy = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  dummy.format = THREE.RGBAFormat;
  dummy.type = THREE.UnsignedByteType;
  dummy.colorSpace = THREE.SRGBColorSpace;
  dummy.minFilter = THREE.LinearFilter;
  dummy.magFilter = THREE.LinearFilter;
  dummy.generateMipmaps = false;
  dummy.needsUpdate = true;
  return dummy;
}

export function initPosterFocusGpu(opts: {
  slotLimit?: number;
  width?: number;
  height?: number;
  renderer?: THREE.WebGLRenderer;
} = {}): void {
  disposePosterFocusGpu();
  const slots = Math.max(1, Math.min(4, opts.slotLimit ?? POSTER_FOCUS_SLOT_LIMIT));
  const w = opts.width ?? POSTER_FOCUS_WIDTH;
  const h = opts.height ?? POSTER_FOCUS_HEIGHT;
  textures = Array.from({ length: slots }, () => {
    const tex = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.flipY = false;
    tex.needsUpdate = true;
    creates++;
    // Pay immutable allocation + zero-fill during tier initialization, before
    // a poster is selected. Later FOCUS transitions use row texSubImage2D.
    if (opts.renderer) {
      try { opts.renderer.initTexture(tex); } catch { /* context may not be ready */ }
    }
    return tex;
  });
  uploadState = { status: 'idle', slot: -1, bytesTotal: 0, bytesUploaded: 0,
    chunksTotal: 0, chunksComplete: 0, submitMs: 0, lastError: null, uploadId: 0 };
  posterFocusResidency.reset();
}

export function disposePosterFocusGpu(): void {
  for (const tex of textures) {
    tex?.dispose();
    if (tex) disposals++;
  }
  textures = [];
  activeSlot = -1;
  activeIndex = -1;
  posterFocusResidency.reset();
}

export function getPosterFocusTexture(slot?: number): THREE.DataTexture {
  if (slot == null) {
    if (activeSlot >= 0 && textures[activeSlot]) return textures[activeSlot]!;
    return ensureDummy();
  }
  return textures[slot] ?? ensureDummy();
}

export function posterFocusActiveIndex(): number {
  return activeIndex;
}

export function posterFocusActive(): boolean {
  return activeIndex >= 0 && activeSlot >= 0;
}

export function setPosterFocusActive(slot: number, globalIndex: number): void {
  activeSlot = slot;
  activeIndex = globalIndex;
}

export function clearPosterFocusActive(): void {
  activeSlot = -1;
  activeIndex = -1;
}

export function uploadPosterFocusTexture(
  slot: number,
  pixels: Uint8Array,
  width = POSTER_FOCUS_WIDTH,
  height = POSTER_FOCUS_HEIGHT,
): boolean {
  const tex = textures[slot];
  if (!tex) return false;
  const need = width * height * 4;
  if (pixels.length < need) return false;
  const data = tex.image.data as Uint8Array;
  const n = Math.min(data.length, need);
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  data.set(pixels.subarray(0, n));
  tex.needsUpdate = true;
  const preparationMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  noteScheduledUpload({ textures: 1, bytes: n, preparationMs });
  return true;
}

/**
 * Actual GPU-owned FOCUS transfer. Each runChunk performs one measured raw
 * texSubImage2D inside the existing texture-upload queue; activation is left to
 * the caller and must happen only after `done`.
 */
export function createPosterFocusUploadTask(
  renderer: THREE.WebGLRenderer,
  slot: number,
  pixels: Uint8Array,
  width = POSTER_FOCUS_WIDTH,
  height = POSTER_FOCUS_HEIGHT,
  rowsPerChunk = 64,
): PosterFocusUploadTask | null {
  const tex = textures[slot];
  const need = width * height * 4;
  if (!tex || pixels.length < need || tex.image.width !== width || tex.image.height !== height) return null;
  try { renderer.initTexture(tex); } catch { return null; }
  const props = renderer.properties.get(tex) as { __webglTexture?: WebGLTexture } | undefined;
  const webglTexture = props?.__webglTexture;
  if (!webglTexture) return null;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const rows = Math.max(1, Math.min(height, Math.floor(rowsPerChunk)));
  let y = 0;
  let cancelled = false;
  const uploadId = nextUploadId++;
  uploadState = {
    status: 'uploading', slot, bytesTotal: need, bytesUploaded: 0,
    chunksTotal: Math.ceil(height / rows), chunksComplete: 0, submitMs: 0, lastError: null, uploadId,
  };

  const task: PosterFocusUploadTask = {
    runChunk() {
      if (uploadState.uploadId !== uploadId) throw new Error('stale FOCUS upload task');
      if (cancelled || uploadState.status === 'cancelled') {
        return { done: true, progress: 0, bytesUploaded: uploadState.bytesUploaded };
      }
      if (y >= height) return { done: true, progress: 1, bytesUploaded: need };
      const count = Math.min(rows, height - y);
      const start = y * width * 4;
      const end = start + count * width * 4;
      const chunk = pixels.subarray(start, end);
      const cpu = tex.image.data as Uint8Array;
      cpu.set(chunk, start);
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      const result = withRestoredGlTextureState(gl, () => {
        gl.bindTexture(gl.TEXTURE_2D, webglTexture);
        pixelStorei(renderer, gl, gl.UNPACK_FLIP_Y_WEBGL, 0);
        pixelStorei(renderer, gl, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        pixelStorei(renderer, gl, gl.UNPACK_ALIGNMENT, 1);
        pixelStorei(renderer, gl, gl.UNPACK_ROW_LENGTH, 0);
        pixelStorei(renderer, gl, gl.UNPACK_SKIP_ROWS, 0);
        pixelStorei(renderer, gl, gl.UNPACK_SKIP_PIXELS, 0);
        gl.texSubImage2D(
          gl.TEXTURE_2D, 0, 0, y, width, count,
          gl.RGBA, gl.UNSIGNED_BYTE, chunk,
        );
      }, renderer);
      const durationMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
      if (!result.ok) {
        uploadState.status = 'failed';
        uploadState.lastError = result.error;
        throw new Error(result.error ?? 'FOCUS texSubImage2D failed');
      }
      y += count;
      uploadState.bytesUploaded += chunk.byteLength;
      uploadState.chunksComplete++;
      uploadState.submitMs += durationMs;
      noteGpuSubmit({ durationMs, texSubImageCalls: 1, bytes: chunk.byteLength });
      const done = y >= height;
      if (done) uploadState.status = 'complete';
      return { done, progress: y / height, bytesUploaded: uploadState.bytesUploaded };
    },
    cancel() {
      cancelled = true;
      if (uploadState.uploadId === uploadId && uploadState.status === 'uploading') uploadState.status = 'cancelled';
    },
    snapshot() { return { ...uploadState }; },
  };
  return task;
}

export function bindPosterFocusUniforms(u: {
  posterFocusMap?: { value: THREE.Texture | null };
  posterFocusIndex?: { value: number };
  posterFocusActive?: { value: number };
}): void {
  if (u.posterFocusMap) u.posterFocusMap.value = getPosterFocusTexture();
  if (u.posterFocusIndex) u.posterFocusIndex.value = activeIndex < 0 ? -1 : activeIndex;
  if (u.posterFocusActive) u.posterFocusActive.value = posterFocusActive() ? 1 : 0;
}

export function posterFocusResourceSnapshot() {
  return {
    ...posterFocusResidency.snapshot(),
    textureCreates: creates,
    textureDisposals: disposals,
    activeIndex,
    activeSlot,
    mipPolicy: 'none',
    array: false,
    upload: {
      ...uploadState,
      progress: uploadState.bytesTotal > 0 ? uploadState.bytesUploaded / uploadState.bytesTotal : 0,
      actualTransferOwnedByBudgetQueue: true,
      timingSemantics: 'CPU_BLOCKING_GL_SUBMIT_NOT_GPU_EXECUTION',
    },
  };
}

export function posterFocusGpuCreates(): number { return creates; }
export function posterFocusGpuDisposals(): number { return disposals; }
