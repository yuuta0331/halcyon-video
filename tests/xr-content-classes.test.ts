import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decorativeXrSafeContentClasses,
  onDemandRequiredContentClasses,
  requiredXrSafeContentClasses,
  worldRequiredContentClasses,
  xrSafeClassEnabled,
  desktopClassEnabled,
  classifyObjectName,
  contentClassPolicy,
} from '../src/xr/content-classes.ts';
import {
  decorativeExpectedDisabled,
  noteOnDemandWrapRequest,
  onDemandReady,
  requiredContentVisible,
  requiredWorldContentParity,
  resetXrContentLiveStateForTests,
  setXrContentLiveState,
  worldRequiredReady,
  xrContentSnapshot,
} from '../src/xr/content-diagnostics.ts';
import { setXrUploadPresenting, textureUploadUsesWindowRaf } from '../src/perf/upload-policy.ts';
import {
  blankGpuCapabilities,
  resetResourceProfileForTests,
  setActiveResourceProfile,
  xrSafeProfile,
  desktopFullProfile,
} from '../src/perf/resource-profile.ts';
import { estimateXrSafeFragmentSamplers } from '../src/perf/resource-profile.ts';
import { PosterResidencyWindow } from '../src/poster-residency.ts';

function worldReadyCounts(over: Record<string, unknown> = {}) {
  return {
    posterAllocated: 128,
    posterDecoded: 40,
    posterUploaded: 40,
    posterVisible: 40,
    signageVisible: 4,
    brandPackReady: true,
    canvasTexturesAllocated: 12,
    fixtureTexturesVisible: 3,
    storeLogosVisible: 1,
    floorWallReady: true,
    ...over,
  };
}

test('WORLD_REQUIRED classification is explicit and enabled in XR_SAFE', () => {
  const world = worldRequiredContentClasses();
  assert.deepEqual(world.sort(), [
    'aisleFascia', 'brandPack', 'canvasTextures', 'fixtureTextures',
    'floorWallMaterials', 'poster', 'signage', 'storeLogos',
  ].sort());
  for (const cls of world) {
    assert.equal(contentClassPolicy(cls)?.requirement, 'WORLD_REQUIRED', cls);
    assert.equal(xrSafeClassEnabled(cls), true, cls);
    assert.equal(desktopClassEnabled(cls), true, cls);
  }
});

test('ON_DEMAND_REQUIRED classification is wraps, CRT, and media', () => {
  assert.deepEqual(onDemandRequiredContentClasses().sort(), ['crt', 'mediaSurfaces', 'wraps'].sort());
  for (const cls of onDemandRequiredContentClasses()) {
    assert.equal(contentClassPolicy(cls)?.requirement, 'ON_DEMAND_REQUIRED', cls);
    assert.equal(xrSafeClassEnabled(cls), true, cls);
  }
});

test('DECORATIVE XR_SAFE classes stay disabled', () => {
  for (const cls of decorativeXrSafeContentClasses()) {
    assert.equal(xrSafeClassEnabled(cls), false, cls);
    assert.equal(desktopClassEnabled(cls), true, cls);
  }
});

test('resource profile still obeys existing sampler/memory policy', () => {
  resetResourceProfileForTests();
  const profile = xrSafeProfile(blankGpuCapabilities({ maxTextures: 16 }));
  setActiveResourceProfile(profile);
  assert.equal(profile.poster.physicalSlots, 128);
  assert.ok(estimateXrSafeFragmentSamplers() <= 16);
  assert.equal(profile.composer, false);
  assert.equal(profile.n8ao, false);
  assert.equal(profile.liveMirrors, false);
  assert.equal(profile.framebufferScale, 0.5);
  resetResourceProfileForTests();
});

test('poster residency invariants remain unchanged', () => {
  const win = new PosterResidencyWindow(128);
  assert.equal(win.residentCount, 0);
  const a = win.acquire('a', 'P0');
  const b = win.acquire('b', 'P1');
  assert.ok(a && b);
  assert.notEqual(a.index, b.index);
  assert.equal(win.residentCount, 2);
  assert.ok(win.residentCount <= 128);
  const inv = win.validateInvariants();
  assert.equal(inv.ok, true);
  assert.equal(inv.duplicateOwners, 0);
  assert.equal(inv.freeOwnedCollisions, 0);
});

test('pending is not ready for an active WORLD_REQUIRED class', () => {
  resetXrContentLiveStateForTests();
  setXrContentLiveState(worldReadyCounts({ posterVisible: 0, posterUploaded: 0, posterDecoded: 0, posterAllocated: 10 }));
  const snap = xrContentSnapshot('XR_SAFE');
  assert.equal(snap.poster.state, 'pending');
  assert.equal(snap.worldReady, false);
  assert.equal(snap.requiredReady, false);
  assert.equal(worldRequiredReady(snap), false);
});

