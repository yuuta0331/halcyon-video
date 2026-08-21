// Viewer-relative FPS HUD. Not body/world-fixed on xrOrigin.

import type { XrViewerPoseState } from './viewer-pose.ts';

/** Center-bottom: readable by eye movement without turning toward a corner. */
export const HUD_VIEW_OFFSET = { x: 0, y: -0.20, z: -0.72 };
/** Center-top; vertically disjoint from the FPS panel. */
export const MODE_HUD_VIEW_OFFSET = { x: 0, y: 0.21, z: -0.72 };
export const FPS_HUD_SIZE_M = { width: 0.44, height: 0.18 };
export const MODE_HUD_SIZE_M = { width: 0.56, height: 0.17 };

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
  return Math.abs(offset.x) <= 0.08 && Math.abs(offset.y) <= 0.28 && offset.z < -0.45;
}

export interface ProjectedHudBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** Perspective-normalized bounds (tan view angle), deterministic without a camera. */
export function projectedHudBounds(
  offset: { x: number; y: number; z: number },
  size: { width: number; height: number },
): ProjectedHudBounds {
  const depth = Math.max(1e-6, -offset.z);
  return {
    left: (offset.x - size.width / 2) / depth,
    right: (offset.x + size.width / 2) / depth,
    bottom: (offset.y - size.height / 2) / depth,
    top: (offset.y + size.height / 2) / depth,
  };
}

export function projectedHudBoundsOverlap(a: ProjectedHudBounds, b: ProjectedHudBounds): boolean {
  return a.left < b.right && a.right > b.left && a.bottom < b.top && a.top > b.bottom;
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
