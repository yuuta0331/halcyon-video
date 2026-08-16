// Diagnostic URL switches around the single production XR architecture.
// These never fork a second runtime; they only disable optional features.

export interface XrRuntimeFlags {
  /** Development-only IWER Meta Quest 3 emulation (`?xrEmu=1`). */
  emu: boolean;
  /** Optional IWER DevUI overlay (`?xrEmuUi=1`). */
  emuUi: boolean;
  /** Strip optional compositor / media / quad-layer UI. */
  minimal: boolean;
  /** When false, do not request the `layers` optional feature. */
  layers: boolean;
  /** Bypass StoreScene entirely (`?xrBare=1`). */
  bare: boolean;
  /** Force the XR_SAFE resource graph (`?xrSafe=1`). */
  safe: boolean;
  /** Diagnostic raw WebXR (`?xrRaw=1`). No StoreScene / Three XR manager. */
  raw: boolean;
  /** Diagnostic Three-native baseline (`?xrThreeBaseline=1`). */
  threeBaseline: boolean;
}

export function readXrFlags(
  search: string = typeof location !== 'undefined' ? location.search : '',
): XrRuntimeFlags {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const minimal = q.get('xrMinimal') === '1';
  const layersOff = q.get('xrLayers') === '0' || minimal || q.get('xrBare') === '1';
  return {
    emu: q.get('xrEmu') === '1',
    emuUi: q.get('xrEmuUi') === '1',
    minimal,
    layers: !layersOff,
    bare: q.get('xrBare') === '1',
    safe: q.get('xrSafe') === '1',
    raw: q.get('xrRaw') === '1',
    threeBaseline: q.get('xrThreeBaseline') === '1',
  };
}

export function xrEmuRequested(search?: string): boolean {
  return readXrFlags(search).emu;
}
