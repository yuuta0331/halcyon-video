// Browser-side Enter VR wiring. Kept out of main.ts so the power menu /
// HUD buttons can light up without feeding that file-budget.
// Do not import three-scene — main loads that module dynamically.

import { isStoreVisualReady, storePreloadStatusLines } from '../store-visual-ready.ts';
import { t } from '../i18n/index.ts';
import { applyXrEntryVisibility, xrEntryShouldShow } from './entry.ts';

export interface XrEntryScene {
  xrVideoGetter: (() => HTMLVideoElement | null) | null;
  probeXr(): Promise<boolean>;
  xr: { presenting: boolean } | null;
  enterXr(): Promise<void>;
  exitXr(): Promise<void>;
}

export type XrSessionActionMode = 'toggle' | 'enter';

export type XrSessionActionReason =
  | 'OK'
  | 'STORE_SCENE_NOT_READY'
  | 'STORE_LOADING'
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

export function wiredXrSupported(): boolean | null {
  return wiredSupport;
}

export function resetXrSessionActionForTests(): void {
  wiredSupport = null;
  inFlight = null;
}

export function setWiredXrSupportedForTests(value: boolean | null): void {
  wiredSupport = value;
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
  const supported = await opts.scene.probeXr();
  wiredSupport = supported;
  opts.onXrSupport?.(supported);
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
    await scene.enterXr();
    syncXrEntryLabels(!!scene.xr?.presenting);
    return { ok: true, action: 'entered', reason: 'OK', presenting: !!scene.xr?.presenting };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'STORE_VISIBLE_LOADING') {
      const status = storePreloadStatusLines();
      console.warn('[XR]', t('store.preload.waitVr'), status.lines.join(' · '));
      return { ok: false, action: 'none', reason: 'STORE_LOADING', presenting: !!scene.xr?.presenting };
    }
    console.warn('[XR] session request failed:', err);
    syncXrEntryLabels(!!scene.xr?.presenting);
    return { ok: false, action: 'none', reason: 'ENTRY_FAILED', error: msg, presenting: !!scene.xr?.presenting };
  }
}

function performXrSessionAction(
  scene: XrEntryScene | null,
  mode: XrSessionActionMode,
): Promise<XrSessionActionResult> {
  if (inFlight) {
    return Promise.resolve({
      ok: false,
      action: 'none',
      reason: 'ENTERING',
      presenting: !!scene?.xr?.presenting,
    });
  }
  const pending = runXrSessionAction(scene, mode).finally(() => {
    inFlight = null;
  });
  inFlight = pending;
  return pending;
}

export async function toggleXrSession(scene: XrEntryScene | null): Promise<XrSessionActionResult> {
  return performXrSessionAction(scene, 'toggle');
}

/** Same implementation as toggle, but never exits. Used by JP-4A ENTER VR. */
export function enterXrSession(scene: XrEntryScene | null): Promise<XrSessionActionResult> {
  return performXrSessionAction(scene, 'enter');
}
