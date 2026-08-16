// GPU backing for the bounded poster detail tier: one DataArrayTexture plus
// a LUT. LUT 0 = sample BASE. LUT slot+1 = sample detail. Never blanks.

import * as THREE from 'three';
import { updateTextureArrayLayer } from './poster-textures';
import {
  POSTER_DETAIL_HEIGHT,
  POSTER_DETAIL_LUT_WIDTH,
  POSTER_DETAIL_SLOT_LIMIT,
  POSTER_DETAIL_WIDTH,
  posterDetailResidency,
} from './poster-detail-residency';

let detailArray: THREE.DataArrayTexture | null = null;
let dummyArray: THREE.DataArrayTexture | null = null;
let lut: THREE.DataTexture | null = null;
let lutBytes: Uint8Array | null = null;
let creates = 0;
let disposals = 0;

function ensureDummy(): THREE.DataArrayTexture {
  if (dummyArray) return dummyArray;
  dummyArray = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1);
  dummyArray.format = THREE.RGBAFormat;
  dummyArray.type = THREE.UnsignedByteType;
  dummyArray.colorSpace = THREE.SRGBColorSpace;
  dummyArray.minFilter = THREE.LinearFilter;
  dummyArray.magFilter = THREE.LinearFilter;
  dummyArray.generateMipmaps = false;
  dummyArray.needsUpdate = true;
  return dummyArray;
}

function ensureLut(): THREE.DataTexture {
  if (lut && lutBytes) return lut;
  lutBytes = new Uint8Array(POSTER_DETAIL_LUT_WIDTH * 4);
  lut = new THREE.DataTexture(lutBytes, POSTER_DETAIL_LUT_WIDTH, 1, THREE.RGBAFormat);
  lut.type = THREE.UnsignedByteType;
  lut.minFilter = THREE.NearestFilter;
  lut.magFilter = THREE.NearestFilter;
  lut.colorSpace = THREE.NoColorSpace;
  lut.needsUpdate = true;
  return lut;
}

export function initPosterDetailGpu(limit = POSTER_DETAIL_SLOT_LIMIT): void {
  disposePosterDetailGpu();
  const slots = Math.max(1, limit);
  const w = POSTER_DETAIL_WIDTH;
  const h = POSTER_DETAIL_HEIGHT;
  const data = new Uint8Array(w * h * 4 * slots);
  detailArray = new THREE.DataArrayTexture(data, w, h, slots);
  detailArray.format = THREE.RGBAFormat;
  detailArray.type = THREE.UnsignedByteType;
  detailArray.colorSpace = THREE.SRGBColorSpace;
  detailArray.minFilter = THREE.LinearMipmapLinearFilter;
  detailArray.magFilter = THREE.LinearFilter;
  detailArray.generateMipmaps = true;
  detailArray.needsUpdate = true;
  creates++;
  ensureLut();
  posterDetailResidency.reset();
}

export function disposePosterDetailGpu(): void {
  if (detailArray) {
    detailArray.dispose();
    detailArray = null;
    disposals++;
  }
  if (lut) {
    lut.dispose();
    lut = null;
    lutBytes = null;
  }
  posterDetailResidency.reset();
}

export function getPosterDetailArray(): THREE.DataArrayTexture {
  return detailArray ?? ensureDummy();
}

export function getPosterDetailLut(): THREE.DataTexture {
  return ensureLut();
}

export function posterDetailGpuCreates(): number { return creates; }
export function posterDetailGpuDisposals(): number { return disposals; }

export function setPosterDetailLut(globalIndex: number, slotPlusOne: number): void {
  const tex = ensureLut();
  const i = Math.max(0, Math.floor(globalIndex));
  if (i >= POSTER_DETAIL_LUT_WIDTH || !lutBytes) return;
  const v = Math.max(0, Math.min(255, Math.floor(slotPlusOne)));
  const o = i * 4;
  lutBytes[o] = v;
  lutBytes[o + 1] = v;
  lutBytes[o + 2] = v;
  lutBytes[o + 3] = 255;
  tex.needsUpdate = true;
}

export function clearPosterDetailLut(globalIndex: number): void {
  setPosterDetailLut(globalIndex, 0);
}

export function uploadPosterDetailLayer(
  renderer: THREE.WebGLRenderer,
  slot: number,
  pixels: Uint8Array,
): boolean {
  if (!detailArray) return false;
  const w = detailArray.image.width;
  const h = detailArray.image.height;
  const need = w * h * 4;
  if (pixels.length < need) return false;
  const layer = pixels.length === need ? pixels : pixels.subarray(0, need);
  updateTextureArrayLayer(renderer, detailArray, slot, layer);
  return true;
}

export function bindPosterDetailUniforms(u: {
  detailMapArray?: { value: THREE.Texture | null };
  detailLayerTex?: { value: THREE.Texture | null };
  posterDetailCount?: { value: number };
}): void {
  if (u.detailMapArray) u.detailMapArray.value = getPosterDetailArray();
  if (u.detailLayerTex) u.detailLayerTex.value = getPosterDetailLut();
  if (u.posterDetailCount) u.posterDetailCount.value = POSTER_DETAIL_LUT_WIDTH;
}

export function posterDetailResourceSnapshot() {
  const st = posterDetailResidency.snapshot();
  return {
    ...st,
    textureCreates: creates,
    textureDisposals: disposals,
    arrayAllocated: !!detailArray,
  };
}
