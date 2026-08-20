// Browser-side Enter VR wiring. Kept out of main.ts so the power menu /
// HUD buttons can light up without feeding that file-budget.
// Do not import three-scene — main loads that module dynamically.

import { isStoreVisualReady, storePreloadStatusLines } from '../store-visual-ready.ts';
import { t } from '../i18n/index.ts';
import { applyXrEntryVisibility, xrEntryShouldShow } from './entry.ts';
import {
  ensureXrSupportProbe,
  onXrSupportChange,
  setXrSupportForTests,
  xrSupportedOrNull,
} from './xr-support-probe.ts';

export interface XrEnterOptions {
  /**
   * JP-4A diagnostic fast path: the shared support probe timed out or errored,
   * so requestSession is the authoritative attempt. Never implies support.
   */
  allowUnverifiedSupport?: boolean;
}

export interface XrEntryScene {
  xrVideoGetter: (() => HTMLVideoElement | null) | null;
  probeXr(): Promise<boolean>;
  xr: { presenting: boolean } | null;
  enterXr(opts?: XrEnterOptions): Promise<void>;
  exitXr(): Promise<void>;
}

export type XrSessionActionMode = 'toggle' | 'enter';

export type XrSessionActionReason =
  | 'OK'
  | 'STORE_SCENE_NOT_READY'
  | 'STORE_LOADING'
  | 'XR_RUNTIME_NOT_READY'
  | 'SESSION_NOT_PRESENTING'
  | 'ENTRY_FAILED'
  | 'ENTERING'
  | 'ALREADY_PRESENTING';

export interface XrSessionActionResult {
  ok: boolean;
  action: 'entered' | 'exited' | 'none';
  reason: XrSessionActionReason;
  error?: string;
  presenting: boolean;
}

let wiredSupport: boolean | null = null;
let inFlight: Promise<XrSessionActionResult> | null = null;
let unsubSupport: (() => void) | null = null;

export function wiredXrSupported(): boolean | null {
  return wiredSupport ?? xrSupportedOrNull();
}

export function resetXrSessionActionForTests(): void {
  wiredSupport = null;
  inFlight = null;
  unsubSupport?.();
  unsubSupport = null;
}

export function setWiredXrSupportedForTests(value: boolean | null): void {
  wiredSupport = value;
  setXrSupportForTests(value);
}

export async function wireXrEntry(opts: {
  isTauri: boolean;
  scene: XrEntryScene;
  getVideo: () => HTMLVideoElement | null;
  onPowerButtonsNeedXr: () => void;
  log: (msg: string, type: 'system' | 'cec' | 'video') => void;
  onXrSupport?: (supported: boolean | null) => void;
}): Promise<boolean> {
  opts.scene.xrVideoGetter = opts.getVideo;
  wiredSupport = null;
  opts.onXrSupport?.(null);
  // The shared probe was started in main() right after emulator installation;
  // this normally reads an already-settled answer instead of starting one.
  void ensureXrSupportProbe({ isTauri: opts.isTauri });
  const supported = await opts.scene.probeXr();
  wiredSupport = supported;
  opts.onXrSupport?.(supported);
  const show = applySupportToEntryUi(supported, opts);
  // A soft-timed-out isSessionSupported() can still answer later. If it comes
  // back true, light the production button up then - conservative either way.
  unsubSupport?.();
  unsubSupport = onXrSupportChange((snap) => {
    if (snap.state !== 'SUPPORTED' || wiredSupport === true) return;
    wiredSupport = true;
    opts.onXrSupport?.(true);
    applySupportToEntryUi(true, opts);
  });
  return show;
}

function applySupportToEntryUi(supported: boolean, opts: {
  isTauri: boolean;
  onPowerButtonsNeedXr: () => void;
  log: (msg: string, type: 'system' | 'cec' | 'video') => void;
}): boolean {
  const show = xrEntryShouldShow({ isTauri: opts.isTauri, immersiveVrSupported: supported });
  if (show) opts.onPowerButtonsNeedXr();
  applyXrEntryVisibility(show, false);
  syncXrEntryLabels(false);
  if (show) {
    opts.log('[XR] immersive-vr is supported. Enter VR is available.', 'system');
  }
  return show;
}

