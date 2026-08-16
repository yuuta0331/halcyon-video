// Diagnostic Three.js native WebXR baseline. Official Meta/Three pattern:
// tiny scene, setAnimationLoop before entry, immediate setSession.
// No StoreScene, no Halcyon XrLayerManager, no posters, no frame-rate change.

import * as THREE from 'three';
import { applyXrEntryVisibility, xrEntryShouldShow } from './entry';
import { syncXrEntryLabels } from './boot';
import { immersiveVrRequestOptions, probeImmersiveVrSupported, selectReferenceSpaceTypeFromFeatures } from './session-policy';
import {
  appendXrJournal,
  attachContextJournal,
  installXrStartupJournal,
  noteContextAttributes,
  noteSessionVisibility,
} from './startup-journal';
import {
  createXrCompatibleWebgl2,
  detectSessionCompositorBackend,
  ensureXrCompatible,
  probeXrBindingApis,
} from './gl-compat';
import { readXrFlags } from './flags';

export interface ThreeBaselineDiagnostics {
  mode: 'THREE_BASELINE';
  sessionRequested: boolean;
  requestSessionStart: number | null;
  requestSessionEnd: number | null;
  requestSessionError: string | null;
  makeXRCompatibleStart: number | null;
  makeXRCompatibleEnd: number | null;
  makeXRCompatibleError: string | null;
  setSessionStart: number | null;
  setSessionEnd: number | null;
  setSessionError: string | null;
  firstXrCallbackAt: number | null;
  firstRenderStart: number | null;
  firstRenderEnd: number | null;
  firstWorldRenderCompletedAt: number | null;
  frameCount: number;
  contextLost: boolean;
  lastError: string | null;
  presenting: boolean;
  referenceSpace: string | null;
  enabledFeatures: string[];
  xrCompatible: boolean | null;
  hasXRWebGLBinding: boolean;
  hasCreateProjectionLayer: boolean;
  compositorBackend: 'projection-layer' | 'xr-webgl-layer' | 'unknown';
  usedExplicitXrCompatibleContext: boolean;
}

const blank = (): ThreeBaselineDiagnostics => ({
  mode: 'THREE_BASELINE',
  sessionRequested: false,
  requestSessionStart: null,
  requestSessionEnd: null,
  requestSessionError: null,
  makeXRCompatibleStart: null,
  makeXRCompatibleEnd: null,
  makeXRCompatibleError: null,
  setSessionStart: null,
  setSessionEnd: null,
  setSessionError: null,
  firstXrCallbackAt: null,
  firstRenderStart: null,
  firstRenderEnd: null,
  firstWorldRenderCompletedAt: null,
  frameCount: 0,
  contextLost: false,
  lastError: null,
  presenting: false,
  referenceSpace: null,
  enabledFeatures: [],
  xrCompatible: null,
  hasXRWebGLBinding: false,
  hasCreateProjectionLayer: false,
  compositorBackend: 'unknown',
  usedExplicitXrCompatibleContext: true,
});

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let session: XRSession | null = null;
let diag = blank();
let gl: WebGL2RenderingContext | null = null;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function publish(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __threeBaselineDiagnostics?: () => ThreeBaselineDiagnostics }).__threeBaselineDiagnostics =
    () => ({ ...diag });
  (window as unknown as { __xrDiagnostics?: () => unknown }).__xrDiagnostics = () => ({
    mode: 'THREE_BASELINE',
    threeBaseline: { ...diag },
    startup: {
      requestSessionStart: diag.requestSessionStart,
      requestSessionEnd: diag.requestSessionEnd,
      rendererSetSessionStart: diag.setSessionStart,
      rendererSetSessionEnd: diag.setSessionEnd,
      firstAnimationCallbackAt: diag.firstXrCallbackAt,
      firstDirectRenderStart: diag.firstRenderStart,
      firstDirectRenderEnd: diag.firstRenderEnd,
      firstWorldRenderCompletedAt: diag.firstWorldRenderCompletedAt,
      lastError: diag.lastError,
    },
    session: { phase: diag.presenting ? 'active' : 'idle', rendererPresenting: diag.presenting },
    flags: { ...readXrFlags(), threeBaseline: true },
  });
}

function onFrame(): void {
  if (!renderer || !scene || !camera) return;
  if (diag.firstXrCallbackAt == null && renderer.xr.isPresenting) {
    diag.firstXrCallbackAt = nowMs();
    appendXrJournal('first-xr-callback', { firstXrCallbackAt: diag.firstXrCallbackAt });
  }
  if (renderer.xr.isPresenting) {
    diag.firstRenderStart ??= nowMs();
    diag.frameCount++;
  }
  renderer.render(scene, camera);
  if (renderer.xr.isPresenting && diag.firstRenderEnd == null) {
    diag.firstRenderEnd = nowMs();
    diag.firstWorldRenderCompletedAt = diag.firstRenderEnd;
    diag.compositorBackend = detectSessionCompositorBackend(session);
    appendXrJournal('first-world-frame', {
      firstWorldFrameAt: diag.firstWorldRenderCompletedAt,
      compositorBackend: diag.compositorBackend,
    });
  }
  diag.presenting = !!renderer.xr.isPresenting;
  publish();
}

