// WebXR types and host seams for JP-3.
//
// Keep this file free of Three.js / DOM canvas imports so node tests can
// describe session policy, locomotion, layers, and quality without a GPU.

export type XrReferenceSpaceType = 'local-floor' | 'local' | 'viewer';

export type XrSessionPhase =
  | 'idle'
  | 'requesting'
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
  immersiveVrSupported: boolean;
  layersFeature: boolean | 'unknown';
  layerCapabilities: XrLayerCapabilities;
  referenceSpace: XrReferenceSpaceType | null;
  targetHz: number | null;
  supportedHz: number[] | null;
  compositorUi: 'layer' | 'mesh-fallback';
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
