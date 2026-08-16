// ─── Poster GPU upload pipeline ────────────────────────────────────────────
//
// Everything between "decoded poster pixels exist on the CPU" and "the shelf
// shader can sample them": the budgeted texture-upload queue, the CPU mip-chain
// builder, the raw texSubImage3D layer streamer, and TextureArrayManager — the
// movieId -> array-layer allocator that owns the low/high-res DataArrayTextures
// and the loaded-flags LUT the case shaders read.
//
// Extracted from video-case.ts (file-budget ceiling): that module still owns
// poster DECODE, case art and materials, and re-exports this module's API for
// its existing consumers.
//
// The one dependency pointing back at video-case is the pair of persisted
// global case materials whose compiled uniforms hold the array references —
// injected via setCaseMaterialUniformProvider() rather than imported, so the
// two modules don't form a cycle.

import * as THREE from 'three';
import { perfTrace, perfSlot } from './perf-trace';
import { type PosterPriorityClass } from './perf/store-readiness';
import { activeGpuCapabilities, activeResourceProfile, isXrSafeProfile } from './perf/resource-profile';
import { choosePosterBankLayout, QUEST_SAFE_POSTER_GPU_BUDGET, type PosterBankLayout } from './perf/poster-bank-layout';
import { PosterResidencyWindow, estimatePosterArrayBytes, type PosterLease } from './poster-residency';
import { pixelStorei } from './xr/gl-state';

const SP_UPLOAD = perfSlot('texUploadMs');  // uploadTextureNow (initTexture + mipmaps)
const CT_UPLOAD = perfSlot('texUploadN');
const SP_ARRAYUP = perfSlot('arrayLayerMs'); // texture-array layer streams (all mips, texSubImage3D)
const CT_ARRAYUP = perfSlot('arrayLayerN');

/**
 * Supplies the persisted global case materials (regular + animated fronts)
 * whose `userData.compiledUniformsList` entries hold the array/LUT uniforms.
 * video-case.ts registers this at module load; until then binding is a no-op.
 */
let caseMaterialUniformProvider: (() => any[]) | null = null;
export function setCaseMaterialUniformProvider(fn: () => any[]) {
  caseMaterialUniformProvider = fn;
}

// Two lanes, drained priority-first. Bulk cache-hit re-uploads (a rebuild, or
// walking back onto an already-decoded shelf) go in the normal lane; freshly
// DECODED posters go in the priority lane, because their task is what fires the
// poster's settle callback — and texturesReadyPromise (the boot overlay) waits
// on those. Letting a few hundred fresh decodes sit behind a few thousand
// re-uploads is what held the overlay up for the entire drain.
import {
  beginRebuildDrain,
  notifyUserActivity,
  pendingTextureUploads,
  posterUploadJobsStarted,
  pumpTextureUploads,
  queueTextureUpload,
  resetTextureUploadQueueForTests,
  setUploadTurbo,
} from './perf/texture-upload-queue';

export {
  beginRebuildDrain,
  notifyUserActivity,
  pendingTextureUploads,
  posterUploadJobsStarted,
  pumpTextureUploads,
  queueTextureUpload,
  resetTextureUploadQueueForTests,
  setUploadTurbo,
};

// Poster DataArrayTextures (low/high-res) are mip-mapped for distance LOD, but
// every layer upload goes through raw gl.texSubImage3D (see
// updateTextureArrayLayer) rather than three's normal upload path, so three
// never calls gl.generateMipmap() for us after the first allocation. WebGL has
// no per-layer generateMipmap either — regenerating on the GPU means the WHOLE
// array (hundreds of MB at library scale) per call, a frame-tanking stall that
// used to fire every 2s during a browse-driven streaming wave. Instead each
// layer's mip chain is box-filtered on the CPU (sub-millisecond at 160x240,
// inside the budgeted upload loop) and every level is uploaded explicitly, so
// streaming cost stays proportional to the posters actually streamed and
// gl.generateMipmap is never called after the array's first allocation.
//
// The per-level scratch buffers are shared across uploads (uploads run
// sequentially on the main thread), keyed by level-0 dimensions, so a
// streaming wave allocates nothing per poster.
const mipChainScratch = new Map<string, Array<{ data: Uint8Array; w: number; h: number }>>();

function getMipChainScratch(w: number, h: number): Array<{ data: Uint8Array; w: number; h: number }> {
  const key = `${w}x${h}`;
  let chain = mipChainScratch.get(key);
  if (!chain) {
    chain = [];
    // GL level-n dimensions: max(1, floor(level0 / 2^n)) — matches the mip
    // count three.js sized the texStorage3D allocation with.
    let cw = w, ch = h;
    while (cw > 1 || ch > 1) {
      cw = Math.max(1, cw >> 1);
      ch = Math.max(1, ch >> 1);
      chain.push({ data: new Uint8Array(cw * ch * 4), w: cw, h: ch });
    }
    mipChainScratch.set(key, chain);
  }
  return chain;
}

// 2x2 box filter (clamped at odd edges). Averages in sRGB space — technically
// generateMipmap on an sRGB texture filters in linear space, but at poster
// scale the difference is invisible and the table-free path stays cheap.
function boxFilterHalf(src: Uint8Array, sw: number, sh: number, dst: Uint8Array, dw: number, dh: number) {
  for (let y = 0; y < dh; y++) {
    const r0 = Math.min(y * 2, sh - 1) * sw;
    const r1 = Math.min(y * 2 + 1, sh - 1) * sw;
    for (let x = 0; x < dw; x++) {
      const sx0 = Math.min(x * 2, sw - 1);
      const sx1 = Math.min(x * 2 + 1, sw - 1);
      const a = (r0 + sx0) << 2, b = (r0 + sx1) << 2, c = (r1 + sx0) << 2, d = (r1 + sx1) << 2;
      const o = (y * dw + x) << 2;
      dst[o] = (src[a] + src[b] + src[c] + src[d] + 2) >> 2;
      dst[o + 1] = (src[a + 1] + src[b + 1] + src[c + 1] + src[d + 1] + 2) >> 2;
      dst[o + 2] = (src[a + 2] + src[b + 2] + src[c + 2] + src[d + 2] + 2) >> 2;
      dst[o + 3] = (src[a + 3] + src[b + 3] + src[c + 3] + src[d + 3] + 2) >> 2;
    }
  }
}

// The renderer is registered here so the upload queue can force each texture's
// GPU upload + mipmap generation to happen *synchronously inside the budgeted
// loop* (via initTexture). Without this, three.js defers the upload to the next
// render() call, where all textures flagged that frame upload at once — causing
// the frame hitch we're trying to avoid. With it, the time budget below actually
// measures (and therefore throttles) the real GPU cost.
let uploadRenderer: THREE.WebGLRenderer | null = null;

export function setUploadRenderer(renderer: THREE.WebGLRenderer) {
  uploadRenderer = renderer;
}

/** The renderer uploads are issued against, or null before a scene exists. */
export function getUploadRenderer(): THREE.WebGLRenderer | null {
  return uploadRenderer;
}

