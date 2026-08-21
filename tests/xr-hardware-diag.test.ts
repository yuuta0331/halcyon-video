import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hardwarePosterDiagRequested,
  HW_POSTER_DIAG_MODES,
  hwPosterDiagModeMeta,
  nextHwPosterDiagMode,
} from '../src/xr/hardware-poster-diagnostic.ts';
import { bothXrEyesSeeLayer, MIRROR_SKIP_LAYER } from '../src/scene-layers.ts';
import { readXrFlags } from '../src/xr/flags.ts';

test('A/B/C/D/E modes are selectable in a cycle', () => {
  let mode: (typeof HW_POSTER_DIAG_MODES)[number] = 'A';
  const seen = new Set<string>();
  for (let i = 0; i < 5; i++) {
    seen.add(mode);
    mode = nextHwPosterDiagMode(mode);
  }
  assert.deepEqual([...seen].sort(), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(mode, 'A');
});

test('diagnostic flag does not affect normal launch', () => {
  assert.equal(hardwarePosterDiagRequested(''), false);
  assert.equal(hardwarePosterDiagRequested('?demo=1'), false);
  assert.equal(hardwarePosterDiagRequested('?xrPosterHwDiag=1'), true);
  assert.equal(readXrFlags('').posterHwDiag, false);
  assert.equal(readXrFlags('?xrPosterHwDiag=1').posterHwDiag, true);
});

test('mode metadata reports shader/texture/depth policy', () => {
  const a = hwPosterDiagModeMeta('A');
  const c = hwPosterDiagModeMeta('C');
  const e = hwPosterDiagModeMeta('E');
  assert.equal(a.array, false);
  assert.equal(a.depthTest, false);
  assert.equal(c.array, true);
  assert.equal(c.shaderPath, 'posterShaderChunk');
  assert.equal(e.focusEnabled, true);
  assert.equal(e.depthWrite, true);
  assert.equal(a.stereoBothEyes, true);
});

test('diagnostic modes remain stereo-visible on layer 0+3', () => {
  const user = (1 << 0) | (1 << 1) | (1 << MIRROR_SKIP_LAYER);
  assert.equal(bothXrEyesSeeLayer(user, MIRROR_SKIP_LAYER), true);
  assert.equal(bothXrEyesSeeLayer(user, 0), true);
});
