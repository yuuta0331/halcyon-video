import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  choosePosterBankLayout,
  stablePosterMapping,
  QUEST_SAFE_POSTER_GPU_BUDGET,
} from '../src/perf/poster-bank-layout.ts';
import { StoreVisibleResidency } from '../src/store-visible-residency.ts';
import {
  beginStoreVisibleLoading,
  isStoreVisualReady,
  markStoreInteractive,
  noteStoreVisibleResolved,
  refreshStoreVisualReady,
  resetStoreVisualReady,
  storeVisibleProgress,
  storeVisualReadyPromise,
} from '../src/store-visual-ready.ts';
import {
  seedCanonicalWorldReadyForTests,
  xrContentSnapshot,
} from '../src/xr/content-diagnostics.ts';
import {
  XR_SAFE_FRAMEBUFFER_SCALE,
  XR_SAFE_WORLD_FOVEATION,
  XR_SAFE_UI_FOVEATION,
  foveationForUiMode,
  clampXrSafeFramebufferScale,
} from '../src/xr/quality-policy.ts';
import { XR_UI_PIXEL_WIDTH, XR_UI_PIXEL_HEIGHT } from '../src/xr/ui/hit.ts';
import { estimateXrSafeFragmentSamplers } from '../src/perf/resource-profile.ts';

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `t${String(i).padStart(4, '0')}`);
}

