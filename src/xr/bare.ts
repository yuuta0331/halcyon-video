// True bare XR control case. Bypasses StoreScene, catalog, posters, composer,
// AO, mirrors, probes, environment bake, and XR media/layers.

import * as THREE from 'three';
import { readXrFlags } from './flags';
import { bareXrRequestOptions, probeImmersiveVrSupported, selectReferenceSpaceTypeFromFeatures } from './session-policy';
import { trySetRuntimeFoveation } from './runtime-foveation';
import {
  attachContextLossDiagnostics,
  gpuDiagnosticsSnapshot,
  installGpuDiagnostics,
  recordResourceSnapshot,
  setGpuLiveState,
  setGpuXrMeta,
} from './gpu-diagnostics';
import { applyXrEntryVisibility, xrEntryShouldShow } from './entry';
import { syncXrEntryLabels } from './boot';
import {
  blankGpuCapabilities,
  readGpuCapabilities,
  readResourceFlags,
  setActiveResourceProfile,
  xrSafeProfile,
} from '../perf/resource-profile';
import { classifyXrEnvironment } from './classification';
import { isIwerActive } from './emu-state';
import { appendXrJournal, installXrStartupJournal } from './startup-journal';

export interface BareXrDiagnostics {
  bareSessionRequested: boolean;
  bareSetSessionStart: number | null;
  bareSetSessionEnd: number | null;
  firstXrCallbackAt: number | null;
  firstRendererRenderStart: number | null;
  firstRendererRenderEnd: number | null;
  firstWorldRenderCompletedAt: number | null;
  frameCount: number;
  contextLost: boolean;
  lastError: string | null;
  presenting: boolean;
  requestedOptionalFeatures: string[];
}

const blankBare = (): BareXrDiagnostics => ({
  bareSessionRequested: false,
  bareSetSessionStart: null,
  bareSetSessionEnd: null,
  firstXrCallbackAt: null,
  firstRendererRenderStart: null,
  firstRendererRenderEnd: null,
  firstWorldRenderCompletedAt: null,
  frameCount: 0,
  contextLost: false,
  lastError: null,
  presenting: false,
  requestedOptionalFeatures: [],
});

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let session: XRSession | null = null;
let diag = blankBare();
let detachContext: (() => void) | null = null;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function publish(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __bareXrDiagnostics?: () => BareXrDiagnostics }).__bareXrDiagnostics =
    () => ({ ...diag });
  (window as unknown as { __xrDiagnostics?: () => unknown }).__xrDiagnostics = () => ({
    classification: classifyXrEnvironment({
      hasWindow: true,
      immersiveVrSupported: true,
      iwerActive: isIwerActive(),
      nativeXrAvailable: !isIwerActive(),
      userAgent: navigator.userAgent,
    }),
    iwerEmulated: isIwerActive(),
    session: {
      phase: diag.presenting ? 'active' : diag.bareSessionRequested ? 'requesting' : 'idle',
      rendererPresenting: diag.presenting,
      sessionStartAt: diag.bareSetSessionStart,
    },
    startup: {
      requestSessionStart: diag.bareSessionRequested ? diag.bareSetSessionStart : null,
      rendererSetSessionStart: diag.bareSetSessionStart,
      rendererSetSessionEnd: diag.bareSetSessionEnd,
      firstAnimationCallbackAt: diag.firstXrCallbackAt,
      firstDirectRenderStart: diag.firstRendererRenderStart,
      firstDirectRenderEnd: diag.firstRendererRenderEnd,
      firstWorldRenderCompletedAt: diag.firstWorldRenderCompletedAt,
      lastError: diag.lastError,
    },
    flags: { ...readXrFlags(), bare: true },
    bare: { ...diag },
    gpu: gpuDiagnosticsSnapshot(),
  });
  setGpuXrMeta({
    classification: isIwerActive() ? 'IWER_EMULATED' : 'QUEST_HARDWARE',
    phase: diag.presenting ? 'active' : 'idle',
    frameCount: diag.frameCount,
    firstWorldRenderCompletedAt: diag.firstWorldRenderCompletedAt,
    lastError: diag.lastError,
  });
}

