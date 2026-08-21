import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPosterMipChainForTest } from '../src/poster-mip-chain.ts';
import { posterIndexNotifyBankSafe, summarizePosterBankInvariant } from '../src/poster-bank-invariant.ts';
import {
  formatJp4aResult,
  jp4aResultJson,
  jp4aTestRequested,
  jp4aTestSnapshot,
  livePosterModeMeta,
  LIVE_POSTER_MODES,
  recordJp4aSample,
  setJp4aBankInvariant,
  setJp4aLockedPoster,
  startJp4aTest,
} from '../src/xr/jp4a-test-state.ts';
import { depthIsolatedPosterMatrix } from '../src/xr/live-poster-mode-math.ts';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

test('JP-4A console is gated to the short route or explicit query', () => {
  assert.equal(jp4aTestRequested('/xr-test/jp4a', ''), true);
  assert.equal(jp4aTestRequested('/', '?xrTest=jp4a'), true);
  assert.equal(jp4aTestRequested('/', '?fps=1'), false);
});

test('LIVE ladder changes one diagnostic variable from its nearest control', () => {
  assert.deepEqual([...LIVE_POSTER_MODES], [
    'LIVE-NORMAL', 'LIVE-BASE', 'LIVE-LOD0', 'LIVE-LOD1', 'LIVE-LOD2',
    'LIVE-LOD3', 'LIVE-LINEAR', 'LIVE-UNLIT', 'LIVE-DEPTH-ISOLATED',
  ]);
  const base = livePosterModeMeta('LIVE-BASE');
  const lod0 = livePosterModeMeta('LIVE-LOD0');
  const lod1 = livePosterModeMeta('LIVE-LOD1');
  const linear = livePosterModeMeta('LIVE-LINEAR');
  assert.equal(base.textureTier, 'base');
  assert.equal(base.mip, 'automatic');
  assert.equal(lod0.textureTier, base.textureTier);
  assert.equal(lod0.mip, 0);
  assert.equal(lod1.mip, 1);
  assert.equal(linear.textureTier, base.textureTier);
  assert.equal(linear.mip, 'linear-lod0');
  assert.equal(livePosterModeMeta('LIVE-UNLIT').lighting, 'unlit');
  assert.ok(livePosterModeMeta('LIVE-DEPTH-ISOLATED').depthOffsetStoreUnits > 0);
});

test('depth isolation translates only along poster-local front and preserves the source matrix', () => {
  const original = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(2, 3, 4);
  const before = original.toArray();
  const isolated = depthIsolatedPosterMatrix(original, 0.025);
  assert.deepEqual(original.toArray(), before);
  const p0 = new THREE.Vector3().setFromMatrixPosition(original);
  const p1 = new THREE.Vector3().setFromMatrixPosition(isolated);
  assert.ok(Math.abs(p0.distanceTo(p1) - 0.025) < 1e-9);
  assert.ok(Math.abs(p1.x - p0.x - 0.025) < 1e-9);
});

test('mip chain covers every level/byte size and odd-dimension edge pixels', () => {
  const source = new Uint8Array(5 * 3 * 4);
  for (let i = 0; i < source.length; i += 4) {
    source[i] = i / 4;
    source[i + 1] = 40;
    source[i + 2] = 80;
    source[i + 3] = 255;
  }
  const chain = buildPosterMipChainForTest(source, 5, 3);
  assert.deepEqual(chain.map((m) => [m.level, m.width, m.height, m.data.byteLength]), [
    [0, 5, 3, 60], [1, 2, 1, 8], [2, 1, 1, 4],
  ]);
  assert.ok(chain[1]!.data[4] > chain[1]!.data[0]);
  assert.equal(chain.at(-1)!.data[3], 255);
});

test('mip generator preserves distinct first/middle/last layer representatives', () => {
  const representatives = [7, 91, 203].map((seed) => {
    const layer = new Uint8Array(8 * 12 * 4);
    for (let i = 0; i < layer.length; i += 4) {
      layer[i] = seed; layer[i + 1] = seed; layer[i + 2] = seed; layer[i + 3] = 255;
    }
    return buildPosterMipChainForTest(layer, 8, 12).map((m) => m.data[0]);
  });
  assert.deepEqual(representatives.map((levels) => new Set(levels).size), [1, 1, 1]);
  assert.deepEqual(representatives.map((levels) => levels[0]), [7, 91, 203]);
});

