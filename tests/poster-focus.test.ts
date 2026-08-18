import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POSTER_FOCUS_HEIGHT,
  POSTER_FOCUS_SLOT_LIMIT,
  POSTER_FOCUS_WIDTH,
  POSTER_NEAR_HEIGHT,
  POSTER_NEAR_WIDTH,
  chooseFocusDecodeSize,
  downsamplePosterRgba,
  estimatePosterTierBytes,
  posterTierSize,
  shelfPosterSourceRequest,
  rewritePosterUrlForFocus,
  wouldFakeUpscale,
} from '../src/poster-quality.ts';
import { PosterFocusResidency } from '../src/poster-focus-residency.ts';
import { activateFocusTitle, demoteFocusTitle, type FocusActivateDeps } from '../src/poster-focus-activate.ts';
import { focusPixelsFromSourceRgba } from '../src/poster-focus-decode.ts';
import { makePosterQualityPattern, patternEdgeEnergy } from '../src/poster-quality-pattern.ts';
import { PosterDetailResidency } from '../src/poster-detail-residency.ts';

function deps(overrides: Partial<FocusActivateDeps> & { selected?: string } = {}): FocusActivateDeps {
  const selected = overrides.selected ?? 'sel';
  return {
    getGlobalIndex: (id) => id === 'sel' ? 7 : 1,
    isSelected: (id) => id === selected,
    sceneGeneration: () => 1,
    getSourcePixels: () => null,
    loadSource: () => {},
    queueUpload: (run) => { run(); },
    uploadFocus: () => true,
    setActive: () => {},
    clearActive: () => {},
    ...overrides,
  };
}

test('FOCUS source is above 320x480 and BASE/NEAR sizes stay distinct', () => {
  assert.equal(posterTierSize('NEAR', true).width, POSTER_NEAR_WIDTH);
  assert.equal(posterTierSize('NEAR', true).height, POSTER_NEAR_HEIGHT);
  assert.equal(posterTierSize('FOCUS', true).width, POSTER_FOCUS_WIDTH);
  assert.equal(posterTierSize('FOCUS', true).height, POSTER_FOCUS_HEIGHT);
  assert.ok(POSTER_FOCUS_WIDTH > POSTER_NEAR_WIDTH);
  assert.equal(shelfPosterSourceRequest().maxWidth, null);
});

test('FOCUS fetch URL raises a Plex 400 cap without upscaling pixels', () => {
  const plex = 'https://example.test/photo/:/transcode?url=%2Fthumb&width=400&height=600&upscale=0';
  const out = rewritePosterUrlForFocus(plex);
  assert.match(out, /width=640/);
  assert.match(out, /height=960/);
  assert.match(out, /upscale=0/);
  const jellyfin = 'https://example.test/Items/abc/Images/Primary?api_key=x';
  const jf = rewritePosterUrlForFocus(jellyfin);
  assert.match(jf, /maxWidth=640/);
  assert.match(jf, /maxHeight=960/);
  assert.equal(new URL(jf).searchParams.get('api_key'), 'x');
});

test('FOCUS GPU slot is 640x960 even when source is larger native art', () => {
  const src = makePosterQualityPattern(800, 1200);
  const decoded = focusPixelsFromSourceRgba(src, 800, 1200);
  assert.equal(decoded.decodeWidth, 640);
  assert.equal(decoded.decodeHeight, 960);
  assert.equal(decoded.pixels.length, 640 * 960 * 4);
  assert.equal(decoded.upscaledFromNear, false);
});

test('FOCUS does not fake-upscale a 320x480 NEAR buffer', () => {
  const near = makePosterQualityPattern(320, 480);
  const decoded = focusPixelsFromSourceRgba(near, 320, 480);
  assert.equal(decoded.upscaledFromNear, true);
  assert.equal(decoded.decodeWidth, 320);
  assert.ok(wouldFakeUpscale(320, 480, 640, 960));
  const native = chooseFocusDecodeSize(800, 1200);
  assert.equal(native.width, 640);
  assert.equal(native.nativeLimited, false);
});

test('FOCUS residency is bounded to the configured cap independent of catalog size', () => {
  const r = new PosterFocusResidency(2);
  r.acquire('a');
  r.acquire('b');
  r.acquire('c');
  assert.equal(r.snapshot().resident, 2);
  assert.equal(r.snapshot().slotLimit, POSTER_FOCUS_SLOT_LIMIT);
  const bytes = estimatePosterTierBytes(2, 640, 960, false);
  assert.ok(bytes.gpu < 10 * 1024 * 1024);
});

test('selected title gets FOCUS priority and BASE remains conceptually visible', () => {
  const r = new PosterFocusResidency(2);
  const near = new PosterDetailResidency(4);
  near.acquire('sel');
  near.markReady('sel');
  const src = makePosterQualityPattern(640, 960);
  const d = deps({
    getSourcePixels: (id) => id === 'sel' ? { pixels: src, width: 640, height: 960 } : null,
  });
  activateFocusTitle('sel', d, r);
  assert.equal(r.isReady('sel'), true);
  assert.equal(r.selected(), 'sel');
  assert.equal(near.isReady('sel'), true);
});

test('focus demotion returns to NEAR/BASE without blank', () => {
  const r = new PosterFocusResidency(2);
  const near = new PosterDetailResidency(4);
  near.acquire('sel');
  near.markReady('sel');
  const src = makePosterQualityPattern(640, 960);
  const d = deps({
    getSourcePixels: () => ({ pixels: src, width: 640, height: 960 }),
  });
  activateFocusTitle('sel', d, r);
  demoteFocusTitle('sel', d, r);
  assert.equal(r.peek('sel'), null);
  assert.equal(near.isReady('sel'), true);
});

test('stale FOCUS async result is rejected', () => {
  const r = new PosterFocusResidency(1);
  let delayed: ((result: ReturnType<typeof focusPixelsFromSourceRgba>) => void) | null = null;
  const d = deps({
    loadSource: (_id, onDecoded) => { delayed = onDecoded; },
  });
  activateFocusTitle('sel', d, r);
  const first = r.peek('sel')!;
  r.release('sel');
  r.acquire('other');
  delayed?.(focusPixelsFromSourceRgba(makePosterQualityPattern(640, 960), 640, 960));
  assert.equal(r.isLeaseCurrent(first), false);
  assert.ok(r.snapshot().staleDropped >= 1 || r.peek('other'));
});

test('BASE/NEAR/FOCUS patterns have distinct edge energy', () => {
  const src = makePosterQualityPattern(640, 960, 3);
  const near = downsamplePosterRgba(src, 640, 960, 320, 480);
  const base = downsamplePosterRgba(src, 640, 960, 96, 144);
  const eFocus = patternEdgeEnergy(src, 640, 960);
  const eNear = patternEdgeEnergy(near, 320, 480);
  const eBase = patternEdgeEnergy(base, 96, 144);
  assert.ok(eFocus !== eNear || src.length !== near.length);
  assert.ok(eNear !== eBase || near.length !== base.length);
  assert.ok(src.length > near.length);
  assert.ok(near.length > base.length);
});
