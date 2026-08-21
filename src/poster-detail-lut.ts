// DETAIL LUT capacity is catalog-sized, not a silent 2048 cliff.
// One texel per globalIndex: 0 = sample BASE, slot+1 = sample DETAIL.

export interface DetailLutPlan {
  ok: boolean;
  width: number;
  height: number;
  capacity: number;
  needed: number;
  maxTextureSize: number;
  reason?: string;
}

export const DETAIL_LUT_FAIL_CLOSED = 'DETAIL_LUT_EXCEEDS_MAX_TEXTURE_SIZE';

export function planDetailLut(needed: number, maxTextureSize: number): DetailLutPlan {
  const n = Math.max(1, Math.ceil(needed));
  const max = Math.max(1, Math.floor(maxTextureSize));
  if (n <= max) {
    return { ok: true, width: n, height: 1, capacity: n, needed: n, maxTextureSize: max };
  }
  const width = max;
  const height = Math.ceil(n / width);
  if (height > max) {
    return {
      ok: false,
      width: 1,
      height: 1,
      capacity: 0,
      needed: n,
      maxTextureSize: max,
      reason: DETAIL_LUT_FAIL_CLOSED,
    };
  }
  return { ok: true, width, height, capacity: width * height, needed: n, maxTextureSize: max };
}

export function detailLutByteOffset(index: number, width: number): number {
  const i = Math.max(0, Math.floor(index));
  const w = Math.max(1, Math.floor(width));
  const x = i % w;
  const y = Math.floor(i / w);
  return (y * w + x) * 4;
}

/** CPU backing for the DETAIL LUT. Does not allocate GPU resources. */
export class DetailLutCpu {
  readonly width: number;
  readonly height: number;
  readonly capacity: number;
  readonly ok: boolean;
  readonly bytes: Uint8Array;
  rejected = 0;

  constructor(plan: DetailLutPlan) {
    this.ok = plan.ok;
    this.width = Math.max(1, plan.width);
    this.height = Math.max(1, plan.height);
    this.capacity = plan.ok ? plan.capacity : 0;
    this.bytes = new Uint8Array(this.width * this.height * 4);
  }

  set(globalIndex: number, slotPlusOne: number): boolean {
    if (!this.ok || globalIndex < 0 || globalIndex >= this.capacity) {
      this.rejected++;
      return false;
    }
    const o = detailLutByteOffset(globalIndex, this.width);
    const v = Math.max(0, Math.min(255, Math.floor(slotPlusOne)));
    this.bytes[o] = v;
    this.bytes[o + 1] = v;
    this.bytes[o + 2] = v;
    this.bytes[o + 3] = 255;
    return true;
  }

  get(globalIndex: number): number {
    if (!this.ok || globalIndex < 0 || globalIndex >= this.capacity) return 0;
    return this.bytes[detailLutByteOffset(globalIndex, this.width)] ?? 0;
  }

  clear(globalIndex: number): boolean {
    return this.set(globalIndex, 0);
  }
}
