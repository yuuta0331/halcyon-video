import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  storeVisibleWork,
} from '../src/perf/store-visible-work.ts';
import {
  beginStoreVisibleLoading,
  isStoreVisualReady,
  markStoreInteractive,
  noteStoreVisibleResolved,
  refreshStoreVisualReady,
  resetStoreVisualReady,
  storeVisibleProgress,
} from '../src/store-visual-ready.ts';
import { seedCanonicalWorldReadyForTests } from '../src/xr/content-diagnostics.ts';
import {
  queueTextureUpload,
  resetTextureUploadQueueForTests,
  setUploadTurbo,
  pendingScopedTextureUploads,
  dropQueuedUploadsForMovie,
} from '../src/perf/texture-upload-queue.ts';
import { uniqueCoverDataUrl, uniqueCoverRgb } from '../src/perf/synthetic-cover.ts';
import {
  groupSlotsByPosterBank,
  posterBankBatchUpperBound,
} from '../src/perf/poster-bank-batches.ts';
import {
  effectivePosterArrayLayerCeiling,
  resetTestPosterArrayLayerCeiling,
  setTestPosterArrayLayerCeiling,
  testPosterArrayLayerCeiling,
} from '../src/perf/test-array-layer-ceiling.ts';
import { readResourceFlags } from '../src/perf/resource-profile.ts';
import type { MovieSlot } from '../src/store-layout.ts';

function resetAll(): void {
  resetStoreVisualReady();
  resetTextureUploadQueueForTests();
  setUploadTurbo(true);
  resetTestPosterArrayLayerCeiling();
}

test('STORE_VISIBLE_BASE real success becomes terminal REAL_READY', () => {
  resetAll();
  beginStoreVisibleLoading({ posterIds: ['a'] });
  noteStoreVisibleResolved('a', 'uploaded');
  seedCanonicalWorldReadyForTests();
  refreshStoreVisualReady();
  const p = storeVisibleProgress();
  assert.equal(storeVisibleWork.terminalState('a'), 'REAL_READY');
  assert.equal(p.postersUploaded, 1);
  assert.equal(p.postersFallback, 0);
  assert.equal(p.visualReady, true);
});

test('fallback cannot become ready while old work can still mutate GPU', () => {
  resetAll();
  beginStoreVisibleLoading({ posterIds: ['a'] });
  storeVisibleWork.noteUploadQueued('STORE_VISIBLE_BASE');
  noteStoreVisibleResolved('a', 'fallback');
  seedCanonicalWorldReadyForTests();
  refreshStoreVisualReady();
  assert.equal(isStoreVisualReady(), false);
  assert.equal(storeVisibleProgress().pendingBaseUpload, 1);
  storeVisibleWork.noteUploadFinished('STORE_VISIBLE_BASE');
  refreshStoreVisualReady();
  assert.equal(isStoreVisualReady(), true);
});

test('late stale upload after STABLE_FALLBACK is rejected', () => {
  resetAll();
  beginStoreVisibleLoading({ posterIds: ['a'] });
  noteStoreVisibleResolved('a', 'fallback');
  let mutated = false;
  queueTextureUpload(() => { mutated = true; }, 'priority', {
    scope: 'STORE_VISIBLE_BASE',
    generation: storeVisibleWork.currentGeneration(),
    movieId: 'a',
  });
  const dropped = dropQueuedUploadsForMovie('a');
  assert.ok(dropped >= 1);
  assert.equal(mutated, false);
  assert.equal(storeVisibleWork.isStableFallback('a'), true);
  assert.ok(storeVisibleProgress().lateRealUploadRejected >= 1);
  noteStoreVisibleResolved('a', 'uploaded');
  assert.equal(storeVisibleWork.terminalState('a'), 'STABLE_FALLBACK');
  assert.equal(storeVisibleProgress().postersUploaded, 0);
  assert.equal(storeVisibleProgress().postersFallback, 1);
});

test('fallback count reflects actual authoritative state', () => {
  resetAll();
  beginStoreVisibleLoading({ posterIds: ['a', 'b'] });
  noteStoreVisibleResolved('a', 'uploaded');
  noteStoreVisibleResolved('b', 'fallback');
  const p = storeVisibleProgress();
  assert.equal(p.postersUploaded, 1);
  assert.equal(p.postersFallback, 1);
  assert.equal(p.postersMissing, 0);
});

test('real-before-reveal replacement updates fallback/uploaded accounting', () => {
  resetAll();
  beginStoreVisibleLoading({ posterIds: ['a'] });
  noteStoreVisibleResolved('a', 'fallback', { terminal: false });
  assert.equal(storeVisibleProgress().postersFallback, 1);
  assert.equal(storeVisibleProgress().postersUploaded, 0);
  assert.equal(storeVisibleWork.terminalState('a'), null);
  noteStoreVisibleResolved('a', 'uploaded');
  const p = storeVisibleProgress();
  assert.equal(p.postersFallback, 0);
  assert.equal(p.postersUploaded, 1);
  assert.equal(p.fallbackReplacementCount, 1);
  assert.equal(storeVisibleWork.terminalState('a'), 'REAL_READY');
});

test('STORE_VISUAL_READY false while scoped pending upload exists', () => {
  resetAll();
  beginStoreVisibleLoading({ posterIds: ['a'] });
  noteStoreVisibleResolved('a', 'uploaded');
  storeVisibleWork.noteUploadQueued('STORE_VISIBLE_BASE');
  seedCanonicalWorldReadyForTests();
  refreshStoreVisualReady();
  assert.equal(isStoreVisualReady(), false);
  assert.equal(storeVisibleProgress().pendingBaseWork > 0, true);
});

