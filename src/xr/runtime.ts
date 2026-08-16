// XR runtime orchestrator. StoreScene holds one instance and forwards
// renderer/camera/scene plus walk collision. This file is the only place
// that talks to navigator.xr / renderer.xr.

import * as THREE from 'three';
import {
  getPlatform,
  setXrSessionActive,
} from '../platform';
import { WALK_INTERACT_RANGE } from '../store-walk';
import type { MovieSlot } from '../store-layout';
import type { XrDiagnostics, XrSessionPhase, WalkCollisionFn } from './types';
import {
  halcyonInitialXrRequestOptions,
  pickXrTargetHz,
  probeImmersiveVrSupported,
  selectReferenceSpaceTypeFromFeatures,
  XR_TARGET_HZ,
} from './session-policy';
import { trySetRuntimeFoveation } from './runtime-foveation';
import {
  competingLoops,
  initialFrameScheduler,
  reduceFrameScheduler,
  shouldSelfScheduleRaf,
  shouldUseSetAnimationLoop,
  type FrameSchedulerState,
} from './loop';
import { xrQualityPolicy } from './quality';
import {
  applyRigLocomotion,
  initialSnapTurnState,
  stepLocomotion,
  xrHeadBobAmount,
  type SnapTurnState,
} from './locomotion';
import {
  detectLayerCapabilities,
  probeLayerApis,
  XrLayerManager,
} from './layers';
import { XrPlayerRig } from './player-rig';
import {
  emptyControllerSnapshot,
  ignoreHandTrackingSource,
  makeControllerRay,
  makeGripMarker,
  readXrGamepadStick,
  targetRayFromController,
  type XrControllerSnapshot,
} from './input';
import { XrHelpPanel, xrPanelContent } from './panel';
import { createMediaQuadLayer, planMediaLayer, xrMediaLayerFlag, type XrMediaBindingLike } from './media';
import { readXrFlags, type XrRuntimeFlags } from './flags';
import { classifyXrEnvironment } from './classification';
import { isIwerActive } from './emu-state';
import { blankXrDiagnostics, mergeSessionDiagnostics } from './diagnostics';
import {
  blankStartupTrace,
  canExitPhase,
  markStartupStage,
  recordStartupError,
  sessionReadyForOptionalLayers,
  startupAborted,
  type XrStartupTrace,
} from './session-lifecycle';
import { shouldInitOptionalCompositor } from './compositor-policy';
import { withRestoredGlTextureState, pixelStorei } from './gl-state';
import { setXrUploadMotion, setXrUploadPresenting } from '../perf/upload-policy';
import { activeResourceProfile } from '../perf/resource-profile';
import { createXrBootScene, disposeXrBootScene, XR_BOOT_STABLE_FRAMES } from './boot-scene';
import {
  recordResourceSnapshot,
  setGpuXrMeta,
} from './gpu-diagnostics';
import {
  detectSessionCompositorBackend,
  ensureXrCompatible,
  probeXrBindingApis,
} from './gl-compat';
import {
  appendXrJournal,
  installXrStartupJournal,
  noteContextAttributes,
  noteSessionVisibility,
} from './startup-journal';

export interface XrRuntimeHost {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  collide: WalkCollisionFn;
  getStoreWidth: () => number;
  getBackWallZ: () => number;
  pickSlot: (origin: THREE.Vector3, direction: THREE.Vector3, maxDist: number) => MovieSlot | null;
  onSelectSlot: (slot: MovieSlot) => void;
  onConsole: (msg: string, type: 'system' | 'cec' | 'video') => void;
  getVideoElement?: () => HTMLVideoElement | null;
  requestRender: () => void;
  onSessionChange?: (presenting: boolean) => void;
  onLocomotionTick?: () => void;
  setXrAnimationLoop: (enabled: boolean) => void;
  claimRenderLoop: () => void;
}

type XrManager = THREE.WebGLRenderer['xr'];

export class XrRuntime {
  phase: XrSessionPhase = 'idle';
  immersiveVrSupported = false;
  scheduler: FrameSchedulerState = initialFrameScheduler();
  diagnostics: XrDiagnostics;
  controllers: XrControllerSnapshot = emptyControllerSnapshot();

