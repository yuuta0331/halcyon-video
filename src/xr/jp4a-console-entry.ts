// JP-4A diagnostic console XR-entry bridge.
// The console calls this from the original ENTER VR click; it must not
// synthesize clicks on production Enter VR buttons.
//
// Two truths this module is responsible for:
//  1. "Checking XR support" is displayed only while the shared support probe is
//     really PROBING. Before that it says "Preparing XR runtime". A soft
//     timeout moves on to TRY ENTER VR instead of blocking forever.
//  2. VR ACTIVE requires confirmed JP-4A XR startup (xrStartedAt + xr_started),
//     never a bare presenting flag.

import { isStoreVisualReady, storeVisibleProgress } from '../store-visual-ready.ts';
import {
  enterXrSession,
  type XrEntryScene,
  type XrSessionActionResult,
} from './boot.ts';
import {
  jp4aTestSnapshot,
  jp4aXrEntryConfirmed,
  noteJp4aTimings,
} from './jp4a-test-state.ts';
import {
  onXrSupportChange,
  xrRequestSessionAvailable,
  xrSupportSnapshot,
  type XrSupportState,
} from './xr-support-probe.ts';

export const JP4A_CONSOLE_READINESS = [
  'BOOTING',
  'CHECKING_XR_SUPPORT',
  'WAITING_FOR_STORE',
  'XR_UNSUPPORTED',
  'STORE_LOADING',
  'READY_TO_ENTER_VR',
  'XR_CHECK_SLOW_READY_TO_TRY',
  'ENTERING_VR',
  'PRESENTING',
  'VR_ENTRY_NOT_CONFIRMED',
  'ENTRY_FAILED',
] as const;

export type Jp4aConsoleReadiness = (typeof JP4A_CONSOLE_READINESS)[number];

export type Jp4aEnterVrReason =
  | 'OK'
  | 'STORE_SCENE_NOT_READY'
  | 'STORE_LOADING'
  | 'XR_UNSUPPORTED'
  | 'XR_SUPPORT_CHECKING'
  | 'XR_CONTROLS_INITIALIZING'
  | 'XR_RUNTIME_NOT_READY'
  | 'SESSION_NOT_PRESENTING'
  | 'ENTERING'
  | 'ENTRY_FAILED'
  | 'ALREADY_PRESENTING';

export interface Jp4aActionResult {
  ok: boolean;
  reason: Jp4aEnterVrReason;
  presenting: boolean;
  error?: string;
  enterCalls: number;
}

export type Jp4aStoreSceneGetter = () => XrEntryScene | null;

let getScene: Jp4aStoreSceneGetter | null = null;
let entering = false;
let lastResult: Jp4aActionResult | null = null;
let enterCalls = 0;
let unsubSupport: (() => void) | null = null;
const listeners = new Set<() => void>();

export function bindJp4aConsoleStoreScene(getter: Jp4aStoreSceneGetter | null): void {
  getScene = getter;
  emitJp4aConsoleEntry();
}

export function notifyJp4aConsoleEntry(): void {
  emitJp4aConsoleEntry();
}

export function onJp4aConsoleEntryChange(fn: () => void): () => void {
  listeners.add(fn);
  // The support probe lives outside StoreScene, so the console must hear about
  // PROBING -> SUPPORTED / TIMED_OUT without waiting for any scene event.
  if (!unsubSupport) unsubSupport = onXrSupportChange(() => emitJp4aConsoleEntry());
  return () => listeners.delete(fn);
}

function emitJp4aConsoleEntry(): void {
  for (const fn of listeners) fn();
}

export function resetJp4aConsoleEntryForTests(): void {
  getScene = null;
  entering = false;
  lastResult = null;
  enterCalls = 0;
  unsubSupport?.();
  unsubSupport = null;
  listeners.clear();
}

