import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  detectPlatform,
  metersFromStoreUnits,
  resetPlatformCache,
  setXrSessionActive,
  STORE_UNITS_PER_METER,
  storeUnitsFromMeters,
} from '../src/platform/index.ts';
import {
  immersiveVrRequestOptions,
  layersIsOptionalFeature,
  pickReferenceSpaceType,
  pickXrTargetHz,
  probeImmersiveVrSupported,
  sessionCanStartWithoutLayers,
  tauriAllowsWebXr,
  XR_OPTIONAL_FEATURES,
  XR_REQUIRED_FEATURES,
  XR_TARGET_HZ,
} from '../src/xr/session-policy.ts';
import {
  competingLoops,
  initialFrameScheduler,
  reduceFrameScheduler,
  shouldSelfScheduleRaf,
  shouldUseSetAnimationLoop,
} from '../src/xr/loop.ts';
import {
  applyXrQualityOverride,
  restoreDesktopQuality,
  xrQualityPolicy,
} from '../src/xr/quality.ts';
import {
  applyRigLocomotion,
  headingForward,
  initialSnapTurnState,
  rigDoesNotWriteHmdPose,
  stepLocomotion,
  xrHeadBobAmount,
  XR_SNAP_RAD,
} from '../src/xr/locomotion.ts';
import {
  composeLayerStack,
  detectLayerCapabilities,
  probeLayerApis,
  XrLayerManager,
} from '../src/xr/layers.ts';
import { xrEntryShouldShow } from '../src/xr/entry.ts';
import { ignoreHandTrackingSource, readXrGamepadStick } from '../src/xr/input-policy.ts';
import { planMediaLayer, xrMediaLayerFlag } from '../src/xr/media.ts';
import { panelIsHeadLocked, panelUsesIndependentResolution, xrPanelContent } from '../src/xr/panel-content.ts';
import { getLocale, resetLocaleCache, setLocale, t } from '../src/i18n/index.ts';
import { HALCYON_JP_PACK_ID } from '../src/bundled-brand-packs.ts';

test('desktop/browser without WebXR stays the pre-JP-3 default', () => {
  const p = detectPlatform({ tauri: false, xr: false });
  assert.equal(p.kind, 'browser');
  assert.equal(p.xrAvailability, 'unsupported');
  assert.equal(p.isXrSession, false);
  assert.equal(p.requiresAnimationLoop, false);
  assert.equal(p.worldUnits, 'store');
});

test('Tauri remains a non-WebXR platform even if xr is present', () => {
  const p = detectPlatform({ tauri: true, xr: true, xrSession: true });
  assert.equal(p.kind, 'tauri');
  assert.equal(p.xrAvailability, 'unsupported');
  assert.equal(p.isXrSession, false);
  assert.equal(p.requiresAnimationLoop, false);
  assert.equal(tauriAllowsWebXr(true), false);
  assert.equal(xrEntryShouldShow({ isTauri: true, immersiveVrSupported: true }), false);
});

test('XR capability is recorded without starting a session', () => {
  const p = detectPlatform({ tauri: false, xr: true });
  assert.equal(p.xrAvailability, 'capable-inactive');
  assert.equal(p.isXrSession, false);
  assert.equal(p.requiresAnimationLoop, false);
});

test('platform XR state transitions: inactive → session → inactive', () => {
  resetPlatformCache();
  setXrSessionActive(true);
  const on = detectPlatform({ tauri: false, xr: true, xrSession: true });
  assert.equal(on.xrAvailability, 'session-active');
  assert.equal(on.isXrSession, true);
  assert.equal(on.requiresAnimationLoop, true);
  setXrSessionActive(false);
  const off = detectPlatform({ tauri: false, xr: true, xrSession: false });
  assert.equal(off.xrAvailability, 'capable-inactive');
  assert.equal(off.isXrSession, false);
  assert.equal(off.requiresAnimationLoop, false);
  resetPlatformCache();
});

