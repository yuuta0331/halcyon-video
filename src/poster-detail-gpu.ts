// GPU backing for the bounded poster detail tier: one DataArrayTexture plus
// a catalog-sized LUT. LUT 0 = sample BASE. LUT slot+1 = sample detail.
// Never blanks. LUT capacity is planned from catalog count, not a 2048 cliff.

import * as THREE from 'three';
import { updateTextureArrayLayer, setDetailUniformBinder } from './poster-textures';
import {
  POSTER_DETAIL_HEIGHT,
  POSTER_DETAIL_SLOT_LIMIT,
  POSTER_DETAIL_WIDTH,
  posterDetailResidency,
} from './poster-detail-residency';
import { DetailLutCpu, planDetailLut, type DetailLutPlan } from './poster-detail-lut';

let detailArray: THREE.DataArrayTexture | null = null;
let dummyArray: THREE.DataArrayTexture | null = null;
let lut: THREE.DataTexture | null = null;
let lutCpu: DetailLutCpu | null = null;
let lutPlan: DetailLutPlan = planDetailLut(1, 4096);
let creates = 0;
let disposals = 0;

function maxTextureSizeFrom(renderer?: THREE.WebGLRenderer | null, fallback = 4096): number {
  try {
    const gl = renderer?.getContext?.() as WebGL2RenderingContext | undefined;
    const n = gl?.getParameter?.(gl.MAX_TEXTURE_SIZE);
    if (typeof n === 'number' && n >= 64) return n;
  } catch {
    // keep fallback
  }
  return fallback;
}

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

function bindLutTexture(): THREE.DataTexture {
  if (lut) return lut;
  const cpu = lutCpu ?? new DetailLutCpu(planDetailLut(1, 4096));
  lutCpu = cpu;
  lut = new THREE.DataTexture(cpu.bytes, cpu.width, cpu.height, THREE.RGBAFormat);
  lut.type = THREE.UnsignedByteType;
  lut.minFilter = THREE.NearestFilter;
  lut.magFilter = THREE.NearestFilter;
  lut.colorSpace = THREE.NoColorSpace;
  lut.flipY = false;
  lut.needsUpdate = true;
  return lut;
}

export function getPosterDetailLutLayout(): DetailLutPlan {
  return lutPlan;
}

export function initPosterDetailGpu(opts: {
  slotLimit?: number;
  catalogCount?: number;
  renderer?: THREE.WebGLRenderer | null;
  maxTextureSize?: number;
} = {}): DetailLutPlan {
  disposePosterDetailGpu();
  const slots = Math.max(1, opts.slotLimit ?? POSTER_DETAIL_SLOT_LIMIT);
  const needed = Math.max(1, opts.catalogCount ?? 1);
  const maxSize = opts.maxTextureSize ?? maxTextureSizeFrom(opts.renderer);
  lutPlan = planDetailLut(needed, maxSize);
  lutCpu = new DetailLutCpu(lutPlan);
  bindLutTexture();
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
  posterDetailResidency.reset();
  return lutPlan;
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
  }
  lutCpu = null;
  posterDetailResidency.reset();
}

export function getPosterDetailArray(): THREE.DataArrayTexture {
  return detailArray ?? ensureDummy();
}

export function getPosterDetailLut(): THREE.DataTexture {
  return bindLutTexture();
}

export function posterDetailGpuCreates(): number { return creates; }
export function posterDetailGpuDisposals(): number { return disposals; }

export function setPosterDetailLut(globalIndex: number, slotPlusOne: number): boolean {
  const cpu = lutCpu ?? new DetailLutCpu(lutPlan);
  lutCpu = cpu;
  const ok = cpu.set(globalIndex, slotPlusOne);
  if (ok) bindLutTexture().needsUpdate = true;
  return ok;
}

export function clearPosterDetailLut(globalIndex: number): boolean {
  return setPosterDetailLut(globalIndex, 0);
}

export function readPosterDetailLut(globalIndex: number): number {
  return lutCpu?.get(globalIndex) ?? 0;
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
  posterDetailLutWidth?: { value: number };
  posterDetailLutHeight?: { value: number };
}): void {
  if (u.detailMapArray) u.detailMapArray.value = getPosterDetailArray();
  if (u.detailLayerTex) u.detailLayerTex.value = getPosterDetailLut();
  const plan = lutPlan;
  if (u.posterDetailCount) u.posterDetailCount.value = Math.max(1, plan.capacity);
  if (u.posterDetailLutWidth) u.posterDetailLutWidth.value = Math.max(1, plan.width);
  if (u.posterDetailLutHeight) u.posterDetailLutHeight.value = Math.max(1, plan.height);
}

export function posterDetailResourceSnapshot() {
  const st = posterDetailResidency.snapshot();
  return {
    ...st,
    textureCreates: creates,
    textureDisposals: disposals,
    arrayAllocated: !!detailArray,
    lutOk: lutPlan.ok,
    lutWidth: lutPlan.width,
    lutHeight: lutPlan.height,
    lutCapacity: lutPlan.capacity,
    lutRejected: lutCpu?.rejected ?? 0,
    lutReason: lutPlan.reason ?? null,
  };
}

setDetailUniformBinder(bindPosterDetailUniforms);
