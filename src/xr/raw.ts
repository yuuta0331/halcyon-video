// Diagnostic RAW WebXR control. No StoreScene, no THREE.WebXRManager.
// Authoritative XRWebGLLayer path for isolating browser/raw-WebXR failures.

import { applyXrEntryVisibility, xrEntryShouldShow } from './entry';
import { syncXrEntryLabels } from './boot';
import { immersiveVrRequestOptions, selectReferenceSpaceTypeFromFeatures } from './session-policy';
import { probeImmersiveVrSupported } from './session-policy';
import {
  attachContextJournal,
  installXrStartupJournal,
  appendXrJournal,
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

export interface RawXrDiagnostics {
  mode: 'RAW';
  sessionRequested: boolean;
  requestSessionStart: number | null;
  requestSessionEnd: number | null;
  requestSessionError: string | null;
  makeXRCompatibleStart: number | null;
  makeXRCompatibleEnd: number | null;
  makeXRCompatibleError: string | null;
  baseLayerSetAt: number | null;
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
}

const MAGENTA = [0.86, 0.08, 0.42, 1] as const;

const blank = (): RawXrDiagnostics => ({
  mode: 'RAW',
  sessionRequested: false,
  requestSessionStart: null,
  requestSessionEnd: null,
  requestSessionError: null,
  makeXRCompatibleStart: null,
  makeXRCompatibleEnd: null,
  makeXRCompatibleError: null,
  baseLayerSetAt: null,
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
});

let canvas: HTMLCanvasElement | null = null;
let gl: WebGL2RenderingContext | null = null;
let session: XRSession | null = null;
let refSpace: XRReferenceSpace | null = null;
let raf = 0;
let diag = blank();
let detachContext: (() => void) | null = null;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function publish(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __rawXrDiagnostics?: () => RawXrDiagnostics }).__rawXrDiagnostics =
    () => ({ ...diag });
  (window as unknown as { __xrDiagnostics?: () => unknown }).__xrDiagnostics = () => ({
    mode: 'RAW',
    raw: { ...diag },
    startup: {
      requestSessionStart: diag.requestSessionStart,
      requestSessionEnd: diag.requestSessionEnd,
      firstAnimationCallbackAt: diag.firstXrCallbackAt,
      firstDirectRenderStart: diag.firstRenderStart,
      firstDirectRenderEnd: diag.firstRenderEnd,
      firstWorldRenderCompletedAt: diag.firstWorldRenderCompletedAt,
      lastError: diag.lastError,
    },
    session: { phase: diag.presenting ? 'active' : 'idle', rendererPresenting: diag.presenting },
    flags: { ...readXrFlags(), raw: true },
  });
}

function onLost(): void {
  diag.contextLost = true;
  diag.lastError = 'webglcontextlost';
  appendXrJournal('context-lost', { contextLost: true });
  publish();
}