test('immersive-vr support probe: unsupported / supported / Tauri', async () => {
  assert.equal(await probeImmersiveVrSupported({ isTauri: true, xr: { isSessionSupported: async () => true } }), false);
  assert.equal(await probeImmersiveVrSupported({ isTauri: false, xr: null }), false);
  assert.equal(await probeImmersiveVrSupported({
    isTauri: false,
    xr: { isSessionSupported: async (mode) => mode === 'immersive-vr' },
  }), true);
  assert.equal(await probeImmersiveVrSupported({
    isTauri: false,
    xr: { isSessionSupported: async () => false },
  }), false);
});

test('session request options include layers as optional, never required', () => {
  const opts = immersiveVrRequestOptions();
  assert.deepEqual(opts.optionalFeatures, [...XR_OPTIONAL_FEATURES]);
  assert.ok(opts.optionalFeatures.includes('layers'));
  assert.ok(opts.optionalFeatures.includes('local-floor'));
  assert.equal((opts.requiredFeatures ?? []).includes('layers'), false);
  assert.equal(XR_REQUIRED_FEATURES.length, 0);
  assert.equal(layersIsOptionalFeature(opts), true);
  assert.equal(sessionCanStartWithoutLayers(opts), true);
});

test('session can start without Layers support', () => {
  assert.equal(sessionCanStartWithoutLayers({ optionalFeatures: ['layers'] }), true);
  assert.equal(sessionCanStartWithoutLayers({ optionalFeatures: [], requiredFeatures: ['layers'] }), false);
});

test('reference-space policy prefers local-floor then local then viewer', async () => {
  const tried: string[] = [];
  const type = await pickReferenceSpaceType(async (tpe) => {
    tried.push(tpe);
    if (tpe !== 'local') throw new Error('nope');
  });
  assert.equal(type, 'local');
  assert.deepEqual(tried, ['local-floor', 'local']);
});

test('store unit ↔ meter invariants stay the JP-0 contract', () => {
  assert.equal(STORE_UNITS_PER_METER, 3.28084);
  assert.equal(storeUnitsFromMeters(1), 3.28084);
  assert.ok(Math.abs(metersFromStoreUnits(3.28084) - 1) < 1e-9);
  assert.ok(Math.abs(storeUnitsFromMeters(1.6) - 5.249344) < 1e-9);
});

test('frame scheduler never arms competing loops', () => {
  let s = initialFrameScheduler();
  s = reduceFrameScheduler(s, 'start-desktop');
  assert.equal(s.mode, 'desktop-raf');
  assert.equal(shouldSelfScheduleRaf(s), true);
  assert.equal(shouldUseSetAnimationLoop(s), false);
  assert.equal(competingLoops(s), false);
  s = reduceFrameScheduler(s, 'enter-xr');
  assert.equal(s.mode, 'xr-animation-loop');
  assert.equal(shouldSelfScheduleRaf(s), false);
  assert.equal(shouldUseSetAnimationLoop(s), true);
  assert.equal(competingLoops(s), false);
  s = reduceFrameScheduler(s, 'exit-xr');
  assert.equal(s.mode, 'desktop-raf');
  assert.equal(competingLoops(s), false);
  s = reduceFrameScheduler(s, 'stop');
  assert.equal(s.mode, 'stopped');
});

test('locomotion does not write HMD pitch/yaw and reuses collision', () => {
  const hmd = { pitch: 0.31, yaw: -0.44, roll: 0.02 };
  const after = { ...hmd };
  assert.equal(rigDoesNotWriteHmdPose(hmd, after), true);

  const hits: number[][] = [];
  const collide = (oldX: number, oldZ: number, newX: number, newZ: number) => {
    hits.push([oldX, oldZ, newX, newZ]);
    return { x: oldX, z: oldZ }; // wall
  };
  const { step, snap } = stepLocomotion({
    stickX: 0,
    stickY: -1,
    snapX: 0,
    headingYaw: 0,
    dt: 0.1,
  }, initialSnapTurnState());
  assert.equal(step.moving, true);
  const fwd = headingForward(0);
  assert.ok(Math.abs(fwd.z + 1) < 1e-9);
  const posed = applyRigLocomotion({
    x: 13, z: 12.5, yaw: 0, step, collide, storeWidth: 40, minZ: -20,
  });
  assert.equal(posed.x, 13);
  assert.equal(posed.z, 12.5);
  assert.equal(hits.length, 1);
  assert.ok(hits[0][3] < 12.5, 'forward along -Z');
  void snap;
});