export function deriveJp4aConsoleReadiness(input: {
  hostBound: boolean;
  supportState: XrSupportState;
  requestSessionAvailable: boolean;
  scene: XrEntryScene | null;
  storeVisualReady: boolean;
  entering: boolean;
  presenting: boolean;
  xrConfirmed: boolean;
  lastFailed: boolean;
}): Jp4aConsoleReadiness {
  if (input.entering) return 'ENTERING_VR';
  if (input.presenting) {
    // A presenting runtime with no recorded JP-4A startup is exactly the state
    // the operator saw as a false VR ACTIVE. It is an incomplete entry.
    return input.xrConfirmed ? 'PRESENTING' : 'VR_ENTRY_NOT_CONFIRMED';
  }
  if (input.supportState === 'UNSUPPORTED') return 'XR_UNSUPPORTED';
  if (input.supportState === 'NOT_STARTED') return 'BOOTING';
  if (input.supportState === 'PROBING') return 'CHECKING_XR_SUPPORT';
  if (!input.hostBound || !input.scene) return 'WAITING_FOR_STORE';
  if (!input.storeVisualReady) return 'STORE_LOADING';
  if (input.supportState === 'TIMED_OUT' || input.supportState === 'ERROR') {
    // Not "unsupported" — unanswered. requestSession is the real authority.
    return input.requestSessionAvailable ? 'XR_CHECK_SLOW_READY_TO_TRY' : 'XR_UNSUPPORTED';
  }
  if (input.lastFailed) return 'ENTRY_FAILED';
  return 'READY_TO_ENTER_VR';
}

export function jp4aEnterVrEnabled(readiness: Jp4aConsoleReadiness): boolean {
  return readiness === 'READY_TO_ENTER_VR'
    || readiness === 'ENTRY_FAILED'
    || readiness === 'XR_CHECK_SLOW_READY_TO_TRY';
}

export function jp4aEnterVrButtonLabel(readiness: Jp4aConsoleReadiness): string {
  return readiness === 'XR_CHECK_SLOW_READY_TO_TRY' ? 'TRY ENTER VR' : 'ENTER VR';
}

export function jp4aEnterVrStatusText(readiness: Jp4aConsoleReadiness, last?: Jp4aActionResult | null): string {
  switch (readiness) {
    case 'BOOTING':
      return 'Preparing XR runtime…';
    case 'CHECKING_XR_SUPPORT':
      return 'Checking XR support…';
    case 'WAITING_FOR_STORE':
      return 'WAITING FOR STORE…';
    case 'XR_UNSUPPORTED':
      return 'Immersive VR unavailable';
    case 'STORE_LOADING':
      return 'Store is still loading…';
    case 'READY_TO_ENTER_VR':
      return 'ENTER VR';
    case 'XR_CHECK_SLOW_READY_TO_TRY':
      return 'XR CHECK SLOW — READY TO TRY VR';
    case 'ENTERING_VR':
      return 'ENTERING VR…';
    case 'PRESENTING':
      return 'VR ACTIVE';
    case 'VR_ENTRY_NOT_CONFIRMED':
      return 'VR ENTRY NOT CONFIRMED';
    case 'ENTRY_FAILED':
      return `VR ENTRY FAILED${last?.reason ? `: ${last.reason}` : ''}`;
    default:
      return 'WAITING FOR STORE…';
  }
}

export interface Jp4aConsoleEntrySnapshot {
  readiness: Jp4aConsoleReadiness;
  enabled: boolean;
  label: string;
  status: string;
  presenting: boolean;
  xrConfirmed: boolean;
  supportState: XrSupportState;
  supportProbeMs: number | null;
  lastResult: Jp4aActionResult | null;
  enterCalls: number;
}