export async function enterRawXr(): Promise<void> {
  if (!gl || !canvas) throw new Error('raw XR GL missing');
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
  next.addEventListener('end', () => { void cleanupRawSession(); });
  next.addEventListener('visibilitychange', () => noteSessionVisibility(next));
  noteSessionVisibility(next);

  const bindings = probeXrBindingApis();
  diag.hasXRWebGLBinding = bindings.hasXRWebGLBinding;
  diag.hasCreateProjectionLayer = bindings.hasCreateProjectionLayer;

  diag.makeXRCompatibleStart = nowMs();
  appendXrJournal('makeXRCompatible-start');
  const compat = await ensureXrCompatible(gl);
  diag.makeXRCompatibleEnd = nowMs();
  diag.makeXRCompatibleError = compat.error;
  diag.xrCompatible = noteContextAttributes(gl).xrCompatible;
  appendXrJournal('makeXRCompatible-end', { makeXRCompatibleError: compat.error });

  const wanted = selectReferenceSpaceTypeFromFeatures(features);
  try {
    refSpace = await next.requestReferenceSpace(wanted);
    diag.referenceSpace = wanted;
  } catch {
    refSpace = await next.requestReferenceSpace('local');
    diag.referenceSpace = 'local';
  }
  appendXrJournal('reference-space', {}, { referenceSpace: diag.referenceSpace ?? 'none' });

  const layer = new XRWebGLLayer(next, gl);
  await next.updateRenderState({ baseLayer: layer });
  diag.baseLayerSetAt = nowMs();
  diag.compositorBackend = detectSessionCompositorBackend(next);
  appendXrJournal('baseLayer', { compositorBackend: diag.compositorBackend });

  const onFrame: XRFrameRequestCallback = (_time, frame) => {
    if (!session || !gl || !refSpace) return;
    raf = session.requestAnimationFrame(onFrame);
    if (diag.firstXrCallbackAt == null) {
      diag.firstXrCallbackAt = nowMs();
      appendXrJournal('first-xr-callback', { firstXrCallbackAt: diag.firstXrCallbackAt });
    }
    const pose = frame.getViewerPose(refSpace);
    const base = session.renderState.baseLayer;
    if (!pose || !base) return;
    diag.firstRenderStart ??= nowMs();
    gl.bindFramebuffer(gl.FRAMEBUFFER, base.framebuffer);
    gl.viewport(0, 0, base.framebufferWidth, base.framebufferHeight);
    gl.clearColor(MAGENTA[0], MAGENTA[1], MAGENTA[2], MAGENTA[3]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    diag.frameCount++;
    if (diag.firstRenderEnd == null) {
      diag.firstRenderEnd = nowMs();
      diag.firstWorldRenderCompletedAt = diag.firstRenderEnd;
      appendXrJournal('first-world-frame', { firstWorldFrameAt: diag.firstWorldRenderCompletedAt });
    }
    diag.presenting = true;
    publish();
  };
  raf = next.requestAnimationFrame(onFrame);
  diag.presenting = true;
  publish();
  syncXrEntryLabels(true);
}

export async function exitRawXr(): Promise<void> {
  if (session) {
    try { await session.end(); } catch { await cleanupRawSession(); }
  } else {
    await cleanupRawSession();
  }
}

async function cleanupRawSession(): Promise<void> {
  if (raf && session) {
    try { session.cancelAnimationFrame(raf); } catch { /* already ended */ }
  }
  raf = 0;
  session = null;
  refSpace = null;
  diag.presenting = false;
  appendXrJournal('session-end', { sessionEnded: true, phase: 'idle' });
  publish();
  syncXrEntryLabels(false);
}

export async function startRawXr(): Promise<void> {
  installXrStartupJournal('RAW');
  hideStoreChrome();
  canvas = document.createElement('canvas');
  canvas.id = 'raw-xr-canvas';
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;background:#15010a;';
  document.body.appendChild(canvas);
  gl = createXrCompatibleWebgl2(canvas);
  canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    onLost();
  });
  detachContext = attachContextJournal(canvas);
  noteContextAttributes(gl);
  const bindings = probeXrBindingApis();
  diag.hasXRWebGLBinding = bindings.hasXRWebGLBinding;
  diag.hasCreateProjectionLayer = bindings.hasCreateProjectionLayer;
  diag.xrCompatible = noteContextAttributes(gl).xrCompatible;
  gl.clearColor(MAGENTA[0], MAGENTA[1], MAGENTA[2], MAGENTA[3]);
  gl.clear(gl.COLOR_BUFFER_BIT);
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
  (window as unknown as { __rawXr?: unknown }).__rawXr = {
    enter: enterRawXr,
    exit: exitRawXr,
    presenting: () => diag.presenting,
    diagnostics: () => ({ ...diag }),
  };
  publish();
  void detachContext;
}

function hideStoreChrome(): void {
  document.getElementById('boot-overlay')?.classList.remove('visible');
  document.getElementById('hud-overlay')?.style.setProperty('display', 'none');
  const note = document.createElement('div');
  note.id = 'raw-xr-note';
  note.textContent = 'RAW WEBXR';
  note.style.cssText = 'position:fixed;top:12px;left:12px;z-index:40;color:#ff4fa3;font:14px sans-serif;';
  document.body.appendChild(note);
}

function wireEnterButtons(): void {
  const enter = async () => {
    try {
      if (diag.presenting) await exitRawXr();
      else await enterRawXr();
    } catch (err) {
      diag.lastError = err instanceof Error ? err.message : String(err);
      publish();
      console.warn('[XR] raw session failed:', err);
    }
  };
  document.getElementById('btn-enter-vr')?.addEventListener('click', () => { void enter(); });
  document.getElementById('xr-enter-btn')?.addEventListener('click', () => { void enter(); });
}

export function xrRawRequested(
  search: string = typeof location !== 'undefined' ? location.search : '',
): boolean {
  return readXrFlags(search).raw;
}
