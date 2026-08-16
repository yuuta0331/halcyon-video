// Belt-and-suspenders: both XR eyes must see mirror-skip world content
// (layer 3). Three.js already subtracts layer 1 from the right eye and
// layer 2 from the left; we only add layer 0 + 3.

import type { WebGLRenderer } from 'three';
import { MIRROR_SKIP_LAYER } from '../scene-layers.ts';

export function ensureXrEyesSeeWorld(renderer: WebGLRenderer): void {
  const xr = renderer.xr as unknown as {
    getCamera?: () => { cameras?: Array<{ layers: { enable(n: number): void } }> };
  };
  const cam = xr.getCamera?.();
  if (!cam?.cameras) return;
  for (const eye of cam.cameras) {
    eye.layers.enable(0);
    eye.layers.enable(MIRROR_SKIP_LAYER);
  }
}