function buildScene(): void {
  const container = document.getElementById('canvas-container') ?? document.body;
  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setSize(container.clientWidth || window.innerWidth || 1280, container.clientHeight || window.innerHeight || 720);
  renderer.xr.enabled = true;
  renderer.shadowMap.enabled = false;
  if (import.meta.env.DEV) renderer.debug.checkShaderErrors = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const gl = renderer.getContext() as WebGL2RenderingContext;
  const caps = readGpuCapabilities({ gl: gl as never, maxTextures: renderer.capabilities.maxTextures });
  setActiveResourceProfile(xrSafeProfile(caps), caps);
  setGpuLiveState({
    renderer: renderer as never,
    composerAllocated: false,
    n8aoAllocated: false,
    gtaoAllocated: false,
    mirrorCount: 0,
    reflectionProbeCount: 0,
  });
  recordResourceSnapshot('renderer-created');
  detachContext = attachContextLossDiagnostics(renderer.domElement, () => !!renderer?.xr.isPresenting);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101418);
  camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  camera.position.set(0, 1.6, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1));
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshBasicMaterial({ color: 0x3d6b4f }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.4, 0.4),
    new THREE.MeshBasicMaterial({ color: 0xffcc66 }),
  );
  cube.position.set(0, 1.3, -1.4);
  cube.name = 'bare-marker';
  scene.add(cube);

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#f4f1ea';
  ctx.font = '22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BARE XR', 128, 32);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.22),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }),
  );
  label.position.set(0, 1.7, -1.35);
  scene.add(label);

  renderer.setAnimationLoop(null);
}

function glMaxArrayLayers(): number {
  try {
    const gl = renderer?.getContext() as WebGL2RenderingContext | undefined;
    const n = gl?.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
    if (typeof n === 'number' && n > 0) return Math.min(2048, n);
  } catch { /* ignore */ }
  return 256;
}

function layoutSnapshot(n: number) {
  return import('../perf/poster-bank-layout').then(({ choosePosterBankLayout, QUEST_SAFE_POSTER_GPU_BUDGET }) => {
    const layout = choosePosterBankLayout({
      uniqueTitles: n,
      maxArrayTextureLayers: glMaxArrayLayers(),
      gpuBudgetBytes: QUEST_SAFE_POSTER_GPU_BUDGET,
    });
    const resident = Math.min(n, layout.totalLayers);
    return { layout, resident };
  });
}

async function posterResourceProbe(n: number) {
  const { layout } = await layoutSnapshot(n);
  // Sequential IWER probes must not allocate multi-hundred-MB arrays; that
  // lost the WebGL context on 2000/4000-title GPU inits.
  if (layout.gpuBytesEstimated > 48 * 1024 * 1024) {
    return {
      catalogTitleCount: n,
      physicalSlots: layout.totalLayers,
      residentCount: 0,
      freeCount: layout.totalLayers,
      uniqueOwners: 0,
      residentHighWaterMark: 0,
      evictionCount: 0,
      acquisitionCount: 0,
      reacquisitionCount: 0,
      pinnedCount: 0,
      staleUploadDrops: 0,
      residencyInvariantOk: true,
      duplicatePhysicalOwners: 0,
      freeOwnedCollisions: 0,
      orphanMovieMappings: 0,
      orphanSlotMappings: 0,
      shelfWidth: layout.width,
      shelfHeight: layout.height,
      bankCount: layout.bankCount,
      layersPerBank: layout.layersPerBank,
      renderBatchCount: layout.renderBatchCount,
      samplersPerDraw: layout.samplersPerDraw,
      evictionWindow: false as const,
      cpuBytes: layout.cpuBytesEstimated,
      cpuBytesActive: layout.cpuBytesActive,
      cpuBytesAllocated: layout.cpuBytesAllocated,
      gpuBytes: layout.gpuBytesEstimated,
      dualArrays: false,
      skippedGpuAlloc: true,
      evidenceKind: 'PLANNING_ONLY',
      classification: 'SOFTWARE_PLANNING_TEST',
      capacityOk: layout.capacityOk,
    };
  }
  const { textureArrayManager } = await import('../poster-textures');
  textureArrayManager.init(n, renderer ?? undefined);
  textureArrayManager.resetBoundedWindowForProbe();
  return { ...textureArrayManager.memorySnapshot(), evidenceKind: 'REAL_GPU_ALLOCATION', skippedGpuAlloc: false };
}

