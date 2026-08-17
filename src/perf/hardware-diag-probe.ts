// DESKTOP_BROWSER A/B/C/D/E fixture render. Not Quest hardware.

import * as THREE from 'three';
import {
  HardwarePosterDiagnostic,
  hardwarePosterDiagRequested,
  HW_POSTER_DIAG_MODES,
  hwPosterDiagModeMeta,
} from '../xr/hardware-poster-diagnostic.ts';
import { bothXrEyesSeeLayer, MIRROR_SKIP_LAYER } from '../scene-layers.ts';

export function runHardwarePosterDiagProbe(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const contextLost = typeof gl.isContextLost === 'function' && gl.isContextLost();
  const diag = new HardwarePosterDiagnostic();
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(70, 1, 0.05, 80);
  cam.position.set(0, 1.25, 0);
  diag.attach(scene);
  const modes: Record<string, { visible: boolean; meta: ReturnType<typeof hwPosterDiagModeMeta>; glError: number }> = {};
  for (const mode of HW_POSTER_DIAG_MODES) {
    diag.setMode(mode);
    renderer.render(scene, cam);
    const err = gl.getError();
    modes[mode] = {
      visible: true,
      meta: hwPosterDiagModeMeta(mode),
      glError: err,
    };
  }
  diag.dispose();
  const user = (1 << 0) | (1 << 1) | (1 << MIRROR_SKIP_LAYER);
  const stereo = bothXrEyesSeeLayer(user, 0) && bothXrEyesSeeLayer(user, MIRROR_SKIP_LAYER);
  const pass = !contextLost
    && hardwarePosterDiagRequested('') === false
    && stereo
    && HW_POSTER_DIAG_MODES.every((m) => modes[m]?.glError === 0);
  return {
    classification: 'DESKTOP_BROWSER' as const,
    QUEST_HARDWARE: 'NOT_EXECUTED',
    pass,
    contextLost,
    stereoBothEyesEligible: stereo,
    normalLaunchUnaffected: hardwarePosterDiagRequested('') === false,
    modes,
    note: 'Fixture render only. Does not diagnose Quest black artifact.',
  };
}
