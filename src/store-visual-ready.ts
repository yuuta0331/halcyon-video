// Deterministic store reveal boundary. Allocated / queued / decoded ≠ ready.
// STORE_VISUAL_READY means every active STORE_VISIBLE_BASE / WORLD_REQUIRED
// class has an actually displayable result (uploaded content or stable fallback).

import { t, tfill } from './i18n/index.ts';
import { storeVisibleResidency } from './store-visible-residency.ts';
import {
  resetXrContentLiveStateForTests,
  setXrContentLiveState,
  xrContentSnapshot,
} from './xr/content-diagnostics.ts';
import { worldRequiredContentClasses, type XrContentClass } from './xr/content-classes.ts';

export type StoreReadinessState =
  | 'STORE_GEOMETRY_READY'
  | 'STORE_VISIBLE_LOADING'
  | 'STORE_VISUAL_READY'
  | 'STORE_INTERACTIVE';

export type StoreVisibleResolveKind = 'uploaded' | 'fallback';

export interface StoreVisibleProgress {
  state: StoreReadinessState;
  postersExpected: number;
  postersUploaded: number;
  postersFallback: number;
  postersResolved: number;
  signageExpected: number;
  signageReady: number;
  otherExpected: number;
  otherReady: number;
  visualReady: boolean;
  worldReady: boolean;
  requiredReady: boolean;
  capacityInvariantOk: boolean;
  timeToVisualReady: number | null;
  startedAt: number | null;
}

const resolved = new Map<string, StoreVisibleResolveKind>();
let expectedIds = new Set<string>();
let signageExpected = 0;
let signageReady = 0;
let otherExpected = 0;
let otherReady = 0;
let state: StoreReadinessState = 'STORE_GEOMETRY_READY';
let startedAt: number | null = null;
let readyAt: number | null = null;
let waiters: Array<() => void> = [];

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function postersResolved(): number {
  let n = 0;
  for (const id of expectedIds) {
    if (resolved.has(id)) n++;
  }
  return n;
}

function postersUploaded(): number {
  let n = 0;
  for (const id of expectedIds) {
    if (resolved.get(id) === 'uploaded') n++;
  }
  return n;
}

function postersFallback(): number {
  let n = 0;
  for (const id of expectedIds) {
    if (resolved.get(id) === 'fallback') n++;
  }
  return n;
}

function syncPosterLive(): void {
  const n = expectedIds.size;
  const r = postersResolved();
  setXrContentLiveState({
    posterAllocated: n,
    posterDecoded: r,
    posterUploaded: r,
    posterVisible: r,
  });
}

function capacityOk(): boolean {
  if (!storeVisibleResidency.layout) return true;
  return storeVisibleResidency.validate().capacityInvariantOk;
}

function worldClassesReady(): boolean {
  return xrContentSnapshot().worldReady;
}

function computeVisualReady(): boolean {
  if (state === 'STORE_GEOMETRY_READY' && startedAt == null) return false;
  if (postersResolved() < expectedIds.size) return false;
  if (!capacityOk()) return false;
  if (signageExpected > 0 && signageReady < signageExpected) return false;
  if (otherExpected > 0 && otherReady < otherExpected) return false;
  return worldClassesReady();
}

function maybeReady(): void {
  if (state === 'STORE_VISUAL_READY' || state === 'STORE_INTERACTIVE') return;
  syncPosterLive();
  if (!computeVisualReady()) return;
  state = 'STORE_VISUAL_READY';
  readyAt = nowMs();
  const done = waiters;
  waiters = [];
  for (const cb of done) cb();
}

export function resetStoreVisualReady(): void {
  resolved.clear();
  expectedIds = new Set();
  signageExpected = 0;
  signageReady = 0;
  otherExpected = 0;
  otherReady = 0;
  state = 'STORE_GEOMETRY_READY';
  startedAt = null;
  readyAt = null;
  waiters = [];
  resetXrContentLiveStateForTests();
}

