// Budgeted GPU texture-upload queue and pump ownership.
// Extracted so Node tests can prove page-rAF suspension without loading Three.

import { xrUploadBudget } from './store-readiness.ts';
import { textureUploadUsesWindowRaf, xrUploadPolicyState } from './upload-policy.ts';
import {
  schedulePageUploadPump,
  setUploadPumpOwnerListener,
  uploadPumpOwner,
  type UploadPumpOwner,
} from './texture-upload-scheduler.ts';
import {
  storeVisibleWork,
  setStoreVisibleGenerationListener,
  type UploadScope,
} from './store-visible-work.ts';
import { refreshStoreVisualReady } from '../store-visual-ready.ts';

export type TextureUploadMeta = {
  scope?: UploadScope;
  generation?: number;
  movieId?: string;
};

type QueuedUpload = {
  run: () => void;
  scope: UploadScope;
  generation: number;
  movieId: string | null;
};

const priorityUploadQueue: QueuedUpload[] = [];
const textureUploadQueue: QueuedUpload[] = [];
const pendingUploads = () => priorityUploadQueue.length + textureUploadQueue.length;
let isUploading = false;

setStoreVisibleGenerationListener(() => {
  dropQueuedUploadsForGeneration(storeVisibleWork.currentGeneration());
});

setUploadPumpOwnerListener((next) => {
  if (next === 'page' && pendingUploads() > 0) {
    isUploading = true;
    schedulePageUploadPump(() => processUploads('page'));
  }
});

const UPLOAD_BUDGET_MS = 4;
const UPLOAD_MAX_PER_FRAME = 4;
const UPLOAD_BURST_BUDGET_MS = 12;
const UPLOAD_BURST_MAX_PER_FRAME = 16;
const UPLOAD_BURST_THRESHOLD = 20;
const BURST_INPUT_COOLDOWN_MS = 2000;
let lastUserActivityTime = -Infinity;

export function notifyUserActivity() {
  lastUserActivityTime = performance.now();
}

let uploadTurbo = false;
export function setUploadTurbo(on: boolean) { uploadTurbo = on; }

let rebuildDraining = false;
export function beginRebuildDrain() { rebuildDraining = true; }

export function pendingTextureUploads(): number { return pendingUploads(); }

export function pendingScopedTextureUploads(scope: UploadScope): number {
  let n = 0;
  for (const q of priorityUploadQueue) if (q.scope === scope) n++;
  for (const q of textureUploadQueue) if (q.scope === scope) n++;
  return n;
}

function wrapTask(task: () => void, meta?: TextureUploadMeta): QueuedUpload {
  const scope: UploadScope = meta?.scope ?? 'OTHER';
  const generation = meta?.generation ?? storeVisibleWork.currentGeneration();
  const movieId = meta?.movieId ?? null;
  storeVisibleWork.noteUploadQueued(scope);
  return {
    scope,
    generation,
    movieId,
    run: () => {
      try {
        if (movieId && !storeVisibleWork.allowsGpuMutation(movieId, generation)) {
          if (generation !== storeVisibleWork.currentGeneration()) {
            storeVisibleWork.noteStaleGenerationDrop();
          }
          if (storeVisibleWork.isStableFallback(movieId)) {
            storeVisibleWork.noteLateRealRejected();
          }
          return;
        }
        task();
      } finally {
        storeVisibleWork.noteUploadFinished(scope);
        refreshStoreVisualReady();
      }
    },
  };
}

function dropFrom(queue: QueuedUpload[], pred: (item: QueuedUpload) => boolean): number {
  let n = 0;
  for (let i = queue.length - 1; i >= 0; i--) {
    const item = queue[i]!;
    if (!pred(item)) continue;
    queue.splice(i, 1);
    storeVisibleWork.noteUploadFinished(item.scope);
    if (item.movieId && storeVisibleWork.isStableFallback(item.movieId)) {
      storeVisibleWork.noteLateRealRejected();
    } else if (item.generation !== storeVisibleWork.currentGeneration()) {
      storeVisibleWork.noteStaleGenerationDrop();
    }
    n++;
  }
  if (n > 0) refreshStoreVisualReady();
  return n;
}