export async function enterThreeBaseline(): Promise<void> {
  if (!renderer || !gl) throw new Error('three baseline renderer missing');
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr) throw new Error('navigator.xr missing');
  diag.sessionRequested = true;
  diag.requestSessionStart = nowMs();
  appendXrJournal('requestSession-start', { phase: 'requesting' });
  publish();
  let next: XRSession;
  try {
    next = await xr.requestSession('immersive-vr', immersiveVrRequestOptions({
      layers: false,
      foveation: false,
    }));
  } catch (err) {
    diag.requestSessionError = err instanceof Error ? err.message : String(err);
    diag.lastError = diag.requestSessionError;
    appendXrJournal('requestSession-error', { requestSessionError: diag.lastError });
    publish();
    throw err;
  }
  diag.requestSessionEnd = nowMs();
  const features = Array.from((next as XRSession & { enabledFeatures?: ReadonlyArray<string> }).enabledFeatures ?? []);
  diag.enabledFeatures = features;
  appendXrJournal('requestSession-end', { enabledFeatures: features, phase: 'binding' });
  session = next;
  next.addEventListener('end', () => { void cleanupThreeBaseline(); });
  next.addEventListener('visibilitychange', () => noteSessionVisibility(next));
  noteSessionVisibility(next);

  const space = selectReferenceSpaceTypeFromFeatures(features);
  diag.referenceSpace = space;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType(space);

  diag.makeXRCompatibleStart = nowMs();
  appendXrJournal('makeXRCompatible-start');
  const compat = await ensureXrCompatible(gl);
  diag.makeXRCompatibleEnd = nowMs();
  diag.makeXRCompatibleError = compat.error;
  diag.xrCompatible = noteContextAttributes(gl).xrCompatible;
  appendXrJournal('makeXRCompatible-end', { makeXRCompatibleError: compat.error });

  const bindings = probeXrBindingApis();
  diag.hasXRWebGLBinding = bindings.hasXRWebGLBinding;
  diag.hasCreateProjectionLayer = bindings.hasCreateProjectionLayer;

  diag.setSessionStart = nowMs();
  appendXrJournal('setSession-start');
  try {
    await renderer.xr.setSession(next);
  } catch (err) {
    diag.setSessionError = err instanceof Error ? err.message : String(err);
    diag.lastError = diag.setSessionError;
    appendXrJournal('setSession-error', { setSessionError: diag.lastError });
    publish();
    throw err;
  }
  diag.setSessionEnd = nowMs();
  diag.compositorBackend = detectSessionCompositorBackend(next);
  diag.presenting = true;
  appendXrJournal('setSession-end', { compositorBackend: diag.compositorBackend, phase: 'active' });
  publish();
  syncXrEntryLabels(true);
}

export async function exitThreeBaseline(): Promise<void> {
  if (session) {
    try { await session.end(); } catch { await cleanupThreeBaseline(); }
  } else {
    await cleanupThreeBaseline();
  }
}

async function cleanupThreeBaseline(): Promise<void> {
  session = null;
  diag.presenting = false;
  appendXrJournal('session-end', { sessionEnded: true, phase: 'idle' });
  publish();
  syncXrEntryLabels(false);
}

export async function startThreeBaseline(): Promise<void> {
  installXrStartupJournal('THREE_BASELINE');
  hideStoreChrome();
  const canvas = document.createElement('canvas');
  canvas.id = 'three-baseline-canvas';
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;';
  document.body.appendChild(canvas);
  gl = createXrCompatibleWebgl2(canvas);
  attachContextJournal(canvas);
  noteContextAttributes(gl);
  renderer = new THREE.WebGLRenderer({
    canvas,
    context: gl,
    antialias: false,
    alpha: false,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x102030);
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 100);
  camera.position.set(0, 1.6, 2);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshBasicMaterial({ color: 0x2a4a3a }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.4, 0.4),
    new THREE.MeshBasicMaterial({ color: 0x3aa0ff }),
  );
  cube.position.set(0, 1.3, -1.2);
  scene.add(cube);
  renderer.setAnimationLoop(onFrame);
  const bindings = probeXrBindingApis();
  diag.hasXRWebGLBinding = bindings.hasXRWebGLBinding;
  diag.hasCreateProjectionLayer = bindings.hasCreateProjectionLayer;
  diag.xrCompatible = noteContextAttributes(gl).xrCompatible;
  const supported = await probeImmersiveVrSupported({
    isTauri: !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
    xr: (navigator as Navigator & { xr?: XRSystem }).xr ?? null,
  });
  applyXrEntryVisibility(xrEntryShouldShow({
    isTauri: !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
    immersiveVrSupported: supported,
  }), false);
  syncXrEntryLabels(false);
  wireEnterButtons();
  (window as unknown as { __threeBaseline?: unknown }).__threeBaseline = {
    enter: enterThreeBaseline,
    exit: exitThreeBaseline,
    presenting: () => diag.presenting,
    diagnostics: () => ({ ...diag }),
  };
  publish();
}

function hideStoreChrome(): void {
  document.getElementById('boot-overlay')?.classList.remove('visible');
  document.getElementById('hud-overlay')?.style.setProperty('display', 'none');
  const note = document.createElement('div');
  note.id = 'three-baseline-note';
  note.textContent = 'THREE BASELINE';
  note.style.cssText = 'position:fixed;top:12px;left:12px;z-index:40;color:#7ec8ff;font:14px sans-serif;';
  document.body.appendChild(note);
}

function wireEnterButtons(): void {
  const enter = async () => {
    try {
      if (diag.presenting) await exitThreeBaseline();
      else await enterThreeBaseline();
    } catch (err) {
      diag.lastError = err instanceof Error ? err.message : String(err);
      publish();
      console.warn('[XR] three baseline session failed:', err);
    }
  };
  document.getElementById('btn-enter-vr')?.addEventListener('click', () => { void enter(); });
  document.getElementById('xr-enter-btn')?.addEventListener('click', () => { void enter(); });
}

export function xrThreeBaselineRequested(
  search: string = typeof location !== 'undefined' ? location.search : '',
): boolean {
  return readXrFlags(search).threeBaseline;
}
