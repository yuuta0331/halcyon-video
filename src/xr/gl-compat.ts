// WebGL XR-compatibility boundary. Three r184 WebXRManager.setSession
// attaches `inputsourceschange` first, then may await makeXRCompatible.
// XrRuntime must not preflight-await this before setSession.

export interface GlXrAttributes {
  xrCompatible: boolean | null;
  alpha: boolean | null;
  antialias: boolean | null;
  depth: boolean | null;
  stencil: boolean | null;
  preserveDrawingBuffer: boolean | null;
  powerPreference: string | null;
}

export function readContextXrAttributes(
  gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined,
): GlXrAttributes {
  const blank: GlXrAttributes = {
    xrCompatible: null,
    alpha: null,
    antialias: null,
    depth: null,
    stencil: null,
    preserveDrawingBuffer: null,
    powerPreference: null,
  };
  if (!gl || typeof gl.getContextAttributes !== 'function') return blank;
  const attrs = gl.getContextAttributes() as (WebGLContextAttributes & { xrCompatible?: boolean }) | null;
  if (!attrs) return blank;
  return {
    xrCompatible: typeof attrs.xrCompatible === 'boolean' ? attrs.xrCompatible : null,
    alpha: attrs.alpha ?? null,
    antialias: attrs.antialias ?? null,
    depth: attrs.depth ?? null,
    stencil: attrs.stencil ?? null,
    preserveDrawingBuffer: attrs.preserveDrawingBuffer ?? null,
    powerPreference: attrs.powerPreference ?? null,
  };
}

export async function ensureXrCompatible(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): Promise<{ skipped: boolean; error: string | null }> {
  const before = readContextXrAttributes(gl);
  if (before.xrCompatible === true) return { skipped: true, error: null };
  const make = (gl as WebGLRenderingContext & { makeXRCompatible?: () => Promise<void> }).makeXRCompatible;
  if (typeof make !== 'function') return { skipped: true, error: 'makeXRCompatible absent' };
  try {
    await make.call(gl);
    return { skipped: false, error: null };
  } catch (err) {
    return { skipped: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function createXrCompatibleWebgl2(
  canvas: HTMLCanvasElement,
): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', {
    xrCompatible: true,
    alpha: false,
    antialias: false,
    depth: true,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 context unavailable');
  return gl;
}

export function detectSessionCompositorBackend(session: XRSession | null | undefined):
  | 'projection-layer'
  | 'xr-webgl-layer'
  | 'unknown' {
  if (!session) return 'unknown';
  const layers = session.renderState.layers;
  if (layers && layers.length > 0) return 'projection-layer';
  if (session.renderState.baseLayer) return 'xr-webgl-layer';
  return 'unknown';
}

export function probeXrBindingApis(): {
  hasXRWebGLBinding: boolean;
  hasCreateProjectionLayer: boolean;
} {
  const Binding = (globalThis as unknown as { XRWebGLBinding?: { prototype?: { createProjectionLayer?: unknown } } }).XRWebGLBinding;
  return {
    hasXRWebGLBinding: typeof Binding === 'function',
    hasCreateProjectionLayer: typeof Binding?.prototype?.createProjectionLayer === 'function',
  };
}
