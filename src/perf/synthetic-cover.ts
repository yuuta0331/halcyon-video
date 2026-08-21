// Deterministic unique synthetic covers for production multibank sampling.
// Solid high-contrast RGB so rendered shelf pixels stay distinguishable
// after production lighting.

const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [255, 24, 24],
  [24, 220, 40],
  [32, 64, 255],
  [255, 220, 24],
  [255, 24, 220],
  [24, 220, 255],
  [255, 128, 24],
  [180, 32, 255],
  [24, 255, 160],
  [255, 80, 80],
  [80, 80, 255],
  [200, 200, 24],
  [24, 160, 80],
  [255, 160, 200],
  [120, 40, 24],
  [40, 40, 120],
  [255, 90, 24],
  [90, 255, 24],
  [24, 90, 255],
  [200, 24, 90],
  [24, 200, 90],
  [90, 24, 200],
  [160, 160, 255],
  [255, 160, 80],
];

export function uniqueCoverRgb(index: number): [number, number, number] {
  const i = Math.max(0, Math.floor(index));
  const hit = PALETTE[i];
  if (hit) return [hit[0], hit[1], hit[2]];
  const n = i + 1;
  return [
    40 + ((n * 67) % 200),
    40 + ((n * 149) % 200),
    40 + ((n * 211) % 200),
  ];
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
  const crcSrc = concat([t, data]);
  return concat([u32be(data.length), crcSrc, u32be(crc32(crcSrc))]);
}

/** Tiny uncompressed RGB PNG data URL for production poster decode. */
export function uniqueCoverDataUrl(index: number, width = 8, height = 12): string {
  const [r, g, b] = uniqueCoverRgb(index);
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const raw = new Uint8Array(h * (1 + w * 3));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const len = raw.length;
  const nlen = len ^ 0xffff;
  const deflate = concat([
    new Uint8Array([0x01, len & 255, (len >>> 8) & 255, nlen & 255, (nlen >>> 8) & 255]),
    raw,
  ]);
  const zlib = concat([
    new Uint8Array([0x78, 0x01]),
    deflate,
    u32be(adler32(raw)),
  ]);
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(w), 0);
  ihdr.set(u32be(h), 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib),
    chunk('IEND', new Uint8Array(0)),
  ]);
  return `data:image/png;base64,${bytesToBase64(png)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += table[(triple >> 18) & 63];
    out += table[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? table[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? table[triple & 63] : '=';
  }
  return out;
}

export function colorDistance(a: readonly number[], b: readonly number[]): number {
  const dr = (a[0] ?? 0) - (b[0] ?? 0);
  const dg = (a[1] ?? 0) - (b[1] ?? 0);
  const db = (a[2] ?? 0) - (b[2] ?? 0);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
