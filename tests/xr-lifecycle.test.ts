import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bindSessionWithPresentingRace,
  canExitPhase,
  sessionReadyForOptionalLayers,
  startupAborted,
} from '../src/xr/session-lifecycle.ts';
import { shouldInstallIwer } from '../src/xr/emu-policy.ts';
import {
  compositorFailureFallsBack,
  layerConstructionMustNotAbortSession,
  shouldInitOptionalCompositor,
} from '../src/xr/compositor-policy.ts';
import {
  chooseXrRenderPath,
  desktopComposerForbidden,
  xrOwnsFrames,
} from '../src/xr/render-invariant.ts';
import { readXrFlags } from '../src/xr/flags.ts';
import { classifyXrEnvironment } from '../src/xr/classification.ts';
import { immersiveVrRequestOptions } from '../src/xr/session-policy.ts';
import { restoreGlTextureState, snapshotGlTextureState, withRestoredGlTextureState } from '../src/xr/gl-state.ts';
import { ignoreHandTrackingSource } from '../src/xr/input-policy.ts';
import {
  applyRigLocomotion,
  headingForward,
  initialSnapTurnState,
  rigDoesNotWriteHmdPose,
  stepLocomotion,
  xrHeadBobAmount,
} from '../src/xr/locomotion.ts';
import { isIwerActive } from '../src/xr/emu-state.ts';
import { simulateSetSessionOrdering } from '../src/xr/direct-render-cycle.ts';

test('renderer presenting before setSession resolves uses direct render', async () => {
  const result = await bindSessionWithPresentingRace({
    setSession: async (onPresenting) => {
      onPresenting();
      await Promise.resolve();
    },
  });
  assert.equal(result.presentingBeforeResolve, true);
  assert.equal(result.firstCallbackPath, 'direct');
  assert.equal(result.phaseAtFirstCallback, 'binding');
  assert.equal(result.phaseAfterResolve, 'projecting');
});

test('EffectComposer is forbidden while renderer.xr.isPresenting', () => {
  assert.equal(desktopComposerForbidden(true), true);
  assert.equal(chooseXrRenderPath({ rendererPresenting: true, hasComposer: true }), 'direct');
  assert.equal(chooseXrRenderPath({ rendererPresenting: false, hasComposer: true }), 'composer');
  assert.equal(xrOwnsFrames({ rendererPresenting: true, xrLoopArmed: false }), true);
  assert.equal(xrOwnsFrames({ rendererPresenting: false, xrLoopArmed: true }), true);
});

test('first XR world render completes before optional compositor', () => {
  assert.equal(shouldInitOptionalCompositor({
    worldRenderCompleted: false, setSessionResolved: true, minimal: false, layersRequested: true,
  }), false);
  assert.equal(shouldInitOptionalCompositor({
    worldRenderCompleted: true, setSessionResolved: true, minimal: false, layersRequested: true,
  }), true);
  assert.equal(sessionReadyForOptionalLayers({
    phase: 'projecting', firstWorldRenderCompletedAt: 1, setSessionResolved: true, minimal: false,
  }), true);
  assert.equal(sessionReadyForOptionalLayers({
    phase: 'projecting', firstWorldRenderCompletedAt: null, setSessionResolved: true, minimal: false,
  }), false);
});

test('Layers construction throw does not abort projection XR', () => {
  const fallback = compositorFailureFallsBack(new Error('createQuadLayer failed'));
  assert.equal(fallback.path, 'mesh-fallback');
  assert.match(fallback.error ?? '', /createQuadLayer/);
});

test('minimal XR policy disables optional compositor', () => {
  const flags = readXrFlags('?xrMinimal=1');
  assert.equal(flags.minimal, true);
  assert.equal(flags.layers, false);
  assert.equal(shouldInitOptionalCompositor({
    worldRenderCompleted: true, setSessionResolved: true, minimal: true, layersRequested: true,
  }), false);
});