// Wake hook for the render-on-demand loop (issue #24): loaded-flag flips land
// in queued upload tasks, possibly after the scene has settled back to IDLE —
// without a nudge the freshly-loaded covers would sit invisible until the
// next input. StoreScene registers requestRender() here.
// Called when a title's art actually becomes samplable (its loaded flag flips),
// as opposed to when it finished DECODING. The two are not the same moment:
// decode fires the poster callback, which re-dirties the slot, but the GPU
// upload is still sitting in the budgeted queue — so the dirty pass can run
// while hasArt() is still false and leave the cover box collapsed with nothing
// scheduled to un-collapse it. Cheap to ignore in the common case (a low-res
// upload lands within a frame or two of the decode); load-bearing at catalog
// scale, where the queue is thousands deep and a title can wait seconds.
let posterLoadedNotify: ((movieId: string) => void) | null = null;
export function setPosterLoadedNotify(cb: ((movieId: string) => void) | null) {
  posterLoadedNotify = cb;
}

let posterIndexNotify: ((movieId: string, index: number) => void) | null = null;
export function setPosterIndexNotify(cb: ((movieId: string, index: number) => void) | null) {
  posterIndexNotify = cb;
}

let textureStreamWake: (() => void) | null = null;
export function setTextureStreamWake(cb: (() => void) | null) {
  textureStreamWake = cb;
}

/**
 * Fire the render-on-demand wake registered above, if any. TextureArrayManager's
 * setFlag() already calls this on every loaded-flag flip; this export lets other
 * CPU-cache-driven material swaps that DON'T go through the texture-array loaded
 * flags — hero/dedicated/fixture cases rebuilt straight from posterPixelCache
 * (video-case.ts's browse-bin loadShelfDetails, person-endcap cases, etc.) — reuse
 * the exact same nudge instead of each threading its own scene/requestRender
 * reference through a module that otherwise has none. Callers that DO have a
 * `scene` handy (store-inspect.ts, store-clerk-flow.ts) just call
 * scene.requestRender() directly, same as every other request in those files.
 */
export function wakeTextureStream() {
  textureStreamWake?.();
}

// Force a texture's GPU upload (and mipmap build) to happen now, so its cost is
// paid inside the budgeted loop rather than during the next scene render.
export function uploadTextureNow(texture: THREE.Texture) {
  if (uploadRenderer) {
    // Best-effort: forcing the upload here is only an optimization to keep the
    // cost inside the throttled loop. If it fails (lost/exhausted GL context),
    // swallow it — three.js will upload the texture normally on the next
    // render(). Letting it throw would abort caching the texture and firing its
    // callbacks, so that movie's cover would never appear.
    perfTrace.count(CT_UPLOAD);
    perfTrace.begin(SP_UPLOAD);
    try {
      uploadRenderer.initTexture(texture);
    } catch (err) {
      console.warn('uploadTextureNow(initTexture) failed; deferring to renderer:', err);
    } finally {
      perfTrace.end(SP_UPLOAD);
    }
  }
}


export function updateTextureArrayLayer(
  renderer: THREE.WebGLRenderer,
  arrayTexture: THREE.DataArrayTexture,
  layerIndex: number,
  pixelData: Uint8Array
) {
  perfTrace.count(CT_ARRAYUP);
  perfTrace.begin(SP_ARRAYUP);
  try {
    updateTextureArrayLayerImpl(renderer, arrayTexture, layerIndex, pixelData);
  } finally {
    perfTrace.end(SP_ARRAYUP);
  }
}

function updateTextureArrayLayerImpl(
  renderer: THREE.WebGLRenderer,
  arrayTexture: THREE.DataArrayTexture,
  layerIndex: number,
  pixelData: Uint8Array
) {
  // Always update the JS memory backing array first!
  // If Three.js hasn't allocated the GPU texture yet, our texSubImage3D call will fail, 
  // but Three.js will use this JS memory when it eventually allocates the texture.
  const layerSize = arrayTexture.image.width * arrayTexture.image.height * 4;
  const byteOffset = layerIndex * layerSize;
  if (arrayTexture.image.data) {
    arrayTexture.image.data.set(pixelData, byteOffset);
  }

  // In Three.js, initTexture() checks if texture.version > 0. If it is 0 (the default),
  // it returns early and does NOT create properties.__webglTexture.
  // Set version to 1 to force initialization.
  if (arrayTexture.version === 0) {
    arrayTexture.version = 1;
  }

  const properties = renderer.properties.get(arrayTexture) as any;
  let webglTexture = properties ? properties.__webglTexture : null;
  if (!webglTexture) {
    renderer.initTexture(arrayTexture);
    webglTexture = properties ? properties.__webglTexture : null;
    if (properties) {
      properties.__storageAllocated = true;
      properties.__version = arrayTexture.version;
    }
  }
  if (!webglTexture) {
    console.warn("Failed to retrieve __webglTexture from renderer properties.");
    return;
  }

  const gl = renderer.getContext() as WebGL2RenderingContext;
  
  // Save unpack parameters that aren't allowed for 3D textures/arrays in WebGL2
  const oldFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
  const oldPremultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);

  pixelStorei(renderer, gl, gl.UNPACK_FLIP_Y_WEBGL, 0);
  pixelStorei(renderer, gl, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);

  // We use the active texture unit, but we MUST tell Three.js to reset its state cache
  // afterwards because we are making raw WebGL calls that Three.js doesn't track.
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, webglTexture);

  try {
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0, // lod level
      0, // xoffset
      0, // yoffset
      layerIndex, // zoffset
      arrayTexture.image.width,
      arrayTexture.image.height,
      1, // depth
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixelData
    );
    // This raw texSubImage3D bypasses three's normal upload path entirely, so
    // three never sees a version bump and never calls gl.generateMipmap() for
    // us — and calling it ourselves would regenerate EVERY layer's mip chain
    // (there is no per-layer generateMipmap in WebGL). Box-filter this layer's
    // chain on the CPU and upload each level explicitly instead; the layer is
    // then renderable at every distance the moment this call returns.
    if (arrayTexture.generateMipmaps) {
      const chain = getMipChainScratch(arrayTexture.image.width, arrayTexture.image.height);
      let src = pixelData;
      let sw = arrayTexture.image.width;
      let sh = arrayTexture.image.height;
      for (let level = 0; level < chain.length; level++) {
        const mip = chain[level];
        boxFilterHalf(src, sw, sh, mip.data, mip.w, mip.h);
        gl.texSubImage3D(
          gl.TEXTURE_2D_ARRAY,
          level + 1,
          0, 0, layerIndex,
          mip.w, mip.h, 1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          mip.data
        );
        src = mip.data;
        sw = mip.w;
        sh = mip.h;
      }
    }
  } catch (err) {
    console.warn("WebGL upload deferred until Three.js allocation.", err);
  }

  pixelStorei(renderer, gl, gl.UNPACK_FLIP_Y_WEBGL, oldFlipY ? 1 : 0);
  pixelStorei(renderer, gl, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, oldPremultiply ? 1 : 0);

  // Restore Three.js state cache so it can re-bind textures correctly
  renderer.resetState();
}

// Scratch reuse: the result is consumed synchronously by texSubImage3D (GL
// copies the pixels during the call), and upload waves used to allocate a
// fresh 150KB buffer per layer — 70-layer waves showed up as multi-MB
// heap spikes followed by GC-pause hitches in perf-trace.
let downsampleScratch: Uint8Array | null = null;
function downsample320To160(src: Uint8Array): Uint8Array {
  return downsampleNearest(src, 320, 480, 160, 240);
}

