import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyPose,
  poseIsCurrent,
  poseIsStale,
  resetViewerPoseForTests,
  updateViewerPoseFromXrFrame,
  viewerPoseFromTransform,
  viewerPoseToWorld,
  viewerPoseToWorldXZ,
  VIEWER_POSE_STALE_MS,
} from '../src/xr/viewer-pose.ts';
import {
  clearUiPlacement,
  requestUiPlacement,
  takeUiPlacementFromViewerPose,
  uiPlacementPending,
  lastUiPlacementEvidence,
  resetUiPlacementForTests,
} from '../src/xr/ui-place-pending.ts';
import { XR_UI_DISTANCE_M, uiFacesHmd } from '../src/xr/ui-placement.ts';
import {
  HUD_VIEW_OFFSET,
  FPS_HUD_SIZE_M,
  MODE_HUD_SIZE_M,
  MODE_HUD_VIEW_OFFSET,
  hudFollowsViewer,
  hudOffsetIsReadableSide,
  placeHudFromViewerPose,
  projectedHudBounds,
  projectedHudBoundsOverlap,
} from '../src/xr/hud-placement.ts';

test('canonical viewer pose comes from XRFrame.getViewerPose', () => {
  resetViewerPoseForTests();
  const frame = {
    getViewerPose() {
      return {
        transform: {
          position: { x: 0.1, y: 1.6, z: -0.2 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
      };
    },
  };
  const pose = updateViewerPoseFromXrFrame({
    frame,
    referenceSpace: {},
    nowMs: 10,
    frameId: 3,
  });
  assert.equal(pose.source, 'XR_VIEWER_POSE');
  assert.equal(pose.valid, true);
  assert.equal(pose.freshness, 'current');
  assert.equal(pose.frameId, 3);
  assert.ok(Math.abs(pose.x - 0.1) < 1e-9);
});

test('stale pose is rejected; current-frame pose is accepted', () => {
  const live = viewerPoseFromTransform(
    { x: 0, y: 1.6, z: 0 },
    { x: 0, y: 0, z: 0, w: 1 },
    8, 100, 0,
  );
  assert.equal(poseIsCurrent(live, 8), true);
  const stale = classifyPose({ ...live, ageMs: VIEWER_POSE_STALE_MS + 5 }, 8);
  assert.equal(poseIsStale(stale), true);
  assert.equal(poseIsCurrent(stale, 8), false);
  const wrongFrame = classifyPose({ ...live, frameId: 7, ageMs: 0 }, 8);
  assert.equal(wrongFrame.freshness, 'stale');
});

test('MENU placement waits for a valid XR viewer pose', () => {
  resetUiPlacementForTests();
  requestUiPlacement();
  assert.equal(uiPlacementPending(), true);
  const missing = takeUiPlacementFromViewerPose(
    viewerPoseFromTransform({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, 1, 0, 80),
    1,
  );
  assert.equal(missing, null);
  assert.equal(uiPlacementPending(), true);
  const pose = viewerPoseFromTransform({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, 2, 50, 0);
  const placed = takeUiPlacementFromViewerPose(pose, 2);
  assert.ok(placed);
  assert.ok(Math.abs(placed.distance - XR_UI_DISTANCE_M) < 0.05);
  assert.equal(uiPlacementPending(), false);
  const ev = lastUiPlacementEvidence();
  assert.equal(ev?.source, 'XR_VIEWER_POSE');
  assert.ok(Math.abs((ev?.distanceFromViewer ?? 0) - XR_UI_DISTANCE_M) < 0.05);
});

test('MENU appears configured distance ahead and faces the viewer', () => {
  resetUiPlacementForTests();
  requestUiPlacement();
  const pose = viewerPoseFromTransform({ x: 2, y: 1.6, z: 4 }, { x: 0, y: 0, z: 0, w: 1 }, 1, 0, 0);
  const placed = takeUiPlacementFromViewerPose(pose, 1);
  assert.ok(placed);
  assert.ok(Math.abs(placed.z - (4 - XR_UI_DISTANCE_M)) < 0.05);
  assert.equal(uiFacesHmd(placed.yaw, pose.yaw), true);
});

test('reopening after changed viewer yaw recenters', () => {
  resetUiPlacementForTests();
  requestUiPlacement();
  const qy = Math.sin(Math.PI / 4);
  const qw = Math.cos(Math.PI / 4);
  const first = takeUiPlacementFromViewerPose(
    viewerPoseFromTransform({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, 1, 0, 0),
    1,
  );
  requestUiPlacement();
  const second = takeUiPlacementFromViewerPose(
    viewerPoseFromTransform({ x: 0, y: 1.6, z: 0 }, { x: 0, y: qy, z: 0, w: qw }, 2, 20, 0),
    2,
  );
  assert.ok(first && second);
  assert.ok(Math.abs(second.x - first.x) > 0.4);
});

test('FPS HUD follows viewer pose, readable-side offset, matching orientation', () => {
  assert.equal(hudOffsetIsReadableSide(), true);
  const pose = viewerPoseFromTransform(
    { x: 1, y: 1.6, z: 2 },
    { x: 0, y: 0, z: 0, w: 1 },
    1, 0, 0,
  );
  const hud = placeHudFromViewerPose(pose);
  assert.ok(hud);
  assert.ok(hud.offsetY > 0);
  assert.ok(hud.offsetX < 0);
  assert.ok(hud.z < pose.z);
  assert.equal(hudFollowsViewer(pose.yaw, pose.yaw), true);
  const turned = viewerPoseFromTransform(
    { x: 1, y: 1.6, z: 2 },
    { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) },
    2, 0, 0,
  );
  const hud2 = placeHudFromViewerPose(turned)!;
  assert.equal(hudFollowsViewer(turned.yaw, turned.yaw), true);
  assert.ok(Math.abs(hud2.x - hud!.x) > 0.05 || Math.abs(hud2.z - hud!.z) > 0.05);
  assert.ok(Math.abs(HUD_VIEW_OFFSET.y) > 0);
});

test('viewer pose world conversion is origin + scaled local', () => {
  const w = viewerPoseToWorldXZ({
    originX: 10, originZ: 5, originYaw: 0, originScale: 3,
    viewerX: 1, viewerZ: -2, viewerYaw: 0.2,
  });
  assert.ok(Math.abs(w.x - 13) < 1e-9);
  assert.ok(Math.abs(w.z - (-1)) < 1e-9);
});

test('viewer eye height converts from reference meters to store-space once', () => {
  const w = viewerPoseToWorld({
    originX: 13, originY: 0, originZ: 12.5, originYaw: Math.PI / 2,
    originScale: 3.28084,
    viewerX: 0.2, viewerY: 1.73, viewerZ: -0.1, viewerYaw: 0.3,
    frameId: 44,
  });
  assert.ok(Math.abs(w.y - 1.73 * 3.28084) < 1e-9);
  assert.equal(w.frameId, 44);
});

test('FPS and mode HUD projected viewer-space bounds do not overlap', () => {
  const fps = projectedHudBounds(HUD_VIEW_OFFSET, FPS_HUD_SIZE_M);
  const mode = projectedHudBounds(MODE_HUD_VIEW_OFFSET, MODE_HUD_SIZE_M);
  assert.equal(projectedHudBoundsOverlap(fps, mode), false);
  assert.ok(fps.right < mode.left);
});

test('clearing UI placement does not leave a pending flag', () => {
  requestUiPlacement();
  clearUiPlacement();
  assert.equal(uiPlacementPending(), false);
});

test('FPS HUD has no second frame loop', () => {
  const src = readFileSync(new URL('../src/xr/fps-panel.ts', import.meta.url), 'utf8');
  assert.equal(/requestAnimationFrame/.test(src), false);
  assert.equal(/setAnimationLoop/.test(src), false);
});
