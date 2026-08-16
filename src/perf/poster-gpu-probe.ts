// Controlled unique-content GPU probe. Not catalog-scale proof.

import * as THREE from 'three';
import { textureArrayManager } from '../poster-textures';
import { storeVisibleResidency } from '../store-visible-residency';

export interface UniqueMultibankProbeResult {
  classification: 'DESKTOP_BROWSER';
  evidenceKind: 'REAL_GPU_ALLOCATION';
  uniqueTextureCount: number;
  bankCount: number;
  layersPerBank: number;
  sampled: number;
  uniqueSamples: number;
  aliased: boolean;
  contextLost: boolean;
  glFatal: boolean;
  capacityInvariantOk: boolean;
  samples: Array<{ id: string; bank: number; layer: number; rgba: number[] }>;
}

function sampleLayer(
  renderer: THREE.WebGLRenderer,
  tex: THREE.DataArrayTexture,
  layer: number,
): number[] | null {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  if (typeof renderer.initTexture === 'function') renderer.initTexture(tex);
  const direct = sampleLayerFramebuffer(renderer, gl, tex, layer);
  if (direct && direct[3] !== 0) return direct;
  return sampleLayerDraw(renderer, tex, layer);
}

function sampleLayerFramebuffer(
  renderer: THREE.WebGLRenderer,
  gl: WebGL2RenderingContext,
  tex: THREE.DataArrayTexture,
  layer: number,
): number[] | null {
  const props = renderer.properties.get(tex) as { __webglTexture?: WebGLTexture } | undefined;
  const handle = props?.__webglTexture;
  if (!handle || typeof gl.framebufferTextureLayer !== 'function') return null;
  const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const fb = gl.createFramebuffer();
  if (!fb) return null;
  try {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, handle, 0, layer);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
    const x = Math.max(0, Math.floor(tex.image.width / 2));
    const y = Math.max(0, Math.floor(tex.image.height / 2));
    const buf = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return [buf[0]!, buf[1]!, buf[2]!, buf[3]!];
  } catch {
    return null;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    gl.deleteFramebuffer(fb);
    renderer.setRenderTarget(null);
  }
}

function sampleLayerDraw(
  renderer: THREE.WebGLRenderer,
  tex: THREE.DataArrayTexture,
  layer: number,
): number[] | null {
  const rt = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: false,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
  });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { t: { value: tex }, layer: { value: layer } },
    vertexShader: `
      void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: `
      precision highp float;
      precision highp sampler2DArray;
      uniform sampler2DArray t;
      uniform float layer;
      void main() { gl_FragColor = texture(t, vec3(0.5, 0.5, layer)); }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  scene.add(mesh);
  const prev = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    const buf = new Uint8Array(4);
    renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, buf);
    return [buf[0]!, buf[1]!, buf[2]!, buf[3]!];
  } catch {
    return null;
  } finally {
    renderer.setRenderTarget(prev);
    rt.dispose();
    mesh.geometry.dispose();
    mat.dispose();
  }
}

export function runUniqueMultibankGpuProbe(
  renderer: THREE.WebGLRenderer,
  opts: { titles?: number; maxArrayTextureLayers?: number } = {},
): UniqueMultibankProbeResult {
  const titles = Math.max(4, Math.min(64, opts.titles ?? 24));
  const maxArrayTextureLayers = Math.max(2, opts.maxArrayTextureLayers ?? 8);
  const ids = Array.from({ length: titles }, (_, i) => `gpu-probe-${String(i).padStart(3, '0')}`);
  storeVisibleResidency.reset();
  textureArrayManager.init(titles, renderer, { maxArrayTextureLayers });
  storeVisibleResidency.bindCatalog(ids, { maxArrayTextureLayers });
  for (const id of ids) {
    textureArrayManager.notePriority(id, 'P0');
    textureArrayManager.getIndex(id, true);
    textureArrayManager.pin(id);
  }
  textureArrayManager.freezeStableMappings();
  ids.forEach((id, i) => {
    textureArrayManager.debugUploadUniquePattern(renderer, id, i + 1);
  });
  const samples: UniqueMultibankProbeResult['samples'] = [];
  const keys = new Set<string>();
  let aliased = false;
  for (const id of ids) {
    const rec = storeVisibleResidency.peek(id);
    if (!rec) {
      aliased = true;
      continue;
    }
    const tex = textureArrayManager.bankTexture(rec.bank);
    const gpu = tex ? sampleLayer(renderer, tex, rec.layer) : null;
    if (!gpu || gpu[3] === 0) {
      aliased = true;
      continue;
    }
    const key = gpu.join(',');
    if (keys.has(key)) aliased = true;
    keys.add(key);
    samples.push({ id, bank: rec.bank, layer: rec.layer, rgba: gpu });
  }
  const gl = renderer.getContext();
  const mem = textureArrayManager.memorySnapshot();
  return {
    classification: 'DESKTOP_BROWSER',
    evidenceKind: 'REAL_GPU_ALLOCATION',
    uniqueTextureCount: titles,
    bankCount: textureArrayManager.bankCount,
    layersPerBank: textureArrayManager.bankSize,
    sampled: samples.length,
    uniqueSamples: keys.size,
    aliased,
    contextLost: typeof gl.isContextLost === 'function' ? gl.isContextLost() : false,
    glFatal: false,
    capacityInvariantOk: mem.capacityInvariantOk,
    samples,
  };
}
