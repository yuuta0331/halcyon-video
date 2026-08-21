// Initial world-stable placement for the Quest hardware poster diagnostic.
// Viewer position is already in store/world units; distance is supplied in
// meters and converted exactly once.

export const HW_DIAG_DISTANCE_M = 1.05;

export interface HardwarePosterWorldPlacement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  distanceM: number;
}

export function placeHardwarePosterFromViewer(input: {
  viewerX: number;
  viewerY: number;
  viewerZ: number;
  viewerYaw: number;
  storeUnitsPerMeter: number;
  distanceM?: number;
}): HardwarePosterWorldPlacement {
  const distanceM = input.distanceM ?? HW_DIAG_DISTANCE_M;
  const distanceStore = distanceM * input.storeUnitsPerMeter;
  return {
    x: input.viewerX - Math.sin(input.viewerYaw) * distanceStore,
    y: input.viewerY,
    z: input.viewerZ - Math.cos(input.viewerYaw) * distanceStore,
    // PlaneGeometry and the production case front both have local +Z normals.
    // Rotating +Z by viewer yaw points the normal from poster back to viewer.
    yaw: input.viewerYaw,
    distanceM,
  };
}

export function posterFrontFacesViewer(input: {
  posterX: number;
  posterZ: number;
  posterYaw: number;
  viewerX: number;
  viewerZ: number;
}, minDot = 0.999): boolean {
  const dx = input.viewerX - input.posterX;
  const dz = input.viewerZ - input.posterZ;
  const len = Math.hypot(dx, dz);
  if (len <= 1e-8) return false;
  const normalX = Math.sin(input.posterYaw);
  const normalZ = Math.cos(input.posterYaw);
  return normalX * (dx / len) + normalZ * (dz / len) >= minDot;
}
