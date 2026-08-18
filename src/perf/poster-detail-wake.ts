// Bounded DETAIL/FOCUS reconcile wake. Queue-cap deferral must not wait for
// another locomotion event. Coalesced timeout — not a busy loop.

const WAKE_MS = 90;

let timer: ReturnType<typeof setTimeout> | null = null;
let handler: (() => void) | null = null;
let pending = false;
let capacityWakeCount = 0;
let fallbackTimerWakeCount = 0;

export function setPosterDetailWakeHandler(fn: (() => void) | null): void {
  handler = fn;
}

export function requestPosterDetailWake(): void {
  pending = true;
  if (timer != null) return;
  timer = setTimeout(flushPosterDetailWake, WAKE_MS);
}

export function flushPosterDetailWake(): void {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!pending) return;
  pending = false;
  fallbackTimerWakeCount++;
  handler?.();
}

/** Primary wake: a promoted expensive upload just freed real queue capacity. */
export function notifyPosterDetailCapacityAvailable(): void {
  if (!pending) return;
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  pending = false;
  capacityWakeCount++;
  handler?.();
}

export function posterDetailWakePending(): boolean {
  return pending || timer != null;
}

export function posterDetailWakeSnapshot() {
  return {
    pending: posterDetailWakePending(),
    capacityWakeCount,
    fallbackTimerWakeCount,
    fallbackDelayMs: WAKE_MS,
  };
}

export function resetPosterDetailWakeForTests(): void {
  if (timer != null) clearTimeout(timer);
  timer = null;
  pending = false;
  handler = null;
  capacityWakeCount = 0;
  fallbackTimerWakeCount = 0;
}