test('world parity fails if one WORLD_REQUIRED class is missing', () => {
  resetXrContentLiveStateForTests();
  setXrContentLiveState(worldReadyCounts({ storeLogosVisible: 0 }));
  const snap = xrContentSnapshot('XR_SAFE');
  assert.equal(snap.storeLogos.state, 'missing');
  assert.equal(requiredWorldContentParity(snap), false);
  assert.equal(snap.worldReady, false);
});

test('world parity passes only when the WORLD_REQUIRED set is satisfied', () => {
  resetXrContentLiveStateForTests();
  setXrContentLiveState(worldReadyCounts());
  const snap = xrContentSnapshot('XR_SAFE');
  assert.equal(snap.poster.state, 'ready');
  assert.equal(snap.signage.state, 'ready');
  assert.equal(snap.aisleFascia.state, 'ready');
  assert.equal(snap.aisleFascia.representedBy, 'signage');
  assert.equal(snap.wraps.state, 'pending');
  assert.equal(snap.wraps.activation, 'idle');
  assert.equal(snap.crt.state, 'pending');
  assert.equal(snap.worldReady, true);
  assert.equal(requiredWorldContentParity(snap), true);
  assert.equal(requiredContentVisible(snap), true);
  assert.equal(decorativeExpectedDisabled(snap), true);
  const json = JSON.stringify(snap);
  assert.equal(/https?:\/\//.test(json), false);
  assert.equal(/apiKey|token|Password/i.test(json), false);
});

test('selected wrap starts lazy and becomes ready after request plus upload', () => {
  resetXrContentLiveStateForTests();
  setXrContentLiveState(worldReadyCounts({ wrapsAllocated: 0, wrapsUploaded: 0, wrapsVisible: 0 }));
  const idle = xrContentSnapshot('XR_SAFE');
  assert.equal(idle.wraps.requirement, 'ON_DEMAND_REQUIRED');
  assert.equal(idle.wraps.activation, 'idle');
  assert.equal(idle.wraps.state, 'pending');
  assert.equal(onDemandReady(idle, 'wraps'), false);
  assert.equal(idle.worldReady, true);

  noteOnDemandWrapRequest('title-1');
  const requested = xrContentSnapshot('XR_SAFE');
  assert.equal(requested.wraps.activation, 'requested');
  assert.equal(requested.wraps.state, 'pending');
  assert.equal(onDemandReady(requested, 'wraps'), false);

  setXrContentLiveState({ wrapsAllocated: 1, wrapsDecoded: 1, wrapsUploaded: 1, wrapsVisible: 0 });
  const ready = xrContentSnapshot('XR_SAFE');
  assert.equal(ready.wraps.state, 'ready');
  assert.equal(onDemandReady(ready, 'wraps'), true);
  assert.equal(ready.onDemandWrapsReady, true);
});

test('diagnostics do not overclaim fascia or CRT readiness', () => {
  resetXrContentLiveStateForTests();
  setXrContentLiveState(worldReadyCounts({ crtReady: true, crtActivated: false, aisleFasciaVisible: 0 }));
  const snap = xrContentSnapshot('XR_SAFE');
  assert.equal(snap.aisleFascia.representedBy, 'signage');
  assert.equal(snap.aisleFascia.state, snap.signage.state);
  assert.equal(snap.crt.requirement, 'ON_DEMAND_REQUIRED');
  assert.equal(snap.crt.activation, 'idle');
  assert.equal(snap.crt.state, 'pending');
  assert.equal(onDemandReady(snap, 'crt'), false);
  assert.equal(snap.mediaSurfaces.requirement, 'ON_DEMAND_REQUIRED');
});

test('object name classifier stays secret-free', () => {
  assert.equal(classifyObjectName('game-rentals-2for10-signs'), 'signage');
  assert.equal(classifyObjectName('storefrontLogo3D'), 'storeLogos');
  assert.equal(classifyObjectName('wall-stripe-1990'), 'floorWallMaterials');
  assert.equal(classifyObjectName('heroFront'), 'wraps');
});

test('DESKTOP_FULL still enables decorative effects in policy', () => {
  resetResourceProfileForTests();
  const desktop = desktopFullProfile();
  assert.equal(desktop.n8ao, true);
  assert.equal(desktop.composer, true);
  assert.equal(xrSafeClassEnabled('decorativeFx'), false);
  resetResourceProfileForTests();
});

test('requiredXrSafeContentClasses still lists world plus on-demand content', () => {
  const all = requiredXrSafeContentClasses();
  assert.ok(all.includes('poster'));
  assert.ok(all.includes('wraps'));
  assert.equal(all.includes('decorativeFx'), false);
});

test('immersive GPU uploads do not schedule window rAF', () => {
  setXrUploadPresenting(false);
  assert.equal(textureUploadUsesWindowRaf(), true);
  setXrUploadPresenting(true);
  assert.equal(textureUploadUsesWindowRaf(), false);
  setXrUploadPresenting(false);
});