async function posterResidencyProbe(n: number) {
  const { layout, resident } = await layoutSnapshot(n);
  if (layout.gpuBytesEstimated > 48 * 1024 * 1024) {
    return {
      catalogTitleCount: n,
      physicalSlots: layout.totalLayers,
      residentCount: resident,
      freeCount: layout.totalLayers - resident,
      uniqueOwners: resident,
      residentHighWaterMark: resident,
      evictionCount: 0,
      acquisitionCount: resident,
      reacquisitionCount: 0,
      pinnedCount: 0,
      staleUploadDrops: 0,
      residencyInvariantOk: true,
      duplicatePhysicalOwners: 0,
      freeOwnedCollisions: 0,
      orphanMovieMappings: 0,
      orphanSlotMappings: 0,
      shelfWidth: layout.width,
      shelfHeight: layout.height,
      bankCount: layout.bankCount,
      layersPerBank: layout.layersPerBank,
      evictionWindow: false as const,
      cpuBytes: layout.cpuBytesEstimated,
      gpuBytes: layout.gpuBytesEstimated,
      dualArrays: false,
      skippedGpuAlloc: true,
      evidenceKind: 'PLANNING_ONLY',
      classification: 'SOFTWARE_PLANNING_TEST',
      capacityOk: layout.capacityOk,
    };
  }
  const { textureArrayManager } = await import('../poster-textures');
  textureArrayManager.init(n, renderer ?? undefined);
  return { ...textureArrayManager.populateResidencyWindow(n), evidenceKind: 'REAL_GPU_ALLOCATION', skippedGpuAlloc: false };
}

async function posterWorkingSetProbe(n: number) {
  const { layout } = await layoutSnapshot(n);
  return {
    catalogTitles: n,
    physicalSlots: layout.totalLayers,
    desiredCount: n,
    p0Scheduled: n,
    p1Scheduled: 0,
    p1CandidateCount: 0,
    bankCount: layout.bankCount,
    layersPerBank: layout.layersPerBank,
    width: layout.width,
    height: layout.height,
    evictionWindow: layout.evictionWindow,
    cpuBytesEstimated: layout.cpuBytesEstimated,
    gpuBytesEstimated: layout.gpuBytesEstimated,
    qualityDropped: layout.qualityDropped,
    evidenceKind: 'PLANNING_ONLY',
    classification: 'SOFTWARE_PLANNING_TEST',
  };
}

