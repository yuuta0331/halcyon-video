// XR attach helpers — extracted from StoreScene so three-scene.ts stays
// under its file budget. Type-only import of StoreScene avoids a cycle.

import type { StoreScene } from './three-scene';
import { XrRuntime } from './xr/runtime';
import * as walk from './store-walk';
import { posterArtSample, updatePosterWorkingSet } from './store-poster-window';
import { installXrStartupJournal } from './xr/startup-journal';
import { pumpTextureUploads, textureArrayManager } from './poster-textures';
import { setXrContentLiveState, xrContentLiveState, xrContentSnapshot } from './xr/content-diagnostics';
import { classifyObjectName } from './xr/content-classes';
import { brandPackStatus } from './brand-pack';
import { publishXrPerfDiagnostics } from './xr/perf-diagnostics.ts';
import { installPosterDetailTestHooks } from './store-poster-detail';
import { inspectCloseRangePosters, closeRangeSweepPlan } from './xr/close-range-probe';
import { sampleSignageStereo, stereoSignagePass, negativeControlLeftEyeOnly, userCameraMask } from './xr/stereo-signage-probe';
import { lastUiPlacementEvidence } from './xr/ui-place-pending';
import { latestViewerPose } from './xr/viewer-pose';
import { xrUploadMetricsSnapshot } from './perf/xr-upload-metrics.ts';
import { noteStoreWorldClassProgress, refreshStoreVisualReady } from './store-visual-ready';
import { jp4aTestRequested, jp4aTestSnapshot, registerJp4aLiveDiagnosticReset } from './xr/jp4a-test-state.ts';
import { LivePosterDiagnostic } from './xr/live-poster-diagnostic.ts';
import { createJp4aHostBindings } from './xr/jp4a-diagnostic-lock.ts';
import {
  emptyJp4aTriggerPressState,
  emptyJp4aTriggerSourceState,
  stepJp4aHandedTrigger,
  stepJp4aTrigger,
  type Jp4aTriggerPressState,
  type Jp4aTriggerSourceState,
} from './xr/jp4a-trigger-input.ts';

