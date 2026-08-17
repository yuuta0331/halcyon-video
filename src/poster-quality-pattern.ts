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
