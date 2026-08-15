// WebXR controllers: target-ray + grip, select/squeeze state, no hand tracking.

import * as THREE from 'three';
import { WALK_INTERACT_RANGE } from '../store-walk';
import { ignoreHandTrackingSource, readXrGamepadStick } from './input-policy';

export { ignoreHandTrackingSource, readXrGamepadStick } from './input-policy';

export interface XrControllerSideState {
  handedness: 'left' | 'right' | 'none';
  connected: boolean;
  select: boolean;
  squeeze: boolean;
  stickX: number;
  stickY: number;
  hasGrip: boolean;
}

export interface XrControllerSnapshot {
  left: XrControllerSideState;
  right: XrControllerSideState;
}

export function emptyControllerSide(handedness: XrControllerSideState['handedness']): XrControllerSideState {
  return {
    handedness,
    connected: false,
    select: false,
    squeeze: false,
    stickX: 0,
    stickY: 0,
    hasGrip: false,
  };
}

export function emptyControllerSnapshot(): XrControllerSnapshot {
  return {
    left: emptyControllerSide('left'),
    right: emptyControllerSide('right'),
  };
}

export function makeControllerRay(): THREE.Line {
  const geom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -WALK_INTERACT_RANGE),
  ]);
  const mat = new THREE.LineBasicMaterial({
    color: 0xffd56a,
    depthTest: true,
    transparent: true,
    opacity: 0.85,
  });
  const line = new THREE.Line(geom, mat);
  line.name = 'xr-target-ray';
  line.frustumCulled = false;
  return line;
}

export function makeGripMarker(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.04, 0.08),
    new THREE.MeshBasicMaterial({ color: 0xe8e0d0 }),
  );
  mesh.name = 'xr-grip';
  return mesh;
}

export interface XrSelectHit {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
}

export function targetRayFromController(controller: THREE.Object3D, out: XrSelectHit): XrSelectHit {
  controller.updateMatrixWorld(true);
  controller.getWorldPosition(out.origin);
  XrSelectScratch.fwd.set(0, 0, -1).transformDirection(controller.matrixWorld);
  out.direction.copy(XrSelectScratch.fwd);
  return out;
}

const XrSelectScratch = {
  fwd: new THREE.Vector3(),
};
