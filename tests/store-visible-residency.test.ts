import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  choosePosterBankLayout,
  stablePosterMapping,
  QUEST_SAFE_POSTER_GPU_BUDGET,
} from '../src/perf/poster-bank-layout.ts';
import { StoreVisibleResidency } from '../src/store-visible-residency.ts';
import {
  beginStoreVisibleLoading,
  isStoreVisualReady,
  noteStoreVisibleResolved,
  resetStoreVisualReady,
  storeVisibleProgress,
  storeVisualReadyPromise,
} from '../src/store-visual-ready.ts';
import {
  XR_SAFE_FRAMEBUFFER_SCALE,
  XR_SAFE_WORLD_FOVEATION,
  XR_SAFE_UI_FOVEATION,
  foveationForUiMode,
  clampXrSafeFramebufferScale,
} from '../src/xr/quality-policy.ts';

test('stable mapping covers 1, 2, and 3+ banks without duplicates', () => {
  for (const unique of [64, 200, 400]) {
    const layout = choosePosterBankLayout({
      uniqueTitles: unique,
      maxArrayTextureLayers: 128,
      gpuBudgetBytes: QUEST_SAFE_POSTER_GPU_BUDGET,
    });
    assert.equal(layout.evictionWindow, false);
    const ids = Array.from({ length: unique }, (_, i) => `t${String(i).padStart(4, '0')}`);
    const map = stablePosterMapping(ids, layout.layersPerBank);
    assert.equal(map.size, unique);
    const owners = new Set<string>();
    for (const rec of map.values()) {
      const key = `${rec.bank}:${rec.layer}`;
      assert.equal(owners.has(key), false, key);
      owners.add(key);
    }
  }
});

test('constrained GPU drops base resolution instead of opening an eviction window', () => {
  const high = choosePosterBankLayout({
    uniqueTitles: 400,
    maxArrayTextureLayers: 256,
    gpuBudgetBytes: 512 * 1024 * 1024,
  });
  const low = choosePosterBankLayout({
    uniqueTitles: 400,
    maxArrayTextureLayers: 256,
    gpuBudgetBytes: 8 * 1024 * 1024,
  });
  assert.equal(high.evictionWindow, false);
  assert.equal(low.evictionWindow, false);
  assert.ok(low.width * low.height <= high.width * high.height);
  assert.equal(low.uniqueTitles, 400);
  assert.equal(high.uniqueTitles, 400);
});

test('movement and selection do not change STORE_VISIBLE_BASE mappings', () => {
  const res = new StoreVisibleResidency();
  const ids = Array.from({ length: 50 }, (_, i) => `m${i}`);
  res.bindCatalog(ids, { maxArrayTextureLayers: 32 });
  const before = res.cloneMappings();
  assert.equal(res.validate().ok, true);
  assert.equal(res.mappingsUnchanged(before), true);
  assert.equal(res.evictionCount, 0);
  assert.equal(res.peek('m0')?.globalIndex, 0);
  assert.equal(res.peek('m49') != null, true);
});

test('STORE_VISUAL_READY requires uploaded or fallback, not allocated/decoded', async () => {
  resetStoreVisualReady();
  beginStoreVisibleLoading({ posterIds: ['a', 'b'] });
  assert.equal(isStoreVisualReady(), false);
  noteStoreVisibleResolved('a', 'uploaded');
  assert.equal(isStoreVisualReady(), false);
  noteStoreVisibleResolved('b', 'fallback');
  await storeVisualReadyPromise();
  const p = storeVisibleProgress();
  assert.equal(p.visualReady, true);
  assert.equal(p.postersUploaded, 1);
  assert.equal(p.postersFallback, 1);
  assert.equal(p.state, 'STORE_VISUAL_READY');
});

test('Quest XR_SAFE readability floor is 0.8 with WORLD 0.5 / UI 0.0 foveation', () => {
  assert.equal(XR_SAFE_FRAMEBUFFER_SCALE, 0.8);
  assert.equal(clampXrSafeFramebufferScale(0.5), 0.8);
  assert.equal(XR_SAFE_WORLD_FOVEATION, 0.5);
  assert.equal(XR_SAFE_UI_FOVEATION, 0);
  assert.equal(foveationForUiMode('WORLD'), 0.5);
  assert.equal(foveationForUiMode('MENU'), 0);
  assert.equal(foveationForUiMode('SETTINGS'), 0);
});
