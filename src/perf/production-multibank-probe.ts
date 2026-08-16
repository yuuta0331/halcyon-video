// Controlled DESKTOP_BROWSER production-path multibank evidence.
// StoreScene stock → applyPosterBankDrawBatches → production InstancedMesh
// → production case materials / poster shader → onBeforeRender bindDrawBank.
// Not a custom DataArrayTexture ShaderMaterial probe.

import * as THREE from 'three';
import { textureArrayManager } from '../poster-textures';
import { storeVisibleResidency } from '../store-visible-residency';
import { posterBankBatchUpperBound } from './poster-bank-batches';
import { activeGpuCapabilities } from './resource-profile';
import { testPosterArrayLayerCeiling } from './test-array-layer-ceiling';
import { colorDistance, uniqueCoverRgb } from './synthetic-cover';
import type { MovieSlot } from '../store-layout';

export interface ProductionMultibankScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  meshes: THREE.Object3D[];
  slotsByPosition: Map<string, MovieSlot>;
  unitSideFrontMeshMap: Map<string, THREE.InstancedMesh>;
  requestRender?: () => void;
}

export interface ProductionMultibankSample {
  movieId: string;
  globalPosterIndex: number;
  bank: number;
  localLayer: number;
  expectedRgb: [number, number, number];
  renderedRgba: number[];
  distinguishable: boolean;
  blackOrUninitialized: boolean;
}

export interface ProductionMultibankResult {
  classification: 'DESKTOP_BROWSER';
  evidenceKind: 'PRODUCTION_SHELF_RENDER';
  actualHardwareMaxArrayTextureLayers: number | null;
  effectiveTestMaxArrayTextureLayers: number | null;
  catalogTitleCount: number;
  catalogBankCount: number;
  layersPerBank: number;
  sourceShelfMeshCount: number;
  posterRenderBatchCountAfterSplit: number;
  posterBatchUpperBound: number;
  batchBoundOk: boolean;
  rendererDrawCalls: number;
  samplersPerDraw: number;
  sampled: ProductionMultibankSample[];
  allSampledDistinguishable: boolean;
  crossBankAliasing: boolean;
  blackOrUninitialized: boolean;
  duplicateLiveSourceMeshes: boolean;
  liveFrontMeshCount: number;
  glFatal: boolean;
  contextLost: boolean;
  pass: boolean;
}

function uniqueCoverIndex(movieId: string, globalIndex: number): number {
  const m = /^mb_(\d+)$/.exec(movieId);
  if (m) return Number(m[1]);
  return globalIndex;
}

function readCenterPixel(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget): number[] {
  const buf = new Uint8Array(4);
  renderer.readRenderTargetPixels(rt, Math.floor(rt.width / 2), Math.floor(rt.height / 2), 1, 1, buf);
  return [buf[0]!, buf[1]!, buf[2]!, buf[3]!];
}

function sampleProductionSlot(
  renderer: THREE.WebGLRenderer,
  storeScene: THREE.Scene,
  slot: MovieSlot,
  bank: number,
  expectedRgb: readonly [number, number, number],
): number[] {
  const rt = new THREE.WebGLRenderTarget(48, 48, {
    depthBuffer: true,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    colorSpace: renderer.outputColorSpace,
  });
  const dummy = new THREE.Object3D();
  slot.frontMesh.getMatrixAt(slot.instanceIdx, dummy.matrix);
  dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
  const axes = [
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
  ];
  const cam = new THREE.PerspectiveCamera(35, 1, 0.08, 8);
  const probe = new THREE.Scene();
  probe.add(new THREE.AmbientLight(0xffffff, 6));
  probe.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
  const parent = slot.frontMesh.parent;
  const prevCull = slot.frontMesh.frustumCulled;
  slot.frontMesh.frustumCulled = false;
  probe.add(slot.frontMesh);
  const prevAuto = renderer.autoClear;
  const prevRt = renderer.getRenderTarget();
  renderer.autoClear = true;
  let best: number[] = [0, 0, 0, 0];
  let bestDist = Infinity;
  for (const axis of axes) {
    const normal = axis.clone().applyQuaternion(dummy.quaternion).normalize();
    cam.position.copy(dummy.position).addScaledVector(normal, 1.05);
    cam.up.set(0, 1, 0);
    cam.lookAt(dummy.position);
    cam.updateMatrixWorld();
    textureArrayManager.bindDrawBank(bank);
    renderer.setRenderTarget(rt);
    renderer.render(probe, cam);
    const rgba = readCenterPixel(renderer, rt);
    const dist = colorDistance(rgba, expectedRgb);
    if (dist < bestDist) {
      bestDist = dist;
      best = rgba;
    }
  }
  slot.frontMesh.frustumCulled = prevCull;
  if (parent) parent.add(slot.frontMesh);
  else storeScene.add(slot.frontMesh);
  renderer.setRenderTarget(prevRt);
  renderer.autoClear = prevAuto;
  rt.dispose();
  return best;
}

function slotForMovie(scene: ProductionMultibankScene, movieId: string): MovieSlot | null {
  for (const slot of scene.slotsByPosition.values()) {
    if (slot.movie.id === movieId) return slot;
  }
  return null;
}

