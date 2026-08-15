// Central owner of session.updateRenderState({ layers }).
// Nothing else in the app mutates the compositor layer list.

import type { LayerApiProbe, LayerKind, XrLayerCapabilities } from './types';

export function detectLayerCapabilities(probe: LayerApiProbe): XrLayerCapabilities {
  const types: string[] = [];
  if (probe.hasCreateProjectionLayer) types.push('XRProjectionLayer');
  if (probe.hasCreateQuadLayer) types.push('XRQuadLayer');
  if (probe.hasCreateCylinderLayer) types.push('XRCylinderLayer');

  const compositorUi = probe.layersFeatureEnabled
    && probe.hasWebGLBinding
    && probe.hasCreateQuadLayer
    && probe.usingProjectionLayer
    && (probe.maxRenderLayers === undefined || probe.maxRenderLayers >= 2);

  const mediaLayer = compositorUi && probe.hasMediaBinding;

  return {
    compositorUi,
    mediaLayer,
    projectionLayer: probe.usingProjectionLayer && probe.hasCreateProjectionLayer,
    fallback: compositorUi ? 'none' : 'mesh',
    maxRenderLayers: probe.maxRenderLayers,
    types,
  };
}

export function probeLayerApis(input: {
  enabledFeatures?: ReadonlyArray<string> | null;
  maxRenderLayers?: number;
  usingProjectionLayer: boolean;
  xrWebGLBinding?: unknown;
  xrMediaBinding?: unknown;
}): LayerApiProbe {
  const Binding = input.xrWebGLBinding as { prototype?: Record<string, unknown> } | undefined;
  const proto = Binding?.prototype ?? {};
  return {
    layersFeatureEnabled: !!input.enabledFeatures?.includes('layers'),
    hasWebGLBinding: typeof input.xrWebGLBinding === 'function',
    hasCreateProjectionLayer: typeof proto.createProjectionLayer === 'function',
    hasCreateQuadLayer: typeof proto.createQuadLayer === 'function',
    hasCreateCylinderLayer: typeof proto.createCylinderLayer === 'function',
    hasMediaBinding: typeof input.xrMediaBinding === 'function',
    maxRenderLayers: input.maxRenderLayers,
    usingProjectionLayer: input.usingProjectionLayer,
  };
}

export interface LayerSlot {
  kind: LayerKind;
  layer: object;
}

export interface ComposedLayers {
  layers: object[];
  dropped: LayerKind[];
}

/**
 * Projection first, then high-acuity UI, then future media. Later entries
 * composite on top. maxRenderLayers (when exposed) is a hard cap.
 */
export function composeLayerStack(
  slots: LayerSlot[],
  maxRenderLayers?: number,
): ComposedLayers {
  const order: LayerKind[] = ['projection', 'ui', 'media'];
  const ranked: LayerSlot[] = [];
  for (const kind of order) {
    const slot = slots.find((s) => s.kind === kind);
    if (slot) ranked.push(slot);
  }
  const cap = maxRenderLayers === undefined
    ? ranked.length
    : Math.max(0, Math.floor(maxRenderLayers));
  if (cap === 0) {
    return { layers: [], dropped: ranked.map((s) => s.kind) };
  }
  const kept = ranked.slice(0, cap);
  return {
    layers: kept.map((s) => s.layer),
    dropped: ranked.slice(kept.length).map((s) => s.kind),
  };
}

export function layerKindsOwnedCentrally(source: string): boolean {
  return source === 'XrLayerManager';
}

export class XrLayerManager {
  private projection: object | null = null;
  private ui: object | null = null;
  private media: object | null = null;
  private lastSynced: object[] = [];
  private disposed = false;
  private readonly apply: (layers: object[]) => void;
  private readonly maxRenderLayers?: number;

  constructor(
    apply: (layers: object[]) => void,
    maxRenderLayers?: number,
  ) {
    this.apply = apply;
    this.maxRenderLayers = maxRenderLayers;
  }

  capabilities(probe: LayerApiProbe): XrLayerCapabilities {
    return detectLayerCapabilities(probe);
  }

  setProjectionLayer(layer: object | null): void {
    this.projection = layer;
    this.sync();
  }

  createUiLayer(layer: object | null): void {
    this.ui = layer;
    this.sync();
  }

  createVideoLayer(layer: object | null): void {
    this.media = layer;
    this.sync();
  }

  updateLayer(kind: LayerKind, layer: object | null): void {
    if (kind === 'projection') this.projection = layer;
    else if (kind === 'ui') this.ui = layer;
    else this.media = layer;
    this.sync();
  }

  removeLayer(kind: LayerKind): void {
    this.updateLayer(kind, null);
  }

  sync(): ComposedLayers {
    if (this.disposed) return { layers: [], dropped: [] };
    const slots: LayerSlot[] = [];
    if (this.projection) slots.push({ kind: 'projection', layer: this.projection });
    if (this.ui) slots.push({ kind: 'ui', layer: this.ui });
    if (this.media) slots.push({ kind: 'media', layer: this.media });
    const composed = composeLayerStack(slots, this.maxRenderLayers);
    this.lastSynced = composed.layers;
    this.apply(composed.layers);
    return composed;
  }

  currentLayers(): object[] {
    return this.lastSynced.slice();
  }

  dispose(): void {
    this.disposed = true;
    this.projection = null;
    this.ui = null;
    this.media = null;
    this.lastSynced = [];
    try {
      this.apply([]);
    } catch {
      // session may already be ending
    }
  }
}
