// Place XR MENU/SETTINGS in front of the current HMD yaw, then leave it
// world-stable. Not head-locked. Pitch is ignored so looking at the floor
// does not spawn the panel under the user.

export const XR_UI_DISTANCE_M = 0.9;
export const XR_UI_EYE_DROP_M = 0.16;
export const XR_UI_MIN_Y_M = 0.95;

export interface XrUiPlacement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  distance: number;
}

export function horizontalYawFromQuaternion(qx: number, qy: number, qz: number, qw: number): number {
  // YXZ yaw from quaternion; pitch/roll discarded.
  const siny = 2 * (qw * qy + qx * qz);
  const cosy = 1 - 2 * (qy * qy + qx * qx);
  return Math.atan2(siny, cosy);
}

export function placeUiInFrontOfHmd(input: {
  hmdX: number;
  hmdY: number;
  hmdZ: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  distanceM?: number;
}): XrUiPlacement {
  const distance = input.distanceM ?? XR_UI_DISTANCE_M;
  const yaw = horizontalYawFromQuaternion(input.qx, input.qy, input.qz, input.qw);
  const x = input.hmdX - Math.sin(yaw) * distance;
  const z = input.hmdZ - Math.cos(yaw) * distance;
  const y = Math.max(XR_UI_MIN_Y_M, input.hmdY - XR_UI_EYE_DROP_M);
  // Plane front is local +Z. At viewer yaw +90° the panel is at -X and must
  // rotate +90° so its +Z normal points back toward the viewer.
  return { x, y, z, yaw, distance };
}

export function uiFacesHmd(panelYaw: number, hmdYaw: number): boolean {
  let d = panelYaw - hmdYaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) < 0.35;
}