async function posterCapacityPlan(titles: number, maxArrayTextureLayers: number) {
  const { choosePosterBankLayout, stablePosterMapping, QUEST_SAFE_POSTER_GPU_BUDGET } =
    await import('../perf/poster-bank-layout');
  const layout = choosePosterBankLayout({
    uniqueTitles: titles,
    maxArrayTextureLayers,
    gpuBudgetBytes: QUEST_SAFE_POSTER_GPU_BUDGET,
  });
  const ids = Array.from({ length: titles }, (_, i) => `plan-${i}`);
  const mapping = stablePosterMapping(ids, layout);
  const owners = new Set<string>();
  let duplicates = 0;
  for (const rec of mapping.values()) {
    const key = `${rec.bank}:${rec.layer}`;
    if (owners.has(key)) duplicates++;
    else owners.add(key);
  }
  return {
    name: titles === 4000 ? 'JP4A_CAPACITY_256_4000' : `JP4A_CAPACITY_${maxArrayTextureLayers}_${titles}`,
    classification: 'SOFTWARE_PLANNING_TEST',
    evidenceKind: 'PLANNING_ONLY',
    titles,
    maxArrayTextureLayers,
    bankCount: layout.bankCount,
    layersPerBank: layout.layersPerBank,
    renderBatchCount: layout.renderBatchCount,
    samplersPerDraw: layout.samplersPerDraw,
    actuallyRenderableTitles: mapping.size,
    logicalMappedTitles: mapping.size,
    expectedTitles: titles,
    capacityOk: layout.capacityOk && mapping.size === titles && duplicates === 0,
    evictionWindow: layout.evictionWindow,
    cpuBytesActive: layout.cpuBytesActive,
    cpuBytesAllocated: layout.cpuBytesAllocated,
    gpuBytesEstimated: layout.gpuBytesEstimated,
    width: layout.width,
    height: layout.height,
    duplicateOwners: duplicates,
  };
}

async function posterUniqueMultibankProbe() {
  if (!renderer) return { error: 'no renderer', evidenceKind: 'REAL_GPU_ALLOCATION' };
  const { runUniqueMultibankGpuProbe } = await import('../perf/poster-gpu-probe');
  return runUniqueMultibankGpuProbe(renderer, { titles: 24, maxArrayTextureLayers: 8 });
}

function onXrFrame(): void {
  if (!renderer || !scene || !camera) return;
  if (diag.firstXrCallbackAt == null) {
    diag.firstXrCallbackAt = nowMs();
    recordResourceSnapshot('first-XR-callback');
  }
  diag.frameCount++;
  diag.presenting = !!renderer.xr.isPresenting;
  if (renderer.xr.isPresenting) {
    if (diag.firstRendererRenderStart == null) diag.firstRendererRenderStart = nowMs();
    renderer.render(scene, camera);
    if (diag.firstRendererRenderEnd == null) {
      diag.firstRendererRenderEnd = nowMs();
      diag.firstWorldRenderCompletedAt = diag.firstRendererRenderEnd;
      recordResourceSnapshot('first-bare-render');
    }
    if (diag.frameCount === 10) recordResourceSnapshot('10-XR-frames');
  }
  publish();
}

export async function enterBareXr(): Promise<void> {
  if (!renderer || !camera) throw new Error('bare XR renderer missing');
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr) throw new Error('navigator.xr missing');
  diag.bareSessionRequested = true;
  recordResourceSnapshot('pre-requestSession');
  publish();
  const options = bareXrRequestOptions();
  diag.requestedOptionalFeatures = [...options.optionalFeatures];
  appendXrJournal('requestSession-start', {
    phase: 'requesting',
    requestedOptionalFeatures: options.optionalFeatures,
  }, { requestedOptionalFeatures: options.optionalFeatures.join(',') });
  let next: XRSession;
  try {
    next = await xr.requestSession('immersive-vr', options);
  } catch (err) {
    diag.lastError = err instanceof Error ? err.message : String(err);
    publish();
    throw err;
  }
  recordResourceSnapshot('requestSession-resolved');
  session = next;
  next.addEventListener('end', () => { void cleanupBareSession(); });
  const features = Array.from((next as XRSession & { enabledFeatures?: ReadonlyArray<string> }).enabledFeatures ?? []);
  const space = selectReferenceSpaceTypeFromFeatures(features);
  const xrMgr = renderer.xr;
  xrMgr.enabled = true;
  xrMgr.setReferenceSpaceType(space);
  xrMgr.setFramebufferScaleFactor(0.5);
  recordResourceSnapshot('pre-setSession');
  diag.bareSetSessionStart = nowMs();
  try {
    await xrMgr.setSession(next);
  } catch (err) {
    diag.lastError = err instanceof Error ? err.message : String(err);
    publish();
    throw err;
  }
  diag.bareSetSessionEnd = nowMs();
  trySetRuntimeFoveation(xrMgr, 1);
  renderer.setAnimationLoop(onXrFrame);
  diag.presenting = true;
  recordResourceSnapshot('setSession-resolved');
  publish();
  syncXrEntryLabels(true);
}

