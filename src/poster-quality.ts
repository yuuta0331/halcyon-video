// Bounded three-tier poster policy. 320×480 is NEAR, not the final visual tier.
// FOCUS must decode from source pixels, never by upscaling a 320×480 buffer.

export const POSTER_BASE_XR_WIDTH = 96;
export const POSTER_BASE_XR_HEIGHT = 144;
export const POSTER_BASE_INLINE_WIDTH = 160;
export const POSTER_BASE_INLINE_HEIGHT = 240;
export const POSTER_NEAR_WIDTH = 320;
export const POSTER_NEAR_HEIGHT = 480;
export const POSTER_FOCUS_WIDTH = 640;
export const POSTER_FOCUS_HEIGHT = 960;
export const POSTER_FOCUS_SLOT_LIMIT = 2;
export const POSTER_NEAR_SLOT_LIMIT = 64;

export type PosterTier = 'BASE' | 'NEAR' | 'FOCUS';

export interface PosterTierPixels {
  width: number;
  height: number;
}

export interface PosterResolutionAudit {
  /** Server-requested size. Null means native / uncapped Primary image. */
  sourceRequested: { maxWidth: number | null; maxHeight: number | null };
  decodedWidth: number;
  decodedHeight: number;
  baseGpuWidth: number;
  baseGpuHeight: number;
  nearGpuWidth: number;
  nearGpuHeight: number;
  focusGpuWidth: number;
  focusGpuHeight: number;
  focusSlotLimit: number;
  upscaledFromNear: boolean;
}

export function posterTierSize(tier: PosterTier, immersive: boolean): PosterTierPixels {
  if (tier === 'BASE') {
    return immersive
      ? { width: POSTER_BASE_XR_WIDTH, height: POSTER_BASE_XR_HEIGHT }
      : { width: POSTER_BASE_INLINE_WIDTH, height: POSTER_BASE_INLINE_HEIGHT };
  }
  if (tier === 'NEAR') return { width: POSTER_NEAR_WIDTH, height: POSTER_NEAR_HEIGHT };
  return { width: POSTER_FOCUS_WIDTH, height: POSTER_FOCUS_HEIGHT };
}

export function estimatePosterTierBytes(
  slots: number,
  width: number,
  height: number,
  withMips: boolean,
): { cpu: number; gpu: number } {
  const cpu = Math.max(0, Math.floor(slots)) * width * height * 4;
  return { cpu, gpu: withMips ? Math.round(cpu * 4 / 3) : cpu };
}

/** Honest downsample. Never invent FOCUS pixels from a 320×480 buffer. */
export function downsamplePosterRgba(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y + 0.5) * srcH / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x + 0.5) * srcW / dstW));
      const si = (sy * srcW + sx) * 4;
      const di = (y * dstW + x) * 4;
      out[di] = src[si]!;
      out[di + 1] = src[si + 1]!;
      out[di + 2] = src[si + 2]!;
      out[di + 3] = src[si + 3]!;
    }
  }
  return out;
}

export function wouldFakeUpscale(srcW: number, srcH: number, dstW: number, dstH: number): boolean {
  return srcW < dstW || srcH < dstH;
}

export function chooseFocusDecodeSize(
  sourceW: number,
  sourceH: number,
  targetW = POSTER_FOCUS_WIDTH,
  targetH = POSTER_FOCUS_HEIGHT,
): { width: number; height: number; nativeLimited: boolean } {
  if (sourceW <= 0 || sourceH <= 0) {
    return { width: targetW, height: targetH, nativeLimited: false };
  }
  if (sourceW < targetW || sourceH < targetH) {
    return { width: sourceW, height: sourceH, nativeLimited: true };
  }
  return { width: targetW, height: targetH, nativeLimited: false };
}

export function texelsPerFace(width: number, height: number): number {
  return width * height;
}

export function shelfPosterSourceRequest(): PosterResolutionAudit['sourceRequested'] {
  // Jellyfin shelf posters omit maxWidth (native Primary). Plex catalog thumbs
  // currently request 400×600; FOCUS rewrites that fetch, it does not upscale.
  return { maxWidth: null, maxHeight: null };
}

/**
 * FOCUS fetch URL. Never invents pixels; only raises an existing cap or adds a
 * documented Jellyfin maxWidth/maxHeight so the server can send a source near
 * 640×960 instead of a huge native Primary. Does not log the URL (may contain tokens).
 */
export function rewritePosterUrlForFocus(url: string): string {
  try {
    const u = new URL(url);
    const jellyfinPrimary = /\/Items\/[^/]+\/Images\/Primary$/i.test(u.pathname);
    if (jellyfinPrimary) {
      if (!u.searchParams.has('maxWidth')) {
        u.searchParams.set('maxWidth', String(POSTER_FOCUS_WIDTH));
      } else {
        const cur = Number(u.searchParams.get('maxWidth'));
        if (!Number.isFinite(cur) || cur < POSTER_FOCUS_WIDTH) {
          u.searchParams.set('maxWidth', String(POSTER_FOCUS_WIDTH));
        }
      }
      if (!u.searchParams.has('maxHeight')) {
        u.searchParams.set('maxHeight', String(POSTER_FOCUS_HEIGHT));
      }
      return u.toString();
    }
    if (u.searchParams.has('maxWidth')) {
      const cur = Number(u.searchParams.get('maxWidth'));
      if (!Number.isFinite(cur) || cur < POSTER_FOCUS_WIDTH) {
        u.searchParams.set('maxWidth', String(POSTER_FOCUS_WIDTH));
      }
    }
    if (u.searchParams.has('width') && u.pathname.includes('transcode')) {
      const cur = Number(u.searchParams.get('width'));
      if (!Number.isFinite(cur) || cur < POSTER_FOCUS_WIDTH) {
        u.searchParams.set('width', String(POSTER_FOCUS_WIDTH));
        u.searchParams.set('height', String(POSTER_FOCUS_HEIGHT));
        u.searchParams.set('upscale', '0');
      }
    }
    return u.toString();
  } catch {
    return url;
  }
}

/** Copy or downsample into a fixed FOCUS slot. Never scales a buffer up. */
export function blitPosterIntoFocusSlot(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW = POSTER_FOCUS_WIDTH,
  dstH = POSTER_FOCUS_HEIGHT,
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH * 4);
  if (srcW <= 0 || srcH <= 0) return dst;
  if (srcW === dstW && srcH === dstH) {
    dst.set(src.subarray(0, Math.min(src.length, dst.length)));
    return dst;
  }
  if (srcW > dstW || srcH > dstH) {
    return downsamplePosterRgba(src, srcW, srcH, dstW, dstH);
  }
  const ox = Math.floor((dstW - srcW) / 2);
  const oy = Math.floor((dstH - srcH) / 2);
  for (let y = 0; y < srcH; y++) {
    const si = y * srcW * 4;
    const di = ((oy + y) * dstW + ox) * 4;
    dst.set(src.subarray(si, si + srcW * 4), di);
  }
  return dst;
}
