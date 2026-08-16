import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  firstFrameBeforeTargetFrameRate,
  targetFrameRateBlocksFirstFrame,
  XR_ENTRY_CRITICAL_PATH,
} from '../src/xr/entry-order.ts';
import { selectReferenceSpaceTypeFromFeatures } from '../src/xr/session-policy.ts';
import { readXrFlags } from '../src/xr/flags.ts';

test('entry critical path places setSession before first render and fps after', () => {
  assert.deepEqual([...XR_ENTRY_CRITICAL_PATH], [
    'requestSession',
    'selectReferenceSpaceType',
    'configureRendererPreSession',
    'makeXRCompatible',
    'renderer.setSession',
    'firstXrRender',
  ]);
  assert.equal(XR_ENTRY_CRITICAL_PATH.includes('updateTargetFrameRate' as never), false);
});

test('frame-rate negotiation must not precede first world frame', () => {
  assert.equal(targetFrameRateBlocksFirstFrame({
    firstWorldRenderCompletedAt: 20,
    targetFrameRateRequestedAt: 10,
  }), true);
  assert.equal(firstFrameBeforeTargetFrameRate({
    firstWorldRenderCompletedAt: 20,
    targetFrameRateRequestedAt: 25,
  }), true);
  assert.equal(firstFrameBeforeTargetFrameRate({
    firstWorldRenderCompletedAt: 20,
    targetFrameRateRequestedAt: null,
  }), true);
});

test('reference space is selected from enabledFeatures without probing', () => {
  assert.equal(selectReferenceSpaceTypeFromFeatures(['local-floor', 'layers']), 'local-floor');
  assert.equal(selectReferenceSpaceTypeFromFeatures(['layers']), 'local');
  assert.equal(selectReferenceSpaceTypeFromFeatures([]), 'local');
  assert.equal(selectReferenceSpaceTypeFromFeatures(null), 'local');
});

test('raw and three-baseline flags are distinct diagnostic modes', () => {
  assert.equal(readXrFlags('?xrRaw=1').raw, true);
  assert.equal(readXrFlags('?xrRaw=1').bare, false);
  assert.equal(readXrFlags('?xrThreeBaseline=1').threeBaseline, true);
  assert.equal(readXrFlags('?xrThreeBaseline=1').raw, false);
  assert.equal(readXrFlags('?xrBare=1').raw, false);
});