export async function exitBareXr(): Promise<void> {
  if (session) {
    try { await session.end(); } catch { await cleanupBareSession(); }
  } else {
    await cleanupBareSession();
  }
}

async function cleanupBareSession(): Promise<void> {
  if (renderer) renderer.setAnimationLoop(null);
  session = null;
  diag.presenting = false;
  recordResourceSnapshot('XR-exit');
  publish();
  syncXrEntryLabels(false);
}

export async function startBareXr(): Promise<void> {
  installXrStartupJournal('BARE');
  installGpuDiagnostics();
  setActiveResourceProfile(xrSafeProfile(blankGpuCapabilities()), blankGpuCapabilities());
  hideStoreChrome();
  buildScene();
  const supported = await probeImmersiveVrSupported({
    isTauri: !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
    xr: (navigator as Navigator & { xr?: XRSystem }).xr ?? null,
  });
  const show = xrEntryShouldShow({
    isTauri: !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
    immersiveVrSupported: supported,
  });
  applyXrEntryVisibility(show, false);
  syncXrEntryLabels(false);
  wireEnterButtons();
  (window as unknown as { __bareXr?: unknown }).__bareXr = {
    enter: enterBareXr,
    exit: exitBareXr,
    presenting: () => diag.presenting,
    diagnostics: () => ({ ...diag }),
  };
  (window as unknown as { __posterResourceProbe?: (n: number) => Promise<unknown> }).__posterResourceProbe =
    posterResourceProbe;
  (window as unknown as { __posterResidencyProbe?: (n: number) => Promise<unknown> }).__posterResidencyProbe =
    posterResidencyProbe;
  (window as unknown as { __posterWorkingSetProbe?: (n: number) => Promise<unknown> }).__posterWorkingSetProbe =
    posterWorkingSetProbe;
  (window as unknown as {
    __posterCapacityPlan?: (titles: number, maxArrayTextureLayers: number) => Promise<unknown>;
  }).__posterCapacityPlan = posterCapacityPlan;
  (window as unknown as { __posterUniqueMultibankProbe?: () => Promise<unknown> }).__posterUniqueMultibankProbe =
    posterUniqueMultibankProbe;
  publish();
}

function hideStoreChrome(): void {
  document.getElementById('boot-overlay')?.classList.remove('visible');
  document.getElementById('hud-overlay')?.style.setProperty('display', 'none');
  const note = document.createElement('div');
  note.id = 'bare-xr-note';
  note.textContent = 'BARE XR';
  note.style.cssText = 'position:fixed;top:12px;left:12px;z-index:40;color:#f4f1ea;font:14px sans-serif;';
  document.body.appendChild(note);
}

function wireEnterButtons(): void {
  const enter = async () => {
    try {
      if (diag.presenting) await exitBareXr();
      else await enterBareXr();
    } catch (err) {
      diag.lastError = err instanceof Error ? err.message : String(err);
      publish();
      console.warn('[XR] bare session failed:', err);
    }
  };
  document.getElementById('btn-enter-vr')?.addEventListener('click', () => { void enter(); });
  document.getElementById('xr-enter-btn')?.addEventListener('click', () => { void enter(); });
}

export function xrBareRequested(
  search: string = typeof location !== 'undefined' ? location.search : '',
): boolean {
  return readResourceFlags(search).bare;
}

void detachContext;
