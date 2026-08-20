// One shared immersive-vr support probe for the whole application.
//
// Owned by app boot, NOT by StoreScene: a StoreScene rebuild must never restart
// it, and the JP-4A diagnostic console must be able to observe it before any
// scene exists. "Checking XR support" is only allowed to be displayed while
// this reports PROBING — i.e. while isSessionSupported() is genuinely pending.
//
// isSessionSupported() has no specified upper bound and real runtimes have been
// observed leaving it pending indefinitely. A quick hardware diagnostic cannot
// wait on that, so the probe carries a short SOFT timeout. TIMED_OUT and ERROR
// are distinct from UNSUPPORTED and must never be reported as "no XR".

export const XR_SUPPORT_SOFT_TIMEOUT_MS = 1500;
/** The JP-4A diagnostic UX may never exceed this, whatever the caller asks for. */
export const XR_SUPPORT_MAX_SOFT_TIMEOUT_MS = 2000;

export type XrSupportState =
  | 'NOT_STARTED'
  | 'PROBING'
  | 'SUPPORTED'
  | 'UNSUPPORTED'
  | 'TIMED_OUT'
  | 'ERROR';

export type XrSupportReason =
  | null
  | 'TAURI'
  | 'NO_NAVIGATOR_XR'
  | 'NO_IS_SESSION_SUPPORTED'
  | 'API_TRUE'
  | 'API_FALSE'
  | 'SOFT_TIMEOUT'
  | 'API_ERROR';

export interface XrSupportSnapshot {
  state: XrSupportState;
  /** true/false only when the API actually answered. null while unresolved. */
  supported: boolean | null;
  /** isSessionSupported() was really invoked (gates the "Checking" wording). */
  invoked: boolean;
  probeStartedAt: number | null;
  probeSettledAt: number | null;
  elapsedMs: number | null;
  softTimeoutMs: number;
  /** Answer that arrived after the soft timeout, if any. */
  lateResult: boolean | null;
  lateSettledAt: number | null;
  lateElapsedMs: number | null;
  reason: XrSupportReason;
  error: string | null;
}

export interface XrSupportApi {
  isSessionSupported?: (mode: XRSessionMode) => Promise<boolean>;
  requestSession?: unknown;
}

export interface XrSupportProbeDeps {
  isTauri?: boolean;
  getXr?: () => XrSupportApi | null | undefined;
  now?: () => number;
  softTimeoutMs?: number;
  /** Injectable timer so tests never sleep for real. Returns a cancel fn. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

function blank(softTimeoutMs = XR_SUPPORT_SOFT_TIMEOUT_MS): XrSupportSnapshot {
  return {
    state: 'NOT_STARTED',
    supported: null,
    invoked: false,
    probeStartedAt: null,
    probeSettledAt: null,
    elapsedMs: null,
    softTimeoutMs,
    lateResult: null,
    lateSettledAt: null,
    lateElapsedMs: null,
    reason: null,
    error: null,
  };
}

let snap: XrSupportSnapshot = blank();
let flight: Promise<XrSupportSnapshot> | null = null;
let settle: ((value: XrSupportSnapshot) => void) | null = null;
let cancelTimer: (() => void) | null = null;
const listeners = new Set<(value: XrSupportSnapshot) => void>();

function emit(): void {
  const value = xrSupportSnapshot();
  for (const fn of [...listeners]) fn(value);
}

export function xrSupportSnapshot(): XrSupportSnapshot {
  return { ...snap };
}

export function xrSupportState(): XrSupportState {
  return snap.state;
}

/**
 * Legacy three-state view: true / false / null ("no answer yet or no answer
 * possible"). TIMED_OUT and ERROR deliberately map to null, never to false —
 * they are not evidence of absent support.
 */
export function xrSupportedOrNull(): boolean | null {
  if (snap.state === 'SUPPORTED') return true;
  if (snap.state === 'UNSUPPORTED') return false;
  return null;
}

export function xrSupportUnresolved(state: XrSupportState = snap.state): boolean {
  return state === 'TIMED_OUT' || state === 'ERROR';
}

export function onXrSupportChange(fn: (value: XrSupportSnapshot) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetXrSupportProbeForTests(): void {
  cancelTimer?.();
  cancelTimer = null;
  flight = null;
  settle = null;
  snap = blank();
  listeners.clear();
}

/** Test seam: force a settled state without touching navigator. */
export function setXrSupportForTests(value: boolean | null, state?: XrSupportState): void {
  cancelTimer?.();
  cancelTimer = null;
  const resolved: XrSupportState = state
    ?? (value === true ? 'SUPPORTED' : value === false ? 'UNSUPPORTED' : 'NOT_STARTED');
  const unresolvedYet = resolved === 'NOT_STARTED' || resolved === 'PROBING';
  snap = {
    ...blank(snap.softTimeoutMs),
    state: resolved,
    supported: resolved === 'SUPPORTED' ? true : resolved === 'UNSUPPORTED' ? false : null,
    invoked: resolved !== 'NOT_STARTED',
    probeStartedAt: resolved === 'NOT_STARTED' ? null : 0,
    probeSettledAt: unresolvedYet ? null : 0,
    elapsedMs: unresolvedYet ? null : 0,
    reason: resolved === 'SUPPORTED' ? 'API_TRUE'
      : resolved === 'UNSUPPORTED' ? 'API_FALSE'
      : resolved === 'TIMED_OUT' ? 'SOFT_TIMEOUT'
      : resolved === 'ERROR' ? 'API_ERROR' : null,
  };
  flight = unresolvedYet ? null : Promise.resolve(xrSupportSnapshot());
  settle = null;
  emit();
}

function defaultXr(): XrSupportApi | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { xr?: XrSupportApi }).xr ?? null;
}

