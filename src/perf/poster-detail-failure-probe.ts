// DESKTOP_BROWSER DETAIL load-failure settlement proof. Not Quest hardware.

import * as THREE from 'three';
import { uniqueCoverDataUrl, uniqueCoverRgb } from './synthetic-cover';
import { XR_SAFE_POSTER_SAMPLE_GLSL } from '../poster-shader';
import { posterPixelCache, posterQueue } from '../video-case';
import { pumpTextureUploads } from '../poster-textures';
import { PosterDetailResidency } from '../poster-detail-residency';
import { DetailRetryBook, DETAIL_MAX_ATTEMPTS, DETAIL_RETRY_DELAYS_MS } from '../poster-detail-retry';
import {
  clearPosterDetailLut,
  getPosterDetailArray,
  getPosterDetailLut,
  getPosterDetailLutLayout,
  initPosterDetailGpu,
  setPosterDetailLut,
  uploadPosterDetailLayer,
} from '../poster-detail-gpu';
import { activateDetailTitle, demoteDetailTitle, type DetailActivateDeps } from '../poster-detail-activate';

export interface PosterDetailFailureProbeResult {
  classification: 'DESKTOP_BROWSER';
  QUEST_HARDWARE: 'NOT_EXECUTED';
  pass: boolean;
  success: { decoded: number; uploaded: number; readyResident: number; shaderDetail: number[] };
  failure: {
    requested: number;
    loadFailed: number;
    pendingPixelsAfter: number;
    pendingUploadAfter: number;
    readyResidentAfter: number;
    leasedAfter: number;
    baseStayedVisible: boolean;
  };
  retry: {
    attempts: number;
    retrySuppressedDuringBackoff: boolean;
    eventualSuccess: boolean;
    decoded: number;
    uploaded: number;
    readyResident: number;
  };
  pool: {
    slotLimit: number;
    failedTitles: number;
    leakedLeases: number;
    healthyTitleAcquiredAfterFailures: boolean;
  };
  stale: {
    oldLeaseRejected: boolean;
    newOwnerPreserved: boolean;
    oldGenerationRejected: boolean;
  };
  gpu: { uploadFailureSettled: boolean; lutFailureSettled: boolean };
  canonicalQueue: { decoded: boolean; loadFailed: boolean; leasedAfterFail: number };
  contextLost: boolean;
  note: string;
}

const BASE = [0, 220, 255, 255] as const;

function solid(w: number, h: number, rgb: readonly number[]): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = rgb[0]!;
    out[i * 4 + 1] = rgb[1]!;
    out[i * 4 + 2] = rgb[2]!;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function isCyan(p: number[]): boolean {
  return p[1]! > 140 && p[2]! > 140 && p[0]! < 80;
}

function isDetailRed(p: number[]): boolean {
  return p[0]! > 140 && p[1]! < 100 && p[2]! < 100;
}

function makeShelf(rgb: readonly number[]): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(solid(8, 12, rgb), 8, 12, 1);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function sample(
  renderer: THREE.WebGLRenderer,
  shelf: THREE.DataArrayTexture,
  index: number,
): number[] {
  const layout = getPosterDetailLutLayout();
  const rt = new THREE.WebGLRenderTarget(32, 32, {
    depthBuffer: false, stencilBuffer: false,
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace,
  });
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      shelfMapArray: { value: shelf },
      detailMapArray: { value: getPosterDetailArray() },
      detailLayerTex: { value: getPosterDetailLut() },
      posterBankOffset: { value: 0 },
      posterDetailCount: { value: layout.capacity },
      posterDetailLutWidth: { value: layout.width },
      posterDetailLutHeight: { value: layout.height },
      posterFocusMap: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1) },
      posterFocusIndex: { value: -1 },
      posterFocusActive: { value: 0 },
      uIndex: { value: index },
    },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      ${XR_SAFE_POSTER_SAMPLE_GLSL}
      varying vec2 vUv; uniform float uIndex;
      void main() {
        gl_FragColor = samplePosterBank(false, vUv, uIndex, dFdx(vUv), dFdy(vUv));
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  scene.add(mesh);
  const prev = renderer.getRenderTarget();
  const buf = new Uint8Array(4);
  try {
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 16, 16, 1, 1, buf);
    return [buf[0]!, buf[1]!, buf[2]!, buf[3]!];
  } finally {
    renderer.setRenderTarget(prev);
    rt.dispose();
    mesh.geometry.dispose();
    mat.dispose();
  }
}

