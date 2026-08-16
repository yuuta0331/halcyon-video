// Deterministic store reveal boundary. Allocated / queued / decoded ≠ ready.

import { t, tfill } from './i18n/index.ts';

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

function computeVisualReady(): boolean {
  if (expectedIds.size === 0) return true;
  if (postersResolved() < expectedIds.size) return false;
  if (signageReady < signageExpected) return false;
  if (otherReady < otherExpected) return false;
  return true;
}

function maybeReady(): void {
  if (state === 'STORE_VISUAL_READY' || state === 'STORE_INTERACTIVE') return;
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
}

export function beginStoreVisibleLoading(input: {
  posterIds: Iterable<string>;
  signageExpected?: number;
  otherExpected?: number;
}): void {
  expectedIds = new Set(input.posterIds);
  resolved.clear();
  signageExpected = Math.max(0, input.signageExpected ?? 0);
  signageReady = signageExpected;
  otherExpected = Math.max(0, input.otherExpected ?? 0);
  otherReady = otherExpected;
  state = 'STORE_VISIBLE_LOADING';
  startedAt = nowMs();
  readyAt = null;
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

export function markStoreInteractive(): void {
  if (state === 'STORE_VISUAL_READY') state = 'STORE_INTERACTIVE';
}

export function isStoreVisualReady(): boolean {
  if (startedAt == null && expectedIds.size === 0) return true;
  return state === 'STORE_VISUAL_READY' || state === 'STORE_INTERACTIVE';
}

export function storeVisualReadyPromise(): Promise<void> {
  if (isStoreVisualReady()) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}

export function storeVisibleProgress(): StoreVisibleProgress {
  const postersExpected = expectedIds.size;
  const uploaded = postersUploaded();
  const fallback = postersFallback();
  const resolvedCount = postersResolved();
  const visualReady = isStoreVisualReady();
  return {
    state,
    postersExpected,
    postersUploaded: uploaded,
    postersFallback: fallback,
    postersResolved: resolvedCount,
    signageExpected,
    signageReady,
    otherExpected,
    otherReady,
    visualReady,
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
  };
  w.__storeReadiness = storeVisibleProgress;
}
