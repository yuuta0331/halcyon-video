import * as THREE from 'three';
import { usesStablePosterBanks } from './perf/resource-profile';
import { textureArrayManager } from './poster-textures';
import {
  getPosterDetailArray,
  getPosterDetailLut,
  getPosterDetailLutLayout,
} from './poster-detail-gpu';
import {
  bindPosterFocusUniforms,
  clearPosterFocusActive,
  getPosterFocusTexture,
  posterFocusActive,
  posterFocusActiveIndex,
} from './poster-focus-texture';

let liveFocusUniforms: {
  posterFocusMap: { value: THREE.Texture | null };
  posterFocusIndex: { value: number };
  posterFocusActive: { value: number };
} | null = null;

/** XR_SAFE / QUEST_INLINE: catalog banks swap on the mesh. FOCUS 2D, then NEAR LUT, else BASE. */
export const XR_SAFE_POSTER_SAMPLE_GLSL = `
      precision highp sampler2DArray;
      uniform sampler2DArray shelfMapArray;
      uniform sampler2DArray detailMapArray;
      uniform sampler2D detailLayerTex;
      uniform sampler2D posterFocusMap;
      uniform float posterBankOffset;
      uniform float posterDetailCount;
      uniform float posterDetailLutWidth;
      uniform float posterDetailLutHeight;
      uniform float posterFocusIndex;
      uniform float posterFocusActive;
      vec4 samplePosterBank(bool hi, vec2 uv, float idx, vec2 ddx, vec2 ddy) {
        if (posterFocusActive > 0.5 && abs(idx - posterFocusIndex) < 0.5) {
          return texture(posterFocusMap, uv);
        }
        float w = max(posterDetailLutWidth, 1.0);
        float h = max(posterDetailLutHeight, 1.0);
        float lx = mod(idx, w);
        float ly = floor(idx / w);
        float detail = texture(detailLayerTex, vec2((lx + 0.5) / w, (ly + 0.5) / h)).r;
        if (detail > 0.001) {
          return textureGrad(detailMapArray, vec3(uv, detail * 255.0 - 1.0), ddx, ddy);
        }
        float layer = idx - posterBankOffset;
        return textureGrad(shelfMapArray, vec3(uv, layer), ddx, ddy);
      }
`;

const POSTER_ARRAY_UNIFORMS = `
      precision highp sampler2DArray;
      uniform sampler2DArray lowResMapArray;
      uniform sampler2DArray highResMapArray;
      uniform float posterLowResBase;
      vec4 samplePosterBank(bool hi, vec2 uv, float idx, vec2 ddx, vec2 ddy) {
        if (hi) return textureGrad(highResMapArray, vec3(uv, idx), ddx, ddy);
        return textureGrad(lowResMapArray, vec3(uv, idx - posterLowResBase), ddx, ddy);
      }
`;

export function posterShaderChunk(): string {
  return usesStablePosterBanks() ? XR_SAFE_POSTER_SAMPLE_GLSL : POSTER_ARRAY_UNIFORMS;
}

export function posterArrayUniforms(shader: THREE.WebGLProgramParametersWithUniforms) {
  const lowResMapArray = shader.uniforms.lowResMapArray = {
    value: textureArrayManager.lowResArray ?? textureArrayManager.highResArray,
  };
  const highResMapArray = shader.uniforms.highResMapArray = { value: textureArrayManager.highResArray };
  const shelfMapArray = shader.uniforms.shelfMapArray = { value: textureArrayManager.highResArray };
  const posterBankOffset = shader.uniforms.posterBankOffset = { value: 0 };
  const posterBankSize = shader.uniforms.posterBankSize = { value: textureArrayManager.bankSize };
  const posterBankCount = shader.uniforms.posterBankCount = { value: textureArrayManager.bankCount };
  const posterLowResBase = shader.uniforms.posterLowResBase = { value: textureArrayManager.lowResBase };
  const highResLoadedTex = shader.uniforms.highResLoadedTex = { value: textureArrayManager.loadedFlagsTexture };
  const maxMoviesCount = shader.uniforms.maxMoviesCount =
    { value: textureArrayManager.loadedFlagsTexture ? textureArrayManager.loadedFlagsTexture.image.width : 2048 };
  const detailMapArray = shader.uniforms.detailMapArray = { value: getPosterDetailArray() };
  const detailLayerTex = shader.uniforms.detailLayerTex = { value: getPosterDetailLut() };
  const lutLayout = getPosterDetailLutLayout();
  const posterDetailCount = shader.uniforms.posterDetailCount = { value: Math.max(1, lutLayout.capacity) };
  const posterDetailLutWidth = shader.uniforms.posterDetailLutWidth = { value: Math.max(1, lutLayout.width) };
  const posterDetailLutHeight = shader.uniforms.posterDetailLutHeight = { value: Math.max(1, lutLayout.height) };
  const posterFocusMap = shader.uniforms.posterFocusMap = { value: getPosterFocusTexture() };
  const posterFocusIndex = shader.uniforms.posterFocusIndex = { value: posterFocusActiveIndex() };
  const posterFocusActiveU = shader.uniforms.posterFocusActive = { value: posterFocusActive() ? 1 : 0 };
  bindPosterFocusUniforms({
    posterFocusMap,
    posterFocusIndex,
    posterFocusActive: posterFocusActiveU,
  });
  liveFocusUniforms = {
    posterFocusMap,
    posterFocusIndex,
    posterFocusActive: posterFocusActiveU,
  };
  return {
    lowResMapArray, highResMapArray, shelfMapArray, posterBankOffset,
    posterBankSize, posterBankCount, posterLowResBase, highResLoadedTex, maxMoviesCount,
    detailMapArray, detailLayerTex, posterDetailCount, posterDetailLutWidth, posterDetailLutHeight,
    posterFocusMap, posterFocusIndex, posterFocusActive: posterFocusActiveU,
  };
}

export function bindPosterBankUniforms(bank: number): void {
  textureArrayManager.bindDrawBank(bank);
  if (liveFocusUniforms) bindPosterFocusUniforms(liveFocusUniforms);
}

/** Test isolation: bank-switch probes must not sample the FOCUS 2D path. */
export function suppressPosterFocusSamplingForProbe(): void {
  clearPosterFocusActive();
  if (liveFocusUniforms) {
    liveFocusUniforms.posterFocusActive.value = 0;
    liveFocusUniforms.posterFocusIndex.value = -1;
    liveFocusUniforms.posterFocusMap.value = getPosterFocusTexture();
  }
}
