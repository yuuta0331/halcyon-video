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
  immersiveVrRequestOptions,
  pickReferenceSpaceType,
  pickXrTargetHz,
  probeImmersiveVrSupported,
  XR_TARGET_HZ,
} from './session-policy';
import {
  competingLoops,
  initialFrameScheduler,
  reduceFrameScheduler,
  shouldSelfScheduleRaf,
  shouldUseSetAnimationLoop,
  type FrameSchedulerState,
} from './loop';
import { applyXrQualityOverride, xrQualityPolicy } from './quality';
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
  setXrAnimationLoop: (enabled: boolean) => void;
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

  constructor(private readonly host: XrRuntimeHost) {
    this.diagnostics = this.blankDiagnostics();
    this.scheduler = reduceFrameScheduler(this.scheduler, 'start-desktop');
  }

  get presenting(): boolean {
    return this.phase === 'active' && !!this.host.renderer.xr.isPresenting;
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

    this.phase = 'requesting';
    const options = immersiveVrRequestOptions();
    let session: XRSession;
    try {
      session = await xr.requestSession('immersive-vr', options);
    } catch (err) {
      this.phase = 'idle';
      throw err;
    }

    this.session = session;
    session.addEventListener('end', this.onSessionEnd);

    const spaceType = await pickReferenceSpaceType((type) => session.requestReferenceSpace(type));
    this.referenceSpace = spaceType;

    const xrMgr = this.host.renderer.xr as XrManager;
    xrMgr.enabled = true;
    xrMgr.setReferenceSpaceType(spaceType);
    const quality = xrQualityPolicy();
    xrMgr.setFramebufferScaleFactor(quality.framebufferScale);

    const rates = (session as XRSession & { supportedFrameRates?: Float32Array }).supportedFrameRates;
    this.supportedHz = rates ? Array.from(rates) : null;
    const picked = pickXrTargetHz(rates, XR_TARGET_HZ);
    this.targetHz = picked.requested;
    const updateRate = (session as XRSession & { updateTargetFrameRate?: (n: number) => Promise<void> }).updateTargetFrameRate;
    if (picked.requested && typeof updateRate === 'function') {
      try {
        await updateRate.call(session, picked.requested);
      } catch {
        // optional API — do not fail the session
      }
    }

    this.snapshotDesktop();
    this.scheduler = reduceFrameScheduler(this.scheduler, 'enter-xr');
    this.host.setXrAnimationLoop(true);
    await xrMgr.setSession(session);
    this.phase = 'active';
    setXrSessionActive(true);

    this.rig = new XrPlayerRig(this.host.camera);
    this.rig.attach(this.host.scene);
    this.installControllers(xrMgr);
    this.panel = new XrHelpPanel();
    this.configureLayers(session, xrMgr);
    this.host.onSessionChange?.(true);
    this.host.onConsole('[XR] Immersive VR session started.', 'system');
    this.host.requestRender();
  }

  async exit(): Promise<void> {
    if (this.phase !== 'active' || !this.session) return;
    this.phase = 'ending';
    try {
      await this.session.end();
    } catch {
      await this.cleanupAfterEnd();
    }
  }

  tick(dt: number): void {
    if (!this.presenting || !this.rig) return;
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
  }

  preRender(): void {
    if (!this.presenting) return;
    this.panel?.flush();
    this.blitUiLayer();
  }

  shouldSkipComposer(): boolean {
    return this.presenting;
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

  private blankDiagnostics(): XrDiagnostics {
    return {
      immersiveVrSupported: false,
      layersFeature: 'unknown',
      layerCapabilities: {
        compositorUi: false,
        mediaLayer: false,
        projectionLayer: false,
        fallback: 'mesh',
        types: [],
      },
      referenceSpace: null,
      targetHz: null,
      supportedHz: null,
      compositorUi: 'mesh-fallback',
      mediaLayer: {
        available: false,
        bound: false,
        blocker: 'No XR session.',
      },
      quality: {
        n8ao: true,
        postprocessing: 'desktop',
        framebufferScale: 1,
      },
    };
  }

  private snapshotDesktop(): void {
    const cam = this.host.camera;
    this.desktopPose = {
      position: cam.position.clone(),
      quaternion: cam.quaternion.clone(),
      parent: cam.parent,
    };
    applyXrQualityOverride();
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
      c.removeFromParent();
    }
    for (const g of this.gripObjects) {
      while (g.children.length) {
        const child = g.children[0];
        g.remove(child);
        disposeObject(child);
      }
      g.removeFromParent();
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
        this.panel.showMesh(this.rig!.xrOrigin);
      }
    } else {
      this.panel.showMesh(this.rig!.xrOrigin);
    }

    this.mediaBlocker = this.tryMediaLayer(session, xrMgr, caps, maxLayers);
    const policy = xrQualityPolicy();
    this.diagnostics = {
      immersiveVrSupported: true,
      layersFeature: probe.layersFeatureEnabled,
      layerCapabilities: caps,
      referenceSpace: this.referenceSpace,
      targetHz: this.targetHz,
      supportedHz: this.supportedHz,
      compositorUi: this.lastCompositor,
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
    try {
      gl.bindTexture(gl.TEXTURE_2D, sub.colorTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      if ('needsRedraw' in layer) (layer as { needsRedraw: boolean }).needsRedraw = true;
    } catch {
      // first frames can race the layer texture
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
    if (!plan.bind) return plan.blocker;
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
    this.layers?.dispose();
    this.layers = null;
    this.uiQuad = null;
    this.teardownControllers();
    this.panel?.dispose();
    this.panel = null;
    if (this.rig) {
      this.rig.detach(this.host.scene);
      this.rig = null;
    }
    if (this.desktopPose) {
      const cam = this.host.camera;
      if (this.desktopPose.parent) this.desktopPose.parent.add(cam);
      else cam.removeFromParent();
      cam.position.copy(this.desktopPose.position);
      cam.quaternion.copy(this.desktopPose.quaternion);
      this.desktopPose = null;
    }
    this.restoreDesktopLoop();
    this.session = null;
    this.phase = 'idle';
    this.mediaBound = false;
    this.snap = initialSnapTurnState();
    this.controllers = emptyControllerSnapshot();
    setXrSessionActive(false);
    this.host.renderer.xr.enabled = this.immersiveVrSupported && !getPlatform().isTauri;
    this.host.onSessionChange?.(false);
    this.host.onConsole('[XR] Immersive VR session ended.', 'system');
    this.host.requestRender();
    this.ending = false;
  }
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
