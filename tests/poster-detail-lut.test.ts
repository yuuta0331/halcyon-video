import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DetailLutCpu,
  DETAIL_LUT_FAIL_CLOSED,
  planDetailLut,
} from '../src/poster-detail-lut.ts';

test('DETAIL LUT plans 1, 2001, 2048, 2049, and 4000 without a 2048 cliff', () => {
  const max = 4096;
  for (const n of [1, 2001, 2048, 2049, 4000]) {
    const plan = planDetailLut(n, max);
    assert.equal(plan.ok, true, `plan ${n}`);
    assert.ok(plan.capacity >= n, `${n} capacity ${plan.capacity}`);
  }
  const over1d = planDetailLut(2049, 2048);
  assert.equal(over1d.ok, true);
  assert.equal(over1d.width, 2048);
  assert.equal(over1d.height, 2);
  assert.ok(over1d.capacity >= 2049);
});

test('last catalog entries beyond 2048 can receive and clear DETAIL mappings', () => {
  const lut = new DetailLutCpu(planDetailLut(4000, 4096));
  assert.equal(lut.set(2001, 3), true);
  assert.equal(lut.get(2001), 3);
  assert.equal(lut.set(2048, 4), true);
  assert.equal(lut.get(2048), 4);
  assert.equal(lut.set(2049, 5), true);
  assert.equal(lut.get(2049), 5);
  assert.equal(lut.set(3999, 6), true);
  assert.equal(lut.get(3999), 6);
  assert.equal(lut.clear(3999), true);
  assert.equal(lut.get(3999), 0);
  assert.equal(lut.get(2049), 5);
});

test('DETAIL LUT fail-closed when catalog exceeds MAX_TEXTURE_SIZE squared', () => {
  const plan = planDetailLut(4096 * 4096 + 1, 4096);
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, DETAIL_LUT_FAIL_CLOSED);
  const lut = new DetailLutCpu(plan);
  assert.equal(lut.set(0, 1), false);
  assert.ok(lut.rejected >= 1);
});

test('2D packing maps index 2048 to the second row when width is 2048', () => {
  const lut = new DetailLutCpu(planDetailLut(3000, 2048));
  assert.equal(lut.set(2048, 7), true);
  assert.equal(lut.get(2047), 0);
  assert.equal(lut.get(2048), 7);
  assert.equal(lut.clear(2048), true);
  assert.equal(lut.get(2048), 0);
});
