// Runtime / platform capability seam.
//
// WebXR (Meta Quest) work must go through this module and src/xr/ rather than
// scattering `if (navigator.xr)` through main.ts / three-scene.ts / store-walk.ts.
//
// Detection by itself never starts a session. isXrSession becomes true only
// after an explicit user-activated requestSession() owned by src/xr/runtime.ts.
//
// Known constraints:
//
//   • WebXR spatial units are meters.
//   • Current store world geometry uses feet-like units.
//   • Conversion: 1 meter ≈ 3.28084 store units (STORE_UNITS_PER_METER).
//   • XR head pose must come from the headset, not manual camera pitch/yaw.
//   • Existing desktop head bob must be disabled in XR.
//   • Locomotion moves a player rig rather than overwriting XR camera tracking.
//   • While a session is active, renderer.setAnimationLoop() is the frame seam.
//   • Desktop keeps requestAnimationFrame + render-on-demand when XR is idle.
//   • Tauri never attempts browser WebXR.

export type RuntimeKind = 'browser' | 'tauri';
export type XrAvailability = 'unsupported' | 'capable-inactive' | 'session-active';

/** 1 meter in current store world units (feet-like). */
export const STORE_UNITS_PER_METER = 3.28084;

export interface PlatformCapabilities {
  kind: RuntimeKind;
  isTauri: boolean;
  /**
   * unsupported: no WebXR, or Tauri (which must not touch navigator.xr).
   * capable-inactive: navigator.xr is present; no session is running.
   * session-active: an immersive session is presenting.
   */
  xrAvailability: XrAvailability;
  /** True only while an XR session is actually running. */
  isXrSession: boolean;
  /**
   * When true, the renderer must use setAnimationLoop() instead of a
   * hand-rolled rAF loop.
   */
  requiresAnimationLoop: boolean;
  /** Current world unit system. XR converts meters at the player-rig origin. */
  worldUnits: 'store';
}

export interface PlatformProbe {
  tauri?: boolean;
  xr?: boolean;
  xrSession?: boolean;
}

let sessionActive = false;

export function detectPlatform(probe: PlatformProbe = {}): PlatformCapabilities {
  const isTauri = probe.tauri ?? (typeof window !== 'undefined'
    && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
  const xrCapable = !isTauri && (probe.xr ?? (typeof navigator !== 'undefined'
    && 'xr' in navigator
    && !!(navigator as unknown as { xr?: unknown }).xr));
  const xrSession = !isTauri && (probe.xrSession ?? sessionActive);
  return {
    kind: isTauri ? 'tauri' : 'browser',
    isTauri,
    xrAvailability: isTauri
      ? 'unsupported'
      : xrSession
        ? 'session-active'
        : xrCapable
          ? 'capable-inactive'
          : 'unsupported',
    isXrSession: xrSession,
    requiresAnimationLoop: xrSession,
    worldUnits: 'store',
  };
}

let cached: PlatformCapabilities | null = null;

export function getPlatform(): PlatformCapabilities {
  return cached ?? (cached = detectPlatform());
}

/**
 * Overlay owned by src/xr/runtime.ts. Detection still never starts a session;
 * this only records that one is running (or has ended).
 */
export function setXrSessionActive(active: boolean): void {
  sessionActive = active;
  cached = detectPlatform({
    tauri: cached?.isTauri,
    xr: active || cached?.xrAvailability !== 'unsupported',
    xrSession: active,
  });
}

export function storeUnitsFromMeters(meters: number): number {
  return meters * STORE_UNITS_PER_METER;
}

export function metersFromStoreUnits(units: number): number {
  return units / STORE_UNITS_PER_METER;
}

/** Test hook. */
export function resetPlatformCache(): void {
  sessionActive = false;
  cached = null;
}
