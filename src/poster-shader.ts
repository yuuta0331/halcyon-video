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
import { noteProductionPosterCompile } from './perf/hw-diag-observe.ts';
import { jp4aTestRequested } from './xr/jp4a-test-state.ts';

let liveFocusUniforms: {
  posterFocusMap: { value: THREE.Texture | null };
  posterFocusIndex: { value: number };
  posterFocusActive: { value: number };
} | null = null;

export type LivePosterShaderMode =
  | 'LIVE-NORMAL' | 'LIVE-BASE' | 'LIVE-LOD0' | 'LIVE-LOD1'
  | 'LIVE-LOD2' | 'LIVE-LOD3' | 'LIVE-LINEAR' | 'LIVE-UNLIT'
  | 'LIVE-DEPTH-ISOLATED';

const LIVE_MODE_CODE: Record<LivePosterShaderMode, number> = {
  'LIVE-NORMAL': 0,
  'LIVE-BASE': 1,
  'LIVE-LOD0': 2,
  'LIVE-LOD1': 3,
  'LIVE-LOD2': 4,
  'LIVE-LOD3': 5,
  'LIVE-LINEAR': 6,
  'LIVE-UNLIT': 7,
  'LIVE-DEPTH-ISOLATED': 8,
};

const liveDiagUniforms = new Set<{
  livePosterDiagIndex: { value: number };
  livePosterDiagMode: { value: number };
}>();
let liveDiagIndex = -1;
let liveDiagMode: LivePosterShaderMode = 'LIVE-NORMAL';
// Evaluated once before materials compile. Ordinary launches receive the
// production shader verbatim, with no diagnostic uniforms or fragment branch.
const liveDiagShaderEnabled = jp4aTestRequested();

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

const XR_SAFE_POSTER_DIAGNOSTIC_GLSL = `
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
      uniform float livePosterDiagIndex;
      uniform float livePosterDiagMode;
      vec4 samplePosterBank(bool hi, vec2 uv, float idx, vec2 ddx, vec2 ddy) {
        bool diagSelected = livePosterDiagIndex >= 0.0 && abs(idx - livePosterDiagIndex) < 0.5;
        bool diagBaseOnly = diagSelected && livePosterDiagMode >= 1.0 && livePosterDiagMode <= 6.0;
        if (!diagBaseOnly && posterFocusActive > 0.5 && abs(idx - posterFocusIndex) < 0.5) {
          return texture(posterFocusMap, uv);
        }
        float w = max(posterDetailLutWidth, 1.0);
        float h = max(posterDetailLutHeight, 1.0);
        float lx = mod(idx, w);
        float ly = floor(idx / w);
        float detail = texture(detailLayerTex, vec2((lx + 0.5) / w, (ly + 0.5) / h)).r;
        if (!diagBaseOnly && detail > 0.001) {
          return textureGrad(detailMapArray, vec3(uv, detail * 255.0 - 1.0), ddx, ddy);
        }
        float layer = idx - posterBankOffset;
        if (diagSelected && livePosterDiagMode >= 2.0 && livePosterDiagMode <= 5.0) {
          return textureLod(shelfMapArray, vec3(uv, layer), livePosterDiagMode - 2.0);
        }
        if (diagSelected && livePosterDiagMode == 6.0) {
          // No derivative/minification selection: bilinear level zero control.
          return textureLod(shelfMapArray, vec3(uv, layer), 0.0);
        }
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
  if (!usesStablePosterBanks()) return POSTER_ARRAY_UNIFORMS;
  return liveDiagShaderEnabled ? XR_SAFE_POSTER_DIAGNOSTIC_GLSL : XR_SAFE_POSTER_SAMPLE_GLSL;
}

export function livePosterShaderDiagnosticsEnabled(): boolean { return liveDiagShaderEnabled; }

export function posterArrayUniforms(shader: THREE.WebGLProgramParametersWithUniforms) {
  noteProductionPosterCompile();
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
  const livePosterDiagIndex = { value: liveDiagIndex };
  const livePosterDiagMode = { value: LIVE_MODE_CODE[liveDiagMode] };
  if (liveDiagShaderEnabled) {
    shader.uniforms.livePosterDiagIndex = livePosterDiagIndex;
    shader.uniforms.livePosterDiagMode = livePosterDiagMode;
    liveDiagUniforms.add({ livePosterDiagIndex, livePosterDiagMode });
  }
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
    livePosterDiagIndex, livePosterDiagMode,
  };
}

/** Test-route-only selector; ordinary launches compile without this branch. */
export function setLivePosterShaderDiagnostic(index: number | null, mode: LivePosterShaderMode): void {
  liveDiagIndex = index == null ? -1 : index;
  liveDiagMode = mode;
  const code = LIVE_MODE_CODE[mode];
  for (const u of liveDiagUniforms) {
    u.livePosterDiagIndex.value = liveDiagIndex;
    u.livePosterDiagMode.value = code;
  }
}

export function livePosterShaderDiagnosticSnapshot() {
  return { index: liveDiagIndex, mode: liveDiagMode, code: LIVE_MODE_CODE[liveDiagMode] };
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
