// Pure XR session policy: request options, reference-space fallback, frame
// rate pick. No navigator.xr calls live here — the runtime asks, tests assert.

import type {
  XrFrameRatePick,
  XrReferenceSpaceType,
  XrSessionRequestOptions,
} from './types';

/** Layers must stay optional so a no-Layers runtime can still enter VR. */
export const XR_OPTIONAL_FEATURES = ['local-floor', 'layers', 'high-fixed-foveation-level'] as const;

/** Never required. Hand tracking is intentionally omitted (JP-4 / later). */
export const XR_REQUIRED_FEATURES: readonly string[] = [];

export const XR_REFERENCE_SPACE_FALLBACK: readonly XrReferenceSpaceType[] = [
  'local-floor',
  'local',
];

/** Choose Three's configured space from session.enabledFeatures. Do not probe. */
export function selectReferenceSpaceTypeFromFeatures(
  enabledFeatures: Iterable<string> | null | undefined,
): XrReferenceSpaceType {
  for (const feature of enabledFeatures ?? []) {
    if (feature === 'local-floor') return 'local-floor';
  }
  return 'local';
}

/** JP-3 baseline. Do not require 90/120. */
export const XR_TARGET_HZ = 72;

export const XR_FIXED_FOVEATION_FEATURE = 'high-fixed-foveation-level';

export function immersiveVrRequestOptions(opts?: {
  layers?: boolean;
  foveation?: boolean;
}): XrSessionRequestOptions {
  const optional: string[] = ['local-floor'];
  if (opts?.layers !== false) optional.push('layers');
  // Fixed-foveation is opt-in. Initial projection must not depend on it.
  if (opts?.foveation === true) optional.push(XR_FIXED_FOVEATION_FEATURE);
  return {
    optionalFeatures: optional,
  };
}

/** RAW / THREE_BASELINE / BARE: no layers, no fixed-foveation. */
export function diagnosticXrRequestOptions(): XrSessionRequestOptions {
  return immersiveVrRequestOptions({ layers: false, foveation: false });
}

/** BARE ignores URL flags, XR_SAFE, and other runtime switches. */
export function bareXrRequestOptions(_ignored?: unknown): XrSessionRequestOptions {
  return diagnosticXrRequestOptions();
}

/** Halcyon initial request: layers follow xrMinimal policy; never foveation. */
export function halcyonInitialXrRequestOptions(input: {
  layers: boolean;
}): XrSessionRequestOptions {
  return immersiveVrRequestOptions({ layers: input.layers, foveation: false });
}

export function requestsSessionFeature(
  options: XrSessionRequestOptions,
  feature: string,
): boolean {
  return options.optionalFeatures.includes(feature)
    || (options.requiredFeatures ?? []).includes(feature);
}

export function requestsLayersFeature(options: XrSessionRequestOptions): boolean {
  return requestsSessionFeature(options, 'layers');
}

export function requestsFixedFoveationFeature(options: XrSessionRequestOptions): boolean {
  return requestsSessionFeature(options, XR_FIXED_FOVEATION_FEATURE);
}

export function layersIsOptionalFeature(options: XrSessionRequestOptions): boolean {
  return options.optionalFeatures.includes('layers')
    && !(options.requiredFeatures ?? []).includes('layers');
}

export function sessionCanStartWithoutLayers(options: XrSessionRequestOptions): boolean {
  return layersIsOptionalFeature(options)
    && !(options.requiredFeatures ?? []).includes('layers');
}

/** RAW path only: at most local-floor then local. Halcyon/Three must not probe. */
export async function pickReferenceSpaceType(
  request: (type: XrReferenceSpaceType) => Promise<unknown>,
): Promise<XrReferenceSpaceType> {
  for (const type of XR_REFERENCE_SPACE_FALLBACK) {
    try {
      await request(type);
      return type;
    } catch {
      // try the next standards-correct fallback
    }
  }
  throw new Error('No WebXR reference space available');
}

export function pickXrTargetHz(
  supported: ArrayLike<number> | null | undefined,
  preferred = XR_TARGET_HZ,
): XrFrameRatePick {
  if (!supported || supported.length === 0) {
    return { requested: null, reason: 'api-absent' };
  }
  const rates = Array.from(supported);
  if (rates.includes(preferred)) {
    return { requested: preferred, reason: 'preferred' };
  }
  const below = rates.filter((hz) => hz <= preferred).sort((a, b) => b - a);
  if (below.length > 0) {
    return { requested: below[0], reason: 'closest-at-or-below' };
  }
  return { requested: rates[0], reason: 'runtime-default' };
}

export function tauriAllowsWebXr(isTauri: boolean): boolean {
  return !isTauri;
}

export async function probeImmersiveVrSupported(opts: {
  isTauri: boolean;
  xr?: { isSessionSupported?: (mode: XRSessionMode) => Promise<boolean> } | null;
}): Promise<boolean> {
  if (opts.isTauri) return false;
  const xr = opts.xr;
  if (!xr || typeof xr.isSessionSupported !== 'function') return false;
  try {
    return !!(await xr.isSessionSupported('immersive-vr'));
  } catch {
    return false;
  }
}