test('STORE_VISUAL_READY true when WORLD_REQUIRED + scoped base pipeline drained', () => {
  resetAll();
  beginStoreVisibleLoading({ posterIds: ['a', 'b'] });
  noteStoreVisibleResolved('a', 'uploaded');
  noteStoreVisibleResolved('b', 'fallback');
  seedCanonicalWorldReadyForTests();
  refreshStoreVisualReady();
  const p = storeVisibleProgress();
  assert.equal(p.visualReady, true);
  assert.equal(p.worldReady, true);
  assert.equal(p.requiredReady, true);
  assert.equal(p.pendingBaseWork, 0);
  assert.equal(p.pendingBaseUpload, 0);
  assert.equal(p.pendingBaseDecode, 0);
  markStoreInteractive();
  assert.equal(storeVisibleProgress().state, 'STORE_INTERACTIVE');
});

test('ON_DEMAND pending work does not block initial store reveal', () => {
  resetAll();
  beginStoreVisibleLoading({ posterIds: ['a'] });
  noteStoreVisibleResolved('a', 'uploaded');
  storeVisibleWork.noteUploadQueued('ON_DEMAND');
  seedCanonicalWorldReadyForTests();
  refreshStoreVisualReady();
  assert.equal(isStoreVisualReady(), true);
  assert.equal(storeVisibleProgress().onDemandPendingWork, 1);
  assert.equal(pendingScopedTextureUploads('ON_DEMAND'), 0);
});

test('after reveal, base pending counters stay zero', () => {
  resetAll();
  beginStoreVisibleLoading({ posterIds: ['a'] });
  noteStoreVisibleResolved('a', 'uploaded');
  seedCanonicalWorldReadyForTests();
  refreshStoreVisualReady();
  markStoreInteractive();
  const p = storeVisibleProgress();
  assert.equal(p.state, 'STORE_INTERACTIVE');
  assert.equal(p.pendingBaseWork, 0);
  assert.equal(p.pendingBaseUpload, 0);
});

test('movement after reveal produces no base upload/eviction/reacquire churn', () => {
  resetAll();
  beginStoreVisibleLoading({ posterIds: ['a'] });
  noteStoreVisibleResolved('a', 'uploaded');
  seedCanonicalWorldReadyForTests();
  refreshStoreVisualReady();
  markStoreInteractive();
  const before = storeVisibleWork.snapshot();
  storeVisibleWork.noteUploadQueued('ON_DEMAND');
  storeVisibleWork.noteUploadFinished('ON_DEMAND');
  const after = storeVisibleWork.snapshot();
  assert.equal(after.pendingWork, 0);
  assert.equal(after.realReady, before.realReady);
  assert.equal(after.stableFallback, before.stableFallback);
});

test('scene rebuild invalidates prior-generation asynchronous work', () => {
  resetAll();
  beginStoreVisibleLoading({ posterIds: ['a'] });
  const gen = storeVisibleWork.currentGeneration();
  let mutated = false;
  queueTextureUpload(() => { mutated = true; }, 'bulk', {
    scope: 'STORE_VISIBLE_BASE',
    generation: gen,
    movieId: 'a',
  });
  beginStoreVisibleLoading({ posterIds: ['a'] });
  assert.equal(storeVisibleWork.allowsGpuMutation('a', gen), false);
  const leftover = pendingScopedTextureUploads('STORE_VISIBLE_BASE');
  if (leftover > 0) {
    dropQueuedUploadsForMovie('a');
  }
  assert.equal(mutated, false);
  assert.ok(storeVisibleProgress().staleGenerationDrops >= 1 || leftover === 0);
});

test('unique synthetic covers are distinct PNG data URLs', () => {
  const a = uniqueCoverRgb(7);
  const b = uniqueCoverRgb(8);
  assert.notDeepEqual(a, b);
  const url = uniqueCoverDataUrl(7);
  assert.match(url, /^data:image\/png;base64,/);
});

test('poster bank batch upper bound is source meshes times catalog banks', () => {
  assert.equal(posterBankBatchUpperBound(4, 3), 12);
  assert.equal(posterBankBatchUpperBound(0, 3), 0);
  const slots = [0, 7, 8, 15, 16, 23].map((i) => ({
    movie: { id: `t${i}` },
  })) as unknown as MovieSlot[];
  const idx = new Map([['t0', 0], ['t7', 7], ['t8', 8], ['t15', 15], ['t16', 16], ['t23', 23]]);
  const groups = groupSlotsByPosterBank(slots, (id) => idx.get(id) ?? 0, 8, 3);
  assert.equal(groups.size, 3);
  assert.equal(groups.get(0)?.length, 2);
  assert.equal(groups.get(1)?.length, 2);
  assert.equal(groups.get(2)?.length, 2);
});

test('test array-layer ceiling stays separate from hardware', () => {
  resetTestPosterArrayLayerCeiling();
  assert.equal(testPosterArrayLayerCeiling(), null);
  assert.equal(effectivePosterArrayLayerCeiling(2048), 2048);
  setTestPosterArrayLayerCeiling(8);
  assert.equal(testPosterArrayLayerCeiling(), 8);
  assert.equal(effectivePosterArrayLayerCeiling(2048), 8);
  assert.equal(readResourceFlags('?xrMultibank=1&xrPosterLayers=8').multibank, true);
  assert.equal(readResourceFlags('?xrMultibank=1&xrPosterLayers=8').posterLayers, 8);
  assert.equal(readResourceFlags('?demo=1').multibank, false);
  resetTestPosterArrayLayerCeiling();
});
