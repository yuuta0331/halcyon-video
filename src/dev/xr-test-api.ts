// Development-only window.__xrTest. Absent/inert in production builds.

import type { XRDevice } from 'iwer';

export interface XrTestPose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface XrTestApi {
  status(): {
    classification: string;
    iwer: boolean;
    sessionOffered: boolean;
    hasActiveSession: boolean;
    deviceName: string | null;
  };
  enter(): Promise<{ ok: boolean; error?: string }>;
  exit(): Promise<{ ok: boolean; error?: string }>;
  getHeadsetPose(): XrTestPose | null;
  setHeadsetPose(pose: Partial<XrTestPose>): XrTestPose | null;
  setControllerPose(side: 'left' | 'right', pose: Partial<XrTestPose>): XrTestPose | null;
  setStick(side: 'left' | 'right', x: number, y: number): void;
  trigger(side: 'left' | 'right', pressed?: boolean): void;
  squeeze(side: 'left' | 'right', pressed?: boolean): void;
  primaryButton(side: 'left' | 'right', pressed?: boolean): void;
  openMenu(): void;
  openSettings(): void;
  uiMode(): string;
  content(): unknown;
  diagnostics(): unknown;
}

function readPose(obj: { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } }): XrTestPose {
  return {
    x: obj.position.x, y: obj.position.y, z: obj.position.z,
    qx: obj.quaternion.x, qy: obj.quaternion.y, qz: obj.quaternion.z, qw: obj.quaternion.w,
  };
}

function writePose(
  obj: { position: { set(x: number, y: number, z: number): void }; quaternion: { set(x: number, y: number, z: number, w: number): void } },
  pose: Partial<XrTestPose>,
): void {
  const cur = readPose(obj as never);
  obj.position.set(pose.x ?? cur.x, pose.y ?? cur.y, pose.z ?? cur.z);
  obj.quaternion.set(pose.qx ?? cur.qx, pose.qy ?? cur.qy, pose.qz ?? cur.qz, pose.qw ?? cur.qw);
}

function controller(device: XRDevice, side: 'left' | 'right') {
  return device.controllers[side];
}

export function createXrTestApi(getDevice: () => XRDevice | null): XrTestApi {
  const api: XrTestApi = {
    status() {
      const device = getDevice();
      return {
        classification: device ? 'IWER_EMULATED' : 'DESKTOP_BROWSER',
        iwer: !!device,
        sessionOffered: !!device?.sessionOffered,
        hasActiveSession: !!device?.activeSession,
        deviceName: device?.name ?? null,
      };
    },
    async enter() {
      const raw = (window as unknown as { __rawXr?: { enter?: () => Promise<void> } }).__rawXr;
      if (raw?.enter) {
        try {
          await raw.enter();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      const three = (window as unknown as { __threeBaseline?: { enter?: () => Promise<void> } }).__threeBaseline;
      if (three?.enter) {
        try {
          await three.enter();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      const bare = (window as unknown as {
        __bareXr?: { enter?: () => Promise<void> };
      }).__bareXr;
      if (bare?.enter) {
        try {
          await bare.enter();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      const scene = (window as unknown as {
        storeScene?: {
          enterXr?: () => Promise<void>;
          probeXr?: () => Promise<boolean>;
        };
      }).storeScene;
      try {
        if (scene?.probeXr) await scene.probeXr();
        if (scene?.enterXr) await scene.enterXr();
        else {
          const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
          if (!xr) return { ok: false, error: 'navigator.xr missing' };
          await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    async exit() {
      const raw = (window as unknown as { __rawXr?: { exit?: () => Promise<void> } }).__rawXr;
      if (raw?.exit) {
        try {
          await raw.exit();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      const three = (window as unknown as { __threeBaseline?: { exit?: () => Promise<void> } }).__threeBaseline;
      if (three?.exit) {
        try {
          await three.exit();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      const bare = (window as unknown as { __bareXr?: { exit?: () => Promise<void> } }).__bareXr;
      if (bare?.exit) {
        try {
          await bare.exit();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      const scene = (window as unknown as { storeScene?: { exitXr?: () => Promise<void> } }).storeScene;
      try {
        if (scene?.exitXr) await scene.exitXr();
        else {
          const device = getDevice();
          await device?.activeSession?.end();
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    getHeadsetPose() {
      const device = getDevice();
      return device ? readPose(device) : null;
    },
    setHeadsetPose(pose) {
      const device = getDevice();
      if (!device) return null;
      device.controlMode = 'programmatic';
      writePose(device, pose);
      device.notifyStateChange();
      return readPose(device);
    },
    setControllerPose(side, pose) {
      const device = getDevice();
      const c = device ? controller(device, side) : undefined;
      if (!device || !c) return null;
      device.controlMode = 'programmatic';
      writePose(c, pose);
      device.notifyStateChange();
      return readPose(c);
    },
    setStick(side, x, y) {
      const device = getDevice();
      const c = device ? controller(device, side) : undefined;
      if (!c) return;
      device!.controlMode = 'programmatic';
      c.updateAxes('thumbstick', x, y);
      device!.notifyStateChange();
    },
  trigger(side, pressed = true) {
    const device = getDevice();
    const c = device ? controller(device, side) : undefined;
    if (!c) return;
    device!.controlMode = 'programmatic';
    c.updateButtonValue('trigger', pressed ? 1 : 0);
    device!.notifyStateChange();
  },
  primaryButton(side: 'left' | 'right', pressed = true) {
    const device = getDevice();
    const c = device ? controller(device, side) : undefined;
    if (!c) return;
    device!.controlMode = 'programmatic';
    const name = side === 'left' ? 'x-button' : 'a-button';
    c.updateButtonValue(name, pressed ? 1 : 0);
    device!.notifyStateChange();
  },
  openMenu() {
    const xr = (window as unknown as { storeScene?: { xr?: { openXrMenu?: () => void } } }).storeScene?.xr;
    xr?.openXrMenu?.();
  },
  openSettings() {
    const xr = (window as unknown as { storeScene?: { xr?: { openXrSettings?: () => void } } }).storeScene?.xr;
    xr?.openXrSettings?.();
  },
  uiMode() {
    const xr = (window as unknown as { storeScene?: { xr?: { uiMode?: string } } }).storeScene?.xr;
    return xr?.uiMode ?? 'WORLD';
  },
  content() {
    const fn = (window as unknown as { __xrContent?: () => unknown }).__xrContent;
    return typeof fn === 'function' ? fn() : null;
  },
    squeeze(side, pressed = true) {
      const device = getDevice();
      const c = device ? controller(device, side) : undefined;
      if (!c) return;
      device!.controlMode = 'programmatic';
      c.updateButtonValue('squeeze', pressed ? 1 : 0);
      device!.notifyStateChange();
    },
    diagnostics() {
      const fn = (window as unknown as { __xrDiagnostics?: () => unknown }).__xrDiagnostics;
      return typeof fn === 'function' ? fn() : null;
    },
  };
  return api;
}

export function installXrTestApi(getDevice: () => XRDevice | null): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __xrTest?: XrTestApi }).__xrTest = createXrTestApi(getDevice);
}
