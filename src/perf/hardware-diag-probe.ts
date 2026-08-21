// DESKTOP_BROWSER A/B/C/D/E fixture render. Not Quest hardware.

import * as THREE from 'three';
import { createHardwarePosterDiagnostic } from '../xr/hw-diag-factory.ts';
import { hardwarePosterDiagRequested, HW_POSTER_DIAG_MODES } from '../xr/hardware-poster-diagnostic.ts';
import { bothXrEyesSeeLayer, MIRROR_SKIP_LAYER } from '../scene-layers.ts';
import {
  hwDiagObserveSnapshot,
  resetHwDiagObserveForTests,
  suppressHwDiagProductionBind,
} from './hw-diag-observe.ts';

export function runHardwarePosterDiagProbe(renderer: THREE.WebGLRenderer) {
  resetHwDiagObserveForTests();
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const contextLost = typeof gl.isContextLost === 'function' && gl.isContextLost();
  const diag = createHardwarePosterDiagnostic({ worldAnchor: 'origin' });
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1));
  scene.add(new THREE.DirectionalLight(0xffffff, 0.8));
  const rig = new THREE.Group();
  scene.add(rig);
  const cam = new THREE.PerspectiveCamera(70, 1, 0.05, 80);
  cam.position.set(0, 1.25, 0);
  diag.attach(scene, rig);

  const beforeMove = diag.contentWorldPosition();
  rig.position.set(2.4, 0, -1.1);
  rig.rotation.y = 0.7;
  scene.updateMatrixWorld(true);
  const afterMove = diag.contentWorldPosition();
  const worldStable = beforeMove.distanceTo(afterMove) < 1e-6;

  const drainGl = () => {
    let guard = 0;
    while (gl.getError() !== 0 && guard++ < 16) { /* consume */ }
  };
  const modes: Record<string, ReturnType<typeof diag.snapshot>> = {};
  for (const mode of HW_POSTER_DIAG_MODES) {
    diag.setMode(mode);
    drainGl();
    renderer.render(scene, cam);
    const err = gl.getError();
    modes[mode] = { ...diag.snapshot(err, contextLost) };
  }

  const bindBefore = hwDiagObserveSnapshot().diagBankBindCount;
  suppressHwDiagProductionBind(true);
  diag.setMode('C');
  renderer.render(scene, cam);
  const bindWhileSuppressed = hwDiagObserveSnapshot().diagBankBindCount;
  suppressHwDiagProductionBind(false);
  renderer.render(scene, cam);
  const bindAfterRestore = hwDiagObserveSnapshot().diagBankBindCount;
  const negativeControl = bindWhileSuppressed === bindBefore && bindAfterRestore > bindWhileSuppressed;

  const c = modes.C;
  const d = modes.D;
  const e = modes.E;
  const productionC = c?.observed?.compileCount > 0 && c?.production?.shaderPath === 'posterShaderChunk+posterArrayUniforms';
  const productionD = d?.production?.detailLutEnabled === true && d?.observed?.diagLutBindCount > 0;
  const productionE = e?.production?.focusEnabled === true && e?.observed?.diagFocusBindCount > 0;
  const user = (1 << 0) | (1 << 1) | (1 << MIRROR_SKIP_LAYER);
  const stereo = bothXrEyesSeeLayer(user, 0) && bothXrEyesSeeLayer(user, MIRROR_SKIP_LAYER);
  const pass = !contextLost
    && hardwarePosterDiagRequested('') === false
    && stereo
    && worldStable
    && negativeControl
    && productionC === true
    && productionD === true
    && productionE === true
    && HW_POSTER_DIAG_MODES.every((m) => modes[m]?.glError === 0);

  diag.dispose();
  resetHwDiagObserveForTests();
  return {
    classification: 'DESKTOP_BROWSER' as const,
    QUEST_HARDWARE: 'NOT_EXECUTED',
    pass,
    contextLost,
    stereoBothEyesEligible: stereo,
    normalLaunchUnaffected: hardwarePosterDiagRequested('') === false,
    worldStable,
    negativeControl,
    productionC,
    productionD,
    productionE,
    bindBefore,
    bindWhileSuppressed,
    bindAfterRestore,
    modes,
    note: 'Observed production hooks. Does not diagnose Quest black artifact.',
  };
}
