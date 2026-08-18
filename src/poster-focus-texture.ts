// Dedicated FOCUS 2D textures. No array, no CPU mip chain, catalog-independent.

import * as THREE from 'three';
import {
  POSTER_FOCUS_HEIGHT,
  POSTER_FOCUS_SLOT_LIMIT,
  POSTER_FOCUS_WIDTH,
} from './poster-quality.ts';
import { posterFocusResidency } from './poster-focus-residency.ts';
import { noteScheduledUpload } from './perf/xr-upload-metrics.ts';

let textures: Array<THREE.DataTexture | null> = [];
let dummy: THREE.DataTexture | null = null;
let activeSlot = -1;
let activeIndex = -1;
let creates = 0;
let disposals = 0;

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

export function initPosterFocusGpu(opts: { slotLimit?: number; width?: number; height?: number } = {}): void {
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
    return tex;
  });
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
  };
}

export function posterFocusGpuCreates(): number { return creates; }
export function posterFocusGpuDisposals(): number { return disposals; }