test('bank invariant passes valid slots and catches mismatch/out-of-range fixtures', () => {
  const valid = summarizePosterBankInvariant([{
    globalIndex: 5, expectedBank: 1, expectedLayer: 1,
    frontBank: 1, backBank: 1, frontIndex: 5, backIndex: 5,
    bankCount: 2, arrayDepth: 4, loadedFlag: 255,
  }]);
  assert.equal(valid.pass, true);
  assert.equal(valid.verdict, 'PASS');
  const bad = summarizePosterBankInvariant([
    { globalIndex: 5, expectedBank: 1, expectedLayer: 4,
      frontBank: 0, backBank: 1, frontIndex: 4, backIndex: 5,
      bankCount: 2, arrayDepth: 4, loadedFlag: 17 },
    { globalIndex: null, expectedBank: null, expectedLayer: null,
      frontBank: null, backBank: null, frontIndex: null, backIndex: null,
      bankCount: 2, arrayDepth: 4, loadedFlag: null },
  ]);
  assert.equal(bad.pass, false);
  assert.equal(bad.verdict, 'FAIL');
  assert.equal(bad.bankMismatchCount, 1);
  assert.equal(bad.layerOutOfRangeCount, 1);
  assert.equal(bad.missingIndexCount, 1);
  assert.equal(bad.invalidLoadedFlagCount, 1);
  assert.equal(posterIndexNotifyBankSafe(5, 4, 1, 1), true);
  assert.equal(posterIndexNotifyBankSafe(5, 4, 0, 1), false);
});

test('zero-slot bank invariant is NOT_EXERCISED and never PASS', () => {
  const empty = summarizePosterBankInvariant([]);
  assert.equal(empty.checkedSlots, 0);
  assert.equal(empty.pass, false);
  assert.equal(empty.verdict, 'NOT_EXERCISED');
});

test('session reset/persistence/result APIs remain opaque and JSON-backed', () => {
  const oldStorage = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  try {
    const s = startJp4aTest(1_700_000_000_000);
    setJp4aLockedPoster({ opaqueId: 'opaque-deadbeef', globalIndex: 9,
      expectedBank: 1, meshBank: 1, expectedLayer: 1, loadedFlag: 255 });
    setJp4aBankInvariant({ checkedSlots: 8, bankMismatchCount: 0,
      layerOutOfRangeCount: 0, missingIndexCount: 0, invalidLoadedFlagCount: 0, pass: true });
    recordJp4aSample({
      timestamp: new Date().toISOString(), elapsedMs: 1000, phase: 'baseline', mode: 'LIVE-NORMAL',
      fps: 72, meanMs: 13.8, onePercentLowFps: 69, p95Ms: 14, p99Ms: 14.5, worstMs: 15,
      frameCount: 72, targetHz: 72, supportedHz: [72, 90], framebufferWidth: 1832,
      framebufferHeight: 1920, framebufferScale: 1, foveation: 0.5, drawCalls: 40,
      triangles: 1000, textures: 10, programs: 4, posterBankCount: 2, renderBatchCount: 12,
      lockedPosterOpaqueId: 'opaque-deadbeef', globalIndex: 9, expectedBank: 1, meshBank: 1,
      expectedLayer: 1, loadedFlag: 255, detailPhase: null, focusPhase: null,
      focusUploadProgress: null, pendingBase: 0, pendingNear: 0, pendingFocus: 0,
      gpuUploadBytes: 0, gpuUploadSubmitMs: 0, decodeMs: 0, viewerDistanceM: 8,
      viewerYawToPosterDeg: 30,
    });
    const text = formatJp4aResult();
    assert.match(text, /Baseline FPS: 72\.0 FPS/);
    assert.match(text, /opaque-deadbeef/);
    assert.doesNotMatch(text, /posterUrl|auth token|library title/i);
    const json = JSON.parse(jp4aResultJson());
    assert.equal(json.sessionId, s.sessionId);
    assert.equal(jp4aTestSnapshot()?.samples.length, 1);
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = oldStorage;
  }
});
