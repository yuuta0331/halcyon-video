// Independent timing buckets for XR entry. The point of separating these is
// that a multi-minute STORE readiness wait must never be able to masquerade as
// XR support probing — the regression that produced HF3-HF4 was exactly that
// conflation. Each bucket is measured and gated on its own.

export interface XrEntryTimings {
  /** isSessionSupported() wall time (or the soft timeout that bounded it). */
  supportProbeMs: number | null;
  /** Store visual readiness wall time. Has its own, much larger bound. */
  storeReadyMs: number | null;
  /** JP-4A ENTER VR click -> action result. */
  enterActionMs: number | null;
  requestSessionMs: number | null;
  setSessionMs: number | null;
  /** requestSession start -> first world frame presented. */
  firstWorldRenderMs: number | null;
}

export function blankXrEntryTimings(): XrEntryTimings {
  return {
    supportProbeMs: null,
    storeReadyMs: null,
    enterActionMs: null,
    requestSessionMs: null,
    setSessionMs: null,
    firstWorldRenderMs: null,
  };
}

export interface XrEntryStartupMarks {
  requestSessionStart: number | null;
  requestSessionEnd: number | null;
  rendererSetSessionStart: number | null;
  rendererSetSessionEnd: number | null;
  firstWorldRenderCompletedAt: number | null;
}

function span(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from == null || to == null) return null;
  const ms = to - from;
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** Derive the session-side timings from an XrStartupTrace-shaped object. */
export function xrEntryTimingsFromStartup(
  marks: XrEntryStartupMarks | null | undefined,
): Pick<XrEntryTimings, 'requestSessionMs' | 'setSessionMs' | 'firstWorldRenderMs'> {
  return {
    requestSessionMs: span(marks?.requestSessionStart, marks?.requestSessionEnd),
    setSessionMs: span(marks?.rendererSetSessionStart, marks?.rendererSetSessionEnd),
    firstWorldRenderMs: span(marks?.requestSessionStart, marks?.firstWorldRenderCompletedAt),
  };
}

export interface XrSupportTimingGate {
  pass: boolean;
  supportProbeMs: number | null;
  boundMs: number;
  reason: 'OK' | 'STILL_PENDING' | 'OVER_BOUND' | 'NOT_MEASURED';
}

/**
 * Strict acceptance for support probing alone. Deliberately small: the JP-4A
 * diagnostic route may not accept a multi-second — let alone 240s — support
 * wait, whatever the store is doing.
 */
export function checkXrSupportTiming(input: {
  supportProbeMs: number | null;
  stillProbing: boolean;
  boundMs: number;
}): XrSupportTimingGate {
  const { supportProbeMs, boundMs } = input;
  if (input.stillProbing) {
    return { pass: false, supportProbeMs, boundMs, reason: 'STILL_PENDING' };
  }
  if (supportProbeMs == null) {
    return { pass: false, supportProbeMs, boundMs, reason: 'NOT_MEASURED' };
  }
  if (supportProbeMs > boundMs) {
    return { pass: false, supportProbeMs, boundMs, reason: 'OVER_BOUND' };
  }
  return { pass: true, supportProbeMs, boundMs, reason: 'OK' };
}
