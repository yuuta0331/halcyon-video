// Pure CPU RGBA mip builder shared by runtime upload and Node diagnostics.

export interface PosterMipLevel {
  level: number;
  width: number;
  height: number;
  data: Uint8Array;
}

// Area box filter. Even dimensions use 2x2 cells; odd dimensions distribute
// the trailing row/column into the final cell instead of dropping a pixel.
export function boxFilterPosterHalf(
  src: Uint8Array,
  sw: number,
  sh: number,
  dst: Uint8Array,
  dw: number,
  dh: number,
): void {
  for (let y = 0; y < dh; y++) {
    const sy0 = Math.floor(y * sh / dh);
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * sh / dh));
    for (let x = 0; x < dw; x++) {
      const sx0 = Math.floor(x * sw / dw);
      const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * sw / dw));
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * sw + sx) << 2;
          r += src[i]!; g += src[i + 1]!; b += src[i + 2]!; a += src[i + 3]!;
          count++;
        }
      }
      const o = (y * dw + x) << 2;
      dst[o] = Math.round(r / count);
      dst[o + 1] = Math.round(g / count);
      dst[o + 2] = Math.round(b / count);
      dst[o + 3] = Math.round(a / count);
    }
  }
}

/** Deterministic software proof helper, including LOD0 through the 1x1 level. */
export function buildPosterMipChainForTest(
  source: Uint8Array,
  width: number,
  height: number,
): PosterMipLevel[] {
  if (width < 1 || height < 1 || source.length < width * height * 4) {
    throw new Error('invalid poster mip source');
  }
  const out: PosterMipLevel[] = [{
    level: 0, width, height, data: source.slice(0, width * height * 4),
  }];
  let src = out[0]!.data;
  let sw = width;
  let sh = height;
  let level = 1;
  while (sw > 1 || sh > 1) {
    const dw = Math.max(1, sw >> 1);
    const dh = Math.max(1, sh >> 1);
    const data = new Uint8Array(dw * dh * 4);
    boxFilterPosterHalf(src, sw, sh, data, dw, dh);
    out.push({ level, width: dw, height: dh, data });
    src = data;
    sw = dw;
    sh = dh;
    level++;
  }
  return out;
}
