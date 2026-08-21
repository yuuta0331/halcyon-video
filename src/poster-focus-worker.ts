// Dedicated lazy FOCUS decoder. Decode/resize/getImageData stay off the XR
// main thread; the returned RGBA buffer transfers ownership without a copy.

interface FocusWorkerRequest {
  id: number;
  url: string;
  targetW: number;
  targetH: number;
}

self.onmessage = async (event: MessageEvent<FocusWorkerRequest>) => {
  const { id, url, targetW, targetH } = event.data;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`FOCUS fetch ${response.status}`);
    const blob = await response.blob();
    const t0 = performance.now();
    const bitmap = await createImageBitmap(blob);
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('FOCUS worker canvas unavailable');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, targetW, targetH);
    if (sourceWidth >= targetW && sourceHeight >= targetH) {
      ctx.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight, 0, 0, targetW, targetH);
    } else {
      const dx = Math.floor((targetW - sourceWidth) / 2);
      const dy = Math.floor((targetH - sourceHeight) / 2);
      ctx.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight, dx, dy, sourceWidth, sourceHeight);
    }
    const pixels = ctx.getImageData(0, 0, targetW, targetH).data.buffer;
    bitmap.close();
    const decodeMs = performance.now() - t0;
    self.postMessage({
      id, success: true, pixels, sourceWidth, sourceHeight, decodeMs,
    }, { transfer: [pixels] });
  } catch (error) {
    self.postMessage({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
