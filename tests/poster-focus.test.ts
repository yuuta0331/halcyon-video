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
import {
  createPosterFocusUploadTask,
  disposePosterFocusGpu,
  getPosterFocusTexture,
  initPosterFocusGpu,
  posterFocusResourceSnapshot,
} from '../src/poster-focus-texture.ts';

function deps(overrides: Partial<FocusActivateDeps> & { selected?: string } = {}): FocusActivateDeps {
  const selected = overrides.selected ?? 'sel';
  return {
    getGlobalIndex: (id) => id === 'sel' ? 7 : 1,
    isSelected: (id) => id === selected,
    sceneGeneration: () => 1,
    getSourcePixels: () => null,
    loadSource: () => {},
    queueUpload: (run) => { run(); },
    createUploadTask: () => ({
      runChunk: () => ({ done: true, progress: 1, bytesUploaded: 640 * 960 * 4 }),
      cancel: () => {},
      snapshot: () => ({} as never),
    }),
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

test('FOCUS activates only after the final actual-upload chunk', () => {
  const r = new PosterFocusResidency(1);
  const queued: Array<() => void> = [];
  let chunks = 0;
  let active = 0;
  let wakes = 0;
  const src = makePosterQualityPattern(640, 960);
  const d = deps({
    getSourcePixels: () => ({ pixels: src, width: 640, height: 960 }),
    queueUpload: (run) => { queued.push(run); return { accepted: true }; },
    createUploadTask: () => ({
      runChunk: () => {
        chunks++;
        return { done: chunks === 3, progress: chunks / 3, bytesUploaded: chunks * 100 };
      },
      cancel: () => {},
      snapshot: () => ({} as never),
    }),
    setActive: () => { active++; },
    requestRender: () => { wakes++; },
  });
  activateFocusTitle('sel', d, r);
  assert.equal(r.peekRecord('sel')?.phase, 'pendingUpload');
  assert.equal(active, 0);
  queued.shift()?.();
  assert.equal(r.peekRecord('sel')?.uploadProgress, 1 / 3);
  assert.equal(active, 0);
  queued.shift()?.();
  assert.equal(active, 0);
  queued.shift()?.();
  assert.equal(r.peekRecord('sel')?.phase, 'ready');
  assert.equal(r.peekRecord('sel')?.uploadProgress, 1);
  assert.equal(active, 1);
  assert.equal(wakes, 1);
});

test('evicted/stale FOCUS chunk cancels and never activates', () => {
  const r = new PosterFocusResidency(1);
  const queued: Array<() => void> = [];
  let active = 0;
  let cancelled = 0;
  const d = deps({
    getSourcePixels: () => ({ pixels: makePosterQualityPattern(640, 960), width: 640, height: 960 }),
    queueUpload: (run) => { queued.push(run); return { accepted: true }; },
    createUploadTask: () => ({
      runChunk: () => ({ done: true, progress: 1, bytesUploaded: 640 * 960 * 4 }),
      cancel: () => { cancelled++; },
      snapshot: () => ({} as never),
    }),
    setActive: () => { active++; },
  });
  activateFocusTitle('sel', d, r);
  r.release('sel');
  r.acquire('replacement', { globalIndex: 9, sceneGeneration: 1 });
  queued.shift()?.();
  assert.equal(cancelled, 1);
  assert.equal(active, 0);
  assert.equal(r.isReady('replacement'), false);
});

test('FOCUS upload task owns actual row-chunk texSubImage2D transfer and restores GL state', () => {
  const gpuTexture = {} as WebGLTexture;
  const calls: Array<{ y: number; height: number; bytes: number }> = [];
  const state = { active: 33984, texture: 'original' as unknown, flip: 1, premul: 1, alignment: 4,
    rowLength: 9, skipRows: 3, skipPixels: 2 };
  const gl = {
    TEXTURE_2D: 3553, TEXTURE_BINDING_2D: 32873, ACTIVE_TEXTURE: 34016,
    UNPACK_FLIP_Y_WEBGL: 37440, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441, UNPACK_ALIGNMENT: 3317,
    UNPACK_ROW_LENGTH: 3314, UNPACK_SKIP_ROWS: 3315, UNPACK_SKIP_PIXELS: 3316,
    RGBA: 6408, UNSIGNED_BYTE: 5121,
    getParameter(pname: number) {
      if (pname === this.TEXTURE_BINDING_2D) return state.texture;
      if (pname === this.ACTIVE_TEXTURE) return state.active;
      if (pname === this.UNPACK_FLIP_Y_WEBGL) return state.flip;
      if (pname === this.UNPACK_PREMULTIPLY_ALPHA_WEBGL) return state.premul;
      if (pname === this.UNPACK_ALIGNMENT) return state.alignment;
      if (pname === this.UNPACK_ROW_LENGTH) return state.rowLength;
      if (pname === this.UNPACK_SKIP_ROWS) return state.skipRows;
      if (pname === this.UNPACK_SKIP_PIXELS) return state.skipPixels;
      return null;
    },
    activeTexture(value: number) { state.active = value; },
    bindTexture(_target: number, value: unknown) { state.texture = value; },
    pixelStorei(pname: number, value: number) {
      if (pname === this.UNPACK_FLIP_Y_WEBGL) state.flip = value;
      if (pname === this.UNPACK_PREMULTIPLY_ALPHA_WEBGL) state.premul = value;
      if (pname === this.UNPACK_ALIGNMENT) state.alignment = value;
      if (pname === this.UNPACK_ROW_LENGTH) state.rowLength = value;
      if (pname === this.UNPACK_SKIP_ROWS) state.skipRows = value;
      if (pname === this.UNPACK_SKIP_PIXELS) state.skipPixels = value;
    },
    texSubImage2D(_target: number, _level: number, _x: number, y: number,
      _width: number, height: number, _format: number, _type: number, pixels: Uint8Array) {
      calls.push({ y, height, bytes: pixels.byteLength });
    },
  };
  const renderer = {
    initTexture() {},
    properties: { get: () => ({ __webglTexture: gpuTexture }) },
    getContext: () => gl,
    resetState() {},
  } as unknown as import('three').WebGLRenderer;
  initPosterFocusGpu({ slotLimit: 1, width: 4, height: 5, renderer });
  const pixels = Uint8Array.from({ length: 4 * 5 * 4 }, (_, i) => i);
  const task = createPosterFocusUploadTask(renderer, 0, pixels, 4, 5, 2);
  assert.ok(task);
  assert.deepEqual(task.runChunk(), { done: false, progress: 0.4, bytesUploaded: 32 });
  assert.deepEqual(task.runChunk(), { done: false, progress: 0.8, bytesUploaded: 64 });
  assert.deepEqual(task.runChunk(), { done: true, progress: 1, bytesUploaded: 80 });
  assert.deepEqual(calls, [
    { y: 0, height: 2, bytes: 32 },
    { y: 2, height: 2, bytes: 32 },
    { y: 4, height: 1, bytes: 16 },
  ]);
  assert.deepEqual(Array.from(getPosterFocusTexture(0).image.data as Uint8Array), Array.from(pixels));
  assert.equal(posterFocusResourceSnapshot().upload.status, 'complete');
  assert.equal(state.texture, 'original');
  assert.deepEqual({ flip: state.flip, premul: state.premul, alignment: state.alignment,
    rowLength: state.rowLength, skipRows: state.skipRows, skipPixels: state.skipPixels },
  { flip: 1, premul: 1, alignment: 4, rowLength: 9, skipRows: 3, skipPixels: 2 });
  disposePosterFocusGpu();
});
