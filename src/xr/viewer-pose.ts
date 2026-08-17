// Canonical immersive viewer pose. Updated only from an actual XRFrame.
// Application PerspectiveCamera world transform is not the HMD source of truth.

import { horizontalYawFromQuaternion } from './ui-placement.ts';

export const VIEWER_POSE_CURRENT_MS = 20;
export const VIEWER_POSE_STALE_MS = 50;

export type ViewerPoseSource = 'XR_VIEWER_POSE' | 'NONE';
export type ViewerPoseFreshness = 'current' | 'stale' | 'missing';

export interface XrViewerPoseState {
  valid: boolean;
  freshness: ViewerPoseFreshness;
  source: ViewerPoseSource;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  yaw: number;
  pitch: number;
  frameId: number;
  timestampMs: number;
  ageMs: number;
}

export interface ViewerWorldPose {
  x: number;
  z: number;
  yaw: number;
  frameId: number;
}

export interface XrViewerPoseInput {
  frame: {
    getViewerPose(space: object): {
      transform: {
        position: { x: number; y: number; z: number };
        orientation: { x: number; y: number; z: number; w: number };
      };
    } | null;
  } | null;
  referenceSpace: object | null;
  nowMs: number;
  frameId: number;
}

const MISSING: XrViewerPoseState = {
  valid: false,
  freshness: 'missing',
  source: 'NONE',
  x: 0, y: 0, z: 0,
  qx: 0, qy: 0, qz: 0, qw: 1,
  yaw: 0, pitch: 0,
  frameId: -1,
  timestampMs: 0,
  ageMs: Number.POSITIVE_INFINITY,
};

let latest: XrViewerPoseState = { ...MISSING };
let world: ViewerWorldPose | null = null;

export function blankViewerPose(): XrViewerPoseState {
  return { ...MISSING };
}

export function latestViewerPose(nowMs?: number): XrViewerPoseState {
  if (!latest.valid) return { ...MISSING };
  const age = nowMs != null ? Math.max(0, nowMs - latest.timestampMs) : latest.ageMs;
  return classifyPose({ ...latest, ageMs: age }, latest.frameId);
}

export function latestViewerWorldPose(): ViewerWorldPose | null {
  return world;
}

export function setViewerWorldPose(next: ViewerWorldPose | null): void {
  world = next;
}

export function poseIsCurrent(pose: XrViewerPoseState, frameId?: number): boolean {
  if (!pose.valid || pose.source !== 'XR_VIEWER_POSE') return false;
  if (frameId != null && pose.frameId !== frameId) return false;
  return pose.freshness !== 'stale' && pose.ageMs <= VIEWER_POSE_STALE_MS;
}

export function poseIsStale(pose: XrViewerPoseState): boolean {
  return !pose.valid || pose.freshness === 'stale' || pose.ageMs > VIEWER_POSE_STALE_MS;
}

export function classifyPose(pose: XrViewerPoseState, currentFrameId: number): XrViewerPoseState {
  if (!pose.valid || pose.source !== 'XR_VIEWER_POSE') {
    return { ...pose, valid: false, freshness: 'missing' };
  }
  if (pose.frameId !== currentFrameId || pose.ageMs > VIEWER_POSE_STALE_MS) {
    return { ...pose, freshness: 'stale' };
  }
  if (pose.ageMs <= VIEWER_POSE_CURRENT_MS) {
    return { ...pose, freshness: 'current' };
  }
  return { ...pose, freshness: pose.ageMs <= VIEWER_POSE_STALE_MS ? 'current' : 'stale' };
}

export function viewerPoseFromTransform(
  position: { x: number; y: number; z: number },
  orientation: { x: number; y: number; z: number; w: number },
  frameId: number,
  timestampMs: number,
  ageMs = 0,
): XrViewerPoseState {
  const yaw = horizontalYawFromQuaternion(orientation.x, orientation.y, orientation.z, orientation.w);
  const sinp = 2 * (orientation.w * orientation.x - orientation.z * orientation.y);
  const pitch = Math.asin(Math.max(-1, Math.min(1, sinp)));
  const pose: XrViewerPoseState = {
    valid: true,
    freshness: 'current',
    source: 'XR_VIEWER_POSE',
    x: position.x,
    y: position.y,
    z: position.z,
    qx: orientation.x,
    qy: orientation.y,
    qz: orientation.z,
    qw: orientation.w,
    yaw,
    pitch,
    frameId,
    timestampMs,
    ageMs,
  };
  return classifyPose(pose, frameId);
}

export function updateViewerPoseFromXrFrame(input: XrViewerPoseInput): XrViewerPoseState {
  const frame = input.frame;
  const space = input.referenceSpace;
  if (!frame || !space) {
    latest = { ...MISSING, frameId: input.frameId, timestampMs: input.nowMs };
    return latestViewerPose(input.nowMs);
  }
  let raw: ReturnType<NonNullable<XrViewerPoseInput['frame']>['getViewerPose']> = null;
  try {
    raw = frame.getViewerPose(space);
  } catch {
    raw = null;
  }
  if (!raw) {
    latest = { ...MISSING, frameId: input.frameId, timestampMs: input.nowMs };
    return latestViewerPose(input.nowMs);
  }
  latest = viewerPoseFromTransform(
    raw.transform.position,
    raw.transform.orientation,
    input.frameId,
    input.nowMs,
    0,
  );
  return latest;
}

/** Store-unit XZ from origin (store) + viewer (meters in origin space). */
export function viewerPoseToWorldXZ(input: {
  originX: number;
  originZ: number;
  originYaw: number;
  originScale: number;
  viewerX: number;
  viewerZ: number;
  viewerYaw: number;
}): ViewerWorldPose {
  const sx = input.viewerX * input.originScale;
  const sz = input.viewerZ * input.originScale;
  const c = Math.cos(input.originYaw);
  const s = Math.sin(input.originYaw);
  return {
    x: input.originX + sx * c + sz * s,
    z: input.originZ - sx * s + sz * c,
    yaw: input.originYaw + input.viewerYaw,
    frameId: latest.frameId,
  };
}

export function resetViewerPoseForTests(): void {
  latest = { ...MISSING };
  world = null;
}