const shelfScratch = new Map<string, Uint8Array>();
function downsampleNearest(
  src: Uint8Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8Array {
  const key = `${dw}x${dh}`;
  let dst = dw === 160 && dh === 240
    ? (downsampleScratch ??= new Uint8Array(dw * dh * 4))
    : (shelfScratch.get(key) ?? new Uint8Array(dw * dh * 4));
  if (dw !== 160 || dh !== 240) shelfScratch.set(key, dst);
  let dstIdx = 0;
  for (let y = 0; y < dh; y++) {
    const srcY = Math.min(sh - 1, Math.floor((y + 0.5) * sh / dh));
    const srcRow = srcY * sw * 4;
    for (let x = 0; x < dw; x++) {
      const srcX = Math.min(sw - 1, Math.floor((x + 0.5) * sw / dw));
      const srcIdx = srcRow + srcX * 4;
      dst[dstIdx] = src[srcIdx];
      dst[dstIdx + 1] = src[srcIdx + 1];
      dst[dstIdx + 2] = src[srcIdx + 2];
      dst[dstIdx + 3] = src[srcIdx + 3];
      dstIdx += 4;
    }
  }
  return dst;
}

function shelfPixelsFromDecoded(pixelData: Uint8Array, w: number, h: number): Uint8Array {
  if (pixelData.byteLength === w * h * 4) return pixelData;
  if (pixelData.byteLength === 320 * 480 * 4) return downsampleNearest(pixelData, 320, 480, w, h);
  if (pixelData.byteLength === 64 * 96 * 4) return downsampleNearest(pixelData, 64, 96, w, h);
  if (pixelData.byteLength === 160 * 240 * 4) return downsampleNearest(pixelData, 160, 240, w, h);
  return downsampleNearest(pixelData, 320, 480, w, h);
}

// Spare layers allocated beyond the current catalog so TextureArrayManager's
// rebuild fast path survives small catalog churn between rebuilds. Costs
// ~178KB of array-texture backing per layer (64x96 + 160x240, RGBA).
const LAYER_CHURN_HEADROOM = 64;

// ── Layer banking ───────────────────────────────────────────────────────────
// GL_MAX_ARRAY_TEXTURE_LAYERS is a HARD driver ceiling on one array texture —
// 4096 on this store's Radeon, and as low as 256 in the WebGL2 spec. A catalog
// bigger than that used to fail silently in the worst possible way: three's
// texStorage3D call errored, every poster sampled an unallocated array, and the
// whole store rendered as bare rental shells while the console filled with
// "WebGL: too many errors". Measured with a 7.1k-title catalog (games-only mode
// over a full Romm library, which is what made a >4096 catalog reachable at
// all).
//
// The obvious fix — a second pair of sampler2DArrays and a branch — is NOT
// available: the case fragment shader is a MeshPhysicalMaterial in a room full
// of shadow-casting lights and already sits at exactly MAX_TEXTURE_IMAGE_UNITS
// (32 here). Measured, twice: adding two samplers and then even one failed to
// link with "FRAGMENT shader texture image units count exceeds
// MAX_TEXTURE_IMAGE_UNITS(32)", which silently invalidates the program and
// leaves the whole store unpainted. There is zero sampler headroom.
//
// So the two arrays we ALREADY bind become the two banks, and what a title
// spends changes with the catalog's size:
//
//   catalog <= bankSize  — unchanged from before. Every title owns one layer in
//                          BOTH arrays: the 64x96 one paints first while the
//                          160x240 one streams (the progressive tier).
//   catalog >  bankSize  — the tiers split into a flat address space. Titles
//                          below bankSize live in the high-res array, titles
//                          above it in the low-res array (offset by
//                          `lowResBase`). Every title still gets a painted
//                          cover; what's traded away is the progressive tier —
//                          a case simply appears when its art lands — and the
//                          overflow titles' shelf art is 64x96. The INSPECT and
//                          hero views are unaffected either way: those paint
//                          from posterPixelCache at full 320x480, not from
//                          these arrays.
//
// Distance LOD never depended on the tier split — that comes from each array's
// own mip chain. The loaded-flags LUT stays single and globally indexed (a
// plain 2D texture bounded by MAX_TEXTURE_SIZE = 32768, nowhere near binding),
// and its existing 255/128 values are exactly the "which array" signal the
// shader needs.
//
// Ceiling: 2 x bankSize titles (8192 here). Past that a title gets no layer and
// shelves unpainted — see getIndex.
const POSTER_BANKS = 2;
// Fallback bank size when no renderer is on hand to ask (headless/asset-viewer
// paths that allocate before a context exists). 2048 is the smallest layer
// count in real-world WebGL2 use.
const FALLBACK_BANK_LAYERS = 2048;

function maxArrayLayers(renderer?: THREE.WebGLRenderer): number {
  const gl = renderer?.getContext() as WebGL2RenderingContext | undefined;
  const limit = gl?.getParameter?.(gl.MAX_ARRAY_TEXTURE_LAYERS);
  return typeof limit === 'number' && limit > 0 ? limit : FALLBACK_BANK_LAYERS;
}

// Set when the decoded poster pixels themselves become invalid (a medium /
// box-art / cover-scan change re-decodes every poster with different
// letterboxing), so the array layers on hand no longer match the catalog and
// TextureArrayManager.init must genuinely reallocate rather than reuse.
let posterLayersInvalid = true;

/** Force the next TextureArrayManager.init() to reallocate from scratch. */
export function invalidatePosterLayers() {
  posterLayersInvalid = true;
}

function missingCoverPixels(w: number, h: number): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const border = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
      data[i] = border ? 201 : 18;
      data[i + 1] = border ? 162 : 28;
      data[i + 2] = border ? 39 : 46;
      data[i + 3] = 255;
    }
  }
  return data;
}

function allocPosterBank(
  w: number,
  h: number,
  layers: number,
  aniso: number,
): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(new Uint8Array(w * h * layers * 4), w, h, layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  if (aniso) tex.anisotropy = aniso;
  tex.version = 1;
  return tex;
}

class TextureArrayManager {
  private movieToIndex = new Map<string, number>();
  private nextIndex = 0;
  public maxMovies = 0;
  /** Layers per bank — the driver's MAX_ARRAY_TEXTURE_LAYERS (see above). */
  public bankSize = FALLBACK_BANK_LAYERS;
  /**
   * Global index the LOW-RES array starts addressing from. 0 while the catalog
   * fits one bank (both arrays hold every title, the progressive tier); equal
   * to bankSize once it overflows, when the low-res array becomes the second
   * bank rather than the first bank's preview. The shader subtracts it.
   */
  public lowResBase = 0;
  private layerBudgetWarned = false;
  public catalogTitleCount = 0;
  public residencyBound = false;
  public mappingsFrozen = false;
  public bankCount = 1;
  public extraBanks: THREE.DataArrayTexture[] = [];
  public lastLayout: PosterBankLayout | null = null;
  public shelfWidth = 160;
  public shelfHeight = 240;
  private residency: PosterResidencyWindow | null = null;
  private fallbackIds = new Set<string>();
  private moviePriority = new Map<string, PosterPriorityClass>();
  private staleUploadDrops = 0;

