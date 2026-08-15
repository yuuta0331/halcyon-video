// XR attach helpers — extracted from StoreScene so three-scene.ts stays
// under its file budget. Type-only import of StoreScene avoids a cycle.

import type { StoreScene } from './three-scene';
import { XrRuntime } from './xr/runtime';
import * as walk from './store-walk';

export function attachXrRuntime(
  scene: StoreScene,
  animate: (time?: number) => void,
  restoreDesktopLoop: () => void,
): XrRuntime {
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
    onSelectSlot: (slot) => walk.xrSelectSlot(scene, slot),
    onConsole: (msg, type) => scene.onConsoleLog(msg, type),
    getVideoElement: () => scene.xrVideoGetter?.() ?? null,
    requestRender: () => scene.requestRender(),
    setXrAnimationLoop: (enabled) => {
      scene.renderer.setAnimationLoop(enabled
        ? (time?: number) => {
          scene.xr?.noteXrFrame(typeof time === 'number' ? time : performance.now());
          animate(time);
        }
        : null);
    },
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
  });
  (window as unknown as { __xrDiagnostics?: unknown }).__xrDiagnostics = () => scene.xr?.diagnostics ?? null;
  return xr;
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
