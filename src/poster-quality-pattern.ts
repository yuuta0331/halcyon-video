// Deterministic high-frequency poster-like pattern for BASE/NEAR/FOCUS probes.
// No private library art.

export function makePosterQualityPattern(
  width: number,
  height: number,
  seed = 7,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const gx = x / Math.max(1, width - 1);
      const gy = y / Math.max(1, height - 1);
      const stripe = ((x + y + seed) % 7) === 0 ? 255 : 40;
      const diag = Math.abs((x * 3 - y * 2 + seed) % 11) < 2 ? 220 : 30;
      const glyph = (x % 16 < 2 || y % 20 < 2) ? 200 : 0;
      const wave = Math.floor(128 + 90 * Math.sin((gx * 18 + gy * 11 + seed) * Math.PI));
      out[i] = Math.min(255, stripe);
      out[i + 1] = Math.min(255, diag);
      out[i + 2] = Math.min(255, Math.max(glyph, wave));
      out[i + 3] = 255;
    }
  }
  return out;
}

// Hardware visual diagnostic source. This deliberately is not a wall of
// high-frequency lines: most of the poster is made from large, flat regions so
// a black incursion is unmistakable. Only the lower-right calibration patch is
// high frequency. The normalized construction keeps BASE / NEAR / FOCUS source
// content equivalent even though their pixel dimensions differ.
export function makeHardwarePosterDiagnosticPattern(
  width: number,
  height: number,
): Uint8Array {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const out = new Uint8Array(w * h * 4);

  const set = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = 255;
  };
  const inside = (v: number, lo: number, hi: number): boolean => v >= lo && v <= hi;

  for (let y = 0; y < h; y++) {
    const gy = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const gx = (x + 0.5) / w;
      let rgb: [number, number, number];
      if (gy < 0.46) rgb = gx < 0.5 ? [244, 246, 242] : [158, 166, 176];
      else rgb = gx < 0.5 ? [46, 184, 214] : [236, 174, 62];

      // A small, explicitly bounded black reference patch.
      if (inside(gx, 0.07, 0.18) && inside(gy, 0.70, 0.80)) rgb = [10, 12, 16];

      // Controlled high-frequency calibration zone (about 6% of the image).
      if (inside(gx, 0.69, 0.94) && inside(gy, 0.70, 0.94)) {
        const cellX = Math.floor((gx - 0.69) * 64);
        const cellY = Math.floor((gy - 0.70) * 64);
        rgb = ((cellX + cellY) & 1) === 0 ? [242, 246, 250] : [28, 48, 78];
      }

      // Thick border and center crosshair remain readable at BASE resolution.
      const border = gx < 0.025 || gx > 0.975 || gy < 0.018 || gy > 0.982;
      const cross = (Math.abs(gx - 0.5) < 0.008 && inside(gy, 0.38, 0.62))
        || (Math.abs(gy - 0.5) < 0.006 && inside(gx, 0.38, 0.62));
      if (border || cross) rgb = [20, 32, 48];
      set(x, y, rgb[0], rgb[1], rgb[2]);
    }
  }

  // Large corner markers: bright squares with a dark inset. They make crop,
  // orientation, and partial-black failures easy to distinguish.
  const marker = (cx: number, cy: number, r: number, g: number, b: number): void => {
    const x0 = Math.floor((cx - 0.045) * w);
    const x1 = Math.ceil((cx + 0.045) * w);
    const y0 = Math.floor((cy - 0.045) * h);
    const y1 = Math.ceil((cy + 0.045) * h);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const edge = x === x0 || x === x1 || y === y0 || y === y1;
        set(x, y, edge ? 18 : r, edge ? 24 : g, edge ? 32 : b);
      }
    }
  };
  marker(0.10, 0.10, 255, 84, 92);
  marker(0.90, 0.10, 82, 232, 126);
  marker(0.10, 0.90, 94, 128, 255);
  marker(0.90, 0.90, 255, 236, 92);
  return out;
}

export function patternEdgeEnergy(pixels: Uint8Array, width: number, height: number): number {
  let acc = 0;
  let n = 0;
  for (let y = 1; y < height; y += 2) {
    for (let x = 1; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const j = (y * width + (x - 1)) * 4;
      acc += Math.abs(pixels[i]! - pixels[j]!);
      n++;
    }
  }
  return n > 0 ? acc / n : 0;
}
