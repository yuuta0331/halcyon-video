// MENU / SETTINGS placement waits for a current XR viewer pose, then stays world-stable.

import { placeUiInFrontOfHmd, type XrUiPlacement } from './ui-placement.ts';
import {
  poseIsCurrent,
  type XrViewerPoseState,
} from './viewer-pose.ts';

export interface UiPlacementEvidence {
  source: 'XR_VIEWER_POSE';
  x: number;
  y: number;
  z: number;
  yaw: number;
  distanceFromViewer: number;
  angleToViewer: number;
  poseAgeMs: number;
  frameId: number;
}

let pending = false;
let last: UiPlacementEvidence | null = null;

export function requestUiPlacement(): void {
  pending = true;
}

export function uiPlacementPending(): boolean {
  return pending;
}

export function lastUiPlacementEvidence(): UiPlacementEvidence | null {
  return last;
}

export function clearUiPlacement(): void {
  pending = false;
  last = null;
}

export function takeUiPlacementFromViewerPose(
  pose: XrViewerPoseState,
  currentFrameId: number,
): XrUiPlacement | null {
  if (!pending) return null;
  if (!poseIsCurrent(pose, currentFrameId)) return null;
  const placed = placeUiInFrontOfHmd({
    hmdX: pose.x,
    hmdY: pose.y,
    hmdZ: pose.z,
    qx: pose.qx,
    qy: pose.qy,
    qz: pose.qz,
    qw: pose.qw,
  });
  const dx = placed.x - pose.x;
  const dz = placed.z - pose.z;
  const dist = Math.hypot(dx, dz);
  const angle = Math.atan2(-dx, -dz);
  last = {
    source: 'XR_VIEWER_POSE',
    x: placed.x,
    y: placed.y,
    z: placed.z,
    yaw: placed.yaw,
    distanceFromViewer: dist,
    angleToViewer: angle - pose.yaw,
    poseAgeMs: pose.ageMs,
    frameId: pose.frameId,
  };
  pending = false;
  return placed;
}

export function resetUiPlacementForTests(): void {
  pending = false;
  last = null;
}
