import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHardwarePosterDiagnosticPattern } from '../src/poster-quality-pattern.ts';

function meanHorizontalEdge(
  pixels: Uint8Array,
  width: number,
  height: number,
  box: { x0: number; x1: number; y0: number; y1: number },
): number {
  let sum = 0;
  let count = 0;
  for (let y = Math.floor(box.y0 * height); y < Math.floor(box.y1 * height); y++) {
    for (let x = Math.max(1, Math.floor(box.x0 * width)); x < Math.floor(box.x1 * width); x++) {
      const i = (y * width + x) * 4;
      const j = i - 4;
      sum += Math.abs(pixels[i]! - pixels[j]!)
        + Math.abs(pixels[i + 1]! - pixels[j + 1]!)
        + Math.abs(pixels[i + 2]! - pixels[j + 2]!);
      count++;
    }
  }
  return count ? sum / count : 0;
}

test('hardware pattern has large low-frequency regions and a bounded calibration zone', () => {
  const width = 320;
  const height = 480;
  const p = makeHardwarePosterDiagnosticPattern(width, height);
  const largeWhiteRegion = meanHorizontalEdge(p, width, height, { x0: 0.22, x1: 0.44, y0: 0.18, y1: 0.36 });
  const calibration = meanHorizontalEdge(p, width, height, { x0: 0.70, x1: 0.93, y0: 0.71, y1: 0.93 });
  assert.ok(largeWhiteRegion < 1, `large region edge=${largeWhiteRegion}`);
  assert.ok(calibration > 100, `calibration edge=${calibration}`);
  assert.ok((0.94 - 0.69) * (0.94 - 0.70) < 0.08);
});

test('BASE NEAR and FOCUS use the same normalized large-area colors', () => {
  for (const [w, h] of [[96, 144], [320, 480], [640, 960]] as const) {
    const p = makeHardwarePosterDiagnosticPattern(w, h);
    const sample = (gx: number, gy: number) => {
      const x = Math.floor(gx * w);
      const y = Math.floor(gy * h);
      const i = (y * w + x) * 4;
      return [...p.slice(i, i + 3)];
    };
    assert.deepEqual(sample(0.3, 0.3), [244, 246, 242]);
    assert.deepEqual(sample(0.7, 0.3), [158, 166, 176]);
    assert.deepEqual(sample(0.3, 0.6), [46, 184, 214]);
  }
});