export function beginStoreVisibleLoading(input: {
  posterIds: Iterable<string>;
  signageExpected?: number;
  signageReady?: number;
  otherExpected?: number;
  otherReady?: number;
}): void {
  expectedIds = new Set(input.posterIds);
  resolved.clear();
  signageExpected = Math.max(0, input.signageExpected ?? 0);
  signageReady = Math.max(0, input.signageReady ?? 0);
  otherExpected = Math.max(0, input.otherExpected ?? 0);
  otherReady = Math.max(0, input.otherReady ?? 0);
  state = 'STORE_VISIBLE_LOADING';
  startedAt = nowMs();
  readyAt = null;
  maybeReady();
}

export function noteStoreWorldClassProgress(input: {
  signageExpected?: number;
  signageReady?: number;
  otherExpected?: number;
  otherReady?: number;
}): void {
  if (input.signageExpected != null) signageExpected = Math.max(0, input.signageExpected);
  if (input.signageReady != null) signageReady = Math.max(0, input.signageReady);
  if (input.otherExpected != null) otherExpected = Math.max(0, input.otherExpected);
  if (input.otherReady != null) otherReady = Math.max(0, input.otherReady);
  maybeReady();
}

export function noteStoreVisibleResolved(movieId: string, kind: StoreVisibleResolveKind): void {
  if (!expectedIds.has(movieId)) return;
  const prev = resolved.get(movieId);
  if (prev === 'uploaded' && kind === 'fallback') return;
  if (prev === kind) return;
  resolved.set(movieId, kind);
  maybeReady();
}

export function refreshStoreVisualReady(): void {
  maybeReady();
}

export function markStoreInteractive(): void {
  if (state === 'STORE_VISUAL_READY') state = 'STORE_INTERACTIVE';
}

export function isStoreVisualReady(): boolean {
  return state === 'STORE_VISUAL_READY' || state === 'STORE_INTERACTIVE';
}

export function storeVisualReadyPromise(): Promise<void> {
  if (isStoreVisualReady()) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}

function remainingWorldReadyCount(): { expected: number; ready: number } {
  const snap = xrContentSnapshot();
  const classes = worldRequiredContentClasses().filter((cls) => cls !== 'poster' && cls !== 'aisleFascia');
  let ready = 0;
  for (const cls of classes) {
    const row = snap[cls as Exclude<XrContentClass, 'decorativeFx'>];
    if (row && typeof row === 'object' && 'state' in row && row.state === 'ready') ready++;
  }
  return { expected: classes.length, ready };
}

export function storeVisibleProgress(): StoreVisibleProgress {
  const postersExpected = expectedIds.size;
  const uploaded = postersUploaded();
  const fallback = postersFallback();
  const resolvedCount = postersResolved();
  const snap = xrContentSnapshot();
  const others = remainingWorldReadyCount();
  return {
    state,
    postersExpected,
    postersUploaded: uploaded,
    postersFallback: fallback,
    postersResolved: resolvedCount,
    signageExpected: Math.max(signageExpected, snap.signage.visible, snap.signage.allocated),
    signageReady: snap.signage.state === 'ready'
      ? Math.max(signageReady, snap.signage.visible, snap.signage.uploaded)
      : signageReady,
    otherExpected: Math.max(otherExpected, others.expected),
    otherReady: Math.max(otherReady, others.ready),
    visualReady: isStoreVisualReady(),
    worldReady: snap.worldReady,
    requiredReady: snap.requiredReady,
    capacityInvariantOk: capacityOk(),
    timeToVisualReady: readyAt != null && startedAt != null ? readyAt - startedAt : null,
    startedAt,
  };
}

export function storePreloadStatusLines(): { title: string; lines: string[] } {
  const p = storeVisibleProgress();
  return {
    title: t('store.preload.title'),
    lines: [
      tfill('store.preload.posters', { done: p.postersResolved, total: p.postersExpected }),
      tfill('store.preload.signage', { done: p.signageReady, total: p.signageExpected }),
      tfill('store.preload.other', { done: p.otherReady, total: p.otherExpected }),
    ],
  };
}

export function publishStoreReadinessWindow(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as {
    __storeReadiness?: () => StoreVisibleProgress;
    __xrContent?: () => ReturnType<typeof xrContentSnapshot>;
  };
  w.__storeReadiness = storeVisibleProgress;
  w.__xrContent = () => xrContentSnapshot();
}
