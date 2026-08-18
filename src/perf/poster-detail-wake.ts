// Bounded DETAIL/FOCUS reconcile wake. Queue-cap deferral must not wait for
// another locomotion event. Coalesced timeout — not a busy loop.

const WAKE_MS = 90;

let timer: ReturnType<typeof setTimeout> | null = null;
let handler: (() => void) | null = null;
let pending = false;

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
  handler?.();
}

export function posterDetailWakePending(): boolean {
  return pending || timer != null;
}

export function resetPosterDetailWakeForTests(): void {
  if (timer != null) clearTimeout(timer);
  timer = null;
  pending = false;
  handler = null;
}