  public lowResArray: THREE.DataArrayTexture | null = null;
  public highResArray: THREE.DataArrayTexture | null = null;
  public loadedFlags: Uint8Array | null = null;
  public loadedFlagsTexture: THREE.DataTexture | null = null;

  /** Is this index served by the high-res array (vs. the low-res bank)? */
  private isHighBank(idx: number): boolean {
    return this.lowResBase === 0 || idx < this.bankSize;
  }

  public init(totalMovies: number, renderer?: THREE.WebGLRenderer) {
    // ── Rebuild fast path ────────────────────────────────────────────────
    // A no-reload rebuild (quality/AO/theme/arrangement/render-mode change)
    // constructs a fresh WebGLRenderer, so the GPU-side layers die with the old
    // context — but the decoded PIXELS are untouched, and
    // updateTextureArrayLayerImpl mirrors every layer into image.data as it
    // uploads. So the arrays already carry a complete CPU copy: keep them, keep
    // the movieId->layer map, and keep the uploaded/queued sets, then let the
    // new context re-upload the whole mirror in one three.js texture init.
    //
    // Reallocating instead meant every one of ~3k layers re-streamed through
    // the budgeted upload queue at 4-16/frame, and because a not-yet-cached
    // title fires its settle callback from inside one of those queued tasks,
    // texturesReadyPromise (i.e. the boot overlay) waited on the whole drain —
    // measured at 7.2s of the 9.4s rebuild on a warm cache, plus a further 3.5s
    // of blank cases after the store reappeared.
    //
    // A medium/box-art change genuinely invalidates the pixels; that path calls
    // invalidatePosterLayers() and falls through to the full reallocation.
    const profile = activeResourceProfile();
    const bounded = isXrSafeProfile(profile) && (
      profile.poster.mode === 'bounded-residency' || profile.poster.mode === 'stable-store-visible'
    );
    this.catalogTitleCount = totalMovies;

    const haveArrays = !!(this.lowResArray && this.highResArray && this.loadedFlagsTexture)
      || !!(bounded && this.highResArray && this.loadedFlagsTexture);
    if (haveArrays && !posterLayersInvalid && bounded && this.residency
        && this.maxMovies >= totalMovies && this.mappingsFrozen) {
      const maxAniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 0;
      if (this.highResArray) {
        this.highResArray.needsUpdate = true;
        if (maxAniso) this.highResArray.anisotropy = maxAniso;
      }
      this.loadedFlagsTexture!.needsUpdate = true;
      this.bindUniforms();
      return;
    }
    if (haveArrays && !posterLayersInvalid && !bounded && totalMovies <= this.maxMovies &&
        this.maxMovies - this.nextIndex >= LAYER_CHURN_HEADROOM / 2) {
      // Re-upload the mirrored pixels into the new GL context on first use.
      const maxAniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 0;
      for (const tex of [this.lowResArray!, this.highResArray!]) {
        tex.needsUpdate = true;
        if (maxAniso) tex.anisotropy = maxAniso;
      }
      this.loadedFlagsTexture!.needsUpdate = true;
      this.bindUniforms();
      return;
    }

    // Release the previous allocation before reallocating. Without this, a
    // no-reload scene rebuild leaks the old DataArrayTextures on the GPU every
    // time (they'd fail the 5x-rebuild memory baseline test).
    this.lowResArray?.dispose();
    this.highResArray?.dispose();
    this.loadedFlagsTexture?.dispose();
    for (const bank of this.extraBanks) bank.dispose();
    this.extraBanks = [];

    this.movieToIndex.clear();
    this.nextIndex = 0;
    this.layerBudgetWarned = false;
    this.residency = null;
    this.residencyBound = bounded;
    this.mappingsFrozen = false;
    this.fallbackIds.clear();
    this.moviePriority.clear();
    if (bounded) {
      const capsLayers = activeGpuCapabilities()?.maxArrayTextureLayers ?? maxArrayLayers(renderer);
      const layout = choosePosterBankLayout({
        uniqueTitles: Math.max(1, totalMovies),
        maxArrayTextureLayers: capsLayers,
        gpuBudgetBytes: QUEST_SAFE_POSTER_GPU_BUDGET,
      });
      this.lastLayout = layout;
      this.shelfWidth = layout.width;
      this.shelfHeight = layout.height;
      this.bankSize = layout.layersPerBank;
      this.bankCount = layout.bankCount;
      this.maxMovies = layout.totalLayers;
      this.lowResBase = 0;
      this.residency = new PosterResidencyWindow(this.maxMovies);
      this.staleUploadDrops = 0;
      this.lowResUploaded.clear();
      this.highResQueued.clear();
      posterLayersInvalid = false;
      const aniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 0;
      const depth0 = layout.bankCount <= 1 ? layout.totalLayers : layout.layersPerBank;
      this.highResArray = allocPosterBank(this.shelfWidth, this.shelfHeight, depth0, aniso);
      this.lowResArray = null;
      if (layout.bankCount >= 2) {
        this.lowResArray = allocPosterBank(this.shelfWidth, this.shelfHeight, layout.layersPerBank, aniso);
      }
      for (let b = 2; b < layout.bankCount; b++) {
        this.extraBanks.push(allocPosterBank(this.shelfWidth, this.shelfHeight, layout.layersPerBank, aniso));
      }
      const lutSize = THREE.MathUtils.ceilPowerOfTwo(this.maxMovies);
      this.loadedFlags = new Uint8Array(lutSize);
      this.loadedFlagsTexture = new THREE.DataTexture(
        this.loadedFlags, lutSize, 1, THREE.RedFormat, THREE.UnsignedByteType,
      );
      this.loadedFlagsTexture.minFilter = THREE.NearestFilter;
      this.loadedFlagsTexture.magFilter = THREE.NearestFilter;
      this.loadedFlagsTexture.generateMipmaps = false;
      this.loadedFlagsTexture.needsUpdate = true;
      this.bindUniforms();
      return;
    }
    this.shelfWidth = 160;
    this.shelfHeight = 240;
    // Spare layers so the fast path above survives the small catalog churn a
    // rebuild can introduce (a refreshed discovery/gap list, a games refetch).
    // Without headroom the very first rebuild would find nextIndex == maxMovies
    // and reallocate anyway, and the fast path would never engage.
    this.bankSize = maxArrayLayers(renderer);
    const layerBudget = this.bankSize * POSTER_BANKS;
    this.maxMovies = Math.max(1, Math.min(totalMovies + LAYER_CHURN_HEADROOM, layerBudget));
    // Overflow: the low-res array stops being every title's preview and becomes
    // the second bank (see the POSTER_BANKS note).
    this.lowResBase = this.maxMovies > this.bankSize ? this.bankSize : 0;
    if (totalMovies > layerBudget) {
      // Past the banked budget a title simply gets no layer (see getIndex) and
      // shows as an unpainted case — the same treatment as a title whose art
      // never arrived. Say so loudly; silently blank shelves read as a bug.
      console.warn(
        `[posters] Catalog of ${totalMovies} exceeds the poster layer budget ` +
        `(${POSTER_BANKS} banks x ${this.bankSize} = ${layerBudget}); ` +
        `${totalMovies - layerBudget} title(s) will shelve without cover art.`
      );
    }
    // Fresh arrays hold no pixels yet, so every layer must upload again.
    this.lowResUploaded.clear();
    this.highResQueued.clear();
    posterLayersInvalid = false;

    // Both arrays are mip-mapped for distance LOD (perf #28): distant shelves
    // sampled without mips alias/shimmer and thrash the GPU texture cache.
    // Layers stream in one at a time via raw texSubImage3D (see
    // updateTextureArrayLayer), which uploads every mip level explicitly from
    // CPU-box-filtered pixels — gl.generateMipmap is never called after the
    // first allocation (whole-array regen is a frame-tanking stall). Keep
    // `generateMipmaps` true anyway: three sizes the texStorage3D mip chain
    // from `generateMipmaps` + `minFilter` at allocation time, so flipping it
    // (or setting the mip-capable minFilter after the array is on the GPU)
    // would leave the wrong number of mip levels allocated and posters would
    // render black.

    // Allocate the low-res (64x96) and high-res (160x240) banks. Only as many
    // banks as the catalog needs are built, and the last one is sized to the
    // remainder — a 5k catalog on a 4096-layer driver costs 4096 + 904 layers,
    // not two full banks.
    //
    // Anisotropy on BOTH: the low-res array is bound for the DISTANT shelves —
    // precisely where grazing-angle shimmer is worst — and used to sit at 1
    // while its high-res twin got 8, which made the far cases crawl. Shelf
    // posters are viewed down the aisles, where isotropic mip sampling
    // over-blurs; cap at the driver's max (some report less than 4).
    const aniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 0;
    // High-res covers indices [0, bankSize); low-res covers either the same
    // range (progressive tier) or [bankSize, maxMovies) (second bank).
    this.highResArray = allocPosterBank(160, 240, Math.min(this.bankSize, this.maxMovies), aniso);
    this.lowResArray = allocPosterBank(64, 96, this.lowResBase === 0
      ? this.maxMovies
      : this.maxMovies - this.bankSize, aniso);

    // Allocate loaded flags LUT (1D texture)
    const lutSize = THREE.MathUtils.ceilPowerOfTwo(this.maxMovies);
    this.loadedFlags = new Uint8Array(lutSize);
    this.loadedFlagsTexture = new THREE.DataTexture(
      this.loadedFlags,
      lutSize,
      1,
      THREE.RedFormat,
      THREE.UnsignedByteType
    );
    this.loadedFlagsTexture.minFilter = THREE.NearestFilter;
    this.loadedFlagsTexture.magFilter = THREE.NearestFilter;
    this.loadedFlagsTexture.generateMipmaps = false;
    this.loadedFlagsTexture.needsUpdate = true;

    this.bindUniforms();
  }

