import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blankGpuCapabilities,
  choosePhysicalPosterSlots,
  estimateXrSafeFragmentSamplers,
  readResourceFlags,
  resetResourceProfileForTests,
  selectResourceProfile,
  setActiveResourceProfile,
  xrSafeProfile,
} from '../src/perf/resource-profile.ts';
import { PosterResidencyWindow, desktopPosterArrayBytes } from '../src/poster-residency.ts';
import { choosePosterBankLayout } from '../src/perf/poster-bank-layout.ts';
import { xrQualityPolicy } from '../src/xr/quality.ts';
import { XR_TARGET_HZ } from '../src/xr/session-policy.ts';
import { blankXrDiagnostics } from '../src/xr/diagnostics.ts';
import { readXrFlags } from '../src/xr/flags.ts';
import { gpuDiagnosticsSnapshot, setGpuLiveState } from '../src/xr/gpu-diagnostics.ts';

test('URL flags distinguish bare, safe, and desktop quality', () => {
  assert.equal(readResourceFlags('?xrBare=1').bare, true);
  assert.equal(readResourceFlags('?xrSafe=1').safe, true);
  assert.equal(readResourceFlags('?xrDesktopQuality=1').desktopQuality, true);
  assert.equal(readResourceFlags('?xrEmu=1').emu, true);
  assert.equal(readResourceFlags('?xrCatalog=4000').catalog, 4000);
  assert.equal(readResourceFlags('?xrMinimal=1').bare, false);
});

test('Quest UA and IWER select XR_SAFE; desktop Chrome stays DESKTOP_FULL even at 16 texture units', () => {
  const low = blankGpuCapabilities({ maxTextures: 16, maxArrayTextureLayers: 256 });
  const quest = selectResourceProfile({
    caps: blankGpuCapabilities({ maxTextures: 32, maxArrayTextureLayers: 2048 }),
    flags: readResourceFlags(''),
    userAgent: 'Mozilla/5.0 (Linux; Android 12; Quest 3) OculusBrowser/35.0',
  });
  const desktopChrome = selectResourceProfile({
    caps: low,
    flags: readResourceFlags(''),
    userAgent: 'Mozilla/5.0 Chrome/120',
  });
  const desktopOverride = selectResourceProfile({
    caps: blankGpuCapabilities({ maxTextures: 32, maxArrayTextureLayers: 2048 }),
    flags: readResourceFlags('?xrDesktopQuality=1'),
    userAgent: 'Mozilla/5.0 (Linux; Android 12; Quest 3) OculusBrowser/35.0',
  });
  const emu = selectResourceProfile({
    caps: low,
    flags: readResourceFlags('?xrEmu=1'),
    userAgent: 'Mozilla/5.0 Chrome/120',
  });
  assert.equal(quest.name, 'XR_SAFE');
  assert.equal(desktopChrome.name, 'DESKTOP_FULL');
  assert.equal(desktopOverride.name, 'DESKTOP_FULL');
  assert.equal(emu.name, 'XR_SAFE');
});

test('XR_SAFE stays valid at maxTextures 16 and array-layer 256/512', () => {
  for (const layers of [256, 512, 2048]) {
    const caps = blankGpuCapabilities({ maxTextures: 16, maxArrayTextureLayers: layers });
    const profile = xrSafeProfile(caps);
    assert.equal(profile.composer, false);
    assert.equal(profile.n8ao, false);
    assert.equal(profile.gtao, false);
    assert.equal(profile.bokeh, false);
    assert.equal(profile.shadows, false);
    assert.equal(profile.liveMirrors, false);
    assert.equal(profile.reflectionProbes, false);
    assert.equal(profile.environmentBake, 'bootstrap');
    assert.equal(profile.singleShelfPosterSampler, true);
    assert.equal(profile.poster.mode, 'stable-store-visible');
    assert.equal(profile.poster.physicalSlots, Math.min(2048, layers));
    assert.ok(estimateXrSafeFragmentSamplers() <= caps.maxTextures);
  }
});