export function attachXrRuntime(
  scene: StoreScene,
  animate: (time?: number) => void,
  restoreDesktopLoop: () => void,
): XrRuntime {
  installXrStartupJournal('HALCYON');
  const liveDiag = jp4aTestRequested()
    ? new LivePosterDiagnostic(() => scene.slotsByPosition.values())
    : null;
  const jp4a = liveDiag
    ? createJp4aHostBindings(liveDiag, (slot) => {
      walk.xrSelectSlot(scene, slot);
      publishXrContent(scene);
    })
    : null;
  const xr = new XrRuntime({
    renderer: scene.renderer,
    scene: scene.scene,
    camera: scene.camera,
    collide: (oldX, oldZ, newX, newZ, storeWidth, minZ) =>
      scene.constrainWalkPosition(oldX, oldZ, newX, newZ, storeWidth, minZ),
    getStoreWidth: () => scene.getStoreWidth(),
    getBackWallZ: () => scene.backWallZ,
    pickSlot: (origin, direction, maxDist) =>
      walk.pickWalkSlotFromRay(scene, origin, direction, maxDist),
    onSelectSlot: (slot) => {
      walk.xrSelectSlot(scene, slot);
      publishXrContent(scene);
    },
    onConsole: (msg, type) => scene.onConsoleLog(msg, type),
    getVideoElement: () => scene.xrVideoGetter?.() ?? null,
    requestRender: () => scene.requestRender(),
    getSettingsScene: () => scene,
    setXrAnimationLoop: (enabled) => {
      if (enabled) scene.claimXrRenderLoop();
      scene.renderer.setAnimationLoop(enabled
        ? (time?: number) => {
          scene.xr?.prepareXrFrame(typeof time === 'number' ? time : performance.now());
          pumpTextureUploads();
          animate(time);
        }
        : null);
    },
    claimRenderLoop: () => scene.claimXrRenderLoop(),
    onSessionChange: (presenting) => {
      if (presenting) {
        if (document.pointerLockElement === scene.renderer.domElement) {
          document.exitPointerLock();
        }
      } else {
        restoreDesktopLoop();
      }
      scene.onXrSessionChange?.(presenting);
    },
    onLocomotionTick: () => {
      updatePosterWorkingSet(scene);
      // publishXrContent traverses the entire scene. It belongs on structural
      // changes/selection, not every 72Hz XR tick; detail reconciliation above
      // already has its own pose hysteresis.
    },
    onJp4aLockSlot: jp4a?.onJp4aLockSlot,
    cycleJp4aMode: jp4a?.cycleJp4aMode,
    cycleJp4aVerdict: jp4a?.cycleJp4aVerdict,
    tickJp4aDiagnostic: jp4a?.tickJp4aDiagnostic,
    jp4aDiagnosticSnapshot: jp4a?.jp4aDiagnosticSnapshot,
    advanceJp4aTestPhase: jp4a?.advanceJp4aTestPhase,
    beginJp4aFocus: jp4a?.beginJp4aFocus,
    applyJp4aTriggerCommand: jp4a?.applyJp4aTriggerCommand,
  });
  (window as unknown as { __xrDiagnostics?: unknown }).__xrDiagnostics = () => scene.xr?.diagnostics ?? null;
  (window as unknown as { __xrContent?: unknown }).__xrContent = () => xrContentSnapshot();
  installPosterDetailTestHooks(scene);
  if (liveDiag && jp4a) {
    let triggerPress: Jp4aTriggerPressState = emptyJp4aTriggerPressState();
    let triggerSource: Jp4aTriggerSourceState = emptyJp4aTriggerSourceState();
    let prevLeftTrigger = false;
    let prevRightTrigger = false;
    const visibleSlots = () => [...scene.slotsByPosition.values()].filter((slot) => !slot.hidden);
    const firstVisible = () => visibleSlots()[0] ?? null;
    const resetLive = () => {
      triggerPress = emptyJp4aTriggerPressState();
      triggerSource = emptyJp4aTriggerSourceState();
      prevLeftTrigger = false;
      prevRightTrigger = false;
      jp4a.resetProductionSelectCount();
      liveDiag.reset(() => scene.requestRender());
    };
    registerJp4aLiveDiagnosticReset(resetLive);
    (window as unknown as { __livePosterDiag?: unknown }).__livePosterDiag = () => liveDiag.observation();
    (window as unknown as { __jp4aLiveControl?: unknown }).__jp4aLiveControl = {
      reset: resetLive,
      snapshot: () => liveDiag.observation(false),
      hasLock: () => liveDiag.hasLock(),
      lockFirstVisible: () => {
        const slot = firstVisible();
        return slot ? liveDiag.lock(slot) : null;
      },
      beginApproach: () => liveDiag.beginApproach(),
      beginFocus: () => jp4a.beginJp4aFocus(),
      cycle: (direction: -1 | 1) => liveDiag.cycle(direction),
      cycleVerdict: () => liveDiag.cycleVerdict(),
      productionSelectCount: () => jp4a.productionSelectCount(),
      triggerPress: () => ({
        ...triggerPress,
        source: triggerSource.source,
        ambiguous: triggerSource.ambiguous,
      }),
      resetTrigger: () => {
        triggerPress = emptyJp4aTriggerPressState();
        triggerSource = emptyJp4aTriggerSourceState();
        prevLeftTrigger = false;
        prevRightTrigger = false;
      },
      stepHandedTrigger: (input: {
        leftTrigger: boolean;
        rightTrigger: boolean;
        leftHit?: 0 | 1 | null;
        rightHit?: 0 | 1 | null;
        now: number;
        leftConnected?: boolean;
        rightConnected?: boolean;
      }) => {
        const slots = visibleSlots();
        const resolve = (index: 0 | 1 | null | undefined) =>
          index === 0 || index === 1 ? slots[index] ?? null : null;
        const handed = stepJp4aHandedTrigger({
          press: triggerPress,
          source: triggerSource,
          leftTrigger: input.leftTrigger,
          rightTrigger: input.rightTrigger,
          prevLeftTrigger,
          prevRightTrigger,
          leftConnected: input.leftConnected !== false,
          rightConnected: input.rightConnected !== false,
          leftHit: resolve(input.leftHit),
          rightHit: resolve(input.rightHit),
          now: input.now,
          phase: jp4aTestSnapshot()?.testPhase ?? 'BASELINE',
          hasLock: liveDiag.hasLock(),
        });
        triggerPress = handed.press;
        triggerSource = handed.source;
        prevLeftTrigger = input.leftTrigger;
        prevRightTrigger = input.rightTrigger;
        jp4a.applyJp4aTriggerCommand(handed.command);
        const locked = liveDiag.lockedSlot();
        const lockedIndex = locked ? slots.findIndex((slot) => slot === locked) : -1;
        return {
          command: handed.command?.type ?? null,
          cancelled: handed.cancelled,
          phase: jp4aTestSnapshot()?.testPhase ?? null,
          verdicts: jp4aTestSnapshot()?.modeVerdicts ?? null,
          mode: jp4aTestSnapshot()?.mode ?? null,
          locked: liveDiag.hasLock(),
          lockedIndex,
          productionSelectCount: jp4a.productionSelectCount(),
          source: triggerSource.source,
          ambiguous: triggerSource.ambiguous,
          press: { ...triggerPress, target: !!triggerPress.target },
        };
      },
      stepTrigger: (down: boolean, now: number, useHit = true) => {
        const session = jp4aTestSnapshot();
        const rising = down && !triggerPress.down;
        const hit = rising && useHit ? firstVisible() : triggerPress.target;
        const stepped = stepJp4aTrigger({
          prev: triggerPress,
          triggerDown: down,
          now,
          hit,
          phase: session?.testPhase ?? 'BASELINE',
          hasLock: liveDiag.hasLock(),
        });
        triggerPress = stepped.press;
        jp4a.applyJp4aTriggerCommand(stepped.command);
        return {
          command: stepped.command?.type ?? null,
          phase: jp4aTestSnapshot()?.testPhase ?? null,
          verdicts: jp4aTestSnapshot()?.modeVerdicts ?? null,
          mode: jp4aTestSnapshot()?.mode ?? null,
          locked: liveDiag.hasLock(),
          productionSelectCount: jp4a.productionSelectCount(),
          press: { ...triggerPress, target: !!triggerPress.target },
        };
      },
      controllerAssociation: () => xr.jp4aControllerAssociationSeam(),
      startupRace: () => xr.jp4aControllerAssociationSeam(),
    };
  }
  (window as unknown as { __closeRangeProbe?: unknown }).__closeRangeProbe = () => {
    const samples = closeRangeSweepPlan().map((step) => inspectCloseRangePosters(scene.scene, step, 'mono'));
    return {
      classification: 'IWER_EMULATED',
      samples,
      worldReady: xrContentSnapshot().worldReady,
      QUEST_HARDWARE: 'NOT_EXECUTED',
    };
  };
  (window as unknown as { __stereoSignage?: unknown }).__stereoSignage = () => {
    const mask = userCameraMask(scene.camera);
    const samples = sampleSignageStereo(scene.scene, mask);
    return {
      classification: 'IWER_EMULATED',
      samples: samples.slice(0, 24),
      pass: stereoSignagePass(samples),
      negativeControl: negativeControlLeftEyeOnly(mask),
      QUEST_HARDWARE: 'NOT_EXECUTED',
    };
  };
  (window as unknown as { __hwPosterDiag?: unknown }).__hwPosterDiag = () => scene.xr?.hwPosterDiagSnapshot?.() ?? { enabled: false };
  (window as unknown as { __cycleHwPosterDiag?: unknown }).__cycleHwPosterDiag = () => scene.xr?.cycleHwPosterDiag?.() ?? null;
  (window as unknown as { __xrUiPlacement?: unknown }).__xrUiPlacement = () => lastUiPlacementEvidence();
  (window as unknown as { __xrViewerPose?: unknown }).__xrViewerPose = () => latestViewerPose();
  (window as unknown as { __xrUploadMetrics?: unknown }).__xrUploadMetrics = () => xrUploadMetricsSnapshot();
  publishXrPerfDiagnostics();
  publishXrContent(scene);
  return xr;
}

