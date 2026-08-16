import * as THREE from 'three';
import { isXrSafeProfile } from './perf/resource-profile';
import { textureArrayManager } from './poster-textures';

const POSTER_SHELF_UNIFORMS = `
      precision highp sampler2DArray;
      uniform sampler2DArray shelfMapArray;
      uniform sampler2DArray shelfMapArray1;
      uniform sampler2DArray shelfMapArray2;
      uniform sampler2DArray shelfMapArray3;
      uniform float posterBankSize;
      uniform float posterBankCount;
      vec4 samplePosterBank(bool hi, vec2 uv, float idx, vec2 ddx, vec2 ddy) {
        if (posterBankCount < 1.5) {
          return textureGrad(shelfMapArray, vec3(uv, idx), ddx, ddy);
        }
        float bank = floor(idx / posterBankSize);
        float layer = idx - bank * posterBankSize;
        if (bank < 0.5) return textureGrad(shelfMapArray, vec3(uv, layer), ddx, ddy);
        if (bank < 1.5) return textureGrad(shelfMapArray1, vec3(uv, layer), ddx, ddy);
        if (bank < 2.5) return textureGrad(shelfMapArray2, vec3(uv, layer), ddx, ddy);
        return textureGrad(shelfMapArray3, vec3(uv, layer), ddx, ddy);
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
  const shelfMapArray1 = shader.uniforms.shelfMapArray1 = {
    value: textureArrayManager.bankTexture(1) ?? textureArrayManager.highResArray,
  };
  const shelfMapArray2 = shader.uniforms.shelfMapArray2 = {
    value: textureArrayManager.bankTexture(2) ?? textureArrayManager.highResArray,
  };
  const shelfMapArray3 = shader.uniforms.shelfMapArray3 = {
    value: textureArrayManager.bankTexture(3) ?? textureArrayManager.highResArray,
  };
  const posterBankSize = shader.uniforms.posterBankSize = { value: textureArrayManager.bankSize };
  const posterBankCount = shader.uniforms.posterBankCount = { value: textureArrayManager.bankCount };
  const posterLowResBase = shader.uniforms.posterLowResBase = { value: textureArrayManager.lowResBase };
  const highResLoadedTex = shader.uniforms.highResLoadedTex = { value: textureArrayManager.loadedFlagsTexture };
  const maxMoviesCount = shader.uniforms.maxMoviesCount =
    { value: textureArrayManager.loadedFlagsTexture ? textureArrayManager.loadedFlagsTexture.image.width : 2048 };
  return {
    lowResMapArray, highResMapArray, shelfMapArray, shelfMapArray1, shelfMapArray2, shelfMapArray3,
    posterBankSize, posterBankCount, posterLowResBase, highResLoadedTex, maxMoviesCount,
  };
}