test('bare XR flag is distinct from xrMinimal', () => {
  const minimal = readXrFlags('?xrMinimal=1');
  const bare = readXrFlags('?xrBare=1');
  assert.equal(minimal.minimal, true);
  assert.equal(minimal.bare, false);
  assert.equal(bare.bare, true);
  assert.equal(bare.layers, false);
  assert.equal(bare.raw, false);
  assert.equal(bare.threeBaseline, false);
});

test('no-layers policy omits the layers optional feature', () => {
  const flags = readXrFlags('?xrLayers=0');
  assert.equal(flags.layers, false);
  const opts = immersiveVrRequestOptions({ layers: flags.layers });
  assert.equal(opts.optionalFeatures.includes('layers'), false);
  assert.ok(opts.optionalFeatures.includes('local-floor'));
});

test('emulator classification is not Quest hardware', () => {
  assert.equal(classifyXrEnvironment({
    hasWindow: true, immersiveVrSupported: true, iwerActive: true, nativeXrAvailable: false,
  }), 'IWER_EMULATED');
  assert.equal(classifyXrEnvironment({
    hasWindow: true, immersiveVrSupported: true, iwerActive: false, nativeXrAvailable: true,
    userAgent: 'OculusBrowser Quest 3',
  }), 'QUEST_HARDWARE');
  assert.equal(classifyXrEnvironment({
    hasWindow: true, immersiveVrSupported: false, iwerActive: false, nativeXrAvailable: false,
  }), 'DESKTOP_BROWSER');
  assert.equal(classifyXrEnvironment({
    hasWindow: false, immersiveVrSupported: false, iwerActive: false, nativeXrAvailable: false,
  }), 'UNIT');
  assert.equal(isIwerActive(), false);
});

test('rig owns locomotion; HMD pose stays runtime-owned', () => {
  const hmd = { pitch: 0.2, yaw: -0.1, roll: 0 };
  assert.equal(rigDoesNotWriteHmdPose(hmd, { ...hmd }), true);
  const { step } = stepLocomotion({
    stickX: 0, stickY: -1, snapX: 0, headingYaw: 0, dt: 0.1,
  }, initialSnapTurnState());
  const posed = applyRigLocomotion({
    x: 13, z: 12.5, yaw: 0, step,
    collide: (_ox, _oz, nx, nz) => ({ x: nx, z: nz }),
    storeWidth: 40, minZ: -20,
  });
  const fwd = headingForward(0);
  assert.ok(posed.z < 12.5);
  assert.ok(fwd.z < 0);
  assert.equal(xrHeadBobAmount(0.7, true), 0);
});

test('snap turn changes rig yaw and collision is reused', () => {
  const { step } = stepLocomotion({
    stickX: 0, stickY: 0, snapX: 1, headingYaw: 0, dt: 0.016,
  }, initialSnapTurnState());
  assert.equal(step.snapped, true);
  let collided = false;
  const posed = applyRigLocomotion({
    x: 13, z: 12.5, yaw: 0, step,
    collide: (ox, oz, nx, nz) => { collided = true; return { x: nx, z: nz }; },
    storeWidth: 40, minZ: -20,
  });
  assert.ok(posed.yaw !== 0);
  assert.equal(collided, true);
});

test('controller input policy still ignores hand tracking', () => {
  assert.equal(ignoreHandTrackingSource({ hand: {} }), true);
  assert.equal(ignoreHandTrackingSource({ targetRayMode: 'tracked-pointer' }), false);
});

test('exit is allowed during binding/projecting startup', () => {
  assert.equal(canExitPhase('binding'), true);
  assert.equal(canExitPhase('projecting'), true);
  assert.equal(canExitPhase('active'), true);
  assert.equal(canExitPhase('idle'), false);
  assert.equal(canExitPhase('ending'), false);
});