export function publishStoreWorldContent(scene: StoreScene): void {
  publishXrContent(scene);
}

function publishXrContent(scene: StoreScene): void {
  const poster = textureArrayManager.memorySnapshot();
  let signage = 0;
  let logos = 0;
  let fixtures = 0;
  let canvas = 0;
  let media = 0;
  let crt = 0;
  let floorWall = 0;
  scene.scene.traverse((obj) => {
    const data = (obj as { userData?: { isSign?: boolean; propScreen?: boolean } }).userData;
    const cls = classifyObjectName(obj.name || '');
    const mesh = obj as {
      visible?: boolean;
      material?: { map?: { isCanvasTexture?: boolean; isVideoTexture?: boolean } }
        | Array<{ map?: { isCanvasTexture?: boolean; isVideoTexture?: boolean } }>;
    };
    if (mesh.visible === false) return;
    const mats = mesh.material
      ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      : [];
    for (const mat of mats) {
      const map = mat?.map;
      if (!map) continue;
      if (map.isCanvasTexture) canvas++;
      if (map.isVideoTexture) media++;
    }
    // Fascia lettering is isSign meshes. Do not invent a separate fascia class
    // from a name-prefix count of 0.
    if (data?.isSign || cls === 'signage') signage++;
    if (cls === 'storeLogos') logos++;
    if (cls === 'fixtureTextures') fixtures++;
    if (data?.propScreen || cls === 'crt') crt++;
    if (cls === 'floorWallMaterials') floorWall++;
  });
  if (scene.storefrontLogo3D) logos = Math.max(logos, 1);
  fixtures = Math.max(fixtures, scene.slottedFixtures.length);
  const art = posterArtSample();
  const prev = xrContentLiveState();
  const posterReady = Math.max(art.withArtCount, prev.posterUploaded ?? 0, prev.posterVisible ?? 0);
  setXrContentLiveState({
    posterAllocated: Math.max(poster.catalogTitleCount, poster.physicalSlots, posterReady, prev.posterAllocated ?? 0),
    posterDecoded: posterReady,
    posterUploaded: posterReady,
    posterVisible: posterReady,
    signageVisible: signage,
    aisleFasciaVisible: signage,
    brandPackReady: brandPackStatus() !== 'failed',
    canvasTexturesAllocated: canvas,
    fixtureTexturesVisible: fixtures,
    storeLogosVisible: logos,
    crtReady: crt > 0,
    crtActivated: false,
    floorWallReady: floorWall > 0 || canvas > 0,
    mediaSurfacesReady: media,
    mediaActivated: media > 0,
    environmentReady: !!scene.scene.environment,
  });
  const snap = xrContentSnapshot();
  const extras = ['brandPack', 'canvasTextures', 'fixtureTextures', 'storeLogos', 'floorWallMaterials'] as const;
  noteStoreWorldClassProgress({
    signageExpected: signage,
    signageReady: snap.signage.state === 'ready' ? signage : 0,
    otherExpected: extras.length,
    otherReady: extras.filter((cls) => snap[cls].state === 'ready').length,
  });
  refreshStoreVisualReady();
}

export async function probeXr(scene: StoreScene): Promise<boolean> {
  return scene.xr?.probe() ?? false;
}

export async function enterXr(scene: StoreScene): Promise<void> {
  await scene.xr?.enter();
}

export async function exitXr(scene: StoreScene): Promise<void> {
  await scene.xr?.exit();
}