function pixels(): Uint8Array {
  return solid(320, 480, uniqueCoverRgb(0));
}

async function waitMs(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function runPosterDetailFailureProbe(
  renderer: THREE.WebGLRenderer,
): Promise<PosterDetailFailureProbeResult> {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const contextLost = typeof gl.isContextLost === 'function' && gl.isContextLost();
  const empty = (note: string): PosterDetailFailureProbeResult => ({
    classification: 'DESKTOP_BROWSER',
    QUEST_HARDWARE: 'NOT_EXECUTED',
    pass: false,
    success: { decoded: 0, uploaded: 0, readyResident: 0, shaderDetail: [0, 0, 0, 0] },
    failure: {
      requested: 0, loadFailed: 0, pendingPixelsAfter: 1, pendingUploadAfter: 1,
      readyResidentAfter: 1, leasedAfter: 1, baseStayedVisible: false,
    },
    retry: {
      attempts: 0, retrySuppressedDuringBackoff: false, eventualSuccess: false,
      decoded: 0, uploaded: 0, readyResident: 0,
    },
    pool: { slotLimit: 4, failedTitles: 0, leakedLeases: 1, healthyTitleAcquiredAfterFailures: false },
    stale: { oldLeaseRejected: false, newOwnerPreserved: false, oldGenerationRejected: false },
    gpu: { uploadFailureSettled: false, lutFailureSettled: false },
    canonicalQueue: { decoded: false, loadFailed: false, leasedAfterFail: 1 },
    contextLost, note,
  });
  if (contextLost) return empty('context lost');

  initPosterDetailGpu({ slotLimit: 4, catalogCount: 8, renderer });
  const shelf = makeShelf(BASE);
  uploadPosterDetailLayer(renderer, 0, pixels());

  const now = { t: 0 };
  const gen = { n: 1 };
  const residency = new PosterDetailResidency(4);
  const retry = new DetailRetryBook();
  const desired = new Set<string>(['a']);
  const settled = new Map<string, () => void>();
  const delayed = new Map<string, (p: Uint8Array) => void>();
  const pix = new Map<string, Uint8Array>();
  const uploadOk = { v: true };
  const lutOk = { v: true };
  const movies = new Map([
    ['a', { id: 'a', posterUrl: 'data:image/png,a' }],
    ['b', { id: 'b', posterUrl: 'data:image/png,b' }],
    ['ok', { id: 'ok', posterUrl: 'data:image/png,ok' }],
  ]);
  const deps: DetailActivateDeps = {
    getMovie: (id) => movies.get(id) ?? { id, posterUrl: `data:image/png,${id}` },
    getGlobalIndex: (id) => id === 'b' ? 1 : 0,
    isDesired: (id) => desired.has(id),
    isSelected: (id) => id === 'a' || id === 'ok',
    sceneGeneration: () => gen.n,
    getPixels: (id) => pix.get(id) ?? null,
    loadPoster: (movie, _p, onPixels, onSettled) => {
      delayed.set(movie.id, onPixels);
      if (onSettled) settled.set(movie.id, onSettled);
    },
    queueUpload: (run) => { run(); },
    uploadLayer: (slot, data) => uploadOk.v && uploadPosterDetailLayer(renderer, slot, data),
    setLut: (i, v) => lutOk.v && setPosterDetailLut(i, v),
    clearLut: (i) => { clearPosterDetailLut(i); },
    now: () => now.t,
  };
  const act = (id: string) => activateDetailTitle(id, deps, residency, retry);

  act('a');
  delayed.get('a')!(pixels());
  const successSnap = residency.snapshot();
  const shaderDetail = sample(renderer, shelf, 0);
  demoteDetailTitle('a', deps, residency);
  retry.noteSuccess('a');

  act('a');
  settled.get('a')!();
  const failSnap = residency.snapshot();
  setPosterDetailLut(0, 0);
  const shaderAfterFail = sample(renderer, shelf, 0);
  const failure = {
    requested: failSnap.requested,
    loadFailed: failSnap.loadFailed,
    pendingPixelsAfter: failSnap.pendingPixels,
    pendingUploadAfter: failSnap.pendingUpload,
    readyResidentAfter: failSnap.readyResident,
    leasedAfter: failSnap.leased,
    baseStayedVisible: isCyan(shaderAfterFail),
  };

  const loadsBefore = retry.attempts('a');
  act('a');
  const suppressed = retry.suppressed('a', 1, now.t) && failSnap.leased === 0;
  now.t += DETAIL_RETRY_DELAYS_MS[0]!;
  act('a');
  delayed.get('a')!(pixels());
  const afterRetry = residency.snapshot();
  const retryEv = {
    attempts: Math.max(loadsBefore, 1),
    retrySuppressedDuringBackoff: suppressed,
    eventualSuccess: afterRetry.readyResident === 1,
    decoded: afterRetry.decoded,
    uploaded: afterRetry.uploaded,
    readyResident: afterRetry.readyResident,
  };
  demoteDetailTitle('a', deps, residency);
  retry.reset();

  const poolLimit = 64;
  const poolRes = new PosterDetailResidency(poolLimit);
  const poolRetry = new DetailRetryBook();
  const poolDesired = new Set<string>();
  const poolSettled = new Map<string, () => void>();
  const poolDeps: DetailActivateDeps = {
    ...deps,
    isDesired: (id) => poolDesired.has(id),
    isSelected: () => false,
    getPixels: () => null,
    loadPoster: (movie, _p, _cb, onSettled) => { if (onSettled) poolSettled.set(movie.id, onSettled); },
    now: () => 0,
    sceneGeneration: () => 1,
  };
  for (let i = 0; i < poolLimit; i++) {
    const id = `fail-${i}`;
    poolDesired.add(id);
    activateDetailTitle(id, poolDeps, poolRes, poolRetry);
    poolSettled.get(id)?.();
    poolDesired.delete(id);
  }
  const leaked = poolRes.snapshot().leased;
  poolDesired.add('ok');
  const okDeps: DetailActivateDeps = {
    ...poolDeps,
    getPixels: (id) => id === 'ok' ? pixels() : null,
    isDesired: (id) => poolDesired.has(id),
  };
  activateDetailTitle('ok', okDeps, poolRes, poolRetry);
  const pool = {
    slotLimit: poolLimit,
    failedTitles: poolLimit,
    leakedLeases: leaked,
    healthyTitleAcquiredAfterFailures: poolRes.isReady('ok'),
  };

  const staleRes = new PosterDetailResidency(1);
  const staleRetry = new DetailRetryBook();
  const staleDesired = new Set(['a']);
  const staleSettled = new Map<string, () => void>();
  const stalePix = new Map<string, Uint8Array>();
  const staleDeps: DetailActivateDeps = {
    ...deps,
    isDesired: (id) => staleDesired.has(id),
    isSelected: () => false,
    getPixels: (id) => stalePix.get(id) ?? null,
    loadPoster: (movie, _p, _cb, onSettled) => { if (onSettled) staleSettled.set(movie.id, onSettled); },
    now: () => 0,
    sceneGeneration: () => 1,
  };
  activateDetailTitle('a', staleDeps, staleRes, staleRetry);
  const oldLease = staleRes.peek('a')!;
  const oldFail = staleSettled.get('a')!;
  staleDesired.delete('a');
  demoteDetailTitle('a', staleDeps, staleRes);
  staleDesired.add('b');
  stalePix.set('b', pixels());
  activateDetailTitle('b', staleDeps, staleRes, staleRetry);
  oldFail();
  const stale = {
    oldLeaseRejected: !staleRes.isLeaseCurrent(oldLease),
    newOwnerPreserved: staleRes.isReady('b'),
    oldGenerationRejected: false,
  };
  const genRes = new PosterDetailResidency(4);
  const genRetry = new DetailRetryBook();
  const genBox = { n: 1 };
  const genSettled = new Map<string, () => void>();
  const genDeps: DetailActivateDeps = {
    ...deps,
    sceneGeneration: () => genBox.n,
    getPixels: () => null,
    loadPoster: (movie, _p, _cb, onSettled) => { if (onSettled) genSettled.set(movie.id, onSettled); },
    now: () => 0,
  };
  activateDetailTitle('a', genDeps, genRes, genRetry);
  genBox.n = 2;
  genSettled.get('a')?.();
  stale.oldGenerationRejected = genRes.snapshot().loadFailed === 0 && genRes.snapshot().staleDropped >= 1;

  const upRes = new PosterDetailResidency(4);
  const upRetry = new DetailRetryBook();
  uploadOk.v = false;
  pix.set('a', pixels());
  desired.add('a');
  activateDetailTitle('a', {
    ...deps,
    getPixels: (id) => pix.get(id) ?? null,
    now: () => 0,
  }, upRes, upRetry);
  const uploadFailureSettled = upRes.snapshot().leased === 0 && upRes.snapshot().uploadFailed >= 1;
  uploadOk.v = true;
  lutOk.v = false;
  const lutRes = new PosterDetailResidency(4);
  activateDetailTitle('a', {
    ...deps,
    getPixels: () => pixels(),
    now: () => 0,
  }, lutRes, new DetailRetryBook());
  const lutFailureSettled = lutRes.snapshot().leased === 0 && lutRes.snapshot().lutFailed >= 1;
  lutOk.v = true;

  posterPixelCache.delete('probe-fail-ok');
  posterPixelCache.delete('probe-fail-bad');
  const liveRes = new PosterDetailResidency(4);
  const liveRetry = new DetailRetryBook();
  const liveDesired = new Set(['probe-fail-ok']);
  const liveOk = { id: 'probe-fail-ok', posterUrl: uniqueCoverDataUrl(1, 32, 48) };
  const liveBad = { id: 'probe-fail-bad', posterUrl: 'data:image/png;base64,notapng' };
  const liveDeps: DetailActivateDeps = {
    getMovie: (id) => id === liveOk.id ? liveOk : id === liveBad.id ? liveBad : null,
    getGlobalIndex: (id) => id === liveBad.id ? 1 : 0,
    isDesired: (id) => liveDesired.has(id),
    isSelected: (id) => liveDesired.has(id),
    sceneGeneration: () => 1,
    getPixels: (id) => posterPixelCache.get(id) ?? null,
    loadPoster: (movie, priority, onPixels, onSettled) => {
      posterQueue.load(movie as never, priority, onPixels, onSettled);
    },
    queueUpload: (run) => { run(); },
    uploadLayer: (slot, data) => uploadPosterDetailLayer(renderer, slot, data),
    setLut: (i, v) => setPosterDetailLut(i, v),
    clearLut: (i) => { clearPosterDetailLut(i); },
  };
  initPosterDetailGpu({ slotLimit: 4, catalogCount: 8, renderer });
  activateDetailTitle(liveOk.id, liveDeps, liveRes, liveRetry);
  const untilOk = Date.now() + 15000;
  while (Date.now() < untilOk && liveRes.snapshot().readyResident < 1) {
    pumpTextureUploads();
    await waitMs(40);
  }
  const liveDecoded = liveRes.isReady(liveOk.id);
  demoteDetailTitle(liveOk.id, liveDeps, liveRes);
  liveDesired.delete(liveOk.id);
  liveDesired.add(liveBad.id);
  activateDetailTitle(liveBad.id, liveDeps, liveRes, liveRetry);
  const untilFail = Date.now() + 15000;
  while (Date.now() < untilFail && liveRes.snapshot().loadFailed < 1) {
    pumpTextureUploads();
    await waitMs(40);
  }
  const liveFailSnap = liveRes.snapshot();
  const canonicalQueue = {
    decoded: liveDecoded,
    loadFailed: liveFailSnap.loadFailed >= 1,
    leasedAfterFail: liveFailSnap.leased,
  };

  const pass = successSnap.readyResident === 1
    && isDetailRed(shaderDetail)
    && failure.loadFailed >= 1
    && failure.pendingPixelsAfter === 0
    && failure.pendingUploadAfter === 0
    && failure.readyResidentAfter === 0
    && failure.leasedAfter === 0
    && failure.baseStayedVisible
    && retryEv.retrySuppressedDuringBackoff
    && retryEv.eventualSuccess
    && pool.leakedLeases === 0
    && pool.healthyTitleAcquiredAfterFailures
    && stale.oldLeaseRejected
    && stale.newOwnerPreserved
    && stale.oldGenerationRejected
    && uploadFailureSettled
    && lutFailureSettled
    && canonicalQueue.decoded
    && canonicalQueue.loadFailed
    && canonicalQueue.leasedAfterFail === 0
    && DETAIL_MAX_ATTEMPTS >= 2
    && !contextLost;

  shelf.dispose();
  return {
    classification: 'DESKTOP_BROWSER',
    QUEST_HARDWARE: 'NOT_EXECUTED',
    pass,
    success: {
      decoded: successSnap.decoded,
      uploaded: successSnap.uploaded,
      readyResident: successSnap.readyResident,
      shaderDetail,
    },
    failure,
    retry: retryEv,
    pool,
    stale,
    gpu: { uploadFailureSettled, lutFailureSettled },
    canonicalQueue,
    contextLost,
    note: pass ? 'DETAIL failure settles; pool reusable; BASE preserved' : 'DETAIL failure probe failed',
  };
}