/** Cancel queued GPU work for a title so STABLE_FALLBACK cannot be overwritten. */
export function dropQueuedUploadsForMovie(movieId: string): number {
  return dropFrom(priorityUploadQueue, (q) => q.movieId === movieId)
    + dropFrom(textureUploadQueue, (q) => q.movieId === movieId);
}

export function dropQueuedUploadsForGeneration(generation: number): number {
  const pred = (q: QueuedUpload) => q.generation !== generation;
  return dropFrom(priorityUploadQueue, pred) + dropFrom(textureUploadQueue, pred);
}

function processUploads(source: UploadPumpOwner = 'page') {
  if (source !== uploadPumpOwner()) return;
  if (pendingUploads() === 0) {
    isUploading = false;
    rebuildDraining = false;
    return;
  }
  isUploading = true;

  const xr = xrUploadPolicyState();
  const xrBudget = xrUploadBudget({
    presenting: xr.presenting,
    moving: xr.moving,
    highPriorityPending: priorityUploadQueue.length > 0,
  });
  const burst = !xr.presenting && (rebuildDraining ||
    (pendingUploads() > UPLOAD_BURST_THRESHOLD &&
      performance.now() - lastUserActivityTime > BURST_INPUT_COOLDOWN_MS));
  const budget = uploadTurbo ? 1000
    : xr.presenting ? xrBudget.budgetMs
    : burst ? UPLOAD_BURST_BUDGET_MS : UPLOAD_BUDGET_MS;
  const maxPerFrame = uploadTurbo ? Infinity
    : xr.presenting ? xrBudget.maxPerFrame
    : burst ? UPLOAD_BURST_MAX_PER_FRAME : UPLOAD_MAX_PER_FRAME;

  const start = performance.now();
  let count = 0;
  while (
    pendingUploads() > 0 &&
    count < maxPerFrame &&
    (count === 0 || performance.now() - start < budget)
  ) {
    const preferPriority = xr.presenting && (xr.moving || priorityUploadQueue.length > 0);
    const item = preferPriority
      ? (priorityUploadQueue.shift() ?? (xrBudget.bulkMaxPerFrame > 0 ? textureUploadQueue.shift() : undefined))
      : (priorityUploadQueue.length > 0 ? priorityUploadQueue.shift() : textureUploadQueue.shift());
    if (!item) break;
    try {
      item.run();
    } catch (err) {
      console.warn('Texture upload task failed:', err);
    }
    count++;
  }

  if (pendingUploads() > 0) {
    if (uploadPumpOwner() === 'page' && textureUploadUsesWindowRaf()) {
      schedulePageUploadPump(() => processUploads('page'));
    } else {
      isUploading = false;
    }
  } else {
    isUploading = false;
  }
}

export function pumpTextureUploads(): void {
  if (uploadPumpOwner() !== 'xr') return;
  if (pendingUploads() > 0) processUploads('xr');
}

let posterUploadJobsQueued = 0;

export function resetTextureUploadQueueForTests(): void {
  priorityUploadQueue.length = 0;
  textureUploadQueue.length = 0;
  isUploading = false;
  posterUploadJobsQueued = 0;
  rebuildDraining = false;
  storeVisibleWork.resetUploadPendingForTests();
}

export function posterUploadJobsStarted(): number {
  return posterUploadJobsQueued;
}

export function queueTextureUpload(
  task: () => void,
  lane: 'bulk' | 'priority' = 'bulk',
  meta?: TextureUploadMeta,
) {
  posterUploadJobsQueued++;
  const item = wrapTask(task, meta);
  (lane === 'priority' ? priorityUploadQueue : textureUploadQueue).push(item);
  if (!isUploading) {
    isUploading = true;
    if (uploadPumpOwner() === 'page' && textureUploadUsesWindowRaf()) {
      const id = schedulePageUploadPump(() => processUploads('page'));
      if (id == null) isUploading = false;
    } else {
      isUploading = false;
    }
  }
}