test('physical poster slots follow the array-layer ceiling per bank', () => {
  const a = choosePhysicalPosterSlots(blankGpuCapabilities({ maxTextures: 16, maxArrayTextureLayers: 256 }));
  const b = choosePhysicalPosterSlots(blankGpuCapabilities({ maxTextures: 16, maxArrayTextureLayers: 512 }));
  const c = choosePhysicalPosterSlots(blankGpuCapabilities({ maxTextures: 16, maxArrayTextureLayers: 2048 }));
  assert.equal(a, 256);
  assert.equal(b, 512);
  assert.equal(c, 2048);
});

test('XR_SAFE catalog layout covers titles with stable banks, not a 128 eviction window', () => {
  const capsLayers = 256;
  for (const n of [200, 1000, 2000, 4000]) {
    const layout = choosePosterBankLayout({
      uniqueTitles: n,
      maxArrayTextureLayers: capsLayers,
    });
    assert.equal(layout.evictionWindow, false);
    assert.ok(layout.bankCount >= 1);
    assert.ok(layout.totalLayers >= Math.min(n, layout.bankCount * layout.layersPerBank));
    assert.ok(layout.cpuBytesEstimated > 0);
    assert.ok(layout.gpuBytesEstimated > 0);
    assert.equal(layout.samplersPerDraw, 1);
  }
  const at256_2001 = choosePosterBankLayout({ uniqueTitles: 2001, maxArrayTextureLayers: 256 });
  const at256_4000 = choosePosterBankLayout({ uniqueTitles: 4000, maxArrayTextureLayers: 256 });
  assert.ok(at256_2001.bankCount >= 8);
  assert.equal(at256_4000.bankCount, 16);
  assert.equal(at256_4000.capacityOk, true);
  const small = choosePosterBankLayout({ uniqueTitles: 200, maxArrayTextureLayers: capsLayers });
  const large = choosePosterBankLayout({ uniqueTitles: 1000, maxArrayTextureLayers: capsLayers });
  assert.ok(large.bankCount >= small.bankCount);
  assert.ok(large.cpuBytesEstimated > small.cpuBytesEstimated);
});

test('desktop catalog-wide arrays still scale with title count', () => {
  const small = desktopPosterArrayBytes(200, 2048).posterArrayCpuBytesEstimated;
  const large = desktopPosterArrayBytes(800, 2048).posterArrayCpuBytesEstimated;
  assert.ok(large > small * 2);
});

test('residency window evicts P3 before P0 and promotes on acquire', () => {
  const win = new PosterResidencyWindow(2);
  win.acquire('a', 'P0');
  win.acquire('b', 'P3');
  const third = win.acquire('c', 'P1');
  assert.equal(third.evicted, 'b');
  assert.equal(win.peek('a'), 0);
  assert.equal(win.peek('b'), null);
  assert.equal(win.peek('c'), 1);
  const fourth = win.acquire('d', 'P1');
  assert.equal(fourth.ok, true);
  assert.equal(fourth.evicted, 'c');
  assert.equal(win.peek('a'), 0);
  assert.equal(win.peek('c'), null);
  assert.equal(win.validateInvariants().ok, true);
});

test('XR_SAFE quality policy is a real lightweight graph', () => {
  resetResourceProfileForTests();
  setActiveResourceProfile(xrSafeProfile(blankGpuCapabilities({ maxTextures: 16 })));
  const policy = xrQualityPolicy();
  assert.equal(policy.resourceProfile, 'XR_SAFE');
  assert.equal(policy.n8ao, false);
  assert.equal(policy.postprocessing, 'none');
  assert.equal(policy.framebufferScale, 0.8);
  assert.equal(policy.foveation, 0.5);
  assert.equal(policy.shadows, false);
  assert.equal(policy.compositionLayers, false);
  assert.equal(policy.targetHz, XR_TARGET_HZ);
});

