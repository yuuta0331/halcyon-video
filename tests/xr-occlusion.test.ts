import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  legacyPresentingOnlyPauseWouldFire,
  shouldPauseStoreRenderingOnOcclusion,
  xrPhaseOwnsRenderLoop,
} from '../src/xr/occlusion-policy.ts';
import type { XrSessionPhase } from '../src/xr/types.ts';

function applyPause(state: { phase: XrSessionPhase; presenting: boolean; isRendering: boolean }): boolean {
  if (!shouldPauseStoreRenderingOnOcclusion(state)) return false;
  state.isRendering = false;
  return true;
}

test('idle desktop + blur pauses rendering', () => {
  const state = { phase: 'idle' as const, presenting: false, isRendering: true };
  assert.equal(applyPause(state), true);
  assert.equal(state.isRendering, false);
});

test('requesting + not-presenting + blur MUST NOT pause', () => {
  assert.equal(legacyPresentingOnlyPauseWouldFire({ presenting: false }), true, 'pre-fix stall reproduced');
  const state = { phase: 'requesting' as const, presenting: false, isRendering: true };
  assert.equal(applyPause(state), false);
  assert.equal(state.isRendering, true);
  assert.equal(xrPhaseOwnsRenderLoop('requesting'), true);
});

test('binding + not-presenting + blur MUST NOT pause', () => {
  const state = { phase: 'binding' as const, presenting: false, isRendering: true };
  assert.equal(applyPause(state), false);
  assert.equal(state.isRendering, true);
});

test('projecting + presenting + blur MUST NOT pause', () => {
  const state = { phase: 'projecting' as const, presenting: true, isRendering: true };
  assert.equal(applyPause(state), false);
  assert.equal(state.isRendering, true);
});

test('active + blur MUST NOT pause', () => {
  const state = { phase: 'active' as const, presenting: true, isRendering: true };
  assert.equal(applyPause(state), false);
  assert.equal(state.isRendering, true);
});

test('session ends then later desktop blur pauses normally', () => {
  const during = { phase: 'ending' as const, presenting: false, isRendering: true };
  assert.equal(applyPause(during), false);
  const after = { phase: 'idle' as const, presenting: false, isRendering: true };
  assert.equal(applyPause(after), true);
  assert.equal(after.isRendering, false);
});