export function syncXrEntryLabels(presenting: boolean): void {
  if (typeof document === 'undefined') return;
  const power = document.getElementById('btn-enter-vr');
  const hud = document.getElementById('xr-enter-btn');
  if (power) power.textContent = presenting ? t('xr.exit') : t('power.enterVr');
  if (hud) hud.textContent = presenting ? t('xr.exit') : t('xr.enter');
}

async function runXrSessionAction(
  scene: XrEntryScene | null,
  mode: XrSessionActionMode,
  enterOpts?: XrEnterOptions,
): Promise<XrSessionActionResult> {
  if (!scene) {
    return { ok: false, action: 'none', reason: 'STORE_SCENE_NOT_READY', presenting: false };
  }
  const presenting = !!scene.xr?.presenting;
  if (mode === 'enter' && presenting) {
    return { ok: true, action: 'none', reason: 'ALREADY_PRESENTING', presenting: true };
  }
  try {
    if (presenting) {
      await scene.exitXr();
      syncXrEntryLabels(!!scene.xr?.presenting);
      return { ok: true, action: 'exited', reason: 'OK', presenting: !!scene.xr?.presenting };
    }
    if (!isStoreVisualReady()) {
      const status = storePreloadStatusLines();
      console.warn('[XR]', status.title, status.lines.join(' · '));
      return { ok: false, action: 'none', reason: 'STORE_LOADING', presenting: false };
    }
    await scene.enterXr(enterOpts);
    const nowPresenting = !!scene.xr?.presenting;
    syncXrEntryLabels(nowPresenting);
    if (!nowPresenting) {
      // enterXr resolved without the runtime actually presenting. Reporting
      // ok/entered here is what let a false VR ACTIVE reach the operator.
      console.warn('[XR] enterXr resolved but the runtime is not presenting.');
      return { ok: false, action: 'none', reason: 'SESSION_NOT_PRESENTING', presenting: false };
    }
    return { ok: true, action: 'entered', reason: 'OK', presenting: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'STORE_VISIBLE_LOADING') {
      const status = storePreloadStatusLines();
      console.warn('[XR]', t('store.preload.waitVr'), status.lines.join(' · '));
      return { ok: false, action: 'none', reason: 'STORE_LOADING', presenting: !!scene.xr?.presenting };
    }
    if (msg === 'XR_RUNTIME_NOT_READY') {
      console.warn('[XR] no XR runtime is attached to the scene yet.');
      return { ok: false, action: 'none', reason: 'XR_RUNTIME_NOT_READY', error: msg, presenting: false };
    }
    console.warn('[XR] session request failed:', err);
    syncXrEntryLabels(!!scene.xr?.presenting);
    return { ok: false, action: 'none', reason: 'ENTRY_FAILED', error: msg, presenting: !!scene.xr?.presenting };
  }
}

function performXrSessionAction(
  scene: XrEntryScene | null,
  mode: XrSessionActionMode,
  enterOpts?: XrEnterOptions,
): Promise<XrSessionActionResult> {
  if (inFlight) {
    return Promise.resolve({
      ok: false,
      action: 'none',
      reason: 'ENTERING',
      presenting: !!scene?.xr?.presenting,
    });
  }
  const pending = runXrSessionAction(scene, mode, enterOpts).finally(() => {
    inFlight = null;
  });
  inFlight = pending;
  return pending;
}

export async function toggleXrSession(scene: XrEntryScene | null): Promise<XrSessionActionResult> {
  return performXrSessionAction(scene, 'toggle');
}

/** Same implementation as toggle, but never exits. Used by JP-4A ENTER VR. */
export function enterXrSession(
  scene: XrEntryScene | null,
  enterOpts?: XrEnterOptions,
): Promise<XrSessionActionResult> {
  return performXrSessionAction(scene, 'enter', enterOpts);
}
