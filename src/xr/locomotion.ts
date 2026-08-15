// XR locomotion: analog stick + snap turn, colliding through the existing
// store-walk clamp. Never writes HMD pitch/yaw — only the player-rig root.

import type { WalkCollisionFn, XrLocomotionSample, XrLocomotionStep } from './types';

/** Conservative walking pace in store units per second (~1.37 m/s). */
export const XR_MOVE_SPEED = 4.5;

/** 30° snap — small enough for comfort, large enough to turn in an aisle. */
export const XR_SNAP_RAD = Math.PI / 6;

export const XR_STICK_DEADZONE = 0.2;
export const XR_SNAP_THRESHOLD = 0.65;
export const XR_SNAP_COOLDOWN_S = 0.35;

export interface SnapTurnState {
  cooldown: number;
  armed: boolean;
}

export function initialSnapTurnState(): SnapTurnState {
  return { cooldown: 0, armed: true };
}

export function headingForward(yaw: number): { x: number; z: number } {
  // Matches desktop walk: camera forward is (0,0,-1) under YXZ yaw.
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

export function headingRight(yaw: number): { x: number; z: number } {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

export function stepLocomotion(
  sample: XrLocomotionSample,
  snap: SnapTurnState,
  speed = XR_MOVE_SPEED,
): { step: XrLocomotionStep; snap: SnapTurnState } {
  const dead = XR_STICK_DEADZONE;
  let sx = sample.stickX;
  let sy = sample.stickY;
  if (Math.abs(sx) < dead) sx = 0;
  if (Math.abs(sy) < dead) sy = 0;

  const fwd = headingForward(sample.headingYaw);
  const right = headingRight(sample.headingYaw);
  // Stick Y: -1 is forward on XR pads (and on the desktop walk gamepad).
  const mx = right.x * sx + fwd.x * -sy;
  const mz = right.z * sx + fwd.z * -sy;
  const mag = Math.hypot(mx, mz);
  let dx = 0;
  let dz = 0;
  let moving = false;
  if (mag > 0) {
    const stepDist = speed * sample.dt;
    dx = (mx / mag) * stepDist;
    dz = (mz / mag) * stepDist;
    moving = true;
  }

  let cooldown = Math.max(0, snap.cooldown - sample.dt);
  let armed = snap.armed;
  let yawDelta = 0;
  let snapped = false;
  const ax = sample.snapX;
  if (Math.abs(ax) < XR_SNAP_THRESHOLD) {
    armed = true;
  } else if (armed && cooldown === 0) {
    yawDelta = ax > 0 ? -XR_SNAP_RAD : XR_SNAP_RAD;
    snapped = true;
    armed = false;
    cooldown = XR_SNAP_COOLDOWN_S;
  }

  return {
    step: { dx, dz, yawDelta, moving, snapped },
    snap: { cooldown, armed },
  };
}

export function applyRigLocomotion(opts: {
  x: number;
  z: number;
  yaw: number;
  step: XrLocomotionStep;
  collide: WalkCollisionFn;
  storeWidth: number;
  minZ: number;
}): { x: number; z: number; yaw: number } {
  const yaw = opts.yaw + opts.step.yawDelta;
  const unconstrainedX = opts.x + opts.step.dx;
  const unconstrainedZ = opts.z + opts.step.dz;
  const hit = opts.collide(
    opts.x,
    opts.z,
    unconstrainedX,
    unconstrainedZ,
    opts.storeWidth,
    opts.minZ,
  );
  return { x: hit.x, z: hit.z, yaw };
}

/** Desktop head-bob must stay off while an XR session is presenting. */
export function xrHeadBobAmount(_desktopBob: number, xrPresenting: boolean): number {
  return xrPresenting ? 0 : _desktopBob;
}

export function rigDoesNotWriteHmdPose(
  before: { pitch: number; yaw: number; roll: number },
  after: { pitch: number; yaw: number; roll: number },
): boolean {
  return before.pitch === after.pitch
    && before.yaw === after.yaw
    && before.roll === after.roll;
}
