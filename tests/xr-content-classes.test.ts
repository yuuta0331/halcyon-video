import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decorativeXrSafeContentClasses,
  requiredXrSafeContentClasses,
  xrSafeClassEnabled,
  desktopClassEnabled,
  classifyObjectName,
} from '../src/xr/content-classes.ts';
import {
  requiredContentVisible,
  requiredWorldContentParity,
  resetXrContentLiveStateForTests,
  setXrContentLiveState,
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

test('XR_SAFE required content classes remain enabled', () => {
  for (const cls of requiredXrSafeContentClasses()) {
    assert.equal(xrSafeClassEnabled(cls), true, cls);
    assert.equal(desktopClassEnabled(cls), true, cls);
  }
});

test('decorative-only disabled resource classes stay disabled', () => {
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

test('content-class diagnostics report counts not URLs', () => {
  resetXrContentLiveStateForTests();
  setXrContentLiveState({
    posterAllocated: 128,
    posterDecoded: 40,
    posterUploaded: 40,
    posterVisible: 40,
    wrapsAllocated: 1,
    wrapsDecoded: 1,
    wrapsUploaded: 1,
    wrapsVisible: 1,
    signageVisible: 4,
    aisleFasciaVisible: 2,
    brandPackReady: true,
    canvasTexturesAllocated: 12,
    fixtureTexturesVisible: 3,
    storeLogosVisible: 1,
    crtReady: true,
    floorWallReady: true,
    mediaSurfacesReady: 2,
  });
  const snap = xrContentSnapshot('XR_SAFE');
  assert.equal(snap.decorativeFx.state, 'disabled');
  assert.equal(snap.poster.state, 'ready');
  assert.equal(snap.signage.visible, 4);
  assert.equal(requiredContentVisible(snap), true);
  assert.equal(requiredWorldContentParity(snap), true);
  const json = JSON.stringify(snap);
  assert.equal(/https?:\/\//.test(json), false);
  assert.equal(/apiKey|token|Password/i.test(json), false);
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

test('world content parity does not treat missing signage as ready', () => {
  resetXrContentLiveStateForTests();
  setXrContentLiveState({
    posterAllocated: 128,
    posterDecoded: 40,
    posterUploaded: 40,
    posterVisible: 40,
    canvasTexturesAllocated: 8,
    floorWallReady: true,
    signageVisible: 0,
    aisleFasciaVisible: 0,
    storeLogosVisible: 0,
  });
  const snap = xrContentSnapshot('XR_SAFE');
  assert.equal(requiredWorldContentParity(snap), false);
});

test('immersive GPU uploads do not schedule window rAF', () => {
  setXrUploadPresenting(false);
  assert.equal(textureUploadUsesWindowRaf(), true);
  setXrUploadPresenting(true);
  assert.equal(textureUploadUsesWindowRaf(), false);
  setXrUploadPresenting(false);
});
