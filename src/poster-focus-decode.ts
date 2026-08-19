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
  if (typeof Worker !== 'undefined') {
    try {
      return await decodeFocusInWorker(rewritePosterUrlForFocus(url), targetW, targetH);
    } catch {
      // Older WebViews may expose Worker while lacking worker-side
      // OffscreenCanvas/createImageBitmap. Keep FOCUS functional there.
    }
  }
  const res = await fetch(rewritePosterUrlForFocus(url));
  const buf = await res.arrayBuffer();
  const blob = new Blob([buf]);
  const bitmap = await createImageBitmap(blob);
  return decodeFocusFromImageBitmap(bitmap, targetW, targetH);
}

let focusWorker: Worker | null = null;
let focusWorkerId = 1;
const focusCallbacks = new Map<number, {
  resolve: (value: FocusDecodeResult) => void;
  reject: (reason: Error) => void;
  targetW: number;
  targetH: number;
}>();

function ensureFocusWorker(): Worker {
  if (focusWorker) return focusWorker;
  focusWorker = new Worker(new URL('./poster-focus-worker.ts', import.meta.url), { type: 'module' });
  focusWorker.onmessage = (event: MessageEvent<{
    id: number;
    success: boolean;
    pixels?: ArrayBuffer;
    sourceWidth?: number;
    sourceHeight?: number;
    decodeMs?: number;
    error?: string;
  }>) => {
    const cb = focusCallbacks.get(event.data.id);
    if (!cb) return;
    focusCallbacks.delete(event.data.id);
    if (!event.data.success || !event.data.pixels) {
      cb.reject(new Error(event.data.error ?? 'FOCUS worker decode failed'));
      return;
    }
    const sourceWidth = event.data.sourceWidth ?? cb.targetW;
    const sourceHeight = event.data.sourceHeight ?? cb.targetH;
    const chosen = chooseFocusDecodeSize(sourceWidth, sourceHeight, cb.targetW, cb.targetH);
    noteCpuWork('decode', event.data.decodeMs ?? 0);
    cb.resolve({
      pixels: new Uint8Array(event.data.pixels),
      sourceWidth,
      sourceHeight,
      decodeWidth: chosen.width,
      decodeHeight: chosen.height,
      upscaledFromNear: false,
      nativeLimited: chosen.nativeLimited,
    });
  };
  focusWorker.onerror = () => {
    const pending = [...focusCallbacks.values()];
    focusCallbacks.clear();
    focusWorker?.terminate();
    focusWorker = null;
    for (const cb of pending) cb.reject(new Error('FOCUS worker unavailable'));
  };
  return focusWorker;
}

function decodeFocusInWorker(url: string, targetW: number, targetH: number): Promise<FocusDecodeResult> {
  return new Promise((resolve, reject) => {
    const id = focusWorkerId++;
    focusCallbacks.set(id, { resolve, reject, targetW, targetH });
    ensureFocusWorker().postMessage({ id, url, targetW, targetH });
  });
}
