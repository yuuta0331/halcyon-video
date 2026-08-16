// Development-only IWER Meta Quest 3 runtime. Never imported from production
// chunks: install-xr-emu.ts dynamically imports this file behind
// `import.meta.env.DEV`.

import { XRDevice, metaQuest3 } from 'iwer';
import { classifyXrEnvironment } from '../xr/classification';
import { shouldInstallIwer } from '../xr/emu-policy';
import { readXrFlags } from '../xr/flags';
import { setIwerActive } from '../xr/emu-state';

export interface IwerHandle {
  device: XRDevice;
  classification: 'IWER_EMULATED';
  installed: true;
}

let handle: IwerHandle | null = null;

export function getIwerHandle(): IwerHandle | null {
  return handle;
}

export function iwerIsActive(): boolean {
  return handle != null;
}

export async function installIwerQuest3(search?: string): Promise<IwerHandle | null> {
  if (handle) return handle;
  const flags = readXrFlags(search);
  if (!flags.emu) return null;

  const device = new XRDevice(metaQuest3);
  let nativeImmersiveVr = false;
  try {
    nativeImmersiveVr = !!(await (navigator as Navigator & { xr?: XRSystem }).xr?.isSessionSupported?.('immersive-vr'));
  } catch {
    nativeImmersiveVr = false;
  }
  const plan = shouldInstallIwer({
    emuRequested: flags.emu,
    nativeImmersiveVrSupported: nativeImmersiveVr,
  });
  if (!plan.install) {
    console.info('[XR] Native immersive-vr is present — IWER will not replace it.');
    return null;
  }

  // Desktop Chrome often exposes navigator.xr without immersive-vr. IWER's
  // default skip-if-native would then leave us with an unusable XR object.
  device.installRuntime({ polyfillLayers: false, forceInstall: plan.forceInstall });
  device.controlMode = 'programmatic';
  handle = { device, classification: 'IWER_EMULATED', installed: true };
  setIwerActive(true);
  console.info('[XR] IWER_EMULATED active (Meta Quest 3).');

  if (import.meta.env.DEV && flags.emuUi) {
    try {
      const { DevUI } = await import('@iwer/devui');
      device.installDevUI(DevUI);
    } catch (err) {
      console.warn('[XR] @iwer/devui failed to load (emulator still active):', err);
    }
  }

  return handle;
}

export function uninstallIwer(): void {
  if (!handle) return;
  try {
    handle.device.uninstallRuntime();
  } catch {
    // IWER best-effort teardown
  }
  handle = null;
  setIwerActive(false);
}

export function iwerClassification(immersiveVrSupported: boolean, ua?: string) {
  return classifyXrEnvironment({
    hasWindow: true,
    immersiveVrSupported,
    iwerActive: handle != null,
    nativeXrAvailable: handle == null && immersiveVrSupported,
    userAgent: ua,
  });
}