  /**
   * Point the persisted global case materials at the current array/LUT objects.
   * Runs on both init paths: after a reallocation the references genuinely
   * changed, and on the rebuild fast path the compiled uniform list belongs to
   * shaders that survived the swap, so re-binding is a cheap no-op that keeps
   * the two paths from drifting.
   */
  private bindUniforms() {
    const updateUniforms = (mat: any) => {
      if (mat && mat.userData.compiledUniformsList) {
        mat.userData.compiledUniformsList.forEach((u: any) => {
          u.lowResMapArray.value = this.lowResArray ?? this.highResArray;
          u.highResMapArray.value = this.highResArray;
          u.shelfMapArray.value = this.highResArray;
          if (u.shelfMapArray1) u.shelfMapArray1.value = this.bankTexture(1) ?? this.highResArray;
          if (u.shelfMapArray2) u.shelfMapArray2.value = this.bankTexture(2) ?? this.highResArray;
          if (u.shelfMapArray3) u.shelfMapArray3.value = this.bankTexture(3) ?? this.highResArray;
          if (u.posterBankSize) u.posterBankSize.value = this.bankSize;
          if (u.posterBankCount) u.posterBankCount.value = this.bankCount;
          u.posterLowResBase.value = this.lowResBase;
          u.highResLoadedTex.value = this.loadedFlagsTexture;
          u.maxMoviesCount.value = this.loadedFlagsTexture ? this.loadedFlagsTexture.image.width : 2048;
        });
      }
    };
    for (const mat of caseMaterialUniformProvider?.() ?? []) updateUniforms(mat);
  }

  public bankTexture(bank: number): THREE.DataArrayTexture | null {
    if (bank <= 0) return this.highResArray;
    if (bank === 1) return this.lowResArray ?? this.highResArray;
    return this.extraBanks[bank - 2] ?? this.highResArray;
  }

  public freezeStableMappings(): void {
    this.mappingsFrozen = true;
  }

  public isFallback(movieId: string): boolean {
    return this.fallbackIds.has(movieId);
  }

  public uploadMissingCoverFallback(movieId: string): void {
    if (!this.residencyBound || !this.residency) {
      if (this.hasArt(movieId)) return;
    }
    const idx = this.getIndex(movieId, !this.mappingsFrozen);
    if (!this.hasLayer(movieId) && this.peekIndex(movieId) == null) return;
    const lease = this.residency?.peekLease(movieId);
    const pixels = missingCoverPixels(this.shelfWidth, this.shelfHeight);
    const renderer = getUploadRenderer();
    if (lease && renderer) this.commitShelfLease(renderer, lease, pixels);
    else if (renderer && this.highResArray) {
      const layerIdx = this.movieToIndex.get(movieId) ?? idx;
      updateTextureArrayLayer(renderer, this.highResArray, layerIdx, pixels);
    }
    this.fallbackIds.add(movieId);
    if (lease) this.setLoadedForLease(lease, 200);
    else this.setHighResLoaded(movieId, true);
  }

  public notePriority(movieId: string, cls: PosterPriorityClass): void {
    this.moviePriority.set(movieId, cls);
    this.residency?.notePriority(movieId, cls);
  }

  public peekIndex(movieId: string): number | null {
    if (this.residency) return this.residency.peek(movieId);
    return this.movieToIndex.get(movieId) ?? null;
  }

  public pin(movieId: string): boolean {
    return this.residency?.pin(movieId) ?? false;
  }

  public unpinAll(): void {
    this.residency?.unpinAll();
  }

  public pinnedCount(): number {
    return this.residency?.pinnedCount ?? 0;
  }

  public residencyResidentCount(): number {
    return this.residency?.residentCount ?? this.movieToIndex.size;
  }

  public residencyWindow(): PosterResidencyWindow | null {
    return this.residency;
  }

  public syncIndexFromResidency(movieId: string): void {
    const idx = this.residency?.peek(movieId);
    if (idx == null) return;
    const prev = this.movieToIndex.get(movieId);
    this.movieToIndex.set(movieId, idx);
    if (prev !== idx) posterIndexNotify?.(movieId, idx);
  }

  public afterWorkingSetEvict(movieId: string): void {
    if (this.mappingsFrozen) return;
    this.afterEvict(movieId);
  }

