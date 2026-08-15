// Runtime / platform capability seam.
//
// This module exists so future WebXR (Meta Quest) work does not scatter
// `if (xr)` through main.ts / three-scene.ts / store-walk.ts. It does NOT
// enable WebXR. isXrSession is always false in this phase; we never call
// navigator.xr.requestSession().
//
// Known constraints for the later XR phase (do not "fix" world scale now):
//
//   • WebXR spatial units are meters.
//   • Current store world geometry uses feet-like units.
//   • Conversion: 1 meter ≈ 3.28084 store units (STORE_UNITS_PER_METER).
//   • XR head pose must come from the headset, not manual camera pitch/yaw.
//   • Existing desktop head bob must be disabled in XR.
//   • Locomotion should move a player rig rather than overwrite XR camera
//     tracking (StoreScene currently writes camera position/rotation directly).
//   • XR rendering will need renderer.setAnimationLoop().
//   • The current requestAnimationFrame + render-on-demand loop in
//     three-scene.ts must remain replaceable — this phase does not change it.
//     When requiresAnimationLoop becomes true, the rAF tick should be handed
//     to renderer.setAnimationLoop(tick) instead of requestAnimationFrame.
//
// Detect Tauri the same way main.ts already does (__TAURI_INTERNALS__).

export type RuntimeKind = 'browser' | 'tauri';
export type XrAvailability = 'unsupported' | 'capable-inactive';

/** 1 meter in current store world units (feet-like). */
export const STORE_UNITS_PER_METER = 3.28084;

export interface PlatformCapabilities {
  kind: RuntimeKind;
  isTauri: boolean;
  /**
   * Whether WebXR appears present. 'capable-inactive' means navigator.xr
   * exists; this phase still never starts a session.
   */
  xrAvailability: XrAvailability;
  /** Always false until an XR session is actually running. */
  isXrSession: boolean;
  /**
   * When true, the renderer must use setAnimationLoop() instead of a
   * hand-rolled rAF loop. Always false until XR ships.
   */
  requiresAnimationLoop: boolean;
  /** Current world unit system. XR will introduce a meters view of the same. */
  worldUnits: 'store';
}

export interface PlatformProbe {
  tauri?: boolean;
  xr?: boolean;
}

export function detectPlatform(probe: PlatformProbe = {}): PlatformCapabilities {
  const isTauri = probe.tauri ?? (typeof window !== 'undefined'
    && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
  const xrCapable = probe.xr ?? (typeof navigator !== 'undefined'
    && 'xr' in navigator
    && !!(navigator as unknown as { xr?: unknown }).xr);
  return {
    kind: isTauri ? 'tauri' : 'browser',
    isTauri,
    xrAvailability: xrCapable ? 'capable-inactive' : 'unsupported',
    isXrSession: false,
    requiresAnimationLoop: false,
    worldUnits: 'store',
  };
}

let cached: PlatformCapabilities | null = null;

export function getPlatform(): PlatformCapabilities {
  return cached ?? (cached = detectPlatform());
}

export function storeUnitsFromMeters(meters: number): number {
  return meters * STORE_UNITS_PER_METER;
}

export function metersFromStoreUnits(units: number): number {
  return units / STORE_UNITS_PER_METER;
}

/** Test hook. */
export function resetPlatformCache(): void {
  cached = null;
}
