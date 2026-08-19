// JP-4A diagnostic console XR-entry bridge.
// The console calls this from the original ENTER VR click; it must not
// synthesize clicks on production Enter VR buttons.

import { isStoreVisualReady } from '../store-visual-ready.ts';
import {
  enterXrSession,
  wiredXrSupported,
  type XrEntryScene,
  type XrSessionActionResult,
} from './boot.ts';

export const JP4A_CONSOLE_READINESS = [
  'BOOTING',
  'WAITING_FOR_STORE',
  'XR_UNSUPPORTED',
  'STORE_LOADING',
  'READY_TO_ENTER_VR',
  'ENTERING_VR',
  'PRESENTING',
  'ENTRY_FAILED',
] as const;

export type Jp4aConsoleReadiness = (typeof JP4A_CONSOLE_READINESS)[number];

export type Jp4aEnterVrReason =
  | 'OK'
  | 'STORE_SCENE_NOT_READY'
  | 'STORE_LOADING'
  | 'XR_UNSUPPORTED'
  | 'XR_CONTROLS_INITIALIZING'
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
  listeners.clear();
}

export function deriveJp4aConsoleReadiness(input: {
  hostBound: boolean;
  xrSupported: boolean | null;
  scene: XrEntryScene | null;
  storeVisualReady: boolean;
  entering: boolean;
  presenting: boolean;
  lastFailed: boolean;
}): Jp4aConsoleReadiness {
  if (input.entering) return 'ENTERING_VR';
  if (input.presenting) return 'PRESENTING';
  if (input.xrSupported === false) return 'XR_UNSUPPORTED';
  if (!input.hostBound) return 'BOOTING';
  if (input.xrSupported == null) return 'BOOTING';
  if (!input.scene) return 'WAITING_FOR_STORE';
  if (!input.storeVisualReady) return 'STORE_LOADING';
  if (input.lastFailed) return 'ENTRY_FAILED';
  return 'READY_TO_ENTER_VR';
}

export function jp4aEnterVrEnabled(readiness: Jp4aConsoleReadiness): boolean {
  return readiness === 'READY_TO_ENTER_VR' || readiness === 'ENTRY_FAILED';
}

export function jp4aEnterVrStatusText(readiness: Jp4aConsoleReadiness, last?: Jp4aActionResult | null): string {
  switch (readiness) {
    case 'BOOTING':
      return 'Checking XR support…';
    case 'WAITING_FOR_STORE':
      return 'WAITING FOR STORE…';
    case 'XR_UNSUPPORTED':
      return 'Immersive VR unavailable';
    case 'STORE_LOADING':
      return 'Store is still loading…';
    case 'READY_TO_ENTER_VR':
      return 'ENTER VR';
    case 'ENTERING_VR':
      return 'ENTERING VR…';
    case 'PRESENTING':
      return 'VR ACTIVE';
    case 'ENTRY_FAILED':
      return `VR ENTRY FAILED${last?.reason ? `: ${last.reason}` : ''}`;
    default:
      return 'WAITING FOR STORE…';
  }
}

export function jp4aConsoleEntrySnapshot(): {
  readiness: Jp4aConsoleReadiness;
  enabled: boolean;
  status: string;
  presenting: boolean;
  lastResult: Jp4aActionResult | null;
  enterCalls: number;
} {
  const scene = getScene?.() ?? null;
  const presenting = !!scene?.xr?.presenting;
  const readiness = deriveJp4aConsoleReadiness({
    hostBound: getScene != null,
    xrSupported: wiredXrSupported(),
    scene,
    storeVisualReady: isStoreVisualReady(),
    entering,
    presenting,
    lastFailed: lastResult != null && !lastResult.ok && lastResult.reason === 'ENTRY_FAILED',
  });
  return {
    readiness,
    enabled: jp4aEnterVrEnabled(readiness),
    status: jp4aEnterVrStatusText(readiness, lastResult),
    presenting,
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
  if (current.readiness === 'XR_UNSUPPORTED') {
    lastResult = {
      ok: false,
      reason: 'XR_UNSUPPORTED',
      presenting: false,
      enterCalls,
    };
    emitJp4aConsoleEntry();
    return Promise.resolve(lastResult);
  }
  if (current.readiness === 'BOOTING') {
    lastResult = {
      ok: false,
      reason: 'XR_CONTROLS_INITIALIZING',
      presenting: false,
      enterCalls,
    };
    emitJp4aConsoleEntry();
    return Promise.resolve(lastResult);
  }

  entering = true;
  emitJp4aConsoleEntry();
  enterCalls += 1;
  const scene = getScene?.() ?? null;
  return enterXrSession(scene).then((boot) => {
    lastResult = mapBootResult(boot);
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
