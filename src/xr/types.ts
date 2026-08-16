// WebXR types and host seams for JP-3.
//
// Keep this file free of Three.js / DOM canvas imports so node tests can
// describe session policy, locomotion, layers, and quality without a GPU.

export type XrReferenceSpaceType = 'local-floor' | 'local' | 'viewer';

export type XrSessionPhase =
  | 'idle'
  | 'requesting'
  | 'binding'
  | 'projecting'
  | 'active'
  | 'ending';

export type LayerKind = 'projection' | 'ui' | 'media';

export type XrLayerSpace = 'viewer' | 'local' | 'local-floor';

export interface XrSessionRequestOptions {
  optionalFeatures: string[];
  requiredFeatures?: string[];
}

export interface XrFrameRatePick {
  requested: number | null;
  reason: 'preferred' | 'closest-at-or-below' | 'runtime-default' | 'api-absent';
}

export interface LayerApiProbe {
  layersFeatureEnabled: boolean;
  hasWebGLBinding: boolean;
  hasCreateProjectionLayer: boolean;
  hasCreateQuadLayer: boolean;
  hasCreateCylinderLayer: boolean;
  hasMediaBinding: boolean;
  maxRenderLayers?: number;
  usingProjectionLayer: boolean;
}

export interface XrLayerCapabilities {
  compositorUi: boolean;
  mediaLayer: boolean;
  projectionLayer: boolean;
  fallback: 'mesh' | 'none';
  maxRenderLayers?: number;
  types: string[];
}

export interface XrDiagnostics {
  classification: 'UNIT' | 'DESKTOP_BROWSER' | 'IWER_EMULATED' | 'QUEST_HARDWARE';
  immersiveVrSupported: boolean;
  iwerEmulated: boolean;
  session: {
    phase: XrSessionPhase;
    immersiveVrSupported: boolean;
    rendererPresenting: boolean;
    referenceSpace: XrReferenceSpaceType | null;
    sessionStartAt: number | null;
  };
  startup: {
    requestSessionStart: number | null;
    requestSessionEnd: number | null;
    referenceSpaceStart: number | null;
    referenceSpaceEnd: number | null;
    makeXRCompatibleStart: number | null;
    makeXRCompatibleEnd: number | null;
    makeXRCompatibleError: string | null;
    targetFrameRateStart: number | null;
    targetFrameRateEnd: number | null;
    targetFrameRateRequestedAt: number | null;
    targetFrameRateResolvedAt: number | null;
    targetFrameRateError: string | null;
    frameratechangeCount: number;
    rendererSetSessionStart: number | null;
    rendererSetSessionEnd: number | null;
    firstAnimationCallbackAt: number | null;
    firstDirectRenderStart: number | null;
    firstDirectRenderEnd: number | null;
    firstWorldRenderCompletedAt: number | null;
    firstVisibleFrameAt: number | null;
    lastCompletedStage: string | null;
    lastError: string | null;
    contextXrCompatibleBefore: boolean | null;
    compositorBackend: 'projection-layer' | 'xr-webgl-layer' | 'unknown' | null;
    enabledFeatures: string[];
  };
  layersFeature: boolean | 'unknown';
  layerCapabilities: XrLayerCapabilities;
  referenceSpace: XrReferenceSpaceType | null;
  targetHz: number | null;
  supportedHz: number[] | null;
  compositorUi: 'layer' | 'mesh-fallback';
  layers: {
    featureEnabled: boolean | 'unknown';
    availableTypes: string[];
    projectionLayer: boolean;
    compositorUiPath: 'layer' | 'mesh-fallback';
    meshFallbackPath: boolean;
    maxRenderLayers?: number;
    mediaLayer: {
      available: boolean;
      bound: boolean;
      blocker: string | null;
    };
  };
  mediaLayer: {
    available: boolean;
    bound: boolean;
    blocker: string | null;
  };
  quality: {
    n8ao: boolean;
    postprocessing: 'none' | 'desktop';
    framebufferScale: number;
  };
  performance: {
    targetHz: number | null;
    supportedHz: number[] | null;
    framebufferScale: number;
    frameCount: number;
    lastFrameDtMs: number | null;
  };
  flags: {
    minimal: boolean;
    layers: boolean;
    emu: boolean;
    bare: boolean;
    safe: boolean;
    raw: boolean;
    threeBaseline: boolean;
  };
}

export interface XrLocomotionSample {
  /** Left-stick X: strafe. */
  stickX: number;
  /** Left-stick Y: typical WebXR pad, -1 is forward. */
  stickY: number;
  /** Right-stick X: snap-turn axis. */
  snapX: number;
  headingYaw: number;
  dt: number;
}

export interface XrLocomotionStep {
  dx: number;
  dz: number;
  yawDelta: number;
  moving: boolean;
  snapped: boolean;
}

export interface WalkCollisionFn {
  (
    oldX: number,
    oldZ: number,
    newX: number,
    newZ: number,
    storeWidth: number,
    minZ: number,
  ): { x: number; z: number };
}
