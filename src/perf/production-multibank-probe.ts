// Controlled DESKTOP_BROWSER production-path multibank evidence.
// StoreScene stock → applyPosterBankDrawBatches → production InstancedMesh
// → production case materials / poster shader → onBeforeRender bindDrawBank.
// Probe never pre-binds the expected bank. Wrong-bank precondition is
// test-side only; the production callback must make the draw correct.

import * as THREE from 'three';
import { textureArrayManager } from '../poster-textures';
import { storeVisibleResidency } from '../store-visible-residency';
import { posterBankBatchUpperBound } from './poster-bank-batches';
import { drainGlErrors, glFatalFrom, type GlErrorRecord } from './gl-error-drain';
import {
  beginBindDrawBankRecording,
  observedBanks,
  takeBindDrawBankRecording,
  adversarialWrongBank,
  type BindDrawBankCall,
} from './poster-bank-bind-observer';
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
  matchesExpected: boolean;
  adversarialWrongBank: number;
  productionBindCalls: number[];
}

export interface ProductionBindObserverEvidence {
  oneTraversalCalls: number[];
  banksObserved: number[];
  switchCount: number;
  oneRenderExercisedMultipleBanks: boolean;
  sampleProductionBindCalls: number[];
}

export interface ProductionNegativeControlEvidence {
  implemented: true;
  movieId: string;
  targetBank: number;
  suppressedCallbackMismatched: boolean;
  restoredCallbackMatched: boolean;
  suppressedRgba: number[];
  restoredRgba: number[];
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
  probeAssistedExpectedBind: false;
  adversarialPrecondition: string;
  bindObserver: ProductionBindObserverEvidence;
  negativeControl: ProductionNegativeControlEvidence | { implemented: false; reason: string };
  glErrorsBefore: GlErrorRecord[];
  glErrorsAfter: GlErrorRecord[];
  glFatal: boolean;
  contextLost: boolean;
  pass: boolean;
}

const MATCH_THRESHOLD = 90;
const MISMATCH_THRESHOLD = 28;
const ADVERSARIAL_PRECONDITION =
  'probe-side bindDrawBank(wrongBank) immediately before renderer.render; expected bank is never pre-bound; production mesh.onBeforeRender must switch';

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

function bankSwitchCount(calls: readonly number[]): number {
  let n = 0;
  for (let i = 1; i < calls.length; i++) {
    if (calls[i] !== calls[i - 1]) n++;
  }
  return n;
}

