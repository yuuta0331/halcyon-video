// FOCUS decode from source pixels. Never upscales a 320×480 NEAR buffer.

import {
  POSTER_FOCUS_HEIGHT,
  POSTER_FOCUS_WIDTH,
  blitPosterIntoFocusSlot,
  chooseFocusDecodeSize,
  rewritePosterUrlForFocus,
  wouldFakeUpscale,
} from './poster-quality.ts';
import { noteCpuWork } from './perf/xr-upload-metrics.ts';

export interface FocusDecodeResult {
  pixels: Uint8Array;
  sourceWidth: number;
  sourceHeight: number;
  decodeWidth: number;
  decodeHeight: number;
  upscaledFromNear: boolean;
  nativeLimited: boolean;
}

export function focusPixelsFromSourceRgba(
  src: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetW = POSTER_FOCUS_WIDTH,
  targetH = POSTER_FOCUS_HEIGHT,
): FocusDecodeResult {
  const fake = wouldFakeUpscale(sourceWidth, sourceHeight, targetW, targetH)
    && sourceWidth <= 320 && sourceHeight <= 480;
  const chosen = chooseFocusDecodeSize(sourceWidth, sourceHeight, targetW, targetH);
  const pixels = blitPosterIntoFocusSlot(src, sourceWidth, sourceHeight, targetW, targetH);
  return {
    pixels,
    sourceWidth,
    sourceHeight,
    decodeWidth: chosen.width,
    decodeHeight: chosen.height,
    upscaledFromNear: fake,
    nativeLimited: chosen.nativeLimited,
  };
}

export async function decodeFocusFromImageBitmap(
  bitmap: ImageBitmap,
  targetW = POSTER_FOCUS_WIDTH,
  targetH = POSTER_FOCUS_HEIGHT,
): Promise<FocusDecodeResult> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const chosen = chooseFocusDecodeSize(sourceWidth, sourceHeight, targetW, targetH);
  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('FOCUS decode canvas unavailable');
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, targetW, targetH);
  if (sourceWidth >= targetW && sourceHeight >= targetH) {
    ctx.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight, 0, 0, targetW, targetH);
  } else {
    const dx = Math.floor((targetW - sourceWidth) / 2);
    const dy = Math.floor((targetH - sourceHeight) / 2);
    ctx.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight, dx, dy, sourceWidth, sourceHeight);
  }
  const img = ctx.getImageData(0, 0, targetW, targetH);
  bitmap.close();
  noteCpuWork('decode', (typeof performance !== 'undefined' ? performance.now() : 0) - t0);
  return {
    pixels: new Uint8Array(img.data.buffer.slice(0)),
    sourceWidth,
    sourceHeight,
    decodeWidth: chosen.width,
    decodeHeight: chosen.height,
    upscaledFromNear: false,
    nativeLimited: chosen.nativeLimited,
  };
}

export async function decodeFocusFromUrl(
  url: string,
  targetW = POSTER_FOCUS_WIDTH,
  targetH = POSTER_FOCUS_HEIGHT,
): Promise<FocusDecodeResult> {
  const res = await fetch(rewritePosterUrlForFocus(url));
  const buf = await res.arrayBuffer();
  const blob = new Blob([buf]);
  const bitmap = await createImageBitmap(blob);
  return decodeFocusFromImageBitmap(bitmap, targetW, targetH);
}