test('stable mapping covers 1, 2, and 3+ banks without duplicates', () => {
  for (const unique of [64, 200, 400]) {
    const layout = choosePosterBankLayout({
      uniqueTitles: unique,
      maxArrayTextureLayers: 128,
      gpuBudgetBytes: QUEST_SAFE_POSTER_GPU_BUDGET,
    });
    assert.equal(layout.evictionWindow, false);
    const map = stablePosterMapping(ids(unique), layout);
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

test('JP4A_CAPACITY_256_2001 is representable without a four-bank ceiling', () => {
  const layout = choosePosterBankLayout({
    uniqueTitles: 2001,
    maxArrayTextureLayers: 256,
  });
  const map = stablePosterMapping(ids(2001), layout);
  assert.ok(layout.bankCount >= 8);
  assert.equal(layout.samplersPerDraw, 1);
  assert.equal(layout.evictionWindow, false);
  assert.equal(layout.capacityOk, true);
  assert.equal(map.size, 2001);
  assert.equal(layout.cpuBytesActive, layout.width * layout.height * 4 * 2001);
});

test('JP4A_CAPACITY_512_2001 uses at least four banks', () => {
  const layout = choosePosterBankLayout({
    uniqueTitles: 2001,
    maxArrayTextureLayers: 512,
  });
  assert.ok(layout.bankCount >= 4);
  assert.equal(layout.samplersPerDraw, 1);
  assert.equal(stablePosterMapping(ids(2001), layout).size, 2001);
});

test('JP4A_CAPACITY_256_4000 uses 16 banks and one sampler per draw', () => {
  const layout = choosePosterBankLayout({
    uniqueTitles: 4000,
    maxArrayTextureLayers: 256,
  });
  const map = stablePosterMapping(ids(4000), layout);
  assert.equal(layout.bankCount, 16);
  assert.equal(layout.renderBatchCount, 16);
  assert.equal(layout.samplersPerDraw, 1);
  assert.equal(layout.capacityOk, true);
  assert.equal(map.size, 4000);
  assert.equal(layout.cpuBytesActive, layout.width * layout.height * 4 * 4000);
});

test('catalog bank count does not imply equal simultaneous sampler count', () => {
  const layout = choosePosterBankLayout({
    uniqueTitles: 4000,
    maxArrayTextureLayers: 256,
  });
  assert.ok(layout.bankCount > 4);
  assert.equal(layout.samplersPerDraw, 1);
  assert.equal(estimateXrSafeFragmentSamplers(), 4);
});

test('movement and selection do not change STORE_VISIBLE_BASE mappings', () => {
  const res = new StoreVisibleResidency();
  const catalog = ids(2001);
  res.bindCatalog(catalog, { maxArrayTextureLayers: 256 });
  const before = res.cloneMappings();
  const inv = res.validate();
  assert.equal(inv.capacityInvariantOk, true);
  assert.equal(inv.expectedCount, 2001);
  assert.equal(inv.mappedCount, 2001);
  assert.equal(inv.actuallyRenderableCount, 2001);
  assert.equal(res.mappingsUnchanged(before), true);
  assert.equal(res.evictionCount, 0);
  assert.equal(res.reacquisitionCount, 0);
  assert.equal(res.peek(catalog[0]!)?.globalIndex, 0);
  assert.equal(res.peek(catalog[2000]!) != null, true);
});

test('STORE_VISUAL_READY requires uploaded or fallback, not allocated/decoded', async () => {
  resetStoreVisualReady();
  beginStoreVisibleLoading({ posterIds: ['a', 'b'] });
  assert.equal(isStoreVisualReady(), false);
  noteStoreVisibleResolved('a', 'uploaded');
  assert.equal(isStoreVisualReady(), false);
  noteStoreVisibleResolved('b', 'fallback');
  assert.equal(isStoreVisualReady(), false);
  seedCanonicalWorldReadyForTests();
  refreshStoreVisualReady();
  await storeVisualReadyPromise();
  const p = storeVisibleProgress();
  assert.equal(p.visualReady, true);
  assert.equal(p.worldReady, true);
  assert.equal(p.requiredReady, true);
  assert.equal(p.postersUploaded, 1);
  assert.equal(p.postersFallback, 1);
  assert.equal(p.state, 'STORE_VISUAL_READY');
});

test('poster readiness alone cannot reveal the store', () => {
  resetStoreVisualReady();
  beginStoreVisibleLoading({ posterIds: ['a'] });
  noteStoreVisibleResolved('a', 'uploaded');
  assert.equal(isStoreVisualReady(), false);
  assert.equal(xrContentSnapshot().worldReady, false);
});

test('signage pending forbids reveal', () => {
  resetStoreVisualReady();
  beginStoreVisibleLoading({ posterIds: ['a'] });
  noteStoreVisibleResolved('a', 'uploaded');
  seedCanonicalWorldReadyForTests({ signageVisible: 0 });
  refreshStoreVisualReady();
  assert.equal(isStoreVisualReady(), false);
  assert.equal(xrContentSnapshot().signage.state, 'missing');
  assert.equal(xrContentSnapshot().worldReady, false);
});

test('fixture/world resource missing forbids reveal', () => {
  resetStoreVisualReady();
  beginStoreVisibleLoading({ posterIds: ['a'] });
  noteStoreVisibleResolved('a', 'uploaded');
  seedCanonicalWorldReadyForTests({ fixtureTexturesVisible: 0 });
  refreshStoreVisualReady();
  assert.equal(isStoreVisualReady(), false);
  assert.equal(xrContentSnapshot().worldReady, false);
});

test('all required classes actual/fallback resolved allows reveal and worldReady', async () => {
  resetStoreVisualReady();
  beginStoreVisibleLoading({ posterIds: ['a', 'b'] });
  noteStoreVisibleResolved('a', 'uploaded');
  noteStoreVisibleResolved('b', 'fallback');
  seedCanonicalWorldReadyForTests();
  refreshStoreVisualReady();
  await storeVisualReadyPromise();
  assert.equal(isStoreVisualReady(), true);
  const snap = xrContentSnapshot();
  assert.equal(snap.worldReady, true);
  assert.equal(snap.requiredReady, true);
  markStoreInteractive();
  assert.equal(storeVisibleProgress().state, 'STORE_INTERACTIVE');
  assert.equal(xrContentSnapshot().worldReady, true);
});

test('XR enter is refused before canonical readiness', () => {
  const runtime = readFileSync('src/xr/runtime.ts', 'utf8');
  assert.match(runtime, /if \(!isStoreVisualReady\(\)\)/);
  assert.match(runtime, /STORE_VISIBLE_LOADING/);
  resetStoreVisualReady();
  beginStoreVisibleLoading({ posterIds: ['pending'] });
  assert.equal(isStoreVisualReady(), false);
});

test('Quest XR_SAFE readability floor is 0.8 with WORLD 0.5 / UI 0.0 foveation', () => {
  assert.equal(XR_SAFE_FRAMEBUFFER_SCALE, 0.8);
  assert.equal(clampXrSafeFramebufferScale(0.5), 0.8);
  assert.equal(XR_SAFE_WORLD_FOVEATION, 0.5);
  assert.equal(XR_SAFE_UI_FOVEATION, 0);
  assert.equal(foveationForUiMode('WORLD'), 0.5);
  assert.equal(foveationForUiMode('MENU'), 0);
  assert.equal(foveationForUiMode('SETTINGS'), 0);
  assert.equal(XR_UI_PIXEL_WIDTH, 1024);
  assert.equal(XR_UI_PIXEL_HEIGHT, 768);
});
