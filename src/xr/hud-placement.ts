// Viewer-relative FPS HUD. Not body/world-fixed on xrOrigin.

import type { XrViewerPoseState } from './viewer-pose.ts';

/** Upper-left peripheral, meters in viewer space. Not lower-left. */
export const HUD_VIEW_OFFSET = { x: -0.16, y: 0.14, z: -0.52 };

export interface HudLocalTransform {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
}

function applyQuat(
  q: { x: number; y: number; z: number; w: number },
  v: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export function hudFollowsViewer(hudYaw: number, viewerYaw: number, eps = 0.12): boolean {
  let d = hudYaw - viewerYaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) < eps;
}

export function hudOffsetIsReadableSide(offset = HUD_VIEW_OFFSET): boolean {
  return offset.x < 0 && offset.y > 0 && offset.z < -0.3;
}

export function placeHudFromViewerPose(
  pose: XrViewerPoseState,
  offset = HUD_VIEW_OFFSET,
): HudLocalTransform | null {
  if (!pose.valid) return null;
  const q = { x: pose.qx, y: pose.qy, z: pose.qz, w: pose.qw };
  const moved = applyQuat(q, offset);
  return {
    x: pose.x + moved.x,
    y: pose.y + moved.y,
    z: pose.z + moved.z,
    qx: pose.qx,
    qy: pose.qy,
    qz: pose.qz,
    qw: pose.qw,
    offsetX: offset.x,
    offsetY: offset.y,
    offsetZ: offset.z,
  };
}
