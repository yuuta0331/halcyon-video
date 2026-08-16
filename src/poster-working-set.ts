// XR_SAFE dynamic poster working set: unique titles, current player position,
// boot pins vs priority. PosterResidencyWindow stays a generic physical owner.

import {
  capP0UniqueToBudget,
  uniqueTitlePriority,
  type PosterPriorityClass,
} from './perf/store-readiness.ts';
import type { PosterResidencyWindow } from './poster-residency.ts';

export const MOVE_UPDATE_FEET = 3.5;
export const YAW_UPDATE_RAD = 0.4;

export interface SpatialTitle {
  movieId: string;
  x: number;
  z: number;
  unitIdx: number;
  libraryIdx: number;
  key: string;
}

export interface WorkingSetQuery {
  playerX: number;
  playerZ: number;
  yaw?: number;
  selectedMovieId?: string | null;
  selectedLibraryIdx?: number;
  selectedKey?: string | null;
  backWallUnitIdx: number;
  p0Radius: number;
  p1Radius: number;
  storeCenterX: number;
  budget: number;
}

export interface DesiredWorkingSet {
  desired: Map<string, PosterPriorityClass>;
  classified: Map<string, { cls: PosterPriorityClass; dist: number }>;
  p0Ids: string[];
  p1Ids: string[];
  p0CandidateCount: number;
  p1CandidateCount: number;
  desiredCount: number;
}

export interface ReconcileResult {
  entered: string[];
  left: string[];
  retained: string[];
  evictionCountDelta: number;
  acquisitionCountDelta: number;
}

export interface WorkingSetTransition {
  before: {
    residentCount: number;
    workingSetVersion: number;
    nearResidentCount: number;
  };
  movement: {
    distanceMoved: number;
    regionChanged: boolean;
  };
  after: {
    residentCount: number;
    evictionCountDelta: number;
    acquisitionCountDelta: number;
    enteredWorkingSetCount: number;
    leftWorkingSetCount: number;
  };
}

export interface WorkingSetState {
  version: number;
  updates: number;
  bootPinsActive: boolean;
  bootPinsReleasedAt: number | null;
  bootP0Ids: string[];
  initialP1Ids: string[];
  initialP0Count: number;
  initialP1CandidateCount: number;
  initialP1ResidentCount: number;
  initialWorkingSetCount: number;
  p1ScheduledAtBoot: number;
  p1RejectedAtBoot: number;
  enteredCount: number;
  leftCount: number;
  lastTransition: WorkingSetTransition | null;
  lastDesired: string[];
}

function effectiveDist(title: SpatialTitle, q: WorkingSetQuery): number {
  const dx = title.x - q.playerX;
  const dz = title.z - q.playerZ;
  let dist = Math.hypot(dx, dz);
  if (q.yaw != null && dist > 1e-4) {
    const fx = -Math.sin(q.yaw);
    const fz = -Math.cos(q.yaw);
    const dot = (dx / dist) * fx + (dz / dist) * fz;
    if (dot > 0.25) dist = Math.max(0, dist - 6);
  }
  return dist;
}

export function classifyDynamicTitle(
  title: SpatialTitle,
  q: WorkingSetQuery,
): PosterPriorityClass {
  if (q.selectedMovieId && title.movieId === q.selectedMovieId) return 'P0';
  if (q.selectedKey && title.key === q.selectedKey) return 'P0';
  const dist = effectiveDist(title, q);
  if (dist <= q.p0Radius) return 'P0';
  if (title.unitIdx === q.backWallUnitIdx && dist <= q.p1Radius) return 'P1';
  if (dist <= q.p1Radius) return 'P1';
  if (q.selectedLibraryIdx != null && title.libraryIdx === q.selectedLibraryIdx) return 'P2';
  return 'P3';
}

export function regionKey(x: number, z: number): string {
  return `${Math.floor(x / 8)}:${Math.floor(z / 8)}`;
}