test('desktop head bob is disabled in XR', () => {
  assert.equal(xrHeadBobAmount(0.8, true), 0);
  assert.equal(xrHeadBobAmount(0.8, false), 0.8);
});

test('snap-turn semantics: 30°, cooldown, release to re-arm', () => {
  let snap = initialSnapTurnState();
  const first = stepLocomotion({
    stickX: 0, stickY: 0, snapX: 1, headingYaw: 0, dt: 0.016,
  }, snap);
  assert.equal(first.step.snapped, true);
  assert.ok(Math.abs(first.step.yawDelta + XR_SNAP_RAD) < 1e-9);
  snap = first.snap;
  const held = stepLocomotion({
    stickX: 0, stickY: 0, snapX: 1, headingYaw: 0, dt: 0.016,
  }, snap);
  assert.equal(held.step.snapped, false);
  snap = held.snap;
  snap = stepLocomotion({
    stickX: 0, stickY: 0, snapX: 0, headingYaw: 0, dt: 0.4,
  }, snap).snap;
  const second = stepLocomotion({
    stickX: 0, stickY: 0, snapX: -1, headingYaw: 0, dt: 0.016,
  }, snap);
  assert.equal(second.step.snapped, true);
  assert.ok(Math.abs(second.step.yawDelta - XR_SNAP_RAD) < 1e-9);
});

test('compositor layer capability detection and mesh fallback', () => {
  const none = detectLayerCapabilities(probeLayerApis({
    enabledFeatures: [],
    usingProjectionLayer: false,
  }));
  assert.equal(none.compositorUi, false);
  assert.equal(none.fallback, 'mesh');

  const on = detectLayerCapabilities({
    layersFeatureEnabled: true,
    hasWebGLBinding: true,
    hasCreateProjectionLayer: true,
    hasCreateQuadLayer: true,
    hasCreateCylinderLayer: true,
    hasMediaBinding: true,
    maxRenderLayers: 4,
    usingProjectionLayer: true,
  });
  assert.equal(on.compositorUi, true);
  assert.equal(on.mediaLayer, true);
  assert.ok(on.types.includes('XRQuadLayer'));
});

test('layer ordering is owned centrally and respects maxRenderLayers', () => {
  const applied: object[][] = [];
  const proj = { id: 'proj' };
  const ui = { id: 'ui' };
  const media = { id: 'media' };
  const mgr = new XrLayerManager((layers) => applied.push(layers), 2);
  mgr.setProjectionLayer(proj);
  mgr.createUiLayer(ui);
  mgr.createVideoLayer(media);
  const last = applied.at(-1)!;
  assert.deepEqual(last, [proj, ui]);
  const composed = composeLayerStack([
    { kind: 'media', layer: media },
    { kind: 'ui', layer: ui },
    { kind: 'projection', layer: proj },
  ], 3);
  assert.deepEqual(composed.layers, [proj, ui, media]);
  mgr.dispose();
  assert.deepEqual(mgr.currentLayers(), []);
});

test('maxRenderLayers guard drops extra compositor layers', () => {
  const stacked = composeLayerStack([
    { kind: 'projection', layer: { a: 1 } },
    { kind: 'ui', layer: { a: 2 } },
    { kind: 'media', layer: { a: 3 } },
  ], 1);
  assert.equal(stacked.layers.length, 1);
  assert.deepEqual(stacked.dropped, ['ui', 'media']);
});

test('session-end cleanup empties the layer manager', () => {
  const mgr = new XrLayerManager(() => { /* apply */ });
  mgr.setProjectionLayer({ n: 1 });
  mgr.createUiLayer({ n: 2 });
  mgr.dispose();
  assert.deepEqual(mgr.currentLayers(), []);
});

