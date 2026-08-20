// XR runtime orchestrator. StoreScene holds one instance and forwards
// renderer/camera/scene plus walk collision. This file is the only place
// that talks to navigator.xr / renderer.xr.

import * as THREE from 'three';
import {
  getPlatform,
  setXrSessionActive,
  STORE_UNITS_PER_METER,
} from '../platform';
import { WALK_INTERACT_RANGE } from '../store-walk';
import { jp4aSelectPickRange } from './jp4a-diagnostic-lock.ts';
import type { MovieSlot } from '../store-layout';
import type { XrDiagnostics, XrSessionPhase, WalkCollisionFn } from './types';
import {
  halcyonInitialXrRequestOptions,
  pickXrTargetHz,
  selectReferenceSpaceTypeFromFeatures,
  XR_TARGET_HZ,
} from './session-policy';
import { trySetRuntimeFoveation } from './runtime-foveation';
import { foveationForUiMode } from './quality-policy.ts';
import { isStoreVisualReady } from '../store-visual-ready.ts';
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
  makeControllerRay,
  makeGripMarker,
  targetRayFromController,
  type XrControllerSnapshot,
} from './input';
import { snapshotControllersFromInputSources } from './input-policy.ts';
import {
  simulateThreeR184SetSessionWithInitialSources,
  type StartupRaceTraceEvent,
} from './webxr-set-session-order.ts';
import {
  bindJp4aControllerObjectEvents,
  clearJp4aControllerHand,
  pickJp4aControllerByHand,
  setJp4aControllerHandFromConnection,
  unbindJp4aControllerObjectEvents,
} from './jp4a-controller-association.ts';
import { XrHelpPanel, xrPanelContent } from './panel';
import { createMediaQuadLayer, planMediaLayer, xrMediaLayerFlag, type XrMediaBindingLike } from './media';
import { readXrFlags, type XrRuntimeFlags } from './flags';
import { classifyXrEnvironment } from './classification';
import { isIwerActive } from './emu-state';
import { blankXrDiagnostics, mergeSessionDiagnostics } from './diagnostics';
import {
  emptyXrButtonSnapshot,
  xrUiActions,
} from './ui-input';
import { locomotionAllowed, uiOwnsInput, type XrUiMode } from './ui-mode';
import { XrUiSession } from './ui-session';
import { XrUiShell } from './ui-shell';
import { applyXrDepthNear, restoreCameraNear, DESKTOP_CAMERA_NEAR } from './near-plane';
import { ensureXrEyesSeeWorld } from './stereo-view';
import { XrFpsHud } from './fps-panel.ts';
import { Jp4aTestHud } from './jp4a-test-hud.ts';
import { placeHudFromViewerPose } from './hud-placement.ts';
import {
  latestViewerPose,
  latestViewerWorldPose,
  setViewerWorldPose,
  updateViewerPoseFromXrFrame,
  viewerPoseToWorld,
} from './viewer-pose.ts';
import {
  clearUiPlacement,
  requestUiPlacement,
  takeUiPlacementFromViewerPose,
} from './ui-place-pending.ts';
import { createHardwarePosterDiagnostic } from './hw-diag-factory.ts';
import type { HardwarePosterDiagnostic } from './hardware-poster-diagnostic.ts';
import { beginXrUploadFrame, detailUploadPolicySnapshot, sampleXrMotion } from '../perf/xr-detail-upload-policy.ts';
import { noteMotionPolicy, noteXrFrameDelta, xrUploadMetricsSnapshot } from '../perf/xr-upload-metrics.ts';
import { pendingTextureUploads, pendingUploadsByCost } from '../perf/texture-upload-queue.ts';
import { posterDetailWakeSnapshot } from '../perf/poster-detail-wake.ts';
import { fpsMeterReadout } from '../fps-meter.ts';
import { setPresentationMode } from '../perf/presentation-mode.ts';
import { rayHitsPanelUv } from './ui/hit';
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
  probeXrBindingApis,
} from './gl-compat';
import {
  appendXrJournal,
  installXrStartupJournal,
  noteContextAttributes,
  noteSessionVisibility,
} from './startup-journal';
import {
  jp4aTestSnapshot,
  markJp4aXrEnded,
  markJp4aXrStarted,
  noteJp4aFocusState,
  noteJp4aTimings,
  recordJp4aSample,
  setJp4aTestPhase,
  type LivePosterMode,
} from './jp4a-test-state.ts';
import { xrEntryTimingsFromStartup } from './xr-entry-timings.ts';
import {
  ensureXrSupportProbe,
  xrRequestSessionAvailable,
  xrSupportSnapshot,
  xrSupportUnresolved,
} from './xr-support-probe.ts';
import {
  jp4aModeCycleAllowed,
  jp4aTelemetryPhase,
  nextJp4aTestPhaseFromFocus,
} from './jp4a-test-phase.ts';
import {
  emptyJp4aTriggerPressState,
  emptyJp4aTriggerSourceState,
  chooseJp4aTriggerSource,
  stepJp4aHandedTrigger,
  type Jp4aTriggerCommand,
  type Jp4aTriggerHand,
  type Jp4aTriggerPressState,
  type Jp4aTriggerSourceState,
} from './jp4a-trigger-input.ts';

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
  getSettingsScene?: () => import('../settings-registry').SettingsApplyTarget | null;
  onJp4aLockSlot?: (slot: MovieSlot) => { changed: boolean; verdict: string };
  cycleJp4aMode?: (direction: -1 | 1) => LivePosterMode;
  cycleJp4aVerdict?: () => { changed: boolean; verdict: string };
  tickJp4aDiagnostic?: (viewer: { x: number; y: number; z: number } | null) => void;
  jp4aDiagnosticSnapshot?: () => Record<string, unknown>;
  advanceJp4aTestPhase?: () => 'BEGIN_APPROACH' | 'BEGIN_FOCUS' | null;
  beginJp4aFocus?: () => boolean;
  applyJp4aTriggerCommand?: (command: Jp4aTriggerCommand | null) => void;
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
    near: number;
  } | null = null;
  private session: XRSession | null = null;
  private onSessionEnd = (): void => { void this.cleanupAfterEnd(); };
  private onSelectStart = (event: { target?: { userData?: Record<string, unknown> } }) => {
    this.handleSelect((event.target as THREE.Object3D | undefined) ?? null);
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
  private lastFoveationMode: XrUiMode | null = null;
  private targetFrameRateArmed = false;
  private uiSession: XrUiSession | null = null;
  private uiShell: XrUiShell | null = null;
  private uiPlacedFromWorld = false;
  private fpsHud: XrFpsHud | null = null;
  private jp4aHud: Jp4aTestHud | null = null;
  private hwDiag: HardwarePosterDiagnostic | null = null;
  private uiButtons = emptyXrButtonSnapshot();
  private prevUiButtons = emptyXrButtonSnapshot();
  private prevUiStick = { x: 0, y: 0 };
  private jp4aPrevThumb = false;
  private jp4aPrevSqueeze = false;
  private jp4aLastSampleAt = -Infinity;
  private jp4aSampleStartAt = 0;
  private jp4aTriggerPress: Jp4aTriggerPressState = emptyJp4aTriggerPressState();
  private jp4aTriggerSource: Jp4aTriggerSourceState = emptyJp4aTriggerSourceState();
  private jp4aPrevLeftTrigger = false;
  private jp4aPrevRightTrigger = false;
  private onControllerConnected = (event: { target?: { userData: Record<string, unknown> }; data?: { handedness?: string } }) => {
    const target = event.target;
    if (!target) return;
    setJp4aControllerHandFromConnection(target, event.data?.handedness, event.data);
  };
  private onControllerDisconnected = (event: { target?: { userData: Record<string, unknown> } }) => {
    clearJp4aControllerHand(event.target);
  };
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

  get uiMode(): XrUiMode {
    return this.uiSession?.mode ?? 'WORLD';
  }

  jp4aControllerAssociationSeam(): {
    classification: 'IWER_EMULATED';
    NOT_HARDWARE_VISUAL_PROOF: true;
    slotHands: Array<'left' | 'right' | null>;
    pickIndex: (hand: 'left' | 'right') => number;
    injectConnection: (slot: number, hand: 'left' | 'right') => boolean;
    injectDisconnection: (slot: number) => boolean;
    simulateReorderedInputSources: (order: Array<'left' | 'right'>) => {
      before: Array<'left' | 'right' | null>;
      after: Array<'left' | 'right' | null>;
      unchanged: boolean;
      pickRight: number;
      pickLeft: number;
      logicalLeftConnected: boolean;
      logicalRightConnected: boolean;
    };
    simulateInitialSourcesDuringCompat: (hands: Array<'left' | 'right'>) => Promise<{
      events: StartupRaceTraceEvent[];
      slotHands: Array<'left' | 'right' | null>;
      listenerInstalledBeforeCompatAwait: boolean;
      capturedInitialEvent: boolean;
      pickRight: number;
      pickLeft: number;
    }>;
  } | null {
    if (!this.flags.jp4aTest) return null;
    const slotHands = () => this.controllerObjects.map((c) => {
      const hand = c.userData.jp4aHand;
      return hand === 'left' || hand === 'right' ? hand : null;
    });
    const dispatch = (slot: number, type: 'connected' | 'disconnected', hand?: 'left' | 'right') => {
      const controller = this.controllerObjects[slot] as XrControllerObj | undefined;
      if (!controller) return false;
      controller.dispatchEvent(hand
        ? { type, data: { handedness: hand } }
        : { type });
      return true;
    };
    return {
      classification: 'IWER_EMULATED',
      NOT_HARDWARE_VISUAL_PROOF: true,
      get slotHands() { return slotHands(); },
      pickIndex: (hand) => this.controllerObjects.findIndex((c) => c.userData.jp4aHand === hand),
      injectConnection: (slot, hand) => {
        if (!dispatch(slot, 'connected', hand)) return false;
        return this.controllerObjects[slot]?.userData.jp4aHand === hand;
      },
      injectDisconnection: (slot) => {
        if (!dispatch(slot, 'disconnected')) return false;
        return this.controllerObjects[slot]?.userData.jp4aHand == null;
      },
      simulateReorderedInputSources: (order) => {
        const before = slotHands();
        const logical = snapshotControllersFromInputSources(
          order.map((handedness) => ({ handedness, targetRayMode: 'tracked-pointer' })),
        );
        this.controllers = logical.controllers;
        this.uiButtons = logical.uiButtons;
        const after = slotHands();
        return {
          before,
          after,
          unchanged: before.length === after.length && before.every((hand, i) => hand === after[i]),
          pickRight: this.controllerObjects.findIndex((c) => c.userData.jp4aHand === 'right'),
          pickLeft: this.controllerObjects.findIndex((c) => c.userData.jp4aHand === 'left'),
          logicalLeftConnected: logical.controllers.left.connected,
          logicalRightConnected: logical.controllers.right.connected,
        };
      },
      simulateInitialSourcesDuringCompat: async (hands) => {
        const objects = this.controllerObjects as Array<{
          userData: Record<string, unknown>;
          addEventListener(type: string, listener: (event: { type: string; target?: { userData: Record<string, unknown> }; data?: { handedness?: string } }) => void): void;
          removeEventListener(type: string, listener: (event: { type: string; target?: { userData: Record<string, unknown> }; data?: { handedness?: string } }) => void): void;
          dispatchEvent(event: { type: string; data?: { handedness?: string } }): void;
        }>;
        const result = await simulateThreeR184SetSessionWithInitialSources({
          controllerObjects: objects,
          initialSources: hands.map((handedness) => ({ handedness })),
          emitDuringCompat: true,
        });
        return {
          events: result.events,
          slotHands: result.slotHands.map((hand) => hand ?? null),
          listenerInstalledBeforeCompatAwait: result.listenerInstalledBeforeCompatAwait,
          capturedInitialEvent: result.capturedInitialEvent,
          pickRight: this.controllerObjects.findIndex((c) => c.userData.jp4aHand === 'right'),
          pickLeft: this.controllerObjects.findIndex((c) => c.userData.jp4aHand === 'left'),
        };
      },
    };
  }

  openXrMenu(): void {
    this.ensureUi();
    this.uiSession?.openMenu();
    this.uiPlacedFromWorld = false;
    requestUiPlacement();
    this.syncUiShell();
  }

  openXrSettings(): void {
    this.openXrMenu();
    this.uiSession?.applyActions({
      toggleMenu: false,
      activate: true,
      cancel: false,
      nav: 0,
      value: 0,
      suppressLocomotion: true,
      suppressWorldSelect: true,
    });
    this.syncUiShell();
  }

  cycleXrControl(key: string, dir: -1 | 1 = 1): void {
    this.ensureUi();
    this.uiSession?.cycleControl(key, dir);
    this.syncUiShell();
  }

  applyXrSettings(): void {
    this.ensureUi();
    this.uiSession?.apply();
    this.syncUiShell();
  }

  cancelXrSettings(): void {
    this.ensureUi();
    this.uiSession?.cancel();
    this.syncUiShell();
  }

  xrUiPaint(): ReturnType<XrUiSession['paint']> | null {
    return this.uiSession?.paint() ?? null;
  }

  xrSettingsDraft(): Record<string, unknown> | null {
    return this.uiSession ? { ...this.uiSession.draft.values } : null;
  }

  hwPosterDiagSnapshot(): unknown {
    if (!this.hwDiag) return { enabled: false, QUEST_HARDWARE: 'NOT_EXECUTED' };
    let glError: number | null = null;
    try {
      const gl = this.host.renderer.getContext() as WebGL2RenderingContext;
      glError = gl.getError();
    } catch {
      glError = null;
    }
    const frame = fpsMeterReadout();
    const policy = xrQualityPolicy();
    const info = this.host.renderer.info;
    const viewerPose = latestViewerPose();
    const runtime = {
      viewerPose,
      frame: {
        currentRollingFps: frame.fps,
        meanFrameIntervalMs: frame.meanMs,
        onePercentLowFps: frame.p99Ms ? 1000 / frame.p99Ms : null,
        p95FrameMs: frame.p95Ms,
        p99FrameMs: frame.p99Ms,
        worstFrameMs: frame.worstMs,
        compositeSamples: frame.samples,
        frameCount: this.xrFrameCount,
      },
      display: {
        targetHz: this.targetHz,
        supportedHz: this.supportedHz,
        requestedFoveation: this.foveationRequested,
        effectiveFoveation: this.foveationEffective,
        framebufferScale: policy.framebufferScale,
      },
      renderer: {
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        lines: info.render.lines,
        points: info.render.points,
        textures: info.memory.textures,
        geometries: info.memory.geometries,
        programs: info.programs?.length ?? 0,
      },
      hud: {
        fps: this.fpsHud?.snapshot() ?? null,
      },
      upload: {
        pending: pendingTextureUploads(),
        pendingByCost: pendingUploadsByCost(),
        policy: detailUploadPolicySnapshot(),
        wake: posterDetailWakeSnapshot(),
        metrics: xrUploadMetricsSnapshot(),
      },
    };
    return this.hwDiag.snapshot(glError, false, runtime, this.classify());
  }

  cycleHwPosterDiag(): string | null {
    return this.hwDiag?.cycle() ?? null;
  }

  selectWorldSlot(slot: Parameters<XrRuntimeHost['onSelectSlot']>[0]): void {
    this.host.onSelectSlot(slot);
  }

  get frameScheduler(): FrameSchedulerState {
    return this.scheduler;
  }

  bobAmount(desktopBob: number): number {
    return xrHeadBobAmount(desktopBob, this.presenting);
  }

  /**
   * Joins the single shared app-level support probe. It is started right after
   * emulator installation in main(), long before StoreScene exists, so a scene
   * rebuild can never restart it and this call is normally already settled.
   */
  async probe(): Promise<boolean> {
    const platform = getPlatform();
    const support = await ensureXrSupportProbe({ isTauri: platform.isTauri });
    // Production stays conservative: only an actual `true` from the API lights
    // up Enter VR. TIMED_OUT/ERROR are not support, but they are not absence
    // of support either — see canEnter(allowUnverifiedSupport).
    this.immersiveVrSupported = support.state === 'SUPPORTED';
    this.diagnostics = {
      ...this.diagnostics,
      immersiveVrSupported: this.immersiveVrSupported,
    };
    return this.immersiveVrSupported;
  }

  canEnter(allowUnverifiedSupport = false): boolean {
    if (getPlatform().isTauri || this.phase !== 'idle') return false;
    if (this.immersiveVrSupported) return true;
    if (!allowUnverifiedSupport) return false;
    // Diagnostic fast path: the support query never answered, so requestSession
    // is the authoritative attempt. Never reported as support === true.
    if (!xrSupportUnresolved(xrSupportSnapshot().state)) return false;
    return xrRequestSessionAvailable((navigator as Navigator & { xr?: XRSystem }).xr ?? null);
  }

  /**
   * Must be called from a user-activation handler. The session request is
   * the first awaited XR call so the UA gesture is not consumed by font I/O.
   */
  async enter(opts?: { allowUnverifiedSupport?: boolean }): Promise<void> {
    if (!isStoreVisualReady()) {
      throw new Error('STORE_VISIBLE_LOADING');
    }
    if (!this.canEnter(opts?.allowUnverifiedSupport === true)) {
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
    if (this.flags.posterHwDiag) {
      this.hwDiag = createHardwarePosterDiagnostic();
      this.hwDiag.attach(this.host.scene, this.rig.xrOrigin);
    }
    this.ensureUi();
    if (!this.flags.minimal) this.installControllers(xrMgr);
    // Three.js r184 dispatches controller `connected` from session
    // `inputsourceschange` inside setSession. Listeners must already be on
    // getController(i) objects before that assignment, which this order
    // guarantees. Do not recover missed connections via inputSources[i].
    // Do not preflight-await XR compatibility here. Three.js attaches
    // inputsourceschange first, then handles compatibility inside setSession.

    this.scheduler = reduceFrameScheduler(this.scheduler, 'enter-xr');
    this.phase = 'binding';
    this.host.claimRenderLoop();
    this.host.setXrAnimationLoop(true);
    this.bootScene ??= createXrBootScene();

    const gl = this.host.renderer.getContext() as WebGL2RenderingContext;
    const attrs = noteContextAttributes(gl);
    this.startup.contextXrCompatibleBefore = attrs.xrCompatible;
    const bindings = probeXrBindingApis();
    appendXrJournal('xr-binding-apis', {}, {
      hasXRWebGLBinding: bindings.hasXRWebGLBinding,
      hasCreateProjectionLayer: bindings.hasCreateProjectionLayer,
      makeXRCompatibleOwner: 'THREE_WEBXR_MANAGER',
      appPreflightMakeXRCompatible: false,
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
    appendXrJournal('makeXRCompatible-owned-by-three', {}, {
      makeXRCompatibleOwner: 'THREE_WEBXR_MANAGER',
      appPreflightMakeXRCompatible: false,
    });
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
    setPresentationMode('IMMERSIVE_XR');
    this.host.onConsole('[XR] Immersive VR session started.', 'system');
    this.host.requestRender();
    if (this.flags.jp4aTest && jp4aTestSnapshot()?.active) {
      this.jp4aSampleStartAt = nowMs();
      this.jp4aLastSampleAt = -Infinity;
      this.jp4aTriggerPress = emptyJp4aTriggerPressState();
      this.jp4aTriggerSource = emptyJp4aTriggerSourceState();
      this.jp4aPrevLeftTrigger = false;
      this.jp4aPrevRightTrigger = false;
      markJp4aXrStarted(Date.now(), this.classify());
      noteJp4aTimings({
        supportProbeMs: xrSupportSnapshot().elapsedMs,
        ...xrEntryTimingsFromStartup(this.startup),
      });
    }
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
    this.tickJp4aButtons();
    this.tickUi();
    const heading = this.rig.headingYaw();
    const sticks = this.locomotionSticks();
    const ui = this.uiSession;
    const suppressMove = ui ? !locomotionAllowed(ui.mode) : false;
    const { step, snap } = stepLocomotion({
      stickX: suppressMove ? 0 : sticks.moveX,
      stickY: suppressMove ? 0 : sticks.moveY,
      snapX: suppressMove ? 0 : sticks.snapX,
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
    this.syncUiShell();
  }

  preRender(): void {
    if (this.ending) return;
    this.noteXrFrame();
    if (!this.presenting) return;
    ensureXrEyesSeeWorld(this.host.renderer);
    if (this.flags.minimal) return;
    if (this.startup.firstWorldRenderCompletedAt == null) return;
    this.panel?.flush();
    this.uiShell?.flush();
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
      if (this.lastFrameAt === at) {
        this.publishDiagnostics();
        return;
      }
      this.xrFrameCount++;
      if (this.lastFrameAt != null) this.lastFrameDtMs = at - this.lastFrameAt;
      this.lastFrameAt = at;
      if (this.lastFrameDtMs != null) noteXrFrameDelta(this.lastFrameDtMs);
    }
    this.publishDiagnostics();
  }

  /** Pose + motion + upload frame gate. Call before pumping GPU uploads. */
  prepareXrFrame(at: number = nowMs()): void {
    this.noteXrFrame(at);
    if (!this.presenting) return;
    const xrMgr = this.host.renderer.xr as XrManager;
    const pose = updateViewerPoseFromXrFrame({
      frame: (xrMgr.getFrame?.() ?? null) as Parameters<typeof updateViewerPoseFromXrFrame>[0]['frame'],
      referenceSpace: xrMgr.getReferenceSpace?.() ?? null,
      nowMs: at,
      frameId: this.xrFrameCount,
    });
    beginXrUploadFrame(this.xrFrameCount);
    if (pose.valid && this.rig) {
      setViewerWorldPose(viewerPoseToWorld({
        originX: this.rig.x,
        originY: this.rig.root.position.y,
        originZ: this.rig.z,
        originYaw: this.rig.yaw,
        originScale: STORE_UNITS_PER_METER,
        viewerX: pose.x,
        viewerY: pose.y,
        viewerZ: pose.z,
        viewerYaw: pose.yaw,
        frameId: pose.frameId,
      }));
      const world = latestViewerWorldPose();
      this.host.tickJp4aDiagnostic?.(world ? { x: world.x, y: world.y, z: world.z } : null);
      const sticks = this.locomotionSticks();
      sampleXrMotion({
        x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw,
        locomotionStickActive: Math.hypot(sticks.moveX, sticks.moveY) > 0.25,
        snapTurnActive: this.snap.cooldown > 0,
        nowMs: at,
      });
      const pol = detailUploadPolicySnapshot();
      noteMotionPolicy({
        deferredForMotion: pol.deferredForMotion,
        promotedWhileStable: pol.promotedWhileStable,
        fairnessForced: pol.fairnessForced,
      });
      this.sampleJp4aTelemetry(at);
    }
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
      if (this.flags.jp4aTest) noteJp4aTimings(xrEntryTimingsFromStartup(this.startup));
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
      near: cam.near,
    };
    applyXrDepthNear(cam);
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
      controller.add(makeControllerRay(
        this.flags.jp4aTest ? jp4aSelectPickRange(true) : undefined,
      ));
      grip.add(makeGripMarker());
      bindJp4aControllerObjectEvents(controller as XrControllerObj, this.controllerObjectHandlers);
      this.rig.xrOrigin.add(controller);
      this.rig.xrOrigin.add(grip);
      this.controllerObjects.push(controller);
      this.gripObjects.push(grip);
    }
  }

  private teardownControllers(): void {
    for (const c of this.controllerObjects) {
      unbindJp4aControllerObjectEvents(c as XrControllerObj, this.controllerObjectHandlers);
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

  private get controllerObjectHandlers() {
    return {
      selectstart: this.onSelectStart,
      connected: this.onControllerConnected,
      disconnected: this.onControllerDisconnected,
    };
  }

  private updateControllers(): void {
    if (!this.session) {
      this.controllers = emptyControllerSnapshot();
      this.uiButtons = emptyXrButtonSnapshot();
      return;
    }
    const logical = snapshotControllersFromInputSources(this.session.inputSources);
    this.controllers = logical.controllers;
    this.uiButtons = logical.uiButtons;
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
    if (this.uiSession && uiOwnsInput(this.uiSession.mode)) {
      const row = this.hitUiRow();
      if (row != null) {
        if (this.uiSession.mode === 'MENU') this.uiSession.menuIndex = row;
        else this.uiSession.settingsIndex = row;
        this.syncUiShell();
      }
      return;
    }
    const jp4aActive = this.flags.jp4aTest && jp4aTestSnapshot()?.active && !!this.host.onJp4aLockSlot;
    if (jp4aActive) {
      // JP-4A Trigger commits on the polled DOWN/HOLD/UP machine, not on
      // XR selectstart. Keep this listener only so Menu UI still receives it.
      return;
    }
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

  private ensureUi(): void {
    if (!this.uiSession) {
      this.uiSession = new XrUiSession(
        {
          exitVr: () => { void this.exit(); },
          getSettingsScene: () => this.host.getSettingsScene?.() ?? null,
        },
        () => activeResourceProfile().name,
      );
    }
    if (!this.uiShell) this.uiShell = new XrUiShell();
    if (!this.fpsHud) this.fpsHud = new XrFpsHud();
    if (this.flags.jp4aTest && !this.jp4aHud) this.jp4aHud = new Jp4aTestHud();
  }

  private tickUi(): void {
    if (!this.uiSession) this.ensureUi();
    const sticks = this.locomotionSticks();
    const actions = xrUiActions({
      mode: this.uiSession!.mode,
      buttons: this.uiButtons,
      prevButtons: this.prevUiButtons,
      stickX: sticks.moveX,
      stickY: sticks.moveY,
      prevStickX: this.prevUiStick.x,
      prevStickY: this.prevUiStick.y,
    });
    this.prevUiButtons = this.uiButtons;
    this.prevUiStick = { x: sticks.moveX, y: sticks.moveY };
    this.uiSession!.applyActions(actions);
    this.applyUiFoveation();
  }

  private applyUiFoveation(): void {
    const mode = this.uiSession?.mode ?? 'WORLD';
    if (mode === this.lastFoveationMode) return;
    this.lastFoveationMode = mode;
    const value = foveationForUiMode(mode);
    this.foveationRequested = value;
    const xrMgr = this.host.renderer.xr as XrManager;
    const result = trySetRuntimeFoveation(xrMgr, value);
    if (result.ok) {
      const getFoveation = (xrMgr as XrManager & { getFoveation?: () => number }).getFoveation;
      if (typeof getFoveation === 'function') {
        try { this.foveationEffective = getFoveation.call(xrMgr); } catch { /* diagnostic */ }
      } else {
        this.foveationEffective = value;
      }
    }
  }

  private syncUiShell(): void {
    const ui = this.uiSession;
    const shell = this.uiShell;
    if (!ui || !shell || !this.rig) return;
    if (uiOwnsInput(ui.mode)) {
      if (!this.uiPlacedFromWorld) {
        requestUiPlacement();
        const pose = latestViewerPose();
        const placed = takeUiPlacementFromViewerPose(pose, this.xrFrameCount);
        if (placed) {
          shell.applyPlacement(placed);
          this.uiPlacedFromWorld = true;
        }
      }
      shell.setPaint(ui.paint());
      shell.show(this.rig.xrOrigin);
      this.panel?.hideMesh();
    } else {
      this.uiPlacedFromWorld = false;
      clearUiPlacement();
      shell.hide();
      if (this.rig) this.panel?.showMesh(this.rig.xrOrigin);
    }
    shell.flush();
    const hudPose = placeHudFromViewerPose(latestViewerPose());
    this.fpsHud?.sync(this.rig.xrOrigin, hudPose, nowMs(), this.targetHz);
    this.jp4aHud?.sync(this.rig.xrOrigin, latestViewerPose());
    if (this.hwDiag) {
      this.hwDiag.noteButtons(this.uiButtons.thumbstick);
      const cam = this.host.camera;
      this.hwDiag.tick(latestViewerPose(), cam.near, cam.far);
    }
    this.applyUiFoveation();
  }

  private hitUiRow(): number | null {
    const mesh = this.uiShell?.mesh;
    if (!mesh || !mesh.visible) return null;
    mesh.updateMatrixWorld(true);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    mesh.matrixWorld.decompose(pos, quat, scale);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    const uv = rayHitsPanelUv({
      origin: this.rayScratch.origin,
      direction: this.rayScratch.direction,
      panelOrigin: pos,
      panelNormal: normal,
      right,
      up,
      width: 0.84 * scale.x,
      height: 0.63 * scale.y,
    });
    if (!uv) return null;
    return this.uiShell!.rowFromUv(uv.v);
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
    this.uiShell?.hide();
    this.fpsHud?.dispose();
    this.fpsHud = null;
    this.jp4aHud?.dispose();
    this.jp4aHud = null;
    this.hwDiag?.dispose();
    this.hwDiag = null;
    this.jp4aTriggerPress = emptyJp4aTriggerPressState();
    this.jp4aTriggerSource = emptyJp4aTriggerSourceState();
    this.jp4aPrevLeftTrigger = false;
    this.jp4aPrevRightTrigger = false;
    this.jp4aPrevThumb = false;
    this.jp4aPrevSqueeze = false;
    clearUiPlacement();
    this.uiSession?.closeToWorld();
    if (this.desktopPose) {
      const cam = this.host.camera;
      if (this.desktopPose.parent) this.desktopPose.parent.add(cam);
      else cam.removeFromParent();
      cam.position.copy(this.desktopPose.position);
      cam.quaternion.copy(this.desktopPose.quaternion);
      restoreCameraNear(cam, this.desktopPose.near ?? DESKTOP_CAMERA_NEAR);
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
    if (this.flags.jp4aTest && jp4aTestSnapshot()) markJp4aXrEnded();
    setXrUploadPresenting(false);
    setPresentationMode('INLINE');
    this.host.onConsole('[XR] Immersive VR session ended.', 'system');
    this.host.requestRender();
    this.ending = false;
    appendXrJournal('session-end', { sessionEnded: true, phase: 'idle' });
    this.publishDiagnostics();
  }

  private tickJp4aButtons(): void {
    if (!this.flags.jp4aTest) return;
    const session = jp4aTestSnapshot();
    const enabled = !!session?.active && this.uiMode === 'WORLD';
    const left = this.controllers.left;
    const right = this.controllers.right;
    if (!enabled) {
      this.jp4aTriggerPress = emptyJp4aTriggerPressState();
      this.jp4aTriggerSource = emptyJp4aTriggerSourceState();
      this.jp4aPrevThumb = this.uiButtons.thumbstick;
      this.jp4aPrevSqueeze = this.uiButtons.squeeze;
      this.jp4aPrevLeftTrigger = left.select;
      this.jp4aPrevRightTrigger = right.select;
      return;
    }
    const phase = session.testPhase;
    if (jp4aModeCycleAllowed(phase) && this.uiButtons.thumbstick && !this.jp4aPrevThumb) {
      this.host.cycleJp4aMode?.(1);
    }
    if (jp4aModeCycleAllowed(phase) && this.uiButtons.squeeze && !this.jp4aPrevSqueeze) {
      this.host.cycleJp4aMode?.(-1);
    }
    const sourceInput = {
      prev: this.jp4aTriggerSource,
      leftTrigger: left.select,
      rightTrigger: right.select,
      prevLeftTrigger: this.jp4aPrevLeftTrigger,
      prevRightTrigger: this.jp4aPrevRightTrigger,
      leftConnected: left.connected,
      rightConnected: right.connected,
    };
    const chosen = chooseJp4aTriggerSource(sourceInput);
    let leftHit: MovieSlot | null = null;
    let rightHit: MovieSlot | null = null;
    if (!chosen.cancel && chosen.triggerDown && !this.jp4aTriggerPress.down && chosen.next.source) {
      if (chosen.next.source === 'left') leftHit = this.pickJp4aTriggerTarget('left');
      else rightHit = this.pickJp4aTriggerTarget('right');
    }
    const handed = stepJp4aHandedTrigger({
      press: this.jp4aTriggerPress,
      source: this.jp4aTriggerSource,
      leftTrigger: left.select,
      rightTrigger: right.select,
      prevLeftTrigger: this.jp4aPrevLeftTrigger,
      prevRightTrigger: this.jp4aPrevRightTrigger,
      leftConnected: left.connected,
      rightConnected: right.connected,
      leftHit,
      rightHit,
      now: nowMs(),
      phase,
      hasLock: !!session.lockedPoster,
    });
    this.jp4aTriggerPress = handed.press;
    this.jp4aTriggerSource = handed.source;
    if (handed.command) this.host.applyJp4aTriggerCommand?.(handed.command);
    this.jp4aPrevThumb = this.uiButtons.thumbstick;
    this.jp4aPrevSqueeze = this.uiButtons.squeeze;
    this.jp4aPrevLeftTrigger = left.select;
    this.jp4aPrevRightTrigger = right.select;
  }

  private pickJp4aTriggerTarget(hand: Jp4aTriggerHand): MovieSlot | null {
    const controller = pickJp4aControllerByHand(this.controllerObjects, hand);
    if (!controller) return null;
    targetRayFromController(controller, this.rayScratch);
    return this.host.pickSlot(
      this.rayScratch.origin,
      this.rayScratch.direction,
      jp4aSelectPickRange(true),
    );
  }

  private sampleJp4aTelemetry(at: number): void {
    if (!this.flags.jp4aTest || !jp4aTestSnapshot()?.active || at - this.jp4aLastSampleAt < 250) return;
    this.jp4aLastSampleAt = at;
    const live = this.host.jp4aDiagnosticSnapshot?.() ?? {};
    const frame = fpsMeterReadout(at);
    const upload = xrUploadMetricsSnapshot();
    const queue = pendingUploadsByCost();
    const info = this.host.renderer.info;
    const focusPhase = typeof live.focusPhase === 'string' ? live.focusPhase : null;
    noteJp4aFocusState(focusPhase);
    const session = jp4aTestSnapshot();
    const advanced = nextJp4aTestPhaseFromFocus(session?.testPhase ?? 'BASELINE', focusPhase);
    if (advanced !== (session?.testPhase ?? 'BASELINE')) setJp4aTestPhase(advanced);
    const testPhase = jp4aTestSnapshot()?.testPhase ?? 'BASELINE';
    const phase = jp4aTelemetryPhase(testPhase);
    const distance = typeof live.viewerDistanceM === 'number' ? live.viewerDistanceM : null;
    const base = (this.host.renderer.xr as XrManager).getBaseLayer?.() as {
      framebufferWidth?: number; framebufferHeight?: number; textureWidth?: number; textureHeight?: number;
    } | undefined;
    const focusUpload = live.focusUpload as {
      progress?: number; bytesUploaded?: number; submitMs?: number;
    } | undefined;
    recordJp4aSample({
      timestamp: new Date().toISOString(),
      elapsedMs: Math.max(0, at - this.jp4aSampleStartAt),
      phase,
      mode: (typeof live.mode === 'string' ? live.mode : 'LIVE-NORMAL') as LivePosterMode,
      fps: frame.fps,
      meanMs: frame.meanMs,
      onePercentLowFps: frame.p99Ms ? 1000 / frame.p99Ms : null,
      p95Ms: frame.p95Ms,
      p99Ms: frame.p99Ms,
      worstMs: frame.worstMs,
      frameCount: this.xrFrameCount,
      targetHz: this.targetHz,
      supportedHz: this.supportedHz,
      framebufferWidth: base?.framebufferWidth ?? base?.textureWidth ?? null,
      framebufferHeight: base?.framebufferHeight ?? base?.textureHeight ?? null,
      framebufferScale: xrQualityPolicy().framebufferScale,
      foveation: this.foveationEffective,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      posterBankCount: typeof live.posterBankCount === 'number' ? live.posterBankCount : null,
      renderBatchCount: typeof live.renderBatchCount === 'number' ? live.renderBatchCount : null,
      lockedPosterOpaqueId: typeof live.opaqueId === 'string' ? live.opaqueId : null,
      globalIndex: typeof live.globalIndex === 'number' ? live.globalIndex : null,
      expectedBank: typeof live.expectedBank === 'number' ? live.expectedBank : null,
      meshBank: typeof live.meshBank === 'number' ? live.meshBank : null,
      expectedLayer: typeof live.expectedLayer === 'number' ? live.expectedLayer : null,
      loadedFlag: typeof live.loadedFlag === 'number' ? live.loadedFlag : null,
      detailPhase: typeof live.detailPhase === 'string' ? live.detailPhase : null,
      focusPhase,
      focusUploadProgress: typeof focusUpload?.progress === 'number' ? focusUpload.progress : null,
      pendingBase: queue.base,
      pendingNear: queue.near,
      pendingFocus: queue.focus,
      gpuUploadBytes: focusUpload?.bytesUploaded ?? upload.bytesUploaded,
      gpuUploadSubmitMs: focusUpload?.submitMs ?? upload.uploadCallMs,
      decodeMs: upload.decodeMs,
      viewerDistanceM: distance,
      viewerYawToPosterDeg: typeof live.viewerYawToPosterDeg === 'number' ? live.viewerYawToPosterDeg : null,
    });
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
  addEventListener(type: string, listener: (event: { target?: THREE.Object3D; data?: { handedness?: string } }) => void): void;
  removeEventListener(type: string, listener: (event: { target?: THREE.Object3D; data?: { handedness?: string } }) => void): void;
  dispatchEvent(event: { type: string; data?: { handedness?: string } }): void;
};

function disposeObject(obj: THREE.Object3D): void {
  const mesh = obj as THREE.Mesh;
  if (mesh.geometry) mesh.geometry.dispose();
  const mat = mesh.material;
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else if (mat) mat.dispose();
}