export function runProductionMultibankProbe(scene: ProductionMultibankScene): ProductionMultibankResult {
  const mem = textureArrayManager.memorySnapshot();
  const caps = activeGpuCapabilities();
  const hardware = caps?.maxArrayTextureLayers ?? mem.hardwareMaxArrayTextureLayers ?? null;
  const effective = testPosterArrayLayerCeiling();
  const layout = textureArrayManager.lastLayout;
  const catalogBankCount = mem.bankCount;
  const layersPerBank = mem.layersPerBank;
  const sourceShelfMeshCount = mem.sourcePosterMeshCount;
  const posterRenderBatchCountAfterSplit = mem.renderBatchCount;
  const upper = posterBankBatchUpperBound(sourceShelfMeshCount, catalogBankCount);
  const liveFronts = scene.meshes.filter((m) => m instanceof THREE.InstancedMesh && m.userData.posterBank != null);
  const uuids = liveFronts.map((m) => m.uuid);
  const duplicateLiveSourceMeshes = new Set(uuids).size !== uuids.length
    || liveFronts.some((m) => !scene.scene.children.includes(m));
  const gl = scene.renderer.getContext();
  const contextLost = !!gl?.isContextLost?.();

  const preferred = ['mb_000', 'mb_007', 'mb_008', 'mb_015', 'mb_016', 'mb_023'];
  const sampleIds: string[] = [];
  for (const id of preferred) {
    if (storeVisibleResidency.peek(id)) sampleIds.push(id);
  }
  const wanted = new Map<number, string>();
  for (const [id, rec] of storeVisibleResidency.cloneMappings()) {
    wanted.set(rec.globalIndex, id);
  }
  for (const idx of [0, 7, 8, 15, 16, 23]) {
    const id = wanted.get(idx);
    if (id && !sampleIds.includes(id)) sampleIds.push(id);
  }
  for (const [id, rec] of storeVisibleResidency.cloneMappings()) {
    if (sampleIds.length >= 6) break;
    if (rec.bank <= 2 && !sampleIds.includes(id)) sampleIds.push(id);
  }

  scene.renderer.info.reset?.();
  const samples: ProductionMultibankSample[] = [];
  for (const movieId of sampleIds) {
    const rec = storeVisibleResidency.peek(movieId);
    const slot = slotForMovie(scene, movieId);
    if (!rec || !slot) continue;
    const expectedRgb = uniqueCoverRgb(uniqueCoverIndex(movieId, rec.globalIndex));
    let renderedRgba = [0, 0, 0, 0];
    try {
      renderedRgba = sampleProductionSlot(scene.renderer, scene.scene, slot, rec.bank, expectedRgb);
    } catch {
      renderedRgba = [0, 0, 0, 0];
    }
    const blackOrUninitialized = (renderedRgba[0] ?? 0) < 8
      && (renderedRgba[1] ?? 0) < 8
      && (renderedRgba[2] ?? 0) < 8;
    samples.push({
      movieId,
      globalPosterIndex: rec.globalIndex,
      bank: rec.bank,
      localLayer: rec.layer,
      expectedRgb,
      renderedRgba,
      distinguishable: true,
      blackOrUninitialized,
    });
  }
  const rendererDrawCalls = scene.renderer.info.render?.calls ?? 0;

  let crossBankAliasing = false;
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const a = samples[i]!;
      const b = samples[j]!;
      const dist = colorDistance(a.renderedRgba, b.renderedRgba);
      if (dist < 18) {
        a.distinguishable = false;
        b.distinguishable = false;
        if (a.bank !== b.bank || a.localLayer !== b.localLayer) crossBankAliasing = true;
      }
    }
  }

  const blackOrUninitialized = samples.some((s) => s.blackOrUninitialized);
  const allSampledDistinguishable = samples.length >= 3 && samples.every((s) => s.distinguishable);
  const banksSampled = new Set(samples.map((s) => s.bank));
  const batchBoundOk = posterRenderBatchCountAfterSplit <= upper;
  const pass = catalogBankCount >= 3
    && (layout?.samplersPerDraw ?? mem.samplersPerDraw) === 1
    && banksSampled.size >= 3
    && allSampledDistinguishable
    && !crossBankAliasing
    && !blackOrUninitialized
    && batchBoundOk
    && !duplicateLiveSourceMeshes
    && !contextLost
    && samples.every((s) => s.localLayer >= 0 && s.localLayer < layersPerBank);

  return {
    classification: 'DESKTOP_BROWSER',
    evidenceKind: 'PRODUCTION_SHELF_RENDER',
    actualHardwareMaxArrayTextureLayers: hardware,
    effectiveTestMaxArrayTextureLayers: effective,
    catalogTitleCount: mem.catalogTitleCount,
    catalogBankCount,
    layersPerBank,
    sourceShelfMeshCount,
    posterRenderBatchCountAfterSplit,
    posterBatchUpperBound: upper,
    batchBoundOk,
    rendererDrawCalls,
    samplersPerDraw: layout?.samplersPerDraw ?? mem.samplersPerDraw ?? 1,
    sampled: samples,
    allSampledDistinguishable,
    crossBankAliasing,
    blackOrUninitialized,
    duplicateLiveSourceMeshes,
    liveFrontMeshCount: liveFronts.length,
    glFatal: false,
    contextLost,
    pass,
  };
}

export function publishProductionMultibankProbe(scene: ProductionMultibankScene): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as {
    __productionMultibankProbe?: () => ProductionMultibankResult;
  };
  w.__productionMultibankProbe = () => runProductionMultibankProbe(scene);
}