  public getIndex(movieId: string, acquire = !this.residencyBound): number {
    if (this.residencyBound && this.residency) {
      if (this.mappingsFrozen || !acquire) return this.residency.peek(movieId) ?? 0;
      const cls = this.moviePriority.get(movieId) ?? 'P2';
      const { index, evicted, ok } = this.residency.acquire(movieId, cls);
      if (!ok) return 0;
      if (evicted) this.afterEvict(evicted);
      const prev = this.movieToIndex.get(movieId);
      this.movieToIndex.set(movieId, index);
      if (prev !== index) posterIndexNotify?.(movieId, index);
      this.prunePriorityMeta();
      return index;
    }
    if (this.movieToIndex.has(movieId)) {
      return this.movieToIndex.get(movieId)!;
    }
    // Out of layers: hand back index 0 WITHOUT recording it, so the title
    // never gets a loaded flag, hasArt() stays false, and its cover box is
    // left out of the scene entirely (the same path an art-less title takes)
    // rather than painting some other title's poster onto it.
    if (this.nextIndex >= this.maxMovies) {
      if (!this.layerBudgetWarned) {
        this.layerBudgetWarned = true;
        console.warn(
          `[posters] Poster layer budget (${this.maxMovies}) exhausted at "${movieId}" — ` +
          'further titles shelve without cover art.'
        );
      }
      return 0;
    }
    const idx = this.nextIndex++;
    this.movieToIndex.set(movieId, idx);
    return idx;
  }

  private afterEvict(movieId: string): void {
    const idx = this.movieToIndex.get(movieId);
    this.movieToIndex.delete(movieId);
    this.moviePriority.delete(movieId);
    this.lowResUploaded.delete(idx ?? -1);
    this.highResQueued.delete(idx ?? -1);
    if (idx !== undefined && this.loadedFlags && this.loadedFlagsTexture) {
      this.loadedFlags[idx] = 0;
      this.loadedFlagsTexture.needsUpdate = true;
    }
    // Do not stamp aTextureIndex=0: slot 0 is a real physical layer. Collapse
    // via hasArt()=false (cover scale 0) until this title is reacquired.
    posterLoadedNotify?.(movieId);
  }

  private captureLease(movieId: string, acquire: boolean): PosterLease | null {
    if (!this.residencyBound || !this.residency) return null;
    if (acquire) this.getIndex(movieId, true);
    return this.residency.peekLease(movieId);
  }

  private prunePriorityMeta(): void {
    if (!this.residencyBound || this.moviePriority.size <= this.maxMovies * 2) return;
    for (const id of [...this.moviePriority.keys()]) {
      if (!this.movieToIndex.has(id)) this.moviePriority.delete(id);
    }
  }

  /** True once a title actually owns a layer (see getIndex's exhaustion path). */
  private hasLayer(movieId: string): boolean {
    return this.movieToIndex.has(movieId);
  }

  /**
   * Does this title's ONLY layer live in the high-res array? True for
   * first-bank titles once the catalog overflows, and it changes how callers
   * must stream: there is no cheap preview tier to paint first, so the
   * full-res upload has to happen even at background priority or the case
   * would never paint at all (see store-stock's loadShelfDetails).
   */
  public usesHighResOnly(movieId: string): boolean {
    if (this.residencyBound) return true;
    if (this.lowResBase === 0) return false;
    const idx = this.movieToIndex.get(movieId);
    return idx !== undefined && idx < this.bankSize;
  }

  // Layers whose low-res pixels are on the GPU or already queued for upload
  // (issue #98) — marked at queue time so updateLOD()'s per-keypress re-runs
  // dedupe before enqueueing. Cleared by init() only when it genuinely
  // reallocates; the rebuild fast path keeps them, since the layers are still
  // live in the arrays' CPU mirror and get re-uploaded to the new context in
  // one go rather than one queued task at a time.
  private lowResUploaded = new Set<number>();
  private highResQueued = new Set<number>();

  // Cache-hit streaming (scene rebuilds, walking back to an already-decoded
  // shelf) used to call updateLowRes/updateHighRes synchronously — a warm
  // shelf reveal paid dozens of uploads in one frame. These wrappers put that
  // path through the same budgeted queue as fresh decodes, deduped at queue
  // time, flipping the shader's loaded flag only once the pixels are up.
  // NOTE: the queued closures deliberately resolve the renderer when they RUN
  // (getUploadRenderer()) instead of capturing the one passed in. A no-reload
  // rebuild builds a fresh WebGLRenderer while tasks from the outgoing scene
  // are still queued; a captured renderer would have those tasks stream into
  // the dead context — writing the pixels into the array's CPU mirror but never
  // onto the live GPU texture, while still flipping the shader's loaded flag.
  // The poster would then be marked ready and render as whatever the layer
  // happened to hold. Resolving late means a stale task simply lands on the
  // current renderer, which is always the right one.
  public queueLowRes(_renderer: THREE.WebGLRenderer, movieId: string, pixelData: Uint8Array) {
    if (this.residencyBound && this.residency) {
      const lease = this.captureLease(movieId, false);
      if (!lease) return;
      if (this.lowResUploaded.has(lease.index)) return;
      this.lowResUploaded.add(lease.index);
      queueTextureUpload(() => {
        if (!this.residency?.isLeaseCurrent(lease)) {
          this.staleUploadDrops++;
          return;
        }
        const r = getUploadRenderer();
        if (r) this.commitShelfLease(r, lease, pixelData);
        this.setLoadedForLease(lease, 255);
      }, 'priority');
      return;
    }
    const idx = this.getIndex(movieId, true);
    if (!this.hasLayer(movieId)) return; // past the layer budget — no art for this one
    // In overflow mode the low-res array is the SECOND BANK, not a preview
    // tier: a high-bank title has no low-res layer to write (see POSTER_BANKS).
    if (this.isHighBank(idx) && this.lowResBase !== 0) return;
    if (this.lowResUploaded.has(idx)) return;
    this.lowResUploaded.add(idx);
    queueTextureUpload(() => {
      const r = getUploadRenderer();
      if (r) this.updateLowRes(r, movieId, pixelData);
      this.setLowResLoaded(movieId, true);
    });
  }

  public queueHighRes(_renderer: THREE.WebGLRenderer, movieId: string, pixelData: Uint8Array) {
    if (this.residencyBound) {
      if (!this.residency?.peek(movieId)) return;
      this.queueLowRes(_renderer, movieId, pixelData);
      return;
    }
    const idx = this.getIndex(movieId, true);
    if (!this.hasLayer(movieId)) return;
    // An overflow-bank title has no high-res layer; its cover is painted by
    // the low-res path from the same decoded pixels (see updateLowRes's
    // caller in store-stock), so this is not a dropped poster.
    if (!this.isHighBank(idx)) return;
    if (this.highResQueued.has(idx)) return;
    if (this.loadedFlags && this.loadedFlags[idx] >= 255) return;
    this.highResQueued.add(idx);
    queueTextureUpload(() => {
      const r = getUploadRenderer();
      if (r) this.updateHighRes(r, movieId, pixelData);
      this.setHighResLoaded(movieId, true);
    });
  }

  public updateShelf(renderer: THREE.WebGLRenderer, movieId: string, pixelData: Uint8Array) {
    if (this.residencyBound && this.residency) {
      const lease = this.residency.peekLease(movieId);
      if (!lease) return;
      this.commitShelfLease(renderer, lease, pixelData);
      return;
    }
    const idx = this.getIndex(movieId, true);
    if (!this.hasLayer(movieId) || !this.highResArray) return;
    const pixels = shelfPixelsFromDecoded(pixelData, this.shelfWidth, this.shelfHeight);
    updateTextureArrayLayer(renderer, this.highResArray, idx, pixels);
    this.lowResUploaded.add(idx);
  }

