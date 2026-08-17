// DESKTOP_BROWSER production DETAIL activation + shader sampling proof.
// Not Quest hardware. Distinguishes BASE vs DETAIL by readback color.

import * as THREE from 'three';
import { uniqueCoverDataUrl, uniqueCoverRgb } from './synthetic-cover';
import { XR_SAFE_POSTER_SAMPLE_GLSL } from '../poster-shader';
import { posterPixelCache, posterQueue } from '../video-case';
import { pumpTextureUploads } from '../poster-textures';
import { PosterDetailResidency } from '../poster-detail-residency';
import {
  clearPosterDetailLut,
  disposePosterDetailGpu,
  getPosterDetailArray,
  getPosterDetailLut,
  getPosterDetailLutLayout,
  initPosterDetailGpu,
  readPosterDetailLut,
  setPosterDetailLut,
  uploadPosterDetailLayer,
} from '../poster-detail-gpu';
import { activateDetailTitle, demoteDetailTitle, type DetailActivateDeps } from '../poster-detail-activate';

export interface PosterDetailActivationProbeResult {
  classification: 'DESKTOP_BROWSER';
  QUEST_HARDWARE: 'NOT_EXECUTED';
  pass: boolean;
  decoded: number;
  uploaded: number;
  readyResident: number;
  leased: number;
  pendingPixels: number;
  requested: number;
  staleDropped: number;
  detailWidth: number;
  detailHeight: number;
  lutCapacity: number;
  lutOk: boolean;
  index2049Ready: boolean;
  missReachedReady: boolean;
  hitReachedReady: boolean;
  shaderBase: number[];
  shaderDetail: number[];
  shaderRestored: number[];
  shader2049: number[];
  staleRejected: boolean;
  blankBetween: boolean;
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

function isBlank(p: number[]): boolean {
  return p[0]! < 8 && p[1]! < 8 && p[2]! < 8;
}

function readCenter(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget): number[] {
  const buf = new Uint8Array(4);
  renderer.readRenderTargetPixels(rt, Math.floor(rt.width / 2), Math.floor(rt.height / 2), 1, 1, buf);
  return [buf[0]!, buf[1]!, buf[2]!, buf[3]!];
}

function makeShelfArray(rgb: readonly number[]): THREE.DataArrayTexture {
  const data = solid(8, 12, rgb);
  const tex = new THREE.DataArrayTexture(data, 8, 12, 1);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function sampleProduction(
  renderer: THREE.WebGLRenderer,
  shelf: THREE.DataArrayTexture,
  index: number,
): number[] {
  const layout = getPosterDetailLutLayout();
  const rt = new THREE.WebGLRenderTarget(32, 32, {
    depthBuffer: false,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
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
      uIndex: { value: index },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      ${XR_SAFE_POSTER_SAMPLE_GLSL}
      varying vec2 vUv;
      uniform float uIndex;
      void main() {
        vec2 ddx = dFdx(vUv);
        vec2 ddy = dFdy(vUv);
        gl_FragColor = samplePosterBank(false, vUv, uIndex, ddx, ddy);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  scene.add(mesh);
  const prev = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    return readCenter(renderer, rt);
  } finally {
    renderer.setRenderTarget(prev);
    rt.dispose();
    mesh.geometry.dispose();
    mat.dispose();
  }
}

async function waitMs(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function syncDeps(
  renderer: THREE.WebGLRenderer,
  pixels: Map<string, Uint8Array>,
  movies: Map<string, { id: string; posterUrl?: string }>,
  desired: Set<string>,
  selected: string | null,
  gen: { n: number },
  loads: string[],
  delayed: Map<string, (p: Uint8Array) => void>,
): DetailActivateDeps {
  return {
    getMovie: (id) => movies.get(id) ?? null,
    getGlobalIndex: (id) => (id === 't2049' ? 2049 : id === 'b' ? 1 : 0),
    isDesired: (id) => desired.has(id),
    isSelected: (id) => selected === id,
    sceneGeneration: () => gen.n,
    getPixels: (id) => pixels.get(id) ?? null,
    loadPoster: (movie, _priority, onPixels) => {
      loads.push(movie.id);
      delayed.set(movie.id, onPixels);
    },
    queueUpload: (run) => { run(); },
    uploadLayer: (slot, data) => uploadPosterDetailLayer(renderer, slot, data),
    setLut: (i, v) => setPosterDetailLut(i, v),
    clearLut: (i) => { clearPosterDetailLut(i); },
  };
}

export async function runPosterDetailActivationProbe(
  renderer: THREE.WebGLRenderer,
): Promise<PosterDetailActivationProbeResult> {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const contextLost = typeof gl.isContextLost === 'function' && gl.isContextLost();
  const fail = (note: string, extra: Partial<PosterDetailActivationProbeResult> = {}): PosterDetailActivationProbeResult => ({
    classification: 'DESKTOP_BROWSER',
    QUEST_HARDWARE: 'NOT_EXECUTED',
    pass: false,
    decoded: 0, uploaded: 0, readyResident: 0, leased: 0, pendingPixels: 0, requested: 0, staleDropped: 0,
    detailWidth: 320, detailHeight: 480, lutCapacity: 0, lutOk: false,
    index2049Ready: false, missReachedReady: false, hitReachedReady: false,
    shaderBase: [0, 0, 0, 0], shaderDetail: [0, 0, 0, 0], shaderRestored: [0, 0, 0, 0], shader2049: [0, 0, 0, 0],
    staleRejected: false, blankBetween: false, contextLost, note, ...extra,
  });
  if (contextLost) return fail('context lost');

  const shelf = makeShelfArray(BASE);
  const plan = initPosterDetailGpu({
    slotLimit: 64,
    catalogCount: 4000,
    renderer,
  });
  if (!plan.ok || plan.capacity < 4000) {
    disposePosterDetailGpu();
    shelf.dispose();
    return fail('lut plan failed', { lutOk: plan.ok, lutCapacity: plan.capacity });
  }

  const magenta = solid(320, 480, uniqueCoverRgb(0));
  uploadPosterDetailLayer(renderer, 0, magenta);
  setPosterDetailLut(0, 0);
  const shaderBase = sampleProduction(renderer, shelf, 0);
  setPosterDetailLut(0, 1);
  const shaderDetail = sampleProduction(renderer, shelf, 0);
  setPosterDetailLut(0, 0);
  const shaderRestored = sampleProduction(renderer, shelf, 0);
  const mid = sampleProduction(renderer, shelf, 0);
  setPosterDetailLut(2049, 1);
  const shader2049 = sampleProduction(renderer, shelf, 2049);
  clearPosterDetailLut(2049);
  const index2049Ready = isDetailRed(shader2049) && readPosterDetailLut(2049) === 0;

  const residency = new PosterDetailResidency(4);
  const pixels = new Map<string, Uint8Array>();
  const movies = new Map<string, { id: string; posterUrl?: string }>([
    ['a', { id: 'a', posterUrl: uniqueCoverDataUrl(0) }],
    ['b', { id: 'b', posterUrl: uniqueCoverDataUrl(1) }],
  ]);
  const desired = new Set<string>(['a']);
  const gen = { n: storeGen(1) };
  const loads: string[] = [];
  const delayed = new Map<string, (p: Uint8Array) => void>();
  const deps = syncDeps(renderer, pixels, movies, desired, 'a', gen, loads, delayed);

  initPosterDetailGpu({ slotLimit: 4, catalogCount: 8, renderer });
  activateDetailTitle('a', deps, residency);
  const pending = residency.snapshot();
  const missPending = pending.pendingPixels === 1 && pending.readyResident === 0 && loads.length === 1;
  delayed.get('a')?.(magenta);
  const afterMiss = residency.snapshot();
  const missReachedReady = afterMiss.readyResident === 1 && afterMiss.uploaded >= 1 && afterMiss.decoded >= 1;

  pixels.set('b', magenta);
  desired.add('b');
  activateDetailTitle('b', deps, residency);
  const afterHit = residency.snapshot();
  const hitReachedReady = afterHit.readyResident >= 1 && residency.isReady('b');

  // Stale: A pending, slot reused by B, A callback must not upload over B.
  const staleRes = new PosterDetailResidency(1);
  const staleDesired = new Set<string>(['a']);
  const staleLoads: string[] = [];
  const staleDelayed = new Map<string, (p: Uint8Array) => void>();
  const stalePixels = new Map<string, Uint8Array>();
  const staleDeps = syncDeps(renderer, stalePixels, movies, staleDesired, null, gen, staleLoads, staleDelayed);
  initPosterDetailGpu({ slotLimit: 1, catalogCount: 8, renderer });
  activateDetailTitle('a', staleDeps, staleRes);
  const aLease = staleRes.peek('a')!;
  staleDesired.delete('a');
  demoteDetailTitle('a', staleDeps, staleRes);
  staleDesired.add('b');
  stalePixels.set('b', magenta);
  activateDetailTitle('b', staleDeps, staleRes);
  staleDelayed.get('a')?.(solid(320, 480, [0, 255, 0]));
  const staleRejected = !staleRes.isLeaseCurrent(aLease) && staleRes.isReady('b') && readPosterDetailLut(1) !== 0;

  // Production miss via posterQueue (real decode) on a synthetic data URL.
  posterPixelCache.delete('probe-detail-a');
  const liveRes = new PosterDetailResidency(4);
  let liveGen = { n: 7 };
  const liveDesired = new Set(['probe-detail-a']);
  const liveMovie = { id: 'probe-detail-a', posterUrl: uniqueCoverDataUrl(0, 32, 48) };
  const liveDeps: DetailActivateDeps = {
    getMovie: (id) => id === liveMovie.id ? liveMovie : null,
    getGlobalIndex: () => 0,
    isDesired: (id) => liveDesired.has(id),
    isSelected: (id) => id === liveMovie.id,
    sceneGeneration: () => liveGen.n,
    getPixels: (id) => posterPixelCache.get(id) ?? null,
    loadPoster: (movie, priority, onPixels) => posterQueue.load(movie as never, priority, onPixels),
    queueUpload: (run) => { run(); },
    uploadLayer: (slot, data) => uploadPosterDetailLayer(renderer, slot, data),
    setLut: (i, v) => setPosterDetailLut(i, v),
    clearLut: (i) => { clearPosterDetailLut(i); },
  };
  initPosterDetailGpu({ slotLimit: 4, catalogCount: 8, renderer });
  activateDetailTitle(liveMovie.id, liveDeps, liveRes);
  const until = Date.now() + 15000;
  while (Date.now() < until && liveRes.snapshot().readyResident < 1) {
    pumpTextureUploads();
    await waitMs(40);
  }
  const liveSnap = liveRes.snapshot();

  const blankBetween = isBlank(shaderBase) || isBlank(shaderDetail) || isBlank(shaderRestored) || isBlank(mid);
  const pass = plan.ok
    && isCyan(shaderBase)
    && isDetailRed(shaderDetail)
    && isCyan(shaderRestored)
    && !blankBetween
    && index2049Ready
    && missPending
    && missReachedReady
    && hitReachedReady
    && staleRejected
    && liveSnap.decoded > 0
    && liveSnap.uploaded > 0
    && liveSnap.readyResident > 0
    && !contextLost;

  shelf.dispose();
  return {
    classification: 'DESKTOP_BROWSER',
    QUEST_HARDWARE: 'NOT_EXECUTED',
    pass,
    decoded: liveSnap.decoded,
    uploaded: liveSnap.uploaded,
    readyResident: liveSnap.readyResident,
    leased: liveSnap.leased,
    pendingPixels: liveSnap.pendingPixels,
    requested: liveSnap.requested,
    staleDropped: liveSnap.staleDropped + staleRes.snapshot().staleDropped,
    detailWidth: 320,
    detailHeight: 480,
    lutCapacity: plan.capacity,
    lutOk: plan.ok,
    index2049Ready,
    missReachedReady,
    hitReachedReady,
    shaderBase,
    shaderDetail,
    shaderRestored,
    shader2049,
    staleRejected,
    blankBetween,
    contextLost,
    note: pass ? 'production DETAIL sampled; BASE fallback restored' : 'DETAIL activation proof failed',
  };
}

function storeGen(n: number): number {
  return n;
}

export function publishPosterDetailActivationProbe(renderer: THREE.WebGLRenderer): void {
  const w = window as unknown as {
    __posterDetailActivationProbe?: () => Promise<PosterDetailActivationProbeResult>;
  };
  w.__posterDetailActivationProbe = () => runPosterDetailActivationProbe(renderer);
}
