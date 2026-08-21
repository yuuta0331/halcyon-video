// Motion-aware NEAR/FOCUS GPU promotion. BASE stays visible while deferred.
// JavaScript call duration is submission time, not Quest GPU execution time.

export type UploadCostClass = 'base' | 'near' | 'focus';
export type MotionClass = 'MOVING' | 'STABLE';

export const XR_MOTION_TRANSLATION_M = 0.018;
export const XR_MOTION_YAW_RAD = 0.045;
export const XR_STABLE_SETTLE_MS = 180;
export const XR_FAIRNESS_MS = 900;
export const XR_EXPENSIVE_PER_FRAME = 1;
export const XR_EXPENSIVE_QUEUE_CAP = 8;

export interface MotionSample {
  x: number;
  y: number;
  z: number;
  yaw: number;
  locomotionStickActive: boolean;
  snapTurnActive: boolean;
  nowMs: number;
}

export interface DetailUploadDecision {
  motion: MotionClass;
  allowExpensive: boolean;
  reason: 'stable' | 'moving' | 'fairness' | 'frame-cap' | 'queue-cap';
  deferredForMotion: number;
  promotedWhileStable: number;
  fairnessForced: number;
  expensiveThisFrame: number;
}

interface PolicyState {
  lastX: number;
  lastY: number;
  lastZ: number;
  lastYaw: number;
  lastSampleMs: number;
  stableSinceMs: number;
  deferredSinceMs: number | null;
  deferredForMotion: number;
  promotedWhileStable: number;
  fairnessForced: number;
  expensiveThisFrame: number;
  frameId: number;
  pendingExpensive: number;
  moving: boolean;
}

function blankState(): PolicyState {
  return {
    lastX: NaN, lastY: NaN, lastZ: NaN, lastYaw: NaN,
    lastSampleMs: 0, stableSinceMs: 0, deferredSinceMs: null,
    deferredForMotion: 0, promotedWhileStable: 0, fairnessForced: 0,
    expensiveThisFrame: 0, frameId: -1, pendingExpensive: 0, moving: false,
  };
}

let state = blankState();

function wrapPi(d: number): number {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function isExpensiveUpload(cost: UploadCostClass): boolean {
  return cost === 'near' || cost === 'focus';
}

export function noteExpensiveQueued(delta = 1): void {
  state.pendingExpensive = Math.max(0, state.pendingExpensive + delta);
}

export function setExpensiveQueued(n: number): void {
  state.pendingExpensive = Math.max(0, n);
}

export function beginXrUploadFrame(frameId: number): void {
  if (state.frameId !== frameId) {
    state.frameId = frameId;
    state.expensiveThisFrame = 0;
  }
}

export function sampleXrMotion(sample: MotionSample): MotionClass {
  const first = !Number.isFinite(state.lastX);
  let moving = sample.locomotionStickActive || sample.snapTurnActive;
  if (!first) {
    const dt = Math.hypot(sample.x - state.lastX, sample.y - state.lastY, sample.z - state.lastZ);
    const dyaw = Math.abs(wrapPi(sample.yaw - state.lastYaw));
    if (dt >= XR_MOTION_TRANSLATION_M || dyaw >= XR_MOTION_YAW_RAD) moving = true;
  }
  state.lastX = sample.x;
  state.lastY = sample.y;
  state.lastZ = sample.z;
  state.lastYaw = sample.yaw;
  state.lastSampleMs = sample.nowMs;
  if (moving) {
    state.moving = true;
    state.stableSinceMs = sample.nowMs;
    if (state.deferredSinceMs == null) state.deferredSinceMs = sample.nowMs;
    return 'MOVING';
  }
  if (state.moving && sample.nowMs - state.stableSinceMs < XR_STABLE_SETTLE_MS) {
    return 'MOVING';
  }
  state.moving = false;
  return 'STABLE';
}

export function canEnqueueExpensive(): boolean {
  return state.pendingExpensive < XR_EXPENSIVE_QUEUE_CAP;
}

export function expensivePendingCount(): number {
  return state.pendingExpensive;
}

export function decideExpensiveUpload(nowMs: number = state.lastSampleMs): DetailUploadDecision {
  const motion: MotionClass = state.moving ? 'MOVING' : 'STABLE';
  if (state.expensiveThisFrame >= XR_EXPENSIVE_PER_FRAME) {
    return snapshot('frame-cap', motion, false);
  }
  if (motion === 'MOVING') {
    const waited = state.deferredSinceMs != null ? nowMs - state.deferredSinceMs : 0;
    if (waited >= XR_FAIRNESS_MS) {
      return snapshot('fairness', 'MOVING', true);
    }
    return snapshot('moving', 'MOVING', false);
  }
  return snapshot('stable', 'STABLE', true);
}

export function noteExpensivePromotion(decision: DetailUploadDecision): void {
  state.expensiveThisFrame++;
  state.pendingExpensive = Math.max(0, state.pendingExpensive - 1);
  if (decision.reason === 'fairness') {
    state.fairnessForced++;
    state.deferredSinceMs = null;
  } else if (decision.reason === 'stable') {
    state.promotedWhileStable++;
    state.deferredSinceMs = null;
  }
}

export function noteExpensiveDeferred(): void {
  state.deferredForMotion++;
  if (state.deferredSinceMs == null) state.deferredSinceMs = state.lastSampleMs;
}

export function detailUploadPolicySnapshot() {
  return {
    motion: state.moving ? 'MOVING' as const : 'STABLE' as const,
    deferredForMotion: state.deferredForMotion,
    promotedWhileStable: state.promotedWhileStable,
    fairnessForced: state.fairnessForced,
    expensiveThisFrame: state.expensiveThisFrame,
    pendingExpensive: state.pendingExpensive,
    queueCap: XR_EXPENSIVE_QUEUE_CAP,
    maxPerFrame: XR_EXPENSIVE_PER_FRAME,
    settleMs: XR_STABLE_SETTLE_MS,
    fairnessMs: XR_FAIRNESS_MS,
  };
}

export function resetDetailUploadPolicyForTests(): void {
  state = blankState();
}

function snapshot(
  reason: DetailUploadDecision['reason'],
  motion: MotionClass,
  allow: boolean,
): DetailUploadDecision {
  return {
    motion,
    allowExpensive: allow,
    reason,
    deferredForMotion: state.deferredForMotion,
    promotedWhileStable: state.promotedWhileStable,
    fairnessForced: state.fairnessForced,
    expensiveThisFrame: state.expensiveThisFrame,
  };
}
