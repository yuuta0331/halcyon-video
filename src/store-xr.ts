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
import { noteStoreWorldClassProgress, refreshStoreVisualReady } from './store-visual-ready';

export function attachXrRuntime(
  scene: StoreScene,
  animate: (time?: number) => void,
  restoreDesktopLoop: () => void,
): XrRuntime {
  installXrStartupJournal('HALCYON');
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
          pumpTextureUploads();
          scene.xr?.noteXrFrame(typeof time === 'number' ? time : performance.now());
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
      publishXrContent(scene);
    },
  });
  (window as unknown as { __xrDiagnostics?: unknown }).__xrDiagnostics = () => scene.xr?.diagnostics ?? null;
  (window as unknown as { __xrContent?: unknown }).__xrContent = () => xrContentSnapshot();
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