  private commitShelfLease(renderer: THREE.WebGLRenderer, lease: PosterLease, pixelData: Uint8Array) {
    if (!this.residency?.isLeaseCurrent(lease)) {
      this.staleUploadDrops++;
      return;
    }
    const bank = this.bankCount <= 1 ? 0 : Math.floor(lease.index / this.bankSize);
    const layer = this.bankCount <= 1 ? lease.index : lease.index - bank * this.bankSize;
    const tex = this.bankTexture(bank);
    if (!tex) return;
    const pixels = shelfPixelsFromDecoded(pixelData, this.shelfWidth, this.shelfHeight);
    updateTextureArrayLayer(renderer, tex, layer, pixels);
    this.lowResUploaded.add(lease.index);
  }

  public updateLowRes(renderer: THREE.WebGLRenderer, movieId: string, pixelData: Uint8Array) {
    const idx = this.getIndex(movieId);
    if (!this.hasLayer(movieId)) return;
    if (this.isHighBank(idx) && this.lowResBase !== 0) return;
    if (this.lowResArray) {
      updateTextureArrayLayer(renderer, this.lowResArray, idx - this.lowResBase, pixelData);
      this.lowResUploaded.add(idx);
    }
  }

  public updateHighRes(renderer: THREE.WebGLRenderer, movieId: string, pixelData: Uint8Array) {
    const idx = this.getIndex(movieId);
    if (!this.hasLayer(movieId) || !this.isHighBank(idx)) return;
    if (this.highResArray) {
      updateTextureArrayLayer(renderer, this.highResArray, idx, downsample320To160(pixelData));
    }
  }

  // Flag flips are immediate: updateTextureArrayLayer uploads the full mip
  // chain, so a layer is renderable at every distance the moment its upload
  // returns. (These used to be deferred behind the batched mipmap regen —
  // flipping early made distant boxes sample allocation-time zeros, pitch
  // black, until the next whole-array generateMipmap.)
  private setFlag(movieId: string, value: number, low: boolean) {
    if (!this.loadedFlags || !this.loadedFlagsTexture) return;
    if (this.residencyBound && this.residency) {
      const lease = this.residency.peekLease(movieId);
      if (!lease) return;
      this.setLoadedForLease(lease, value, low);
      return;
    }
    const idx = this.getIndex(movieId);
    if (!this.hasLayer(movieId)) return; // no layer, nothing to mark loaded
    // A low-res flip never downgrades an already-applied high-res (255) flag,
    // and never fires for a HIGH-bank title in overflow mode — that title has
    // no low-res layer, so the shader's 128 branch would sample someone else's.
    if (low && ((this.isHighBank(idx) && this.lowResBase !== 0) || this.loadedFlags[idx] >= 255)) return;
    const wasUnpainted = this.loadedFlags[idx] === 0;
    this.loadedFlags[idx] = value;
    this.loadedFlagsTexture.needsUpdate = true;
    // The moment a title goes from "no art" to "art": its cover box is sitting
    // collapsed and only a re-dirty will bring it back (see setPosterLoadedNotify).
    if (wasUnpainted && value > 0) posterLoadedNotify?.(movieId);
    // Nudge the render-on-demand loop (issue #24) — the scene may have
    // settled to IDLE between the poster callback and this flip landing.
    textureStreamWake?.();
  }

  private setLoadedForLease(lease: PosterLease, value: number, low = false) {
    if (!this.residency?.isLeaseCurrent(lease)) {
      this.staleUploadDrops++;
      return;
    }
    if (!this.loadedFlags || !this.loadedFlagsTexture) return;
    const idx = lease.index;
    if (low && this.loadedFlags[idx] >= 255) return;
    const wasUnpainted = this.loadedFlags[idx] === 0;
    this.loadedFlags[idx] = value;
    this.loadedFlagsTexture.needsUpdate = true;
    if (wasUnpainted && value > 0) posterLoadedNotify?.(lease.movieId);
    textureStreamWake?.();
  }

  /**
   * Has ANY art landed for this title (low-res counts)? Non-allocating on
   * purpose: getIndex() would mint a layer for a title that has none, so this
   * reads the map directly. Callers use it to keep an unpainted cover box out
   * of the scene entirely rather than showing a blank one.
   */
  public hasArt(movieId: string): boolean {
    const idx = this.movieToIndex.get(movieId);
    if (idx === undefined || !this.loadedFlags) return false;
    if (this.residency && this.residency.peek(movieId) !== idx) return false;
    return this.loadedFlags[idx] > 0;
  }

  /**
   * Has the FULL-res layer landed (as opposed to just the low-res preview)?
   * The GPU array layer, once uploaded, is never evicted — unlike
   * posterPixelCache/lowResCache, whose CPU-side entries can vanish under a
   * byte budget. Callers that only re-request a decode to refill an evicted
   * CPU cache entry (store-stock's loadShelfDetails) check this first: if the
   * resolution they actually need for this priority is already on the GPU,
   * the shelf already looks right and a redecode would be pure churn.
   */
  public hasHighRes(movieId: string): boolean {
    const idx = this.movieToIndex.get(movieId);
    if (idx === undefined || !this.loadedFlags) return false;
    if (this.residency && this.residency.peek(movieId) !== idx) return false;
    return this.loadedFlags[idx] >= 255;
  }

  public setLowResLoaded(movieId: string, loaded: boolean) {
    this.setFlag(movieId, loaded ? 128 : 0, true);
  }

  public setHighResLoaded(movieId: string, loaded: boolean) {
    this.setFlag(movieId, loaded ? 255 : 0, false);
  }

