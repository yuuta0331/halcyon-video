// Save/restore WebGL pixel-store + texture bindings around raw compositor
// uploads so Three.js renderer state is not left corrupted.

export interface GlSnapshot {
  texture2D: WebGLTexture | null;
  activeTexture: number;
  unpackFlipY: boolean;
  unpackPremultiply: boolean;
  unpackAlignment: number;
}

type PixelStoreRenderer = {
  state?: unknown;
  resetState?: () => void;
};

export function pixelStorei(
  renderer: PixelStoreRenderer | null,
  gl: WebGLRenderingContext,
  pname: number,
  value: number,
): void {
  const state = renderer?.state as { pixelStorei?: (pname: number, value: number) => void } | undefined;
  if (state && typeof state.pixelStorei === 'function') {
    state.pixelStorei(pname, value);
    return;
  }
  gl.pixelStorei(pname, value);
}

export function snapshotGlTextureState(gl: WebGLRenderingContext): GlSnapshot {
  return {
    texture2D: gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null,
    activeTexture: gl.getParameter(gl.ACTIVE_TEXTURE) as number,
    unpackFlipY: !!gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),
    unpackPremultiply: !!gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL),
    unpackAlignment: gl.getParameter(gl.UNPACK_ALIGNMENT) as number,
  };
}

export function restoreGlTextureState(
  gl: WebGLRenderingContext,
  snap: GlSnapshot,
  renderer?: PixelStoreRenderer | null,
): void {
  gl.activeTexture(snap.activeTexture);
  gl.bindTexture(gl.TEXTURE_2D, snap.texture2D);
  pixelStorei(renderer ?? null, gl, gl.UNPACK_FLIP_Y_WEBGL, snap.unpackFlipY ? 1 : 0);
  pixelStorei(renderer ?? null, gl, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, snap.unpackPremultiply ? 1 : 0);
  pixelStorei(renderer ?? null, gl, gl.UNPACK_ALIGNMENT, snap.unpackAlignment);
  renderer?.resetState?.();
}

export function withRestoredGlTextureState(
  gl: WebGLRenderingContext,
  fn: () => void,
  renderer?: PixelStoreRenderer | null,
): { ok: boolean; error: string | null } {
  const snap = snapshotGlTextureState(gl);
  try {
    fn();
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    restoreGlTextureState(gl, snap, renderer);
  }
}
