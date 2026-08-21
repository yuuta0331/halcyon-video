// DESKTOP_BROWSER BASE/NEAR/FOCUS ladder. Not human readability. Not Quest.

import * as THREE from 'three';
import { downsamplePosterRgba, texelsPerFace } from '../poster-quality.ts';
import { makePosterQualityPattern, patternEdgeEnergy } from '../poster-quality-pattern.ts';
import { XR_SAFE_POSTER_SAMPLE_GLSL } from '../poster-shader.ts';
import { focusPixelsFromSourceRgba } from '../poster-focus-decode.ts';

function solidTex(pixels: Uint8Array, w: number, h: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(pixels, w, h);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function readCenter(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget): number[] {
  const buf = new Uint8Array(4);
  renderer.readRenderTargetPixels(rt, Math.floor(rt.width / 2), Math.floor(rt.height / 2), 1, 1, buf);
  return [buf[0]!, buf[1]!, buf[2]!, buf[3]!];
}

function sample2d(renderer: THREE.WebGLRenderer, tex: THREE.Texture): number[] {
  const rt = new THREE.WebGLRenderTarget(32, 32, {
    depthBuffer: false, stencilBuffer: false,
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace,
  });
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  scene.add(mesh);
  const prev = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    return readCenter(renderer, rt);
  } finally {
    renderer.setRenderTarget(prev);
    rt.dispose();
    mesh.geometry.dispose();
    mat.dispose();
  }
}

export async function runFocusQualityProbe(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const contextLost = typeof gl.isContextLost === 'function' && gl.isContextLost();
  const source = makePosterQualityPattern(800, 1200, 4);
  const focus = focusPixelsFromSourceRgba(source, 800, 1200);
  const near = downsamplePosterRgba(focus.pixels, focus.decodeWidth, focus.decodeHeight, 320, 480);
  const base = downsamplePosterRgba(focus.pixels, focus.decodeWidth, focus.decodeHeight, 96, 144);
  const focusTex = solidTex(focus.pixels, focus.decodeWidth, focus.decodeHeight);
  const nearTex = solidTex(near, 320, 480);
  const baseTex = solidTex(base, 96, 144);
  const shaderFocus = sample2d(renderer, focusTex);
  const shaderNear = sample2d(renderer, nearTex);
  const shaderBase = sample2d(renderer, baseTex);
  focusTex.dispose();
  nearTex.dispose();
  baseTex.dispose();
  const pass = !contextLost
    && focus.decodeWidth === 640
    && focus.decodeHeight === 960
    && focus.upscaledFromNear === false
    && focus.sourceWidth === 800
    && shaderFocus.join() !== shaderBase.join()
    && XR_SAFE_POSTER_SAMPLE_GLSL.includes('posterFocusMap');
  return {
    classification: 'DESKTOP_BROWSER' as const,
    QUEST_HARDWARE: 'NOT_EXECUTED',
    pass,
    contextLost,
    source: { width: 800, height: 1200 },
    decoded: { width: focus.decodeWidth, height: focus.decodeHeight },
    baseGpu: { width: 96, height: 144, texelsPerFace: texelsPerFace(96, 144) },
    nearGpu: { width: 320, height: 480, texelsPerFace: texelsPerFace(320, 480) },
    focusGpu: { width: focus.decodeWidth, height: focus.decodeHeight, texelsPerFace: texelsPerFace(focus.decodeWidth, focus.decodeHeight) },
    upscaledFromNear: focus.upscaledFromNear,
    edgeEnergy: {
      base: patternEdgeEnergy(base, 96, 144),
      near: patternEdgeEnergy(near, 320, 480),
      focus: patternEdgeEnergy(focus.pixels, focus.decodeWidth, focus.decodeHeight),
    },
    shaderBase,
    shaderNear,
    shaderFocus,
    note: 'Synthetic pattern; not human readability. Not Quest GPU.',
  };
}
