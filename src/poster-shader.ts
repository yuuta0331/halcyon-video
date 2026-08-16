import * as THREE from 'three';
import { isXrSafeProfile } from './perf/resource-profile';
import { textureArrayManager } from './poster-textures';
import {
  getPosterDetailArray,
  getPosterDetailLut,
} from './poster-detail-gpu';
import { POSTER_DETAIL_LUT_WIDTH } from './poster-detail-residency';

/** XR_SAFE: catalog banks swap on the mesh. Detail LUT 0 = BASE, else detail layer. */
const POSTER_SHELF_UNIFORMS = `
      precision highp sampler2DArray;
      uniform sampler2DArray shelfMapArray;
      uniform sampler2DArray detailMapArray;
      uniform sampler2D detailLayerTex;
      uniform float posterBankOffset;
      uniform float posterDetailCount;
      vec4 samplePosterBank(bool hi, vec2 uv, float idx, vec2 ddx, vec2 ddy) {
        float detail = texture(detailLayerTex, vec2((idx + 0.5) / max(posterDetailCount, 1.0), 0.5)).r;
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
  const detailMapArray = shader.uniforms.detailMapArray = { value: getPosterDetailArray() };
  const detailLayerTex = shader.uniforms.detailLayerTex = { value: getPosterDetailLut() };
  const posterDetailCount = shader.uniforms.posterDetailCount = { value: POSTER_DETAIL_LUT_WIDTH };
  return {
    lowResMapArray, highResMapArray, shelfMapArray, posterBankOffset,
    posterBankSize, posterBankCount, posterLowResBase, highResLoadedTex, maxMoviesCount,
    detailMapArray, detailLayerTex, posterDetailCount,
  };
}

export function bindPosterBankUniforms(bank: number): void {
  textureArrayManager.bindDrawBank(bank);
}