export function shouldUpdateWorkingSet(
  prev: { x: number; z: number; yaw: number; selectedMovieId: string | null; selectedKey: string | null; selectedLibraryIdx: number },
  next: { x: number; z: number; yaw: number; selectedMovieId: string | null; selectedKey: string | null; selectedLibraryIdx: number },
  force = false,
): boolean {
  if (force) return true;
  if (next.selectedMovieId !== prev.selectedMovieId) return true;
  if (next.selectedKey !== prev.selectedKey) return true;
  if (next.selectedLibraryIdx !== prev.selectedLibraryIdx) return true;
  const moved = Math.hypot(next.x - prev.x, next.z - prev.z);
  if (moved >= MOVE_UPDATE_FEET) return true;
  let dyaw = Math.abs(next.yaw - prev.yaw);
  if (dyaw > Math.PI) dyaw = Math.PI * 2 - dyaw;
  return dyaw >= YAW_UPDATE_RAD;
}

/**
 * Cap unique P0 to budget, then fill remaining physical slots with the nearest
 * other unique titles (working-set P1). Never walks the whole catalog onto GPU.
 */
export function selectGpuWorkingSet(
  best: Map<string, { cls: PosterPriorityClass; dist: number }>,
  budget: number,
): DesiredWorkingSet {
  const capped = capP0UniqueToBudget(best, budget);
  const p0: Array<{ id: string; dist: number }> = [];
  const rest: Array<{ id: string; dist: number; cls: PosterPriorityClass }> = [];
  let p0Candidates = 0;
  let p1Candidates = 0;
  for (const rec of best.values()) {
    if (rec.cls === 'P0') p0Candidates++;
    else if (rec.cls === 'P1') p1Candidates++;
  }
  const classified = new Map<string, { cls: PosterPriorityClass; dist: number }>();
  for (const [id, rec] of best) {
    const cls = capped.get(id) ?? rec.cls;
    classified.set(id, { cls, dist: rec.dist });
    if (cls === 'P0') p0.push({ id, dist: rec.dist });
    else rest.push({ id, dist: rec.dist, cls });
  }
  p0.sort((a, b) => a.dist - b.dist || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  rest.sort((a, b) => a.dist - b.dist || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const p0Ids = p0.map((t) => t.id);
  const take = Math.max(0, budget - p0Ids.length);
  const p1Ids = rest.slice(0, take).map((t) => t.id);
  const desired = new Map<string, PosterPriorityClass>();
  for (const id of p0Ids) desired.set(id, 'P0');
  for (const id of p1Ids) desired.set(id, 'P1');
  return {
    desired,
    classified,
    p0Ids,
    p1Ids,
    p0CandidateCount: p0Candidates,
    p1CandidateCount: p1Candidates,
    desiredCount: desired.size,
  };
}

export function computeDesiredWorkingSet(
  titles: SpatialTitle[],
  q: WorkingSetQuery,
): DesiredWorkingSet {
  const items = titles.map((title) => ({
    movieId: title.movieId,
    dist: q.selectedMovieId === title.movieId ? -1 : effectiveDist(title, q),
    cls: classifyDynamicTitle(title, q),
  }));
  return selectGpuWorkingSet(uniqueTitlePriority(items), q.budget);
}

export function reconcilePosterWindow(
  win: PosterResidencyWindow,
  desired: Map<string, PosterPriorityClass>,
  pinIds: Iterable<string> = [],
): ReconcileResult {
  const pins = new Set(pinIds);
  const beforeEvict = win.evictionCount;
  const beforeAcquire = win.acquisitionCount;
  const before = new Set(win.residentIds());

  win.unpinAll();
  for (const id of before) {
    if (!desired.has(id) && !pins.has(id)) win.notePriority(id, 'P3');
  }
  const p0: string[] = [];
  const p1: string[] = [];
  for (const [id, cls] of desired) {
    if (cls === 'P0') p0.push(id);
    else p1.push(id);
  }
  p0.sort();
  p1.sort();
  const order = p0.concat(p1);
  for (const id of order) {
    if (before.has(id)) {
      win.notePriority(id, desired.get(id) ?? 'P1');
      win.acquire(id, desired.get(id) ?? 'P1');
    }
  }
  for (const id of order) {
    if (!before.has(id)) {
      win.acquire(id, desired.get(id) ?? 'P1');
    }
  }
  for (const id of pins) win.pin(id);

  const after = new Set(win.residentIds());
  const entered: string[] = [];
  const left: string[] = [];
  const retained: string[] = [];
  for (const id of after) {
    if (before.has(id)) retained.push(id);
    else entered.push(id);
  }
  for (const id of before) {
    if (!after.has(id)) left.push(id);
  }
  entered.sort();
  left.sort();
  retained.sort();
  return {
    entered,
    left,
    retained,
    evictionCountDelta: win.evictionCount - beforeEvict,
    acquisitionCountDelta: win.acquisitionCount - beforeAcquire,
  };
}

export function blankWorkingSetState(): WorkingSetState {
  return {
    version: 0,
    updates: 0,
    bootPinsActive: false,
    bootPinsReleasedAt: null,
    bootP0Ids: [],
    initialP1Ids: [],
    initialP0Count: 0,
    initialP1CandidateCount: 0,
    initialP1ResidentCount: 0,
    initialWorkingSetCount: 0,
    p1ScheduledAtBoot: 0,
    p1RejectedAtBoot: 0,
    enteredCount: 0,
    leftCount: 0,
    lastTransition: null,
    lastDesired: [],
  };
}

export class PosterWorkingSetTracker {
  state = blankWorkingSetState();
  private lastPose = {
    x: Number.NaN,
    z: Number.NaN,
    yaw: 0,
    selectedMovieId: null as string | null,
    selectedKey: null as string | null,
    selectedLibraryIdx: -1,
  };

  reset(): void {
    this.state = blankWorkingSetState();
    this.lastPose.x = Number.NaN;
  }

  noteBoot(desired: DesiredWorkingSet): void {
    this.state.bootP0Ids = [...desired.p0Ids];
    this.state.initialP1Ids = [...desired.p1Ids];
    this.state.initialP0Count = desired.p0Ids.length;
    this.state.initialP1CandidateCount = desired.p1CandidateCount;
    this.state.initialP1ResidentCount = desired.p1Ids.length;
    this.state.initialWorkingSetCount = desired.desiredCount;
    this.state.p1ScheduledAtBoot = desired.p1Ids.length;
    this.state.p1RejectedAtBoot = Math.max(0, desired.p1CandidateCount - desired.p1Ids.length);
    this.state.bootPinsActive = true;
    this.state.bootPinsReleasedAt = null;
    this.state.lastDesired = [...desired.desired.keys()].sort();
    this.state.version = 1;
  }

  releaseBootPins(now = typeof performance !== 'undefined' ? performance.now() : Date.now()): void {
    this.state.bootPinsActive = false;
    this.state.bootPinsReleasedAt = now;
  }

  needsUpdate(
    pose: { x: number; z: number; yaw: number; selectedMovieId: string | null; selectedKey: string | null; selectedLibraryIdx: number },
    force = false,
  ): boolean {
    if (Number.isNaN(this.lastPose.x)) {
      this.lastPose = { ...pose };
      return force;
    }
    if (!shouldUpdateWorkingSet(this.lastPose, pose, force)) return false;
    return true;
  }

  commitUpdate(
    pose: { x: number; z: number; yaw: number; selectedMovieId: string | null; selectedKey: string | null; selectedLibraryIdx: number },
    result: ReconcileResult,
    counts: {
      beforeResidentCount: number;
      afterResidentCount: number;
      nearResidentCount: number;
      desiredIds: string[];
    },
  ): WorkingSetTransition {
    const distanceMoved = Number.isNaN(this.lastPose.x)
      ? 0
      : Math.hypot(pose.x - this.lastPose.x, pose.z - this.lastPose.z);
    const regionChanged = Number.isNaN(this.lastPose.x)
      ? true
      : regionKey(pose.x, pose.z) !== regionKey(this.lastPose.x, this.lastPose.z);
    const transition: WorkingSetTransition = {
      before: {
        residentCount: counts.beforeResidentCount,
        workingSetVersion: this.state.version,
        nearResidentCount: counts.nearResidentCount,
      },
      movement: { distanceMoved, regionChanged },
      after: {
        residentCount: counts.afterResidentCount,
        evictionCountDelta: result.evictionCountDelta,
        acquisitionCountDelta: result.acquisitionCountDelta,
        enteredWorkingSetCount: result.entered.length,
        leftWorkingSetCount: result.left.length,
      },
    };
    this.state.version++;
    this.state.updates++;
    this.state.enteredCount += result.entered.length;
    this.state.leftCount += result.left.length;
    this.state.lastTransition = transition;
    this.state.lastDesired = [...counts.desiredIds].sort();
    this.lastPose = { ...pose };
    return transition;
  }
}

export function hashIdList(ids: Iterable<string>): number {
  const s = [...ids].sort().join('|');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) | 0;
  return h;
}
