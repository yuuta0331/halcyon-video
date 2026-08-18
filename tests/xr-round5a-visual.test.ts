import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bothXrEyesSeeLayer,
  MIRROR_SKIP_LAYER,
  XR_LEFT_EYE_LAYER,
  xrEyeLayerMask,
} from '../src/scene-layers.ts';
import { negativeControlLeftEyeOnly } from '../src/xr/stereo-signage-probe.ts';
import { placeUiInFrontOfHmd, uiFacesHmd, XR_UI_DISTANCE_M } from '../src/xr/ui-placement.ts';
import { XR_DEPTH_NEAR_M } from '../src/xr/near-plane.ts';

test('layer 1 is left-eye-only; layer 3 is visible to both XR eyes', () => {
  const user = (1 << 0) | (1 << 1) | (1 << MIRROR_SKIP_LAYER);
  assert.equal(bothXrEyesSeeLayer(user, XR_LEFT_EYE_LAYER), false);
  assert.equal(bothXrEyesSeeLayer(user, MIRROR_SKIP_LAYER), true);
  const left = xrEyeLayerMask(user, 'left');
  const right = xrEyeLayerMask(user, 'right');
  assert.equal((left & (1 << XR_LEFT_EYE_LAYER)) !== 0, true);
  assert.equal((right & (1 << XR_LEFT_EYE_LAYER)) !== 0, false);
  assert.equal(negativeControlLeftEyeOnly(user), true);
});

test('XR menu placement uses current yaw, not a fixed rig forward', () => {
  const identity = placeUiInFrontOfHmd({
    hmdX: 0, hmdY: 1.6, hmdZ: 0, qx: 0, qy: 0, qz: 0, qw: 1,
  });
  assert.ok(Math.abs(identity.z + XR_UI_DISTANCE_M) < 0.05);
  assert.ok(identity.x ** 2 < 0.01);
  const qy = Math.sin(Math.PI / 4);
  const qw = Math.cos(Math.PI / 4);
  const turned = placeUiInFrontOfHmd({
    hmdX: 0, hmdY: 1.6, hmdZ: 0, qx: 0, qy, qz: 0, qw,
  });
  assert.ok(Math.abs(turned.x) > 0.4, 'must move off the rig-forward -Z axis');
  assert.notEqual(Math.round(turned.x * 10), Math.round(identity.x * 10));
  assert.equal(uiFacesHmd(identity.yaw, 0), true);
  assert.equal(uiFacesHmd(turned.yaw, Math.PI / 2), true);
  const toViewer = { x: -turned.x, z: -turned.z };
  const len = Math.hypot(toViewer.x, toViewer.z);
  const front = { x: Math.sin(turned.yaw), z: Math.cos(turned.yaw) };
  assert.ok(front.x * toViewer.x / len + front.z * toViewer.z / len > 0.99);
});

test('extreme pitch does not place the panel under the user', () => {
  const pitchDown = placeUiInFrontOfHmd({
    hmdX: 2, hmdY: 1.6, hmdZ: 5,
    qx: Math.sin(-0.6), qy: 0, qz: 0, qw: Math.cos(-0.6),
  });
  assert.ok(pitchDown.y >= 0.9);
  assert.ok(Math.hypot(pitchDown.x - 2, pitchDown.z - 5) > 0.5);
});

test('XR depth near is tighter than the desktop 0.1 store-foot near', () => {
  assert.ok(XR_DEPTH_NEAR_M < 0.1);
  assert.ok(XR_DEPTH_NEAR_M >= 0.02);
});
