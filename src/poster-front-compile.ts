// Shared production front-poster onBeforeCompile. video-case and the hardware
// diagnostic must not drift apart on vertex attributes or samplePosterBank.

import type * as THREE from 'three';
import {
  livePosterShaderDiagnosticsEnabled,
  posterArrayUniforms,
  posterShaderChunk,
} from './poster-shader.ts';

export type PosterFrontCompileVariant = 'regular' | 'animated';

export function compileProductionPosterFront(
  mat: THREE.Material,
  shader: THREE.WebGLProgramParametersWithUniforms,
  cropX: number,
  variant: PosterFrontCompileVariant,
): void {
  mat.userData.compiledUniformsList = mat.userData.compiledUniformsList || [];
  const arrays = posterArrayUniforms(shader);
  const uPosterCropX = shader.uniforms.uPosterCropX = { value: cropX };
  mat.userData.compiledUniformsList.push({
    ...arrays,
    uPosterCropX,
  });

  shader.vertexShader = `
      attribute float aTextureIndex;
      attribute float aPosterCropSkip;
      varying float vTextureIndex;
      varying float vPosterCropSkip;
      ${shader.vertexShader}
    `.replace(
    '#include <uv_vertex>',
    `
      vUv = uv;
      `,
  ).replace(
    '#include <begin_vertex>',
    `
      #include <begin_vertex>
      vTextureIndex = aTextureIndex;
      vPosterCropSkip = aPosterCropSkip;
      `,
  );

  const mapFragment = variant === 'animated' ? ANIMATED_MAP_FRAGMENT : REGULAR_MAP_FRAGMENT;
  shader.fragmentShader = `
      ${posterShaderChunk()}
      uniform sampler2D highResLoadedTex;
      uniform float maxMoviesCount;
      uniform float uPosterCropX;
      varying float vTextureIndex;
      varying float vPosterCropSkip;
      ${shader.fragmentShader}
    `.replace('#include <map_fragment>', mapFragment);
  if (livePosterShaderDiagnosticsEnabled()) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      // LIVE-UNLIT keeps the selected production geometry and chosen texture
      // tier, but removes MeshStandard lighting as the sole diagnostic change.
      if (livePosterDiagIndex >= 0.0 && abs(vTextureIndex - livePosterDiagIndex) < 0.5
          && livePosterDiagMode == 7.0) {
        outgoingLight = diffuseColor.rgb;
      }
      #include <opaque_fragment>
      `);
  }
}

const REGULAR_MAP_FRAGMENT = `
      #if defined( REPR_MAP_ARRAY )
        // On VHS the face is narrower than the poster, so crop the poster's
        // sides (uPosterCropX per side) rather than squashing it. 0 on DVD,
        // and 0 for crop-exempt instances (game boxes keep their own face
        // dims in both mediums, so their fill-decoded art must not be cut).
        float cropX = uPosterCropX * (1.0 - vPosterCropSkip);
        vec2 posterUv = vec2(cropX + vUv.x * (1.0 - 2.0 * cropX), vUv.y);
        // Gradients computed in uniform control flow, before branching on
        // loadStatus — see samplePosterBank.
        vec2 posterUvDx = dFdx(posterUv);
        vec2 posterUvDy = dFdy(posterUv);
        float loadStatus = texture(highResLoadedTex, vec2((vTextureIndex + 0.5) / maxMoviesCount, 0.5)).r;
        vec4 mapTexel;
        if (loadStatus > 0.8) {
          mapTexel = samplePosterBank(true, posterUv, vTextureIndex, posterUvDx, posterUvDy);
        } else if (loadStatus > 0.3) {
          mapTexel = samplePosterBank(false, posterUv, vTextureIndex, posterUvDx, posterUvDy);
        } else {
          mapTexel = texture(map, posterUv);
        }
        diffuseColor *= mapTexel;
      #else
        #include <map_fragment>
      #endif
      `;

const ANIMATED_MAP_FRAGMENT = `
      #if defined( REPR_MAP_ARRAY )
        float border = 0.04;
        // scaledUv/posterUv and their screen-space derivatives are computed
        // unconditionally (outside the border if/else) so dFdx/dFdy — which,
        // like implicit-LOD texture(), is undefined in non-uniform control
        // flow per the GLSL ES 3.00 spec — always runs in uniform control
        // flow, regardless of whether a given fragment is in the border strip.
        vec2 scaledUv = vec2(vUv.x / (1.0 - border), (vUv.y - border) / (1.0 - 2.0 * border));
        float cropX = uPosterCropX * (1.0 - vPosterCropSkip);
        vec2 posterUv = vec2(cropX + scaledUv.x * (1.0 - 2.0 * cropX), scaledUv.y);
        vec2 posterUvDx = dFdx(posterUv);
        vec2 posterUvDy = dFdy(posterUv);
        if (vUv.x > 1.0 - border || vUv.y < border || vUv.y > 1.0 - border) {
          diffuseColor.rgb = vec3(1.0);
        } else {
          // See samplePosterBank for why this uses an explicit gradient:
          // mip-mapped arrays + a branch that differs between adjacent
          // instanced quads means implicit-LOD texture() calls here would be
          // in non-uniform control flow.
          float loadStatus = texture(highResLoadedTex, vec2((vTextureIndex + 0.5) / maxMoviesCount, 0.5)).r;
          vec4 mapTexel;
          if (loadStatus > 0.8) {
            mapTexel = samplePosterBank(true, posterUv, vTextureIndex, posterUvDx, posterUvDy);
          } else if (loadStatus > 0.3) {
            mapTexel = samplePosterBank(false, posterUv, vTextureIndex, posterUvDx, posterUvDy);
          } else {
            mapTexel = texture(map, posterUv);
          }
          diffuseColor *= mapTexel;
        }
      #else
        #include <map_fragment>
      #endif
      `;
