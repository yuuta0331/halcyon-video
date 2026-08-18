import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HardwarePosterDiagnostic, hwPosterDiagModeMeta } from '../src/xr/hardware-poster-diagnostic.ts';
import { suppressHwDiagProductionBind, resetHwDiagObserveForTests, hwDiagObserveSnapshot, noteHwDiagBankBind } from '../src/perf/hw-diag-observe.ts';
import { resetXrUploadMetricsForTests, noteScheduledUpload, xrUploadMetricsSnapshot } from '../src/perf/xr-upload-metrics.ts';

test('diagnostic poster content stays world-stable when the player rig moves', () => {
  const diag = new HardwarePosterDiagnostic({ worldAnchor: 'origin' });
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  scene.add(rig);
  diag.attach(scene, rig);
  scene.updateMatrixWorld(true);
  const before = diag.contentWorldPosition();
  const labelBefore = diag.labelWorldPosition();
  rig.position.set(3.2, 0, -2.5);
  rig.rotation.y = 0.9;
  scene.updateMatrixWorld(true);
  const after = diag.contentWorldPosition();
  const labelAfter = diag.labelWorldPosition();
  assert.ok(before.distanceTo(after) < 1e-6);
  assert.ok(labelAfter.distanceTo(labelBefore) > 0.5);
  diag.dispose();
});

test('mode metadata classifies C/D/E as production shader path, A/B as synthetic', () => {
  const a = hwPosterDiagModeMeta('A');
  const b = hwPosterDiagModeMeta('B');
  const c = hwPosterDiagModeMeta('C');
  const d = hwPosterDiagModeMeta('D');
  const e = hwPosterDiagModeMeta('E');
  assert.equal(a.shaderPath, 'MeshBasicMaterial');
  assert.equal(b.geometryPath, 'createClonedCaseGeometry');
  assert.equal(c.shaderPath, 'posterShaderChunk');
  assert.equal(c.detailLutEnabled, false);
  assert.equal(c.focusEnabled, false);
  assert.equal(d.detailLutEnabled, true);
  assert.equal(d.focusEnabled, false);
  assert.equal(e.focusEnabled, true);
  assert.equal(e.baseEnabled, true);
  assert.equal(a.worldStable, true);
});

test('production-bind negative control can fail then recover', () => {
  resetHwDiagObserveForTests();
  suppressHwDiagProductionBind(true);
  noteHwDiagBankBind();
  assert.equal(hwDiagObserveSnapshot().diagBankBindCount, 0);
  suppressHwDiagProductionBind(false);
  noteHwDiagBankBind();
  assert.equal(hwDiagObserveSnapshot().diagBankBindCount, 1);
  resetHwDiagObserveForTests();
});

test('scheduled FOCUS upload is not counted as a GL texSubImage call', () => {
  resetXrUploadMetricsForTests();
  noteScheduledUpload({ textures: 1, bytes: 640 * 960 * 4, preparationMs: 0.4 });
  const snap = xrUploadMetricsSnapshot();
  assert.equal(snap.texSubImageCalls, 0);
  assert.equal(snap.texturesScheduledForUpload, 1);
  assert.equal(snap.bytesScheduledForUpload, 640 * 960 * 4);
});
