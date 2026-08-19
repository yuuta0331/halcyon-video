// JP-4A-test-only lock reach and host wiring. Production walk reach stays
// WALK_INTERACT_RANGE. Diagnostic lock never starts production FOCUS.

import type { MovieSlot } from '../store-layout.ts';
import { STORE_UNITS_PER_METER } from '../platform/index.ts';
import type { LivePosterDiagRuntime } from './live-poster-diag-runtime.ts';
import type { LivePosterMode } from './jp4a-test-state.ts';
import type { Jp4aTriggerCommand } from './jp4a-trigger-input.ts';

/** Production walk reach. JP-4A lock must not change this constant. */
export const JP4A_PRODUCTION_INTERACT_RANGE_FT = 14;

/** Long enough to lock a poster where the ~8 m black veil is already visible. */
export const JP4A_DIAGNOSTIC_LOCK_RANGE_M = 12;

export function jp4aDiagnosticLockRangeStoreUnits(
  meters = JP4A_DIAGNOSTIC_LOCK_RANGE_M,
  unitsPerMeter = STORE_UNITS_PER_METER,
): number {
  return meters * unitsPerMeter;
}

export function jp4aSelectPickRange(jp4aActive: boolean): number {
  return jp4aActive ? jp4aDiagnosticLockRangeStoreUnits() : JP4A_PRODUCTION_INTERACT_RANGE_FT;
}

export function jp4aLockInRange(
  distanceStoreUnits: number,
  jp4aActive: boolean,
  unitsPerMeter = STORE_UNITS_PER_METER,
): boolean {
  const max = jp4aActive
    ? jp4aDiagnosticLockRangeStoreUnits(JP4A_DIAGNOSTIC_LOCK_RANGE_M, unitsPerMeter)
    : JP4A_PRODUCTION_INTERACT_RANGE_FT;
  return distanceStoreUnits <= max + 1e-6 && distanceStoreUnits >= 0;
}

export function metersToStoreUnits(meters: number, unitsPerMeter = STORE_UNITS_PER_METER): number {
  return meters * unitsPerMeter;
}

export function pickNearestVisibleDiagnosticSlot<T extends { hidden: boolean }>(
  hits: ReadonlyArray<{ distance: number; instanceId?: number; object: unknown }>,
  resolveSlot: (object: unknown, instanceId: number) => T | null,
  maxDist: number,
): T | null {
  for (const hit of hits) {
    if (hit.distance > maxDist) break;
    if (hit.instanceId === undefined) continue;
    const slot = resolveSlot(hit.object, hit.instanceId);
    if (slot && !slot.hidden) return slot;
  }
  return null;
}

export interface Jp4aHostBindings {
  onJp4aLockSlot: (slot: MovieSlot) => { changed: boolean; verdict: string };
  cycleJp4aVerdict: () => { changed: boolean; verdict: string };
  cycleJp4aMode: (direction: -1 | 1) => LivePosterMode;
  tickJp4aDiagnostic: (viewer: { x: number; y: number; z: number } | null) => void;
  jp4aDiagnosticSnapshot: () => Record<string, unknown>;
  advanceJp4aTestPhase: () => 'BEGIN_APPROACH' | 'BEGIN_FOCUS' | null;
  beginJp4aFocus: () => boolean;
  applyJp4aTriggerCommand: (command: Jp4aTriggerCommand | null) => void;
  productionSelectCount: () => number;
  resetProductionSelectCount: () => void;
}

export function applyJp4aTriggerCommand(
  command: Jp4aTriggerCommand | null,
  liveDiag: LivePosterDiagRuntime,
  selectProduction: (slot: MovieSlot) => void,
): void {
  if (!command) return;
  if (command.type === 'LOCK') {
    liveDiag.lock(command.slot);
    return;
  }
  if (command.type === 'CYCLE_VERDICT') {
    liveDiag.cycleVerdict();
    return;
  }
  if (command.type === 'BEGIN_APPROACH') {
    liveDiag.beginApproach();
    return;
  }
  if (command.type === 'BEGIN_FOCUS' && liveDiag.beginFocus()) {
    const slot = liveDiag.lockedSlot();
    if (slot) selectProduction(slot);
  }
}

export function createJp4aHostBindings(
  liveDiag: LivePosterDiagRuntime,
  selectProduction: (slot: MovieSlot) => void,
): Jp4aHostBindings {
  let productionSelects = 0;
  const countedSelect = (slot: MovieSlot): void => {
    productionSelects += 1;
    selectProduction(slot);
  };
  const selectLocked = (): boolean => {
    const slot = liveDiag.lockedSlot();
    if (!slot) return false;
    countedSelect(slot);
    return true;
  };
  return {
    onJp4aLockSlot: (slot) => liveDiag.lock(slot),
    cycleJp4aVerdict: () => liveDiag.cycleVerdict(),
    cycleJp4aMode: (direction) => liveDiag.cycle(direction),
    tickJp4aDiagnostic: (viewer) => liveDiag.tickViewer(viewer),
    jp4aDiagnosticSnapshot: () => liveDiag.observation(false),
    advanceJp4aTestPhase: () => {
      const action = liveDiag.advanceFromHold();
      if (action === 'BEGIN_FOCUS') selectLocked();
      return action;
    },
    beginJp4aFocus: () => {
      if (!liveDiag.beginFocus()) return false;
      return selectLocked();
    },
    applyJp4aTriggerCommand: (command) => applyJp4aTriggerCommand(command, liveDiag, countedSelect),
    productionSelectCount: () => productionSelects,
    resetProductionSelectCount: () => { productionSelects = 0; },
  };
}
