import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readXrFlags } from '../src/xr/flags.ts';
import {
  bareXrRequestOptions,
  diagnosticXrRequestOptions,
  halcyonInitialXrRequestOptions,
  immersiveVrRequestOptions,
  requestsFixedFoveationFeature,
  requestsLayersFeature,
} from '../src/xr/session-policy.ts';
import { trySetRuntimeFoveation } from '../src/xr/runtime-foveation.ts';
import {
  firstFrameBeforeTargetFrameRate,
  XR_ENTRY_CRITICAL_PATH,
} from '../src/xr/entry-order.ts';

function assertDiagnosticControl(options: ReturnType<typeof diagnosticXrRequestOptions>, label: string): void {
  assert.equal(requestsLayersFeature(options), false, `${label} must not request layers`);
  assert.equal(requestsFixedFoveationFeature(options), false, `${label} must not request fixed foveation`);
  assert.equal((options.requiredFeatures ?? []).length, 0, `${label} must not require features`);
  assert.ok(options.optionalFeatures.includes('local-floor'));
}

test('RAW request options omit layers and fixed foveation', () => {
  assertDiagnosticControl(diagnosticXrRequestOptions(), 'RAW');
  const raw = readFileSync('src/xr/raw.ts', 'utf8');
  assert.match(raw, /diagnosticXrRequestOptions\(\)/);
  assert.doesNotMatch(raw, /from ['"].*three-scene/);
  assert.doesNotMatch(raw, /import \* as THREE/);
});

test('THREE_BASELINE request options omit layers and fixed foveation', () => {
  assertDiagnosticControl(diagnosticXrRequestOptions(), 'THREE_BASELINE');
  const src = readFileSync('src/xr/three-baseline.ts', 'utf8');
  assert.match(src, /diagnosticXrRequestOptions\(\)/);
  assert.doesNotMatch(src, /from ['"].*three-scene/);
});

test('BARE request options stay minimal even if URL flags ask for layers/foveation', () => {
  const hostileFlags = { ...readXrFlags('?xrBare=1&xrSafe=1'), layers: true };
  const opts = bareXrRequestOptions(hostileFlags);
  assertDiagnosticControl(opts, 'BARE');
  const contaminated = immersiveVrRequestOptions({ layers: true, foveation: true });
  assert.equal(requestsLayersFeature(contaminated), true);
  assert.equal(requestsFixedFoveationFeature(contaminated), true);
  assert.notDeepEqual(opts.optionalFeatures, contaminated.optionalFeatures);
  const src = readFileSync('src/xr/bare.ts', 'utf8');
  assert.match(src, /bareXrRequestOptions\(\)/);
  assert.doesNotMatch(src, /from ['"].*three-scene/);
});

test('Halcyon xrMinimal initial request does not depend on fixed foveation', () => {
  const flags = readXrFlags('?xrMinimal=1');
  const opts = halcyonInitialXrRequestOptions({ layers: flags.layers });
  assert.equal(flags.layers, false);
  assert.equal(requestsLayersFeature(opts), false);
  assert.equal(requestsFixedFoveationFeature(opts), false);
  const runtime = readFileSync('src/xr/runtime.ts', 'utf8');
  assert.match(runtime, /halcyonInitialXrRequestOptions\(/);
  assert.doesNotMatch(runtime, /foveation:\s*true/);
});

test('Halcyon non-minimal path may request optional layers but never fixed foveation', () => {
  const flags = readXrFlags('?demo=1');
  const opts = halcyonInitialXrRequestOptions({ layers: flags.layers });
  assert.equal(requestsLayersFeature(opts), true);
  assert.equal(requestsFixedFoveationFeature(opts), false);
});

test('runtime setFoveation is post-session and failure is nonfatal', () => {
  const runtime = readFileSync('src/xr/runtime.ts', 'utf8');
  const setSessionIdx = runtime.indexOf('await xrMgr.setSession(session)');
  const foveationIdx = runtime.indexOf('trySetRuntimeFoveation(xrMgr, this.foveationRequested)');
  const firstWorldIdx = runtime.indexOf('this.requestTargetFrameRateBestEffort()');
  assert.ok(setSessionIdx > 0 && foveationIdx > setSessionIdx, 'setFoveation after setSession');
  assert.ok(firstWorldIdx > setSessionIdx, 'frame-rate helper is after setSession in source');
  assert.deepEqual(trySetRuntimeFoveation({ setFoveation: () => undefined }, 0), { attempted: true, ok: true });
  assert.deepEqual(trySetRuntimeFoveation({ setFoveation: () => undefined }, 1), { attempted: true, ok: true });
  assert.deepEqual(trySetRuntimeFoveation({
    setFoveation: () => { throw new Error('foveation unsupported'); },
  }, 1), { attempted: true, ok: false });
  assert.deepEqual(trySetRuntimeFoveation({}, 1), { attempted: false, ok: true });
});

test('entry order remains setSession then first render; first world before fps', () => {
  assert.deepEqual([...XR_ENTRY_CRITICAL_PATH], [
    'requestSession',
    'selectReferenceSpaceType',
    'configureRendererPreSession',
    'makeXRCompatible',
    'renderer.setSession',
    'firstXrRender',
  ]);
  assert.equal(firstFrameBeforeTargetFrameRate({
    firstWorldRenderCompletedAt: 20,
    targetFrameRateRequestedAt: 25,
  }), true);
  const runtime = readFileSync('src/xr/runtime.ts', 'utf8');
  const afterDirect = runtime.indexOf('afterDirectRender(at: number = nowMs())');
  const fpsCall = runtime.indexOf('this.requestTargetFrameRateBestEffort()');
  assert.ok(afterDirect > 0 && fpsCall > afterDirect);
});
