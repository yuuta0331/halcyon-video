import type { XrDiagnostics, XrSessionPhase } from './types';
import type { XrEvidenceClass } from './classification';
import { blankStartupTrace, type XrStartupTrace } from './session-lifecycle';
import type { XrRuntimeFlags } from './flags';

export function blankXrDiagnostics(
  flags: XrRuntimeFlags,
  classification: XrEvidenceClass = 'DESKTOP_BROWSER',
): XrDiagnostics {
  const startup = blankStartupTrace();
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
    quality: { n8ao: true, postprocessing: 'desktop', framebufferScale: 1 },
    performance: {
      targetHz: null,
      supportedHz: null,
      framebufferScale: 1,
      frameCount: 0,
      lastFrameDtMs: null,
    },
    flags: { minimal: flags.minimal, layers: flags.layers, emu: flags.emu },
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
  },
): XrDiagnostics {
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
    performance: {
      ...base.performance,
      targetHz: patch.targetHz ?? base.performance.targetHz,
      supportedHz: patch.supportedHz ?? base.performance.supportedHz,
      framebufferScale: patch.framebufferScale ?? base.performance.framebufferScale,
      frameCount: patch.frameCount ?? base.performance.frameCount,
      lastFrameDtMs: patch.lastFrameDtMs === undefined
        ? base.performance.lastFrameDtMs
        : patch.lastFrameDtMs,
    },
  };
}