test('XR_SAFE estimated sampler use fits a 16-unit GPU', () => {
  assert.ok(estimateXrSafeFragmentSamplers() <= 16);
  const profile = xrSafeProfile(blankGpuCapabilities({ maxTextures: 16 }));
  assert.ok(profile.estimatedFragmentSamplers <= 16);
  assert.equal(profile.singleShelfPosterSampler, true);
  assert.equal(estimateXrSafeFragmentSamplers(), 4);
});

test('XR_SAFE poster policy is stable-store-visible; quality drops before eviction', () => {
  const profile = xrSafeProfile(blankGpuCapabilities({ maxTextures: 16, maxArrayTextureLayers: 2048 }));
  assert.equal(profile.poster.mode, 'stable-store-visible');
  assert.equal(profile.poster.physicalSlots, 2048);
  assert.equal(profile.framebufferScale, 0.8);
});

test('XR_SAFE diagnostic quality agrees with the resource policy', () => {
  resetResourceProfileForTests();
  setActiveResourceProfile(xrSafeProfile(blankGpuCapabilities({ maxTextures: 16 })));
  const d = blankXrDiagnostics(readXrFlags('?xrSafe=1&xrEmu=1'));
  assert.equal(d.quality.n8ao, false);
  assert.equal(d.quality.postprocessing, 'none');
  assert.equal(d.quality.framebufferScale, 0.8);
  const gpu = gpuDiagnosticsSnapshot();
  assert.equal(gpu.n8aoAllocated, false);
  assert.equal(gpu.composerAllocated, false);
  assert.equal(gpu.xrFramebufferScaleRequested, 0.8);
  assert.equal(d.quality.n8ao, gpu.n8aoAllocated);
  assert.equal(d.quality.framebufferScale, gpu.xrFramebufferScaleRequested);
});

test('GPU diagnostics expose residency invariants and fail-closed counts', () => {
  resetResourceProfileForTests();
  setActiveResourceProfile(xrSafeProfile(blankGpuCapabilities({ maxTextures: 16 })));
  setGpuLiveState({
    poster: {
      catalogTitleCount: 2001,
      physicalSlots: 128,
      residentCount: 80,
      freeCount: 48,
      uniqueOwners: 80,
      residentHighWaterMark: 90,
      evictionCount: 12,
      staleUploadDrops: 3,
      residencyInvariantOk: true,
      duplicatePhysicalOwners: 0,
      freeOwnedCollisions: 0,
      orphanMovieMappings: 0,
      orphanSlotMappings: 0,
      cpuBytes: 1,
      gpuBytes: 1,
      cacheBytes: 0,
      cacheBudget: 1,
      p0UniqueTitles: 40,
      p1UniqueTitles: 80,
      p2UniqueTitles: 100,
      p3UniqueTitles: 200,
      p0PlusP1UniqueTitles: 120,
      posterWorkingSetVersion: 1,
      posterPinnedCount: 0,
      bootPinsActive: false,
      posterInitialP0Count: 40,
      posterInitialP1ResidentCount: 80,
      acquisitionCount: 90,
      reacquisitionCount: 2,
    },
  });
  const gpu = gpuDiagnosticsSnapshot();
  assert.equal(gpu.posterPhysicalSlots, 128);
  assert.equal(gpu.posterResidentTitles, 80);
  assert.equal(gpu.posterResidencyInvariantOk, true);
  assert.equal(gpu.posterDuplicatePhysicalOwners, 0);
  assert.equal(gpu.p0UniqueTitles, 40);
  assert.equal(gpu.bootPinsActive, false);
  assert.equal(gpu.posterWorkingSetVersion, 1);
  assert.ok((gpu.p0UniqueTitles ?? 0) <= (gpu.posterPhysicalSlots ?? 0));
});
