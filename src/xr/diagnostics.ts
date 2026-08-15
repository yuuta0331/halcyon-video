import type { XrDiagnostics, XrSessionPhase } from './types.ts';
import type { XrEvidenceClass } from './classification.ts';
import { blankStartupTrace, type XrStartupTrace } from './session-lifecycle.ts';
import type { XrRuntimeFlags } from './flags.ts';

import { xrQualityPolicy } from './quality.ts';

export function blankXrDiagnostics(
  flags: XrRuntimeFlags,
  classification: XrEvidenceClass = 'DESKTOP_BROWSER',
): XrDiagnostics {
  const startup = blankStartupTrace();
  const quality = xrQualityPolicy();
  return {
    classification,
    immersiveVrSupported: false,
    iwerEmulated: classification === 'IWER_EMULATED',
    session: {
      phase: 'idle',
      immersiveVrSupported: false,
      rendererPresenting: false,
      referenceSpace: null,
      sessionStartAt: null,
    },
    startup,
    layersFeature: 'unknown',
    layerCapabilities: {
      compositorUi: false,
      mediaLayer: false,
      projectionLayer: false,
      fallback: 'mesh',
      types: [],
    },
    referenceSpace: null,
    targetHz: null,
    supportedHz: null,
    compositorUi: 'mesh-fallback',
    layers: {
      featureEnabled: 'unknown',
      availableTypes: [],
      projectionLayer: false,
      compositorUiPath: 'mesh-fallback',
      meshFallbackPath: true,
      mediaLayer: { available: false, bound: false, blocker: 'No XR session.' },
    },
    mediaLayer: { available: false, bound: false, blocker: 'No XR session.' },
    quality: {
      n8ao: quality.n8ao,
      postprocessing: quality.postprocessing,
      framebufferScale: quality.framebufferScale,
    },
    performance: {
      targetHz: null,
      supportedHz: null,
      framebufferScale: quality.framebufferScale,
      frameCount: 0,
      lastFrameDtMs: null,
    },
    flags: { minimal: flags.minimal, layers: flags.layers, emu: flags.emu, bare: flags.bare, safe: flags.safe },
  };
}

export function mergeSessionDiagnostics(
  base: XrDiagnostics,
  patch: {
    phase: XrSessionPhase;
    immersiveVrSupported: boolean;
    rendererPresenting: boolean;
    referenceSpace: XrDiagnostics['referenceSpace'];
    sessionStartAt: number | null;
    startup: XrStartupTrace;
    classification: XrEvidenceClass;
    iwerEmulated: boolean;
    frameCount?: number;
    lastFrameDtMs?: number | null;
    framebufferScale?: number;
    targetHz?: number | null;
    supportedHz?: number[] | null;
    quality?: {
      n8ao: boolean;
      postprocessing: 'none' | 'desktop';
      framebufferScale: number;
    };
  },
): XrDiagnostics {
  const quality = patch.quality ?? xrQualityPolicy();
  return {
    ...base,
    classification: patch.classification,
    immersiveVrSupported: patch.immersiveVrSupported,
    iwerEmulated: patch.iwerEmulated,
    session: {
      phase: patch.phase,
      immersiveVrSupported: patch.immersiveVrSupported,
      rendererPresenting: patch.rendererPresenting,
      referenceSpace: patch.referenceSpace,
      sessionStartAt: patch.sessionStartAt,
    },
    startup: patch.startup,
    referenceSpace: patch.referenceSpace,
    targetHz: patch.targetHz ?? base.targetHz,
    supportedHz: patch.supportedHz ?? base.supportedHz,
    quality: {
      n8ao: quality.n8ao,
      postprocessing: quality.postprocessing,
      framebufferScale: quality.framebufferScale,
    },
    performance: {
      ...base.performance,
      targetHz: patch.targetHz ?? base.performance.targetHz,
      supportedHz: patch.supportedHz ?? base.performance.supportedHz,
      framebufferScale: patch.framebufferScale ?? quality.framebufferScale,
      frameCount: patch.frameCount ?? base.performance.frameCount,
      lastFrameDtMs: patch.lastFrameDtMs === undefined
        ? base.performance.lastFrameDtMs
        : patch.lastFrameDtMs,
    },
  };
}
