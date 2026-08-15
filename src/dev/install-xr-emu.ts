// Development-only IWER activation. Production DCE drops the iwer import
// because the dynamic import is inside `if (import.meta.env.DEV)`.

import { readXrFlags } from '../xr/flags';
import { classifyXrEnvironment } from '../xr/classification';

export async function installXrEmulatorIfRequested(
  search: string = typeof location !== 'undefined' ? location.search : '',
): Promise<void> {
  if (import.meta.env.DEV) {
    const flags = readXrFlags(search);
    if (!flags.emu) {
      exposeDevHooks(null);
      return;
    }
    const { installIwerQuest3, getIwerHandle } = await import('./iwer-runtime');
    try {
      await installIwerQuest3(search);
    } catch (err) {
      console.error('[XR] IWER install failed; continuing without emulator:', err);
    }
    const handle = getIwerHandle();
    exposeDevHooks(handle?.device ?? null);
  }
}

function exposeDevHooks(device: unknown): void {
  if (typeof window === 'undefined') return;
  if (import.meta.env.DEV) {
    void import('./xr-test-api').then(({ installXrTestApi }) => {
      installXrTestApi(() => device as never);
    });
  }
  const existing = (window as unknown as { __xrDiagnostics?: () => unknown }).__xrDiagnostics;
  if (typeof existing !== 'function') {
    (window as unknown as { __xrDiagnostics?: () => unknown }).__xrDiagnostics = () => ({
      classification: classifyXrEnvironment({
        hasWindow: true,
        immersiveVrSupported: false,
        iwerActive: !!device,
        nativeXrAvailable: false,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      }),
      iwerEmulated: !!device,
      note: 'StoreScene not published yet.',
    });
  }
}
