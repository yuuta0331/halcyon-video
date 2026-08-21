// WebXR copies camera.near into session depthNear (meters). The store
// desktop near of 0.1 is store-feet; passing it through yields a ~10 cm
// compositor clip that blacks out posters when the HMD leans in.

export const XR_DEPTH_NEAR_M = 0.03;
export const DESKTOP_CAMERA_NEAR = 0.1;

export function applyXrDepthNear(camera: { near: number; far: number; updateProjectionMatrix?: () => void }): number {
  const prev = camera.near;
  camera.near = XR_DEPTH_NEAR_M;
  camera.updateProjectionMatrix?.();
  return prev;
}

export function restoreCameraNear(
  camera: { near: number; updateProjectionMatrix?: () => void },
  near: number,
): void {
  camera.near = near;
  camera.updateProjectionMatrix?.();
}