  /**
   * A COPY of this title's best available art straight from the array
   * textures' CPU mirrors (updateTextureArrayLayerImpl always writes pixels
   * there before/alongside the GPU upload — see that function's opening
   * comment), or null if the title has no layer at all.
   *
   * Why this exists: hero-lowres-front.ts's soft-cover fallback used to stop
   * at lowResCache/posterPixelCache — both small, evictable CPU caches
   * (256MB / 64MB, video-case.ts) bounded well under a real library's size.
   * A title decoded early in a background sweep (loadAllArtworkForActiveLibrary)
   * routinely ages out of BOTH before the browse cursor ever reaches it, even
   * though hasArt()/hasHighRes() are true — its layer has been sitting on the
   * GPU, uploaded, the whole time. Before this existed, that combination (art
   * on the GPU, nothing in either CPU cache) fell all the way through to the
   * flat placeholder — the exact black-flash bug the low-res tier was built to
   * remove, just reopened by a cache the size of the low-res tier itself.
   * Measured on a 1400-title synthetic catalog: titles more than ~200 browse
   * steps from boot order reliably hit this path (scratch/hoverflicker2.mjs).
   *
   * Prefers the low-res (64x96) layer even when high-res (160x240) has also
   * landed: this is a TRANSITIONAL cover, on screen for a frame or two before
   * the real decode swaps in (same contract as the CPU lowResCache tier this
   * sits behind), so the high-res layer's extra sharpness buys nothing but a
   * ~6x heavier synchronous GPU upload (uploadTextureNow, called right on the
   * cursor-move keypress that triggered the miss). Measured on a 5000-title
   * catalog (tools/shot.mjs --perf 60 --lib 5000, worst case: every title on
   * this path — far past this app's ~3000-title production target):
   * always-preferring high-res cost ~550ms of extra heroMs/caseCanvasMs over
   * the 60-move sweep (vs. a placeholder-fallback baseline that pays neither);
   * preferring low-res here recovers about 3.5-4x of that (down to ~65-80ms
   * extra caseCanvasMs/heroMs — the remaining cost is the texture upload
   * itself, unavoidable once a real per-title texture has to exist at all).
   * At the scale that actually reproduced the original report (~1400 titles),
   * neither version is distinguishable from baseline in p50/p90/hitch count —
   * this only matters once a catalog is large enough that browsing routinely
   * outruns both CPU caches on nearly every step.
   * Falls back to high-res only when there's no low-res layer for this title
   * at all — a high-bank title once the catalog overflows into two banks
   * (POSTER_BANKS/isHighBank), where the low-res array becomes a SECOND BANK
   * holding different titles entirely, not a preview tier for this one.
   *
   * A `.slice()` copy, not a `.subarray()` view: a view would keep the ENTIRE
   * multi-hundred-MB array-texture backing buffer alive for as long as one
   * caller holds a texture built from a tiny slice of it.
   */
  public getFallbackPixels(movieId: string): { data: Uint8Array; w: number; h: number } | null {
    const idx = this.movieToIndex.get(movieId);
    if (idx === undefined || !this.loadedFlags || this.loadedFlags[idx] === 0) return null;
    if (this.residency && this.residency.peek(movieId) !== idx) return null;
    if (this.lowResArray) {
      const lowIdx = idx - this.lowResBase;
      if (lowIdx >= 0) {
        const { width: w, height: h, data } = this.lowResArray.image;
        const layerSize = w * h * 4;
        const start = lowIdx * layerSize;
        if (start + layerSize <= (data as Uint8Array).length) {
          return { data: (data as Uint8Array).slice(start, start + layerSize), w, h };
        }
      }
    }
    if (this.highResArray) {
      const { width: w, height: h, data } = this.highResArray.image;
      const layerSize = w * h * 4;
      const start = idx * layerSize;
      if (start + layerSize <= (data as Uint8Array).length) {
        return { data: (data as Uint8Array).slice(start, start + layerSize), w, h };
      }
    }
    return null;
  }

  public memorySnapshot(): {
    catalogTitleCount: number;
    physicalSlots: number;
    residentCount: number;
    freeCount: number;
    uniqueOwners: number;
    residentHighWaterMark: number;
    evictionCount: number;
    acquisitionCount: number;
    reacquisitionCount: number;
    pinnedCount: number;
    staleUploadDrops: number;
    residencyInvariantOk: boolean | null;
    duplicatePhysicalOwners: number;
    freeOwnedCollisions: number;
    orphanMovieMappings: number;
    orphanSlotMappings: number;
    shelfWidth: number;
    shelfHeight: number;
    bankCount: number;
    layersPerBank: number;
    evictionWindow: false;
    cpuBytes: number;
    gpuBytes: number;
    dualArrays: boolean;
  } {
    const layerBytes = (tex: THREE.DataArrayTexture | null) => {
      if (!tex) return 0;
      const { width, height, depth, data } = tex.image as {
        width: number; height: number; depth?: number; data?: Uint8Array;
      };
      if (data?.byteLength) return data.byteLength;
      return width * height * (depth ?? 1) * 4;
    };
    const cpu = layerBytes(this.highResArray)
      + (this.lowResArray && this.lowResArray !== this.highResArray ? layerBytes(this.lowResArray) : 0)
      + this.extraBanks.reduce((sum, tex) => sum + layerBytes(tex), 0);
    const inv = this.residency?.validateInvariants() ?? null;
    return {
      catalogTitleCount: this.catalogTitleCount,
      physicalSlots: this.maxMovies,
      residentCount: this.residency?.residentCount ?? this.movieToIndex.size,
      freeCount: this.residency?.freeCount ?? Math.max(0, this.maxMovies - this.movieToIndex.size),
      uniqueOwners: this.residency?.uniquePhysicalOwners() ?? this.movieToIndex.size,
      residentHighWaterMark: this.residency?.residentHighWaterMark ?? this.movieToIndex.size,
      evictionCount: this.residency?.evictionCount ?? 0,
      acquisitionCount: this.residency?.acquisitionCount ?? this.movieToIndex.size,
      reacquisitionCount: this.residency?.reacquisitionCount ?? 0,
      pinnedCount: this.residency?.pinnedCount ?? 0,
      staleUploadDrops: this.staleUploadDrops,
      residencyInvariantOk: inv ? inv.ok : null,
      duplicatePhysicalOwners: inv?.duplicateOwners ?? 0,
      freeOwnedCollisions: inv?.freeOwnedCollisions ?? 0,
      orphanMovieMappings: inv?.orphanMovieMappings ?? 0,
      orphanSlotMappings: inv?.orphanSlotMappings ?? 0,
      shelfWidth: this.shelfWidth,
      shelfHeight: this.shelfHeight,
      bankCount: this.bankCount,
      layersPerBank: this.bankSize,
      evictionWindow: false as const,
      cpuBytes: cpu,
      gpuBytes: Math.round(cpu * 4 / 3),
      dualArrays: !this.residencyBound,
    };
  }

  public resetBoundedWindowForProbe(): void {
    if (!this.residencyBound || !this.residency) return;
    this.mappingsFrozen = false;
    this.residency = new PosterResidencyWindow(this.maxMovies);
    this.movieToIndex.clear();
    this.moviePriority.clear();
    this.staleUploadDrops = 0;
    this.lowResUploaded.clear();
    this.highResQueued.clear();
    if (this.loadedFlags) this.loadedFlags.fill(0);
  }
  public populateResidencyWindow(logicalCount: number) {
    this.resetBoundedWindowForProbe();
    const fill = Math.min(Math.max(0, logicalCount), this.maxMovies);
    const classes: PosterPriorityClass[] = ['P0', 'P1', 'P2', 'P3'];
    for (let i = 0; i < fill; i++) {
      const id = `probe-${i}`;
      const cls = classes[i % 4];
      this.notePriority(id, cls);
      this.getIndex(id, true);
    }
    this.freezeStableMappings();
    return this.memorySnapshot();
  }

  /** Test-only: replay a captured lease as if a late decode finished. */
  public debugCommitLease(lease: PosterLease, loadedValue = 255): boolean {
    if (!this.residency?.isLeaseCurrent(lease)) {
      this.staleUploadDrops++;
      return false;
    }
    this.setLoadedForLease(lease, loadedValue);
    return true;
  }

  public debugPeekLease(movieId: string): PosterLease | null {
    return this.residency?.peekLease(movieId) ?? null;
  }
}

export const textureArrayManager = new TextureArrayManager();

export function posterArrayMemorySnapshot() {
  return textureArrayManager.memorySnapshot();
}

export function estimatedPosterBytesForCatalog(catalogTitles: number) {
  const profile = activeResourceProfile();
  if (isXrSafeProfile(profile)) {
    return { ...estimatePosterArrayBytes(profile.poster), catalogTitleCount: catalogTitles };
  }
  return {
    ...estimatePosterArrayBytes({
      ...profile.poster,
      physicalSlots: catalogTitles,
    }),
    catalogTitleCount: catalogTitles,
  };
}