function finish(patch: Partial<XrSupportSnapshot>): void {
  cancelTimer?.();
  cancelTimer = null;
  snap = { ...snap, ...patch };
  const done = settle;
  settle = null;
  emit();
  done?.(xrSupportSnapshot());
}

/**
 * Start (or join) the single shared probe. Never restarts: a second caller —
 * StoreScene wiring, the JP-4A console, a scene rebuild — gets the same flight.
 * Resolves at the soft timeout if the underlying promise has not answered.
 */
export function ensureXrSupportProbe(deps: XrSupportProbeDeps = {}): Promise<XrSupportSnapshot> {
  if (flight) return flight;
  const now = deps.now ?? (() => Date.now());
  const softTimeoutMs = Math.min(
    deps.softTimeoutMs ?? XR_SUPPORT_SOFT_TIMEOUT_MS,
    XR_SUPPORT_MAX_SOFT_TIMEOUT_MS,
  );
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  });
  const startedAt = now();
  snap = { ...blank(softTimeoutMs), probeStartedAt: startedAt, state: 'PROBING' };

  const pendingFlight = new Promise<XrSupportSnapshot>((resolve) => { settle = resolve; });
  flight = pendingFlight;

  if (deps.isTauri) {
    finish({ state: 'UNSUPPORTED', supported: false, reason: 'TAURI', probeSettledAt: startedAt, elapsedMs: 0 });
    return pendingFlight;
  }
  const xr = (deps.getXr ?? defaultXr)();
  if (!xr) {
    finish({
      state: 'UNSUPPORTED', supported: false, reason: 'NO_NAVIGATOR_XR',
      probeSettledAt: startedAt, elapsedMs: 0,
    });
    return pendingFlight;
  }
  if (typeof xr.isSessionSupported !== 'function') {
    finish({
      state: 'UNSUPPORTED', supported: false, reason: 'NO_IS_SESSION_SUPPORTED',
      probeSettledAt: startedAt, elapsedMs: 0,
    });
    return pendingFlight;
  }

  snap = { ...snap, invoked: true };
  emit();

  cancelTimer = schedule(() => {
    cancelTimer = null;
    if (snap.state !== 'PROBING') return;
    const at = now();
    finish({
      state: 'TIMED_OUT', supported: null, reason: 'SOFT_TIMEOUT',
      probeSettledAt: at, elapsedMs: at - startedAt,
    });
  }, softTimeoutMs);

  let pending: Promise<boolean>;
  try {
    pending = Promise.resolve(xr.isSessionSupported('immersive-vr'));
  } catch (err) {
    const at = now();
    finish({
      state: 'ERROR', supported: null, reason: 'API_ERROR',
      error: err instanceof Error ? err.message : String(err),
      probeSettledAt: at, elapsedMs: at - startedAt,
    });
    return pendingFlight;
  }

  // Always attached, so a late resolution/rejection can never become an
  // unhandled rejection and can never start a second probe.
  void pending.then(
    (value) => {
      const at = now();
      if (snap.state === 'PROBING') {
        finish({
          state: value ? 'SUPPORTED' : 'UNSUPPORTED',
          supported: !!value,
          reason: value ? 'API_TRUE' : 'API_FALSE',
          probeSettledAt: at,
          elapsedMs: at - startedAt,
        });
        return;
      }
      // Late answer after the soft timeout. Record it, and promote a late
      // `true` to SUPPORTED — that is the authoritative answer arriving late.
      const promote = value && snap.state === 'TIMED_OUT';
      snap = {
        ...snap,
        lateResult: !!value,
        lateSettledAt: at,
        lateElapsedMs: at - (snap.probeStartedAt ?? at),
        ...(promote
          ? { state: 'SUPPORTED' as XrSupportState, supported: true, reason: 'API_TRUE' as XrSupportReason }
          : {}),
      };
      emit();
    },
    (err) => {
      const at = now();
      const message = err instanceof Error ? err.message : String(err);
      if (snap.state === 'PROBING') {
        finish({
          state: 'ERROR', supported: null, reason: 'API_ERROR', error: message,
          probeSettledAt: at, elapsedMs: at - startedAt,
        });
        return;
      }
      snap = { ...snap, lateResult: null, lateSettledAt: at, error: snap.error ?? message };
      emit();
    },
  );

  return pendingFlight;
}

/** Is requestSession callable at all? The authoritative diagnostic fallback. */
export function xrRequestSessionAvailable(
  xr: XrSupportApi | null | undefined = defaultXr(),
): boolean {
  return typeof xr?.requestSession === 'function';
}
