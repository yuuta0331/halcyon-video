// Save/restore WebGL pixel-store + texture bindings around raw compositor
// uploads so Three.js renderer state is not left corrupted.

export interface GlSnapshot {
  texture2D: WebGLTexture | null;
  activeTexture: number;
  unpackFlipY: boolean;
  unpackPremultiply: boolean;
  unpackAlignment: number;
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

export function restoreGlTextureState(gl: WebGLRenderingContext, snap: GlSnapshot): void {
  gl.activeTexture(snap.activeTexture);
  gl.bindTexture(gl.TEXTURE_2D, snap.texture2D);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, snap.unpackFlipY ? 1 : 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, snap.unpackPremultiply ? 1 : 0);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, snap.unpackAlignment);
}

export function withRestoredGlTextureState(
  gl: WebGLRenderingContext,
  fn: () => void,
): { ok: boolean; error: string | null } {
  const snap = snapshotGlTextureState(gl);
  try {
    fn();
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    restoreGlTextureState(gl, snap);
  }
}
