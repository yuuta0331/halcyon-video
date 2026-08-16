// Browser-side Enter VR wiring. Kept out of main.ts so the power menu /
// HUD buttons can light up without feeding that file-budget.
// Do not import three-scene — main loads that module dynamically.

import { isStoreVisualReady, storePreloadStatusLines } from '../store-visual-ready';
import { t } from '../i18n';
import { applyXrEntryVisibility, xrEntryShouldShow } from './entry';

export interface XrEntryScene {
  xrVideoGetter: (() => HTMLVideoElement | null) | null;
  probeXr(): Promise<boolean>;
  xr: { presenting: boolean } | null;
  enterXr(): Promise<void>;
  exitXr(): Promise<void>;
}

export async function wireXrEntry(opts: {
  isTauri: boolean;
  scene: XrEntryScene;
  getVideo: () => HTMLVideoElement | null;
  onPowerButtonsNeedXr: () => void;
  log: (msg: string, type: 'system' | 'cec' | 'video') => void;
}): Promise<boolean> {
  opts.scene.xrVideoGetter = opts.getVideo;
  const supported = await opts.scene.probeXr();
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

export async function toggleXrSession(scene: XrEntryScene | null): Promise<void> {
  if (!scene) return;
  try {
    if (scene.xr?.presenting) await scene.exitXr();
    else if (!isStoreVisualReady()) {
      const status = storePreloadStatusLines();
      console.warn('[XR]', status.title, status.lines.join(' · '));
      return;
    } else await scene.enterXr();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'STORE_VISIBLE_LOADING') {
      const status = storePreloadStatusLines();
      console.warn('[XR]', t('store.preload.waitVr'), status.lines.join(' · '));
      return;
    }
    console.warn('[XR] session request failed:', err);
  }
  syncXrEntryLabels(!!scene.xr?.presenting);
}