function sampleProductionSlot(
  renderer: THREE.WebGLRenderer,
  storeScene: THREE.Scene,
  slot: MovieSlot,
  targetBank: number,
  expectedRgb: readonly [number, number, number],
  opts: { suppressProductionBind?: boolean } = {},
): { rgba: number[]; calls: BindDrawBankCall[]; wrongBank: number } {
  const wrongBank = adversarialWrongBank(targetBank, textureArrayManager.bankCount);
  const rt = new THREE.WebGLRenderTarget(48, 48, {
    depthBuffer: true,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
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
  const prevCallback = slot.frontMesh.onBeforeRender;
  slot.frontMesh.frustumCulled = false;
  if (opts.suppressProductionBind) {
    slot.frontMesh.onBeforeRender = () => {};
  }
  probe.add(slot.frontMesh);
  const prevAuto = renderer.autoClear;
  const prevRt = renderer.getRenderTarget();
  renderer.autoClear = true;
  let best: number[] = [0, 0, 0, 0];
  let bestDist = Infinity;
  const recorded: BindDrawBankCall[] = [];
  try {
    for (const axis of axes) {
      const normal = axis.clone().applyQuaternion(dummy.quaternion).normalize();
      cam.position.copy(dummy.position).addScaledVector(normal, 1.05);
      cam.up.set(0, 1, 0);
      cam.lookAt(dummy.position);
      cam.updateMatrixWorld();
      textureArrayManager.bindDrawBank(wrongBank);
      beginBindDrawBankRecording();
      renderer.setRenderTarget(rt);
      renderer.render(probe, cam);
      recorded.push(...takeBindDrawBankRecording());
      const rgba = readCenterPixel(renderer, rt);
      const dist = colorDistance(rgba, expectedRgb);
      if (dist < bestDist) {
        bestDist = dist;
        best = rgba;
      }
    }
  } finally {
    takeBindDrawBankRecording();
    slot.frontMesh.frustumCulled = prevCull;
    slot.frontMesh.onBeforeRender = prevCallback;
    if (parent) parent.add(slot.frontMesh);
    else storeScene.add(slot.frontMesh);
    renderer.setRenderTarget(prevRt);
    renderer.autoClear = prevAuto;
    rt.dispose();
  }
  return { rgba: best, calls: recorded, wrongBank };
}

function livePosterMeshes(scene: ProductionMultibankScene): THREE.InstancedMesh[] {
  return scene.meshes.filter((m): m is THREE.InstancedMesh =>
    m instanceof THREE.InstancedMesh && m.userData.posterBank != null);
}

function observeOneProductionTraversal(scene: ProductionMultibankScene): BindDrawBankCall[] {
  const meshes = livePosterMeshes(scene);
  const wanted = [0, 1, 2]
    .map((bank) => meshes.find((m) => m.userData.posterBank === bank))
    .filter((m): m is THREE.InstancedMesh => !!m);
  if (wanted.length < 3) return [];
  const probe = new THREE.Scene();
  probe.add(new THREE.AmbientLight(0xffffff, 1));
  const restored: Array<{ mesh: THREE.InstancedMesh; parent: THREE.Object3D | null; cull: boolean }> = [];
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  cam.position.set(0, 4, 12);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const rt = new THREE.WebGLRenderTarget(32, 32, {
    depthBuffer: false,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
  const prevRt = scene.renderer.getRenderTarget();
  const prevAuto = scene.renderer.autoClear;
  try {
    for (const mesh of wanted) {
      restored.push({ mesh, parent: mesh.parent, cull: mesh.frustumCulled });
      mesh.frustumCulled = false;
      probe.add(mesh);
    }
    textureArrayManager.bindDrawBank(0);
    beginBindDrawBankRecording();
    scene.renderer.autoClear = true;
    scene.renderer.setRenderTarget(rt);
    scene.renderer.render(probe, cam);
    return takeBindDrawBankRecording();
  } finally {
    takeBindDrawBankRecording();
    for (const row of restored) {
      row.mesh.frustumCulled = row.cull;
      if (row.parent) row.parent.add(row.mesh);
      else scene.scene.add(row.mesh);
    }
    scene.renderer.setRenderTarget(prevRt);
    scene.renderer.autoClear = prevAuto;
    rt.dispose();
  }
}

function slotForMovie(scene: ProductionMultibankScene, movieId: string): MovieSlot | null {
  for (const slot of scene.slotsByPosition.values()) {
    if (slot.movie.id === movieId) return slot;
  }
  return null;
}

function runNegativeControl(
  scene: ProductionMultibankScene,
  movieId: string,
): ProductionNegativeControlEvidence | { implemented: false; reason: string } {
  const rec = storeVisibleResidency.peek(movieId);
  const slot = slotForMovie(scene, movieId);
  if (!rec || !slot) {
    return { implemented: false, reason: `missing slot/residency for ${movieId}` };
  }
  const expectedRgb = uniqueCoverRgb(uniqueCoverIndex(movieId, rec.globalIndex));
  let suppressedRgba = [0, 0, 0, 0];
  let restoredRgba = [0, 0, 0, 0];
  try {
    suppressedRgba = sampleProductionSlot(
      scene.renderer, scene.scene, slot, rec.bank, expectedRgb, { suppressProductionBind: true },
    ).rgba;
    restoredRgba = sampleProductionSlot(
      scene.renderer, scene.scene, slot, rec.bank, expectedRgb,
    ).rgba;
  } catch (err) {
    return { implemented: false, reason: String(err) };
  }
  return {
    implemented: true,
    movieId,
    targetBank: rec.bank,
    suppressedCallbackMismatched: colorDistance(suppressedRgba, expectedRgb) >= MISMATCH_THRESHOLD,
    restoredCallbackMatched: colorDistance(restoredRgba, expectedRgb) < MATCH_THRESHOLD,
    suppressedRgba,
    restoredRgba,
  };
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
  const liveFronts = livePosterMeshes(scene);
  const uuids = liveFronts.map((m) => m.uuid);
  const duplicateLiveSourceMeshes = new Set(uuids).size !== uuids.length
    || liveFronts.some((m) => !scene.scene.children.includes(m));
  const gl = scene.renderer.getContext() as WebGLRenderingContext | WebGL2RenderingContext | null;
  const contextLost = !!gl && 'isContextLost' in gl && gl.isContextLost();
  const glErrorsBefore = drainGlErrors(gl);

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
  const traversalCalls = observeOneProductionTraversal(scene);
  const traversalBanks = traversalCalls.map((c) => c.bank);
  const samples: ProductionMultibankSample[] = [];
  const sampleProductionBindCalls: number[] = [];
  for (const movieId of sampleIds) {
    const rec = storeVisibleResidency.peek(movieId);
    const slot = slotForMovie(scene, movieId);
    if (!rec || !slot) continue;
    const expectedRgb = uniqueCoverRgb(uniqueCoverIndex(movieId, rec.globalIndex));
    let renderedRgba = [0, 0, 0, 0];
    let productionBindCalls: number[] = [];
    let wrongBank = adversarialWrongBank(rec.bank, catalogBankCount);
    try {
      const hit = sampleProductionSlot(scene.renderer, scene.scene, slot, rec.bank, expectedRgb);
      renderedRgba = hit.rgba;
      productionBindCalls = hit.calls.map((c) => c.bank);
      wrongBank = hit.wrongBank;
    } catch {
      renderedRgba = [0, 0, 0, 0];
    }
    sampleProductionBindCalls.push(...productionBindCalls);
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
      matchesExpected: colorDistance(renderedRgba, expectedRgb) < MATCH_THRESHOLD,
      adversarialWrongBank: wrongBank,
      productionBindCalls,
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

  const negativeId = sampleIds.find((id) => (storeVisibleResidency.peek(id)?.bank ?? 0) >= 2)
    ?? sampleIds.find((id) => (storeVisibleResidency.peek(id)?.bank ?? 0) >= 1)
    ?? sampleIds[0]
    ?? 'mb_016';
  const negativeControl = runNegativeControl(scene, negativeId);

  const glErrorsAfter = drainGlErrors(gl);
  const glFatal = glFatalFrom(glErrorsAfter) || contextLost;

  const blackOrUninitialized = samples.some((s) => s.blackOrUninitialized);
  const allSampledDistinguishable = samples.length >= 3 && samples.every((s) => s.distinguishable);
  const banksSampled = new Set(samples.map((s) => s.bank));
  const batchBoundOk = posterRenderBatchCountAfterSplit <= upper;
  const observedFromTraversal = observedBanks(traversalCalls);
  const observedFromSamples = [...new Set(sampleProductionBindCalls)].sort((a, b) => a - b);
  const banksObserved = [...new Set([...observedFromTraversal, ...observedFromSamples])].sort((a, b) => a - b);
  const productionCallbackObserved = samples.every((s) => s.productionBindCalls.includes(s.bank))
    && observedFromTraversal.includes(0)
    && observedFromTraversal.includes(1)
    && observedFromTraversal.includes(2);
  const noExpectedPreBind = samples.every((s) => s.adversarialWrongBank !== s.bank || catalogBankCount <= 1);
  const oneRenderExercisedMultipleBanks = new Set(traversalBanks).size >= 3;
  const negativeOk = negativeControl.implemented === true
    && negativeControl.suppressedCallbackMismatched
    && negativeControl.restoredCallbackMatched;

  const pass = catalogBankCount >= 3
    && (layout?.samplersPerDraw ?? mem.samplersPerDraw) === 1
    && banksSampled.size >= 3
    && allSampledDistinguishable
    && samples.every((s) => s.matchesExpected)
    && !crossBankAliasing
    && !blackOrUninitialized
    && batchBoundOk
    && !duplicateLiveSourceMeshes
    && !contextLost
    && !glFatal
    && glErrorsAfter.length === 0
    && samples.every((s) => s.localLayer >= 0 && s.localLayer < layersPerBank)
    && productionCallbackObserved
    && noExpectedPreBind
    && oneRenderExercisedMultipleBanks
    && banksObserved.includes(0)
    && banksObserved.includes(1)
    && banksObserved.includes(2)
    && negativeOk;

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
    probeAssistedExpectedBind: false,
    adversarialPrecondition: ADVERSARIAL_PRECONDITION,
    bindObserver: {
      oneTraversalCalls: traversalBanks,
      banksObserved,
      switchCount: bankSwitchCount(traversalBanks),
      oneRenderExercisedMultipleBanks,
      sampleProductionBindCalls,
    },
    negativeControl,
    glErrorsBefore,
    glErrorsAfter,
    glFatal,
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
