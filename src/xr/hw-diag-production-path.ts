// Production-path diagnostic poster for modes C/D/E.
// Synthetic PIXELS, production compile / array / LUT / FOCUS / bank-bind path.

import * as THREE from 'three';
import { createClonedCaseGeometry, POSTER_CROP_X } from '../video-case.ts';
import { compileProductionPosterFront } from '../poster-front-compile.ts';
import { bindPosterBankUniforms } from '../poster-shader.ts';
import { textureArrayManager } from '../poster-textures.ts';
import { makePosterQualityPattern } from '../poster-quality-pattern.ts';
import {
  POSTER_BASE_XR_HEIGHT,
  POSTER_BASE_XR_WIDTH,
  POSTER_FOCUS_HEIGHT,
  POSTER_FOCUS_WIDTH,
  POSTER_NEAR_HEIGHT,
  POSTER_NEAR_WIDTH,
} from '../poster-quality.ts';
import {
  hwDiagProductionBindSuppressed,
  noteHwDiagBankBind,
  noteHwDiagFocusBind,
  noteHwDiagLutBind,
} from '../perf/hw-diag-observe.ts';

export type ProductionDiagTier = 'C' | 'D' | 'E';

function makeArray(w: number, h: number, layers: number, seed: number, mips: boolean): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(makePosterQualityPattern(w, h, seed), w, h, layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = mips;
  tex.needsUpdate = true;
  return tex;
}

function makeLoadedFlags(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeLut(on: boolean): THREE.DataTexture {
  const bytes = new Uint8Array([on ? 1 : 0, 0, 0, 255]);
  const tex = new THREE.DataTexture(bytes, 1, 1);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

function makeFocus(seed: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    makePosterQualityPattern(POSTER_FOCUS_WIDTH, POSTER_FOCUS_HEIGHT, seed),
    POSTER_FOCUS_WIDTH,
    POSTER_FOCUS_HEIGHT,
  );
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export class HwDiagProductionPoster {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.MeshStandardMaterial;
  private readonly baseArray: THREE.DataArrayTexture;
  private readonly nearArray: THREE.DataArrayTexture;
  private readonly dummyNear: THREE.DataArrayTexture;
  private readonly loaded: THREE.DataTexture;
  private readonly lutOff: THREE.DataTexture;
  private readonly lutOn: THREE.DataTexture;
  private readonly focusTex: THREE.DataTexture;
  private readonly dummyFocus: THREE.DataTexture;
  private mode: ProductionDiagTier = 'C';

  constructor() {
    this.baseArray = makeArray(POSTER_BASE_XR_WIDTH, POSTER_BASE_XR_HEIGHT, 1, 1, true);
    this.nearArray = makeArray(POSTER_NEAR_WIDTH, POSTER_NEAR_HEIGHT, 1, 5, false);
    this.dummyNear = makeArray(POSTER_NEAR_WIDTH, POSTER_NEAR_HEIGHT, 1, 0, false);
    this.loaded = makeLoadedFlags();
    this.lutOff = makeLut(false);
    this.lutOn = makeLut(true);
    this.focusTex = makeFocus(9);
    this.dummyFocus = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    this.dummyFocus.format = THREE.RGBAFormat;
    this.dummyFocus.type = THREE.UnsignedByteType;
    this.dummyFocus.needsUpdate = true;

    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0,
      depthTest: true,
      depthWrite: true,
      map: this.loaded,
    });
    this.material.defines = this.material.defines || {};
    this.material.defines.USE_UV = '';
    this.material.defines.REPR_MAP_ARRAY = '';
    this.material.needsUpdate = true;
    this.material.onBeforeCompile = (shader) => {
      compileProductionPosterFront(this.material, shader, POSTER_CROP_X, 'regular');
      this.applyUniforms();
    };

    const geo = createClonedCaseGeometry(1);
    this.mesh = new THREE.InstancedMesh(geo, this.material, 1);
    this.mesh.name = 'hw-diag-production';
    this.mesh.frustumCulled = false;
    this.mesh.setMatrixAt(0, new THREE.Matrix4());
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.onBeforeRender = () => this.onBeforeRender();
  }

  setMode(mode: ProductionDiagTier): void {
    this.mode = mode;
    this.mesh.visible = true;
    this.applyUniforms();
  }

  onBeforeRender(): void {
    if (hwDiagProductionBindSuppressed()) return;
    if (textureArrayManager.highResArray) bindPosterBankUniforms(0);
    this.applyUniforms();
    noteHwDiagBankBind();
    if (this.mode === 'D' || this.mode === 'E') noteHwDiagLutBind();
    if (this.mode === 'E') noteHwDiagFocusBind();
  }

  snapshot() {
    const near = this.mode === 'D' || this.mode === 'E';
    const focus = this.mode === 'E';
    return {
      geometryPath: 'createClonedCaseGeometry',
      materialPath: 'compileProductionPosterFront',
      shaderPath: 'posterShaderChunk+posterArrayUniforms',
      productionPathClass: 'production',
        baseEnabled: true,
        detailLutEnabled: near,
        focusEnabled: focus,
        mipPolicy: 'base-mips-near-none' as const,
    };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.baseArray.dispose();
    this.nearArray.dispose();
    this.dummyNear.dispose();
    this.loaded.dispose();
    this.lutOff.dispose();
    this.lutOn.dispose();
    this.focusTex.dispose();
    this.dummyFocus.dispose();
  }

  private applyUniforms(): void {
    const list = this.material.userData.compiledUniformsList as Array<Record<string, { value: unknown }>> | undefined;
    if (!list) return;
    const near = this.mode === 'D' || this.mode === 'E';
    const focus = this.mode === 'E';
    for (const u of list) {
      if (u.shelfMapArray) u.shelfMapArray.value = this.baseArray;
      if (u.highResMapArray) u.highResMapArray.value = this.baseArray;
      if (u.lowResMapArray) u.lowResMapArray.value = this.baseArray;
      if (u.highResLoadedTex) u.highResLoadedTex.value = this.loaded;
      if (u.maxMoviesCount) u.maxMoviesCount.value = 1;
      if (u.posterBankOffset) u.posterBankOffset.value = 0;
      if (u.detailMapArray) u.detailMapArray.value = near ? this.nearArray : this.dummyNear;
      if (u.detailLayerTex) u.detailLayerTex.value = near ? this.lutOn : this.lutOff;
      if (u.posterDetailLutWidth) u.posterDetailLutWidth.value = 1;
      if (u.posterDetailLutHeight) u.posterDetailLutHeight.value = 1;
      if (u.posterFocusMap) u.posterFocusMap.value = focus ? this.focusTex : this.dummyFocus;
      if (u.posterFocusIndex) u.posterFocusIndex.value = focus ? 0 : -1;
      if (u.posterFocusActive) u.posterFocusActive.value = focus ? 1 : 0;
    }
  }
}
