import * as THREE from 'three';
import { isXrSafeProfile } from './perf/resource-profile';
import { textureArrayManager } from './poster-textures';

/** XR_SAFE: one sampler2DArray per draw. Catalog banks are swapped on the mesh. */
const POSTER_SHELF_UNIFORMS = `
      precision highp sampler2DArray;
      uniform sampler2DArray shelfMapArray;
      uniform float posterBankOffset;
      vec4 samplePosterBank(bool hi, vec2 uv, float idx, vec2 ddx, vec2 ddy) {
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
  return isXrSafeProfile() ? POSTER_SHELF_UNIFORMS : POSTER_ARRAY_UNIFORMS;
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
  return {
    lowResMapArray, highResMapArray, shelfMapArray, posterBankOffset,
    posterBankSize, posterBankCount, posterLowResBase, highResLoadedTex, maxMoviesCount,
  };
}

export function bindPosterBankUniforms(bank: number): void {
  textureArrayManager.bindDrawBank(bank);
}
