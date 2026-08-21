// Single owner for GPU texture-upload pumping.
// Page/window rAF is the desktop owner. The XR animation loop is the
// immersive owner. Quest Browser may stop page rAF after immersive entry;
// stale page callbacks must not drain (or double-drain) the queue.

export type UploadPumpOwner = 'page' | 'xr';

export interface PageRafScheduler {
  requestAnimationFrame(cb: FrameRequestCallback): number;
}

let owner: UploadPumpOwner = 'page';
let pagePumpGeneration = 0;
let pageRaf: PageRafScheduler | null = null;
let ownerListener: ((owner: UploadPumpOwner) => void) | null = null;

export function uploadPumpOwner(): UploadPumpOwner {
  return owner;
}

export function pageUploadPumpGeneration(): number {
  return pagePumpGeneration;
}

export function setUploadPumpOwnerListener(fn: ((owner: UploadPumpOwner) => void) | null): void {
  ownerListener = fn;
}

export function setUploadPumpOwner(next: UploadPumpOwner): void {
  if (next === owner) return;
  if (next === 'xr') pagePumpGeneration += 1;
  owner = next;
  ownerListener?.(owner);
}

export function setPageUploadRafForTests(scheduler: PageRafScheduler | null): void {
  pageRaf = scheduler;
}

export function resetUploadPumpSchedulerForTests(): void {
  owner = 'page';
  pagePumpGeneration = 0;
  pageRaf = null;
}

/**
 * Schedule a page-rAF upload pump. No-ops when XR owns the pump.
 * The callback is tagged with the generation at schedule time so a later
 * withheld/stale page callback cannot run after XR has taken ownership.
 */
export function schedulePageUploadPump(cb: FrameRequestCallback): number | null {
  if (owner !== 'page') return null;
  const gen = pagePumpGeneration;
  const wrapped: FrameRequestCallback = (time) => {
    if (owner !== 'page' || gen !== pagePumpGeneration) return;
    cb(time);
  };
  const raf = pageRaf ?? (typeof requestAnimationFrame === 'function'
    ? { requestAnimationFrame: (cb: FrameRequestCallback) => requestAnimationFrame(cb) }
    : null);
  if (!raf) return null;
  return raf.requestAnimationFrame(wrapped);
}

export function pageCallbackShouldRun(scheduledGeneration: number): boolean {
  return owner === 'page' && scheduledGeneration === pagePumpGeneration;
}
