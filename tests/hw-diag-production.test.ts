import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HardwarePosterDiagnostic, hwPosterDiagModeMeta } from '../src/xr/hardware-poster-diagnostic.ts';
import { suppressHwDiagProductionBind, resetHwDiagObserveForTests, hwDiagObserveSnapshot, observeHwDiagBankBind } from '../src/perf/hw-diag-observe.ts';
import { resetXrUploadMetricsForTests, noteScheduledUpload, xrUploadMetricsSnapshot } from '../src/perf/xr-upload-metrics.ts';
import { placeHardwarePosterFromViewer, posterFrontFacesViewer } from '../src/xr/hardware-poster-placement.ts';
import { STORE_UNITS_PER_METER } from '../src/platform/index.ts';
import { setViewerWorldPose, viewerPoseFromTransform } from '../src/xr/viewer-pose.ts';

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
  assert.equal(a.side, 'DoubleSide');
  assert.match(a.baselineSemantics ?? '', /DoubleSide.*backface/i);
});

test('bank-bind observer increments only after an available actual bind', () => {
  resetHwDiagObserveForTests();
  let calls = 0;
  assert.equal(observeHwDiagBankBind(false, () => { calls++; }), false);
  assert.equal(calls, 0);
  assert.equal(hwDiagObserveSnapshot().diagBankBindCount, 0);
  suppressHwDiagProductionBind(true);
  assert.equal(observeHwDiagBankBind(true, () => { calls++; }), false);
  assert.equal(calls, 0);
  assert.equal(hwDiagObserveSnapshot().diagBankBindCount, 0);
  suppressHwDiagProductionBind(false);
  assert.equal(observeHwDiagBankBind(true, () => { calls++; }), true);
  assert.equal(calls, 1);
  assert.equal(hwDiagObserveSnapshot().diagBankBindCount, 1);
  assert.throws(() => observeHwDiagBankBind(true, () => { throw new Error('bind failed'); }));
  assert.equal(hwDiagObserveSnapshot().diagBankBindCount, 1);
  resetHwDiagObserveForTests();
});

test('fresh viewer placement is eye-height, horizontal-yaw, and front-facing', () => {
  const viewer = { x: 13.4, y: 1.68 * STORE_UNITS_PER_METER, z: 9.2, yaw: 0.73 };
  const placed = placeHardwarePosterFromViewer({
    viewerX: viewer.x,
    viewerY: viewer.y,
    viewerZ: viewer.z,
    viewerYaw: viewer.yaw,
    storeUnitsPerMeter: STORE_UNITS_PER_METER,
  });
  assert.ok(Math.abs(placed.y - viewer.y) < 1e-9);
  assert.ok(Math.abs(Math.hypot(placed.x - viewer.x, placed.z - viewer.z) / STORE_UNITS_PER_METER - 1.05) < 1e-9);
  assert.equal(placed.yaw, viewer.yaw);
  assert.equal(posterFrontFacesViewer({
    posterX: placed.x, posterZ: placed.z, posterYaw: placed.yaw,
    viewerX: viewer.x, viewerZ: viewer.z,
  }), true);
});

test('diagnostic consumes the first fresh pose once, then poster remains world-stable', () => {
  const diag = new HardwarePosterDiagnostic();
  const pose1 = viewerPoseFromTransform(
    { x: 0, y: 1.72, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, 1, 0, 0,
  );
  setViewerWorldPose({ x: 13, y: 1.72 * STORE_UNITS_PER_METER, z: 12.5, yaw: 0, frameId: 1 });
  diag.tick(pose1, 0.05, 80);
  const first = diag.contentWorldPosition();
  assert.ok(Math.abs(first.y - 1.72 * STORE_UNITS_PER_METER) < 1e-9);
  const pose2 = viewerPoseFromTransform(
    { x: 0.4, y: 1.9, z: -0.3 },
    { x: 0, y: Math.sin(0.4), z: 0, w: Math.cos(0.4) },
    2, 20, 0,
  );
  setViewerWorldPose({ x: 15, y: 1.9 * STORE_UNITS_PER_METER, z: 10, yaw: 0.8, frameId: 2 });
  diag.tick(pose2, 0.05, 80);
  const second = diag.contentWorldPosition();
  assert.ok(first.distanceTo(second) < 1e-9);
  setViewerWorldPose(null);
  diag.dispose();
});

test('scheduled FOCUS upload is not counted as a GL texSubImage call', () => {
  resetXrUploadMetricsForTests();
  noteScheduledUpload({ textures: 1, bytes: 640 * 960 * 4, preparationMs: 0.4 });
  const snap = xrUploadMetricsSnapshot();
  assert.equal(snap.texSubImageCalls, 0);
  assert.equal(snap.texturesScheduledForUpload, 1);
  assert.equal(snap.bytesScheduledForUpload, 640 * 960 * 4);
});
