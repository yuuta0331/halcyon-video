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

const priorityUploadQueue: Array<() => void> = [];
const textureUploadQueue: Array<() => void> = [];
const pendingUploads = () => priorityUploadQueue.length + textureUploadQueue.length;
let isUploading = false;

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
    const task = preferPriority
      ? (priorityUploadQueue.shift() ?? (xrBudget.bulkMaxPerFrame > 0 ? textureUploadQueue.shift() : undefined))
      : (priorityUploadQueue.length > 0 ? priorityUploadQueue.shift() : textureUploadQueue.shift());
    if (!task) break;
    if (task) {
      try {
        task();
      } catch (err) {
        console.warn('Texture upload task failed:', err);
      }
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
}

export function posterUploadJobsStarted(): number {
  return posterUploadJobsQueued;
}

export function queueTextureUpload(task: () => void, lane: 'bulk' | 'priority' = 'bulk') {
  posterUploadJobsQueued++;
  (lane === 'priority' ? priorityUploadQueue : textureUploadQueue).push(task);
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
