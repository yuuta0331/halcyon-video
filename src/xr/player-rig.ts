// XR player rig: locomotion root + meter-scaled origin. WebXR writes the
// HMD pose onto the camera as a child of xrOrigin. Locomotion must never
// assign camera.rotation.

import * as THREE from 'three';
import { STORE_UNITS_PER_METER } from '../platform';

export const XR_SPAWN = { x: 13.0, z: 12.5, yaw: Math.atan2(-2, 12.5) };

export class XrPlayerRig {
  readonly root: THREE.Group;
  readonly xrOrigin: THREE.Group;
  private readonly camera: THREE.Object3D;
  private attached = false;

  constructor(camera: THREE.Object3D) {
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.name = 'xr-player-rig';
    this.xrOrigin = new THREE.Group();
    this.xrOrigin.name = 'xr-origin-meters';
    this.xrOrigin.scale.setScalar(STORE_UNITS_PER_METER);
    this.root.add(this.xrOrigin);
  }

  attach(scene: THREE.Scene): void {
    if (this.attached) return;
    this.xrOrigin.add(this.camera);
    scene.add(this.root);
    this.attached = true;
    this.place(XR_SPAWN.x, XR_SPAWN.z, XR_SPAWN.yaw);
  }

  place(x: number, z: number, yaw: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.set(0, yaw, 0);
  }

  setPose(x: number, z: number, yaw: number): void {
    this.root.position.x = x;
    this.root.position.z = z;
    this.root.rotation.y = yaw;
  }

  get x(): number { return this.root.position.x; }
  get z(): number { return this.root.position.z; }
  get yaw(): number { return this.root.rotation.y; }

  /** World-space look heading (rig yaw + HMD yaw), XZ only. */
  headingYaw(scratch = new THREE.Euler()): number {
    this.camera.getWorldQuaternion(XrPlayerRig._q);
    scratch.setFromQuaternion(XrPlayerRig._q, 'YXZ');
    return scratch.y;
  }

  detach(scene: THREE.Scene): void {
    if (!this.attached) return;
    this.xrOrigin.remove(this.camera);
    scene.remove(this.root);
    this.attached = false;
  }

  private static readonly _q = new THREE.Quaternion();
}