export function jp4aConsoleEntrySnapshot(): Jp4aConsoleEntrySnapshot {
  const scene = getScene?.() ?? null;
  const presenting = !!scene?.xr?.presenting;
  const support = xrSupportSnapshot();
  const readiness = deriveJp4aConsoleReadiness({
    hostBound: getScene != null,
    supportState: support.state,
    requestSessionAvailable: xrRequestSessionAvailable(),
    scene,
    storeVisualReady: isStoreVisualReady(),
    entering,
    presenting,
    xrConfirmed: jp4aXrEntryConfirmed(jp4aTestSnapshot()),
    lastFailed: lastResult != null && !lastResult.ok
      && (lastResult.reason === 'ENTRY_FAILED'
        || lastResult.reason === 'SESSION_NOT_PRESENTING'
        || lastResult.reason === 'XR_RUNTIME_NOT_READY'),
  });
  return {
    readiness,
    enabled: jp4aEnterVrEnabled(readiness),
    label: jp4aEnterVrButtonLabel(readiness),
    status: jp4aEnterVrStatusText(readiness, lastResult),
    presenting,
    xrConfirmed: jp4aXrEntryConfirmed(jp4aTestSnapshot()),
    supportState: support.state,
    supportProbeMs: support.elapsedMs,
    lastResult,
    enterCalls,
  };
}

function mapBootResult(result: XrSessionActionResult): Jp4aActionResult {
  const reason: Jp4aEnterVrReason = result.reason;
  return {
    ok: result.ok,
    reason,
    presenting: result.presenting,
    error: result.error,
    enterCalls,
  };
}

function refusal(reason: Jp4aEnterVrReason, presenting = false): Promise<Jp4aActionResult> {
  lastResult = { ok: false, reason, presenting, enterCalls };
  emitJp4aConsoleEntry();
  return Promise.resolve(lastResult);
}

/**
 * Called from the JP-4A ENTER VR click handler. Starts the authoritative
 * enterXrSession path in this turn — no preload poll, no other-button click.
 */
export function invokeJp4aEnterVr(): Promise<Jp4aActionResult> {
  const current = jp4aConsoleEntrySnapshot();
  if (current.readiness === 'ENTERING_VR') {
    return Promise.resolve({
      ok: false,
      reason: 'ENTERING',
      presenting: current.presenting,
      enterCalls,
    });
  }
  if (current.readiness === 'XR_UNSUPPORTED') return refusal('XR_UNSUPPORTED');
  if (current.readiness === 'CHECKING_XR_SUPPORT') return refusal('XR_SUPPORT_CHECKING');
  if (current.readiness === 'BOOTING') return refusal('XR_CONTROLS_INITIALIZING');

  entering = true;
  emitJp4aConsoleEntry();
  enterCalls += 1;
  const scene = getScene?.() ?? null;
  const startedAt = Date.now();
  noteJp4aTimings({
    supportProbeMs: current.supportProbeMs,
    storeReadyMs: storeVisibleProgress().timeToVisualReady,
  });
  // Timed-out / errored support means "no answer", so the diagnostic is allowed
  // to let requestSession answer instead. Production keeps its own gate.
  const allowUnverifiedSupport = current.readiness === 'XR_CHECK_SLOW_READY_TO_TRY';
  return enterXrSession(scene, { allowUnverifiedSupport }).then((boot) => {
    lastResult = mapBootResult(boot);
    noteJp4aTimings({ enterActionMs: Date.now() - startedAt });
    return lastResult;
  }).finally(() => {
    entering = false;
    emitJp4aConsoleEntry();
  });
}

export function clearJp4aConsoleEntryFailure(): void {
  lastResult = null;
  entering = false;
  emitJp4aConsoleEntry();
}

export function jp4aEnterVrUsesProxyClick(consoleSrc: string): boolean {
  const enterFn = consoleSrc.match(/function enterVr\(\): void \{[\s\S]*?\n\}/);
  const body = enterFn?.[0] ?? '';
  return /\.click\(\)/.test(body)
    || /xr-enter-btn/.test(body)
    || /btn-enter-vr/.test(body);
}

export function jp4aEnterVrClickStartsAuthoritativeAction(consoleSrc: string): boolean {
  return consoleSrc.includes('void invokeJp4aEnterVr()')
    && /actionId:\s*'enter-vr'/.test(consoleSrc)
    && !consoleSrc.includes('enterXrSession')
    && !jp4aEnterVrUsesProxyClick(consoleSrc)
    && !/async function enterVr/.test(consoleSrc);
}