test('XR quality policy does not rewrite desktop defaults', () => {
  const policy = xrQualityPolicy();
  assert.equal(policy.n8ao, false);
  assert.equal(policy.postprocessing, 'none');
  assert.equal(policy.targetHz, XR_TARGET_HZ);
  const snap = { n8aoEnabled: true, composerActive: true, bokehEnabled: true, bloomEnabled: true };
  assert.deepEqual(applyXrQualityOverride(), {
    n8aoEnabled: false, composerActive: false, bokehEnabled: false,
  });
  assert.deepEqual(restoreDesktopQuality(snap), snap);
});

test('frame-rate pick does not require 90/120 and survives a missing API', () => {
  assert.equal(pickXrTargetHz(null).reason, 'api-absent');
  assert.equal(pickXrTargetHz([72, 90, 120]).requested, 72);
  assert.equal(pickXrTargetHz([60, 90]).requested, 60);
});

test('no locale or Brand Pack coupling in XR policy', () => {
  resetLocaleCache();
  const enOpts = immersiveVrRequestOptions();
  setLocale('ja');
  const jaOpts = immersiveVrRequestOptions();
  assert.deepEqual(enOpts, jaOpts);
  assert.equal(getLocale(), 'ja');
  assert.equal(HALCYON_JP_PACK_ID, 'halcyon-jp');
  assert.equal(t('xr.enter'), 'VRを開始');
  setLocale('en');
  assert.equal(t('xr.enter'), 'Enter VR');
  resetLocaleCache();

  const platformSrc = readFileSync('src/platform/index.ts', 'utf8');
  assert.equal(/bb_locale|bb_brand_pack|halcyon-jp/.test(platformSrc), false);
  const policySrc = readFileSync('src/xr/session-policy.ts', 'utf8');
  assert.equal(/bb_locale|bb_brand_pack|halcyon-jp/.test(policySrc), false);
});

test('XR chrome strings exist in English and Japanese', () => {
  assert.equal(t('xr.panel.title', 'en'), 'HALCYON VIDEO — VR');
  assert.equal(t('xr.panel.title', 'ja'), 'ハルシオンビデオ — VR');
  const content = xrPanelContent({
    compositor: 'mesh-fallback',
    layersFeature: false,
    referenceSpace: 'local-floor',
    targetHz: 72,
  });
  assert.ok(content.lines.length >= 5);
  assert.equal(panelIsHeadLocked('local-floor'), false);
  assert.equal(panelIsHeadLocked('viewer'), true);
  assert.equal(panelUsesIndependentResolution(1024, 512), true);
});

test('XRMediaBinding stays behind a flag and needs a real video element', () => {
  assert.equal(xrMediaLayerFlag(''), false);
  assert.equal(xrMediaLayerFlag('?xrMedia=1'), true);
  const blocked = planMediaLayer({
    video: { readyState: 4, videoWidth: 1920 },
    flagOn: false,
    hasMediaBinding: true,
    compositorUi: true,
    droppedByBudget: false,
  });
  assert.equal(blocked.bind, false);
  assert.match(blocked.blocker ?? '', /bb_xr_media_layer/);
  const ready = planMediaLayer({
    video: { readyState: 4, videoWidth: 1920 },
    flagOn: true,
    hasMediaBinding: true,
    compositorUi: true,
    droppedByBudget: false,
  });
  assert.equal(ready.bind, true);
});

test('hand tracking sources are ignored; sticks read from XR gamepads', () => {
  assert.equal(ignoreHandTrackingSource({ hand: {} }), true);
  assert.equal(ignoreHandTrackingSource({ targetRayMode: 'tracked-pointer' }), false);
  assert.deepEqual(readXrGamepadStick({ axes: [0.1, -0.2, 0.9, -0.8] }), { x: 0.9, y: -0.8 });
});

test('Enter VR UI is hidden when immersive-vr is unsupported', () => {
  assert.equal(xrEntryShouldShow({ isTauri: false, immersiveVrSupported: false }), false);
  assert.equal(xrEntryShouldShow({ isTauri: false, immersiveVrSupported: true }), true);
  const css = readFileSync('src/styles.css', 'utf8');
  assert.match(css, /#btn-enter-vr\[hidden\]/);
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /id="btn-enter-vr"[^>]*hidden/);
});