test('GL compositor upload restores texture binding and unpack state', () => {
  const state = {
    TEXTURE_2D: 3553,
    TEXTURE_BINDING_2D: 32873,
    ACTIVE_TEXTURE: 34016,
    UNPACK_FLIP_Y_WEBGL: 37440,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441,
    UNPACK_ALIGNMENT: 3317,
    tex: 'orig',
    active: 33984,
    flip: false,
    premul: false,
    align: 4,
  };
  const gl = {
    TEXTURE_2D: state.TEXTURE_2D,
    TEXTURE_BINDING_2D: state.TEXTURE_BINDING_2D,
    ACTIVE_TEXTURE: state.ACTIVE_TEXTURE,
    UNPACK_FLIP_Y_WEBGL: state.UNPACK_FLIP_Y_WEBGL,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: state.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
    UNPACK_ALIGNMENT: state.UNPACK_ALIGNMENT,
    getParameter(pname: number) {
      if (pname === state.TEXTURE_BINDING_2D) return state.tex;
      if (pname === state.ACTIVE_TEXTURE) return state.active;
      if (pname === state.UNPACK_FLIP_Y_WEBGL) return state.flip;
      if (pname === state.UNPACK_PREMULTIPLY_ALPHA_WEBGL) return state.premul;
      if (pname === state.UNPACK_ALIGNMENT) return state.align;
      return null;
    },
    activeTexture(v: number) { state.active = v; },
    bindTexture(_t: number, v: unknown) { state.tex = v as string; },
    pixelStorei(pname: number, v: number) {
      if (pname === state.UNPACK_FLIP_Y_WEBGL) state.flip = !!v;
      if (pname === state.UNPACK_PREMULTIPLY_ALPHA_WEBGL) state.premul = !!v;
      if (pname === state.UNPACK_ALIGNMENT) state.align = v;
    },
  };
  const snap = snapshotGlTextureState(gl as unknown as WebGLRenderingContext);
  gl.bindTexture(gl.TEXTURE_2D, 'layer');
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  restoreGlTextureState(gl as unknown as WebGLRenderingContext, snap);
  assert.equal(state.tex, 'orig');
  assert.equal(state.flip, false);
  const threw = withRestoredGlTextureState(gl as unknown as WebGLRenderingContext, () => {
    throw new Error('texSubImage2D failed');
  });
  assert.equal(threw.ok, false);
  assert.equal(state.tex, 'orig');
});