  private rig: XrPlayerRig | null = null;
  private panel: XrHelpPanel | null = null;
  private layers: XrLayerManager | null = null;
  private snap: SnapTurnState = initialSnapTurnState();
  private desktopPose: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    parent: THREE.Object3D | null;
  } | null = null;
  private session: XRSession | null = null;
  private onSessionEnd = (): void => { void this.cleanupAfterEnd(); };
  private onSelectStart = (event: { target?: THREE.Object3D }) => {
    this.handleSelect(event.target ?? null);
  };
  private controllerObjects: THREE.Object3D[] = [];
  private gripObjects: THREE.Object3D[] = [];
  private rayScratch = { origin: new THREE.Vector3(), direction: new THREE.Vector3() };
  private lastCompositor: 'layer' | 'mesh-fallback' = 'mesh-fallback';
  private mediaBound = false;
  private mediaBlocker: string | null = null;
  private targetHz: number | null = null;
  private supportedHz: number[] | null = null;
  private referenceSpace: XrDiagnostics['referenceSpace'] = null;
  private disposed = false;
  private ending = false;
  private flags: XrRuntimeFlags = readXrFlags();
  private startup: XrStartupTrace = blankStartupTrace();
  private sessionStartAt: number | null = null;
  private setSessionResolved = false;
  private optionalLayersInited = false;
  private xrFrameCount = 0;
  private lastFrameAt: number | null = null;
  private lastFrameDtMs: number | null = null;
  private bootScene: THREE.Scene | null = null;
  private bootProjectionFrames = 0;
  private firstStoreXrRenderAt: number | null = null;
  private foveationRequested = 0;
  private foveationEffective: number | null = null;
  private targetFrameRateArmed = false;
  private onFrameRateChange = (): void => {
    this.startup.frameratechangeCount += 1;
    appendXrJournal('frameratechange', {
      frameratechangeCount: this.startup.frameratechangeCount,
      targetFrameRate: this.targetHz,
    });
    this.publishDiagnostics();
  };

  constructor(private readonly host: XrRuntimeHost) {
    this.diagnostics = this.blankDiagnostics();
    this.scheduler = reduceFrameScheduler(this.scheduler, 'start-desktop');
  }

  get presenting(): boolean {
    return !!this.host.renderer.xr.isPresenting;
  }

  get rigPose(): { x: number; z: number; yaw: number } | null {
    if (!this.rig) return null;
    return { x: this.rig.x, z: this.rig.z, yaw: this.rig.yaw };
  }

  get frameScheduler(): FrameSchedulerState {
    return this.scheduler;
  }

  bobAmount(desktopBob: number): number {
    return xrHeadBobAmount(desktopBob, this.presenting);
  }

  async probe(): Promise<boolean> {
    const platform = getPlatform();
    this.immersiveVrSupported = await probeImmersiveVrSupported({
      isTauri: platform.isTauri,
      xr: platform.isTauri ? null : (navigator as Navigator & { xr?: XRSystem }).xr ?? null,
    });
    this.diagnostics = {
      ...this.diagnostics,
      immersiveVrSupported: this.immersiveVrSupported,
    };
    return this.immersiveVrSupported;
  }

  canEnter(): boolean {
    return this.immersiveVrSupported && !getPlatform().isTauri && this.phase === 'idle';
  }

  /**
   * Must be called from a user-activation handler. The session request is
   * the first awaited XR call so the UA gesture is not consumed by font I/O.
   */
  async enter(): Promise<void> {
    if (!this.canEnter()) {
      throw new Error('WebXR immersive-vr is not available');
    }
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) throw new Error('navigator.xr missing');

    this.flags = readXrFlags();
    this.startup = blankStartupTrace();
    this.setSessionResolved = false;
    this.optionalLayersInited = false;
    this.xrFrameCount = 0;
    this.bootProjectionFrames = 0;
    this.firstStoreXrRenderAt = null;
    this.targetFrameRateArmed = false;
    installXrStartupJournal('HALCYON');
    this.phase = 'requesting';
    this.host.claimRenderLoop();
    this.startup = markStartupStage(this.startup, 'requestSessionStart', nowMs());
    const options = halcyonInitialXrRequestOptions({
      layers: this.flags.layers && activeResourceProfile().xrCompositionLayers,
    });
    appendXrJournal('requestSession-start', {
      phase: 'requesting',
      requestedOptionalFeatures: options.optionalFeatures,
    }, { requestedOptionalFeatures: options.optionalFeatures.join(',') });
    recordResourceSnapshot('pre-requestSession');
    this.publishDiagnostics();
    let session: XRSession;
    try {
      session = await xr.requestSession('immersive-vr', options);
    } catch (err) {
      this.startup = recordStartupError(this.startup, err);
      appendXrJournal('requestSession-error', {
        requestSessionError: this.startup.lastError,
        phase: 'idle',
      });
      this.phase = 'idle';
      this.publishDiagnostics();
      throw err;
    }
    this.startup = markStartupStage(this.startup, 'requestSessionEnd', nowMs());
    this.sessionStartAt = nowMs();
    recordResourceSnapshot('requestSession-resolved');

    this.session = session;
    session.addEventListener('end', this.onSessionEnd);
    session.addEventListener('frameratechange', this.onFrameRateChange);
    session.addEventListener('visibilitychange', () => noteSessionVisibility(session));
    noteSessionVisibility(session);

    const features = Array.from(
      (session as XRSession & { enabledFeatures?: ReadonlyArray<string> }).enabledFeatures ?? [],
    );
    this.startup.enabledFeatures = features;
    this.startup = markStartupStage(this.startup, 'referenceSpaceStart', nowMs());
    const spaceType = selectReferenceSpaceTypeFromFeatures(features);
    this.referenceSpace = spaceType;
    this.startup = markStartupStage(this.startup, 'referenceSpaceEnd', nowMs());
    appendXrJournal('requestSession-end', {
      enabledFeatures: features,
      phase: 'binding',
    }, { referenceSpace: spaceType });

    const xrMgr = this.host.renderer.xr as XrManager;
    xrMgr.enabled = true;
    xrMgr.setReferenceSpaceType(spaceType);
    const quality = xrQualityPolicy();
    xrMgr.setFramebufferScaleFactor(quality.framebufferScale);
    this.foveationRequested = quality.foveation;

    const rates = (session as XRSession & { supportedFrameRates?: Float32Array }).supportedFrameRates;
    this.supportedHz = rates ? Array.from(rates) : null;
    const picked = pickXrTargetHz(rates, XR_TARGET_HZ);
    this.targetHz = picked.requested;

    this.snapshotDesktop();
    this.rig = new XrPlayerRig(this.host.camera);
    this.rig.attach(this.host.scene);
    if (!this.flags.minimal) this.installControllers(xrMgr);

    this.scheduler = reduceFrameScheduler(this.scheduler, 'enter-xr');
    this.phase = 'binding';
    this.host.claimRenderLoop();
    this.host.setXrAnimationLoop(true);
    this.bootScene ??= createXrBootScene();

    const gl = this.host.renderer.getContext() as WebGL2RenderingContext;
    const attrs = noteContextAttributes(gl);
    this.startup.contextXrCompatibleBefore = attrs.xrCompatible;
    this.startup = markStartupStage(this.startup, 'makeXRCompatibleStart', nowMs());
    appendXrJournal('makeXRCompatible-start');
    const compat = await ensureXrCompatible(gl);
    this.startup.makeXRCompatibleError = compat.error;
    this.startup = markStartupStage(this.startup, 'makeXRCompatibleEnd', nowMs());
    appendXrJournal('makeXRCompatible-end', { makeXRCompatibleError: compat.error });
    const bindings = probeXrBindingApis();
    appendXrJournal('xr-binding-apis', {}, {
      hasXRWebGLBinding: bindings.hasXRWebGLBinding,
      hasCreateProjectionLayer: bindings.hasCreateProjectionLayer,
    });

    if (this.startupWasAborted(session)) {
      throw new Error(this.startup.lastError ?? 'XR session ended during startup');
    }

    this.startup = markStartupStage(this.startup, 'rendererSetSessionStart', nowMs());
    recordResourceSnapshot('pre-setSession');
    appendXrJournal('setSession-start', { phase: 'binding' });
    this.publishDiagnostics();
    try {
      await xrMgr.setSession(session);
    } catch (err) {
      this.startup = recordStartupError(this.startup, err);
      appendXrJournal('setSession-error', { setSessionError: this.startup.lastError });
      this.publishDiagnostics();
      await this.cleanupAfterEnd();
      throw err;
    }
    if (this.startupWasAborted(session)) {
      throw new Error(this.startup.lastError ?? 'XR session ended during startup');
    }
    this.setSessionResolved = true;
    this.startup = markStartupStage(this.startup, 'rendererSetSessionEnd', nowMs());
    this.startup.compositorBackend = detectSessionCompositorBackend(session);
    appendXrJournal('setSession-end', { compositorBackend: this.startup.compositorBackend });
    try {
      trySetRuntimeFoveation(xrMgr, this.foveationRequested);
      const getFoveation = (xrMgr as XrManager & { getFoveation?: () => number }).getFoveation;
      if (typeof getFoveation === 'function') this.foveationEffective = getFoveation.call(xrMgr);
    } catch {
      this.foveationEffective = null;
    }
    this.phase = this.startup.firstWorldRenderCompletedAt != null ? 'active' : 'projecting';
    recordResourceSnapshot('setSession-resolved');
    setXrSessionActive(true);

    this.host.onSessionChange?.(true);
    setXrUploadPresenting(true);
    this.host.onConsole('[XR] Immersive VR session started.', 'system');
    this.host.requestRender();
    this.maybeInitOptionalLayers();
    this.publishDiagnostics();
  }

  async exit(): Promise<void> {
    if (!canExitPhase(this.phase) || !this.session) return;
    this.phase = 'ending';
    try {
      await this.session.end();
    } catch {
      await this.cleanupAfterEnd();
    }
  }

  tick(dt: number): void {
    if (this.ending || !this.presenting || !this.rig) return;
    this.updateControllers();
    const heading = this.rig.headingYaw();
    const sticks = this.locomotionSticks();
    const { step, snap } = stepLocomotion({
      stickX: sticks.moveX,
      stickY: sticks.moveY,
      snapX: sticks.snapX,
      headingYaw: heading,
      dt,
    }, this.snap);
    this.snap = snap;
    const next = applyRigLocomotion({
      x: this.rig.x,
      z: this.rig.z,
      yaw: this.rig.yaw,
      step,
      collide: this.host.collide,
      storeWidth: this.host.getStoreWidth(),
      minZ: this.host.getBackWallZ() + 1.5,
    });
    this.rig.setPose(next.x, next.z, next.yaw);
    this.panel?.flush();
    setXrUploadMotion(step.moving || snap.cooldown > 0);
    this.host.onLocomotionTick?.();
  }

  preRender(): void {
    if (this.ending) return;
    this.noteXrFrame();
    if (!this.presenting) return;
    if (this.flags.minimal) return;
    if (this.startup.firstWorldRenderCompletedAt == null) return;
    this.panel?.flush();
    this.blitUiLayer();
  }

  /** Animation-callback seam only. Does not mean renderer.render completed. */
  noteXrFrame(at: number = nowMs()): void {
    if (this.startup.firstAnimationCallbackAt == null) {
      this.startup = markStartupStage(this.startup, 'firstAnimationCallbackAt', at);
      recordResourceSnapshot('first-XR-callback');
      appendXrJournal('first-xr-callback', { firstXrCallbackAt: at });
    }
    if (this.host.renderer.xr.isPresenting) {
      this.xrFrameCount++;
      if (this.lastFrameAt != null) this.lastFrameDtMs = at - this.lastFrameAt;
      this.lastFrameAt = at;
    }
    this.publishDiagnostics();
  }

  beforeDirectRender(at: number = nowMs()): void {
    if (this.startup.firstDirectRenderStart == null) {
      this.startup = markStartupStage(this.startup, 'firstDirectRenderStart', at);
    }
  }

  afterDirectRender(at: number = nowMs()): void {
    if (this.startup.firstDirectRenderEnd == null) {
      this.startup = markStartupStage(this.startup, 'firstDirectRenderEnd', at);
      this.startup = markStartupStage(this.startup, 'firstWorldRenderCompletedAt', at);
      this.startup = markStartupStage(this.startup, 'firstVisibleFrameAt', at);
      appendXrJournal('first-world-frame', { firstWorldFrameAt: at });
      this.requestTargetFrameRateBestEffort();
    }
    if (this.phase === 'binding' || this.phase === 'projecting') {
      this.phase = this.setSessionResolved ? 'active' : 'projecting';
    }
    this.maybeInitOptionalLayers();
    this.publishDiagnostics();
  }

  renderWorld(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    this.preRender();
    if (this.host.renderer.xr.isPresenting) {
      this.beforeDirectRender();
      const boot = this.bootScene && this.bootProjectionFrames < XR_BOOT_STABLE_FRAMES;
      renderer.render(boot ? this.bootScene! : scene, camera);
      if (boot) this.bootProjectionFrames++;
      else if (this.firstStoreXrRenderAt == null) {
        this.firstStoreXrRenderAt = nowMs();
        setGpuXrMeta({ firstStoreXrRenderAt: this.firstStoreXrRenderAt, frameCount: this.xrFrameCount });
        recordResourceSnapshot('first-store-XR-render');
      }
      this.afterDirectRender();
      if (this.xrFrameCount === 10) recordResourceSnapshot('10-XR-frames');
      return;
    }
    renderer.render(scene, camera);
  }

  shouldSkipComposer(): boolean {
    return !!this.host.renderer.xr.isPresenting;
  }

  shouldSelfScheduleRaf(): boolean {
    return shouldSelfScheduleRaf(this.scheduler);
  }

  shouldUseSetAnimationLoop(): boolean {
    return shouldUseSetAnimationLoop(this.scheduler);
  }

  competingLoops(): boolean {
    return competingLoops(this.scheduler);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.session) {
      this.session.removeEventListener('end', this.onSessionEnd);
      void this.session.end().catch(() => { /* already ending */ });
    }
    void this.cleanupAfterEnd();
  }

  private startupWasAborted(session: XRSession): boolean {
    if (!startupAborted({
      expectedSession: session,
      currentSession: this.session,
      phase: this.phase,
      ending: this.ending,
    })) {
      return false;
    }
    if (!this.startup.lastError) {
      this.startup = recordStartupError(this.startup, new Error('XR session ended during startup'));
    }
    this.publishDiagnostics();
    return true;
  }

  private blankDiagnostics(): XrDiagnostics {
    return blankXrDiagnostics(this.flags, this.classify());
  }

  private classify() {
    return classifyXrEnvironment({
      hasWindow: typeof window !== 'undefined',
      immersiveVrSupported: this.immersiveVrSupported,
      iwerActive: isIwerActive(),
      nativeXrAvailable: this.immersiveVrSupported && !isIwerActive(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    });
  }

  private publishDiagnostics(): void {
    const policy = xrQualityPolicy();
    this.diagnostics = mergeSessionDiagnostics(this.diagnostics, {
      phase: this.phase,
      immersiveVrSupported: this.immersiveVrSupported,
      rendererPresenting: !!this.host.renderer.xr.isPresenting,
      referenceSpace: this.referenceSpace,
      sessionStartAt: this.sessionStartAt,
      startup: this.startup,
      classification: this.classify(),
      iwerEmulated: isIwerActive(),
      frameCount: this.xrFrameCount,
      lastFrameDtMs: this.lastFrameDtMs,
      framebufferScale: policy.framebufferScale,
      targetHz: this.targetHz,
      supportedHz: this.supportedHz,
    });
    setGpuXrMeta({
      classification: this.classify(),
      stage: this.startup.lastCompletedStage ?? this.phase,
      phase: this.phase,
      frameCount: this.xrFrameCount,
      firstWorldRenderCompletedAt: this.startup.firstWorldRenderCompletedAt,
      firstStoreXrRenderAt: this.firstStoreXrRenderAt,
      foveationEffective: this.foveationEffective,
      lastError: this.startup.lastError,
    });
  }

  private maybeInitOptionalLayers(): void {
    if (this.optionalLayersInited) return;
    if (!this.session) return;
    if (!activeResourceProfile().xrCompositionLayers) {
      this.optionalLayersInited = true;
      this.phase = 'active';
      this.publishDiagnostics();
      return;
    }
    const ready = sessionReadyForOptionalLayers({
      phase: this.phase === 'binding' ? 'projecting' : this.phase,
      firstWorldRenderCompletedAt: this.startup.firstWorldRenderCompletedAt,
      setSessionResolved: this.setSessionResolved,
      minimal: false,
    });
    if (!ready) return;
    if (this.flags.minimal) {
      this.optionalLayersInited = true;
      this.phase = 'active';
      this.publishDiagnostics();
      return;
    }
    if (!shouldInitOptionalCompositor({
      worldRenderCompleted: this.startup.firstWorldRenderCompletedAt != null,
      setSessionResolved: this.setSessionResolved,
      minimal: this.flags.minimal,
      layersRequested: this.flags.layers,
    })) {
      this.optionalLayersInited = true;
      this.installMeshPanelOnly();
      this.phase = 'active';
      this.publishDiagnostics();
      return;
    }
    this.optionalLayersInited = true;
    this.startup = markStartupStage(this.startup, 'optionalLayersStart', nowMs());
    try {
      this.configureLayers(this.session, this.host.renderer.xr as XrManager);
    } catch (err) {
      this.startup = recordStartupError(this.startup, err);
      this.host.onConsole(
        `[XR] compositor setup failed; remaining in projection XR (${err instanceof Error ? err.message : String(err)})`,
        'system',
      );
      this.installMeshPanelOnly();
    }
    this.startup = markStartupStage(this.startup, 'optionalLayersEnd', nowMs());
    this.phase = 'active';
    this.publishDiagnostics();
  }

  private installMeshPanelOnly(): void {
    try {
      this.panel ??= new XrHelpPanel();
      this.lastCompositor = 'mesh-fallback';
      this.panel.setContent(xrPanelContent({
        compositor: 'mesh-fallback',
        layersFeature: false,
        referenceSpace: this.referenceSpace,
        targetHz: this.targetHz,
      }));
      this.panel.flush();
      if (this.rig) this.panel.showMesh(this.rig.xrOrigin);
    } catch (err) {
      this.startup = recordStartupError(this.startup, err);
    }
  }

  private snapshotDesktop(): void {
    const cam = this.host.camera;
    this.desktopPose = {
      position: cam.position.clone(),
      quaternion: cam.quaternion.clone(),
      parent: cam.parent,
    };
  }

  private requestTargetFrameRateBestEffort(): void {
    if (this.targetFrameRateArmed) return;
    const session = this.session;
    if (!session) return;
    this.targetFrameRateArmed = true;
    const updateRate = (session as XRSession & { updateTargetFrameRate?: (n: number) => Promise<void> }).updateTargetFrameRate;
    const requested = this.targetHz;
    const at = nowMs();
    this.startup = markStartupStage(this.startup, 'targetFrameRateStart', at);
    this.startup.targetFrameRateRequestedAt = at;
    appendXrJournal('targetFrameRate-request', {
      targetFrameRate: requested,
      targetFrameRateRequestedAt: at,
    });
    if (!requested || typeof updateRate !== 'function') {
      this.startup = markStartupStage(this.startup, 'targetFrameRateEnd', nowMs());
      this.startup.targetFrameRateResolvedAt = this.startup.targetFrameRateEnd;
      return;
    }
    void updateRate.call(session, requested).then(
      () => {
        const done = nowMs();
        this.startup = markStartupStage(this.startup, 'targetFrameRateEnd', done);
        this.startup.targetFrameRateResolvedAt = done;
        appendXrJournal('targetFrameRate-resolved', { targetFrameRateResolvedAt: done });
        this.publishDiagnostics();
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.startup.targetFrameRateError = message;
        this.startup = markStartupStage(this.startup, 'targetFrameRateEnd', nowMs());
        this.startup.targetFrameRateResolvedAt = this.startup.targetFrameRateEnd;
        appendXrJournal('targetFrameRate-error', { targetFrameRateError: message });
        this.publishDiagnostics();
      },
    );
  }

  private restoreDesktopLoop(): void {
    this.scheduler = reduceFrameScheduler(this.scheduler, 'exit-xr');
    this.host.setXrAnimationLoop(false);
  }

  private installControllers(xrMgr: XrManager): void {
    this.teardownControllers();
    if (!this.rig) return;
    for (let i = 0; i < 2; i++) {
      const controller = xrMgr.getController(i);
      const grip = xrMgr.getControllerGrip(i);
      controller.add(makeControllerRay());
      grip.add(makeGripMarker());
      (controller as XrControllerObj).addEventListener('selectstart', this.onSelectStart);
      this.rig.xrOrigin.add(controller);
      this.rig.xrOrigin.add(grip);
      this.controllerObjects.push(controller);
      this.gripObjects.push(grip);
    }
  }

  private teardownControllers(): void {
    for (const c of this.controllerObjects) {
      (c as XrControllerObj).removeEventListener('selectstart', this.onSelectStart);
      while (c.children.length) {
        const child = c.children[0];
        c.remove(child);
        disposeObject(child);
      }
    }
    for (const g of this.gripObjects) {
      while (g.children.length) {
        const child = g.children[0];
        g.remove(child);
        disposeObject(child);
      }
    }
    this.controllerObjects = [];
    this.gripObjects = [];
  }

  private updateControllers(): void {
    const snap = emptyControllerSnapshot();
    const session = this.session;
    if (!session) {
      this.controllers = snap;
      return;
    }
    const sources = Array.from(session.inputSources);
    for (const source of sources) {
      if (ignoreHandTrackingSource(source)) continue;
      const stick = readXrGamepadStick(source.gamepad);
      const side = source.handedness === 'left' ? snap.left
        : source.handedness === 'right' ? snap.right
        : null;
      if (!side) continue;
      side.connected = true;
      side.hasGrip = source.targetRayMode === 'tracked-pointer';
      side.stickX = stick.x;
      side.stickY = stick.y;
      const buttons = source.gamepad?.buttons;
      side.select = !!buttons?.[0]?.pressed;
      side.squeeze = !!buttons?.[1]?.pressed;
    }
    this.controllers = snap;
  }

  private locomotionSticks(): { moveX: number; moveY: number; snapX: number } {
    const l = this.controllers.left.connected ? this.controllers.left : this.controllers.right;
    const r = this.controllers.right.connected ? this.controllers.right : this.controllers.left;
    return {
      moveX: l.stickX,
      moveY: l.stickY,
      snapX: r.stickX,
    };
  }

  private handleSelect(controller: THREE.Object3D | null): void {
    if (!controller) return;
    targetRayFromController(controller, this.rayScratch);
    const slot = this.host.pickSlot(
      this.rayScratch.origin,
      this.rayScratch.direction,
      WALK_INTERACT_RANGE,
    );
    if (slot) this.host.onSelectSlot(slot);
  }

  private configureLayers(session: XRSession, xrMgr: XrManager): void {
    try {
      this.configureLayersInner(session, xrMgr);
    } catch (err) {
      this.startup = recordStartupError(this.startup, err);
      this.lastCompositor = 'mesh-fallback';
      this.installMeshPanelOnly();
      this.host.onConsole(
        `[XR] compositor setup threw; projection XR continues (${err instanceof Error ? err.message : String(err)})`,
        'system',
      );
    }
  }

  private configureLayersInner(session: XRSession, xrMgr: XrManager): void {
    const enabled = (session as XRSession & { enabledFeatures?: ReadonlyArray<string> }).enabledFeatures;
    const maxLayers = (session as XRSession & { maxRenderLayers?: number }).maxRenderLayers;
    const base = xrMgr.getBaseLayer?.() as { textureWidth?: number; framebufferWidth?: number } | undefined;
    const usingProjectionLayer = !!base && typeof base.textureWidth === 'number';
    const Binding = (typeof globalThis !== 'undefined'
      ? (globalThis as unknown as { XRWebGLBinding?: unknown }).XRWebGLBinding
      : undefined);
    const Media = (typeof globalThis !== 'undefined'
      ? (globalThis as unknown as { XRMediaBinding?: unknown }).XRMediaBinding
      : undefined);
    const probe = probeLayerApis({
      enabledFeatures: enabled,
      maxRenderLayers: maxLayers,
      usingProjectionLayer,
      xrWebGLBinding: Binding,
      xrMediaBinding: Media,
    });
    const caps = detectLayerCapabilities(probe);
    this.layers = new XrLayerManager((layers) => {
      try {
        session.updateRenderState({ layers: layers as never });
      } catch {
        // runtime rejected the stack; mesh fallback still works
      }
    }, maxLayers);

    if (usingProjectionLayer && base) {
      this.layers.setProjectionLayer(base);
    }

    this.panel ??= new XrHelpPanel();
    const compositor: 'layer' | 'mesh-fallback' = caps.compositorUi ? 'layer' : 'mesh-fallback';
    this.lastCompositor = compositor;
    this.panel.setContent(xrPanelContent({
      compositor,
      layersFeature: probe.layersFeatureEnabled,
      referenceSpace: this.referenceSpace,
      targetHz: this.targetHz,
    }));
    this.panel.flush();

    if (caps.compositorUi) {
      const quad = this.tryCreateUiQuad(session, xrMgr);
      if (quad) {
        this.layers.createUiLayer(quad);
        this.panel.hideMesh();
      } else {
        this.lastCompositor = 'mesh-fallback';
        if (this.rig) this.panel.showMesh(this.rig.xrOrigin);
      }
    } else if (this.rig) {
      this.panel.showMesh(this.rig.xrOrigin);
    }

    this.mediaBlocker = this.tryMediaLayer(session, xrMgr, caps, maxLayers);
    const policy = xrQualityPolicy();
    this.diagnostics = {
      ...this.blankDiagnostics(),
      classification: this.classify(),
      immersiveVrSupported: true,
      iwerEmulated: isIwerActive(),
      session: {
        phase: this.phase,
        immersiveVrSupported: true,
        rendererPresenting: !!this.host.renderer.xr.isPresenting,
        referenceSpace: this.referenceSpace,
        sessionStartAt: this.sessionStartAt,
      },
      startup: this.startup,
      layersFeature: probe.layersFeatureEnabled,
      layerCapabilities: caps,
      referenceSpace: this.referenceSpace,
      targetHz: this.targetHz,
      supportedHz: this.supportedHz,
      compositorUi: this.lastCompositor,
      layers: {
        featureEnabled: probe.layersFeatureEnabled,
        availableTypes: caps.types,
        projectionLayer: caps.projectionLayer,
        compositorUiPath: this.lastCompositor,
        meshFallbackPath: this.lastCompositor === 'mesh-fallback',
        maxRenderLayers: maxLayers,
        mediaLayer: {
          available: caps.mediaLayer,
          bound: this.mediaBound,
          blocker: this.mediaBlocker,
        },
      },
      mediaLayer: {
        available: caps.mediaLayer,
        bound: this.mediaBound,
        blocker: this.mediaBlocker,
      },
      quality: {
        n8ao: false,
        postprocessing: 'none',
        framebufferScale: policy.framebufferScale,
      },
      performance: {
        targetHz: this.targetHz,
        supportedHz: this.supportedHz,
        framebufferScale: policy.framebufferScale,
        frameCount: this.xrFrameCount,
        lastFrameDtMs: this.lastFrameDtMs,
      },
      flags: {
        minimal: this.flags.minimal,
        layers: this.flags.layers,
        emu: this.flags.emu,
        bare: this.flags.bare,
        safe: this.flags.safe,
        raw: this.flags.raw,
        threeBaseline: this.flags.threeBaseline,
      },
    };
    this.host.onConsole(
      `[XR] compositor=${this.lastCompositor} layers=${caps.types.join(',') || 'none'} maxRenderLayers=${maxLayers ?? 'n/a'}`,
      'system',
    );
  }

  private tryCreateUiQuad(_session: XRSession, xrMgr: XrManager): object | null {
    try {
      const binding = xrMgr.getBinding?.() as unknown as {
        createQuadLayer?: (init: Record<string, unknown>) => { width: number; height: number };
      } | null;
      if (!binding?.createQuadLayer) return null;
      const space = xrMgr.getReferenceSpace?.();
      if (!space) return null;
      const layer = binding.createQuadLayer({
        space,
        viewPixelWidth: 1024,
        viewPixelHeight: 512,
        layout: 'mono',
        isStatic: true,
        width: 0.72,
        height: 0.36,
      });
      this.uiQuad = layer as unknown as XrQuadLayerHandle;
      this.placeUiQuad();
      this.blitUiLayer();
      return layer;
    } catch {
      return null;
    }
  }

  private uiQuad: XrQuadLayerHandle | null = null;

  private placeUiQuad(): void {
    const layer = this.uiQuad;
    const rig = this.rig;
    if (!layer || !rig) return;
    // Body/world-oriented in local-floor (meters), not viewer/head-locked.
    try {
      layer.transform = new XRRigidTransform(
        { x: -0.22, y: 1.25, z: -1.15 },
        { x: 0, y: Math.sin(0.06), z: 0, w: Math.cos(0.06) },
      );
      layer.width = 0.72;
      layer.height = 0.36;
    } catch {
      // transform assignment is best-effort
    }
  }

  private blitUiLayer(): void {
    const layer = this.uiQuad;
    if (!layer || !this.panel) return;
    const xrMgr = this.host.renderer.xr as XrManager & {
      getBinding?: () => {
        getSubImage?: (layer: unknown, frame: unknown) => { colorTexture?: WebGLTexture; viewport?: { x: number; y: number; width: number; height: number } };
      } | null;
      getFrame?: () => unknown;
    };
    const binding = xrMgr.getBinding?.();
    const frame = xrMgr.getFrame?.();
    if (!binding?.getSubImage || !frame) return;
    let sub: { colorTexture?: WebGLTexture } | undefined;
    try {
      sub = binding.getSubImage(layer as unknown as XRCompositionLayer, frame);
    } catch {
      return;
    }
    if (!sub?.colorTexture) return;
    const gl = this.host.renderer.getContext() as WebGL2RenderingContext;
    const canvas = this.panel.canvas;
    const result = withRestoredGlTextureState(gl, () => {
      gl.bindTexture(gl.TEXTURE_2D, sub.colorTexture!);
      pixelStorei(this.host.renderer, gl, gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      if ('needsRedraw' in layer) (layer as { needsRedraw: boolean }).needsRedraw = true;
    }, this.host.renderer);
    if (!result.ok && result.error) {
      this.startup = recordStartupError(this.startup, result.error);
    }
  }

  private tryMediaLayer(
    session: XRSession,
    xrMgr: XrManager,
    caps: ReturnType<typeof detectLayerCapabilities>,
    maxLayers?: number,
  ): string | null {
    const plan = planMediaLayer({
      video: this.host.getVideoElement?.() ?? null,
      flagOn: typeof location !== 'undefined' && xrMediaLayerFlag(location.search, localStorage),
      hasMediaBinding: caps.mediaLayer,
      compositorUi: caps.compositorUi,
      droppedByBudget: maxLayers !== undefined && maxLayers < 3,
    });
    if (!plan.bind || !activeResourceProfile().xrMediaLayer) {
      return plan.blocker ?? (activeResourceProfile().xrMediaLayer ? null : 'XR_SAFE defers media layers.');
    }
    const Media = (globalThis as unknown as { XRMediaBinding?: new (s: XRSession) => XrMediaBindingLike }).XRMediaBinding;
    const video = this.host.getVideoElement?.();
    if (!Media || !video) return plan.blocker ?? 'XRMediaBinding constructor missing.';
    try {
      const binding = new Media(session);
      const space = xrMgr.getReferenceSpace?.();
      const layer = createMediaQuadLayer(binding, video, space);
      this.layers?.createVideoLayer(layer);
      this.mediaBound = true;
      return null;
    } catch (err) {
      this.mediaBound = false;
      return `XRMediaBinding.createQuadLayer failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async cleanupAfterEnd(): Promise<void> {
    if (this.ending && this.phase === 'idle') return;
    this.ending = true;
    const session = this.session;
    if (session) session.removeEventListener('end', this.onSessionEnd);
    if (session) session.removeEventListener('frameratechange', this.onFrameRateChange);
    this.restoreDesktopLoop();
    this.layers?.dispose();
    this.layers = null;
    this.uiQuad = null;
    this.teardownControllers();
    this.panel?.dispose();
    this.panel = null;
    if (this.desktopPose) {
      const cam = this.host.camera;
      if (this.desktopPose.parent) this.desktopPose.parent.add(cam);
      else cam.removeFromParent();
      cam.position.copy(this.desktopPose.position);
      cam.quaternion.copy(this.desktopPose.quaternion);
      this.desktopPose = null;
    }
    if (this.rig) {
      this.rig.detach(this.host.scene);
      this.rig = null;
    }
    disposeXrBootScene(this.bootScene);
    this.bootScene = null;
    this.bootProjectionFrames = 0;
    recordResourceSnapshot('XR-exit');
    this.session = null;
    this.phase = 'idle';
    this.mediaBound = false;
    this.setSessionResolved = false;
    this.optionalLayersInited = false;
    this.targetFrameRateArmed = false;
    this.sessionStartAt = null;
    this.xrFrameCount = 0;
    this.lastFrameAt = null;
    this.lastFrameDtMs = null;
    this.startup = blankStartupTrace();
    this.snap = initialSnapTurnState();
    this.controllers = emptyControllerSnapshot();
    setXrSessionActive(false);
    this.host.renderer.xr.enabled = this.immersiveVrSupported && !getPlatform().isTauri;
    this.host.onSessionChange?.(false);
    setXrUploadPresenting(false);
    this.host.onConsole('[XR] Immersive VR session ended.', 'system');
    this.host.requestRender();
    this.ending = false;
    appendXrJournal('session-end', { sessionEnded: true, phase: 'idle' });
    this.publishDiagnostics();
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

interface XrQuadLayerHandle {
  transform?: XRRigidTransform;
  width?: number;
  height?: number;
  needsRedraw?: boolean;
}

type XrControllerObj = THREE.Object3D & {
  addEventListener(type: string, listener: (event: { target?: THREE.Object3D }) => void): void;
  removeEventListener(type: string, listener: (event: { target?: THREE.Object3D }) => void): void;
};

function disposeObject(obj: THREE.Object3D): void {
  const mesh = obj as THREE.Mesh;
  if (mesh.geometry) mesh.geometry.dispose();
  const mat = mesh.material;
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else if (mat) mat.dispose();
}