test('production sources do not statically import iwer', () => {
  const install = readFileSync('src/dev/install-xr-emu.ts', 'utf8');
  assert.match(install, /import\.meta\.env\.DEV/);
  assert.match(install, /iwer-runtime/);
  const main = readFileSync('src/main.ts', 'utf8');
  assert.equal(/\bfrom ['"]iwer['"]/.test(main), false);
  assert.equal(/\bfrom ['"]@iwer\/devui['"]/.test(main), false);
  const runtime = readFileSync('src/xr/runtime.ts', 'utf8');
  assert.equal(/\bfrom ['"]iwer['"]/.test(runtime), false);
});

test('IWER installs only when emu is requested and native immersive-vr is absent', () => {
  assert.deepEqual(shouldInstallIwer({ emuRequested: false, nativeImmersiveVrSupported: false }), {
    install: false, forceInstall: false,
  });
  assert.deepEqual(shouldInstallIwer({ emuRequested: true, nativeImmersiveVrSupported: true }), {
    install: false, forceInstall: false,
  });
  assert.deepEqual(shouldInstallIwer({ emuRequested: true, nativeImmersiveVrSupported: false }), {
    install: true, forceInstall: true,
  });
});

test('session end during startup aborts enter; IWER UA is not Quest hardware', () => {
  const sess = {};
  assert.equal(startupAborted({
    expectedSession: sess, currentSession: null, phase: 'idle', ending: false,
  }), true);
  assert.equal(startupAborted({
    expectedSession: sess, currentSession: sess, phase: 'binding', ending: false,
  }), false);
  assert.equal(canExitPhase('requesting'), true);
  assert.equal(layerConstructionMustNotAbortSession(true, true), true);
  assert.equal(classifyXrEnvironment({
    hasWindow: true, immersiveVrSupported: true, iwerActive: true, nativeXrAvailable: false,
    userAgent: 'OculusBrowser Quest 3',
  }), 'IWER_EMULATED');
});

test('reveal waits for STORE_VISUAL_READY, not P0-only settlement', () => {
  const stock = readFileSync('src/store-stock.ts', 'utf8');
  assert.match(stock, /storeVisualReadyPromise/);
  assert.match(stock, /beginStoreVisibleLoading/);
  assert.match(stock, /STORE_VISIBLE_BASE/);
  assert.match(stock, /allTexturesSettledPromise/);
  assert.match(stock, /peekIndex\(slot\.movie\.id\)/);
  const main = readFileSync('src/main.ts', 'utf8');
  const revealIdx = main.indexOf('scene.texturesReadyPromise.then');
  assert.ok(revealIdx > 0);
  const hideIdx = main.indexOf('hideBootOverlay();', revealIdx);
  assert.ok(hideIdx > revealIdx);
});

test('setSession ordering A: XR callback before setSession resolves', async () => {
  const log = await simulateSetSessionOrdering('callback-before-resolve');
  assert.equal(log.events[0], 'xr-animation-callback');
  assert.ok(log.events.indexOf('setSession-resolved') > log.events.indexOf('afterDirectRender'));
  assert.equal(log.events.includes('path:direct'), true);
  assert.equal(log.composerDuringPresenting, false);
  assert.equal(log.firstRendererRenderCompleted, true);
  assert.equal(log.compositorAfterFirstRender, true);
});

test('setSession ordering B: setSession resolves before first XR callback', async () => {
  const log = await simulateSetSessionOrdering('resolve-before-callback');
  assert.equal(log.events[0], 'setSession-resolved');
  assert.ok(log.events.indexOf('xr-animation-callback') > 0);
  assert.equal(log.events.includes('path:direct'), true);
  assert.equal(log.composerDuringPresenting, false);
  assert.equal(log.firstRendererRenderCompleted, true);
  assert.equal(log.compositorAfterFirstRender, true);
  assert.ok(log.events.indexOf('optional-compositor') > log.events.indexOf('afterDirectRender'));
});

test('XR slot raycast binds Raycaster.camera before set()', () => {
  const walk = readFileSync('src/store-walk.ts', 'utf8');
  assert.match(walk, /export function bindSlotRaycaster/);
  assert.match(walk, /raycaster\.camera\s*=\s*camera/);
  assert.match(walk, /bindSlotRaycaster\(scene\._raycaster,\s*scene\.camera,\s*origin,\s*direction,\s*maxDist\)/);
  const sprite = readFileSync('node_modules/three/src/objects/Sprite.js', 'utf8');
  assert.match(sprite, /Raycaster\.camera" needs to be set/);
  assert.match(sprite, /raycaster\.camera\.matrixWorld/);
});

test('StoreScene XR path records world render around renderer.render', () => {
  const scene = readFileSync('src/three-scene.ts', 'utf8');
  assert.match(scene, /this\.xr\.renderWorld\(this\.renderer, this\.scene, this\.camera\)/);
  assert.doesNotMatch(scene, /this\.xr\.preRender\(\);\s*\n\s*this\.renderer\.render/);
  const runtime = readFileSync('src/xr/runtime.ts', 'utf8');
  assert.match(runtime, /beforeDirectRender/);
  assert.match(runtime, /afterDirectRender/);
  assert.match(runtime, /firstWorldRenderCompletedAt/);
  assert.match(runtime, /createXrBootScene/);
  assert.match(runtime, /XR_BOOT_STABLE_FRAMES/);
  assert.match(runtime, /this\.afterDirectRender\(\)/);
  assert.match(runtime, /renderer\.render\(boot \? this\.bootScene! : scene, camera\)/);
});

