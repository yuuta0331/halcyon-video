import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PosterDetailResidency } from '../src/poster-detail-residency.ts';
import { activateDetailTitle, type DetailActivateDeps } from '../src/poster-detail-activate.ts';
import { PosterFocusResidency } from '../src/poster-focus-residency.ts';
import { activateFocusTitle, type FocusActivateDeps } from '../src/poster-focus-activate.ts';
import {
  beginXrUploadFrame,
  expensivePendingCount,
  noteExpensiveQueued,
  resetDetailUploadPolicyForTests,
  sampleXrMotion,
  setExpensiveQueued,
  XR_EXPENSIVE_QUEUE_CAP,
} from '../src/perf/xr-detail-upload-policy.ts';
import {
  pendingTextureUploads,
  pendingUploadsByCost,
  pumpTextureUploads,
  queueTextureUpload,
  resetTextureUploadQueueForTests,
  setUploadTurbo,
} from '../src/perf/texture-upload-queue.ts';
import { resetUploadPumpSchedulerForTests } from '../src/perf/texture-upload-scheduler.ts';
import { setXrUploadPresenting } from '../src/perf/upload-policy.ts';
import { storeVisibleWork } from '../src/perf/store-visible-work.ts';
import {
  flushPosterDetailWake,
  notifyPosterDetailCapacityAvailable,
  posterDetailWakeSnapshot,
  requestPosterDetailWake,
  resetPosterDetailWakeForTests,
  setPosterDetailWakeHandler,
} from '../src/perf/poster-detail-wake.ts';
import { runUploadAdmissionProbe } from '../src/perf/upload-admission-probe.ts';

afterEach(() => {
  resetDetailUploadPolicyForTests();
  resetTextureUploadQueueForTests();
  resetUploadPumpSchedulerForTests();
  resetPosterDetailWakeForTests();
  setXrUploadPresenting(false);
  setUploadTurbo(false);
});

function settle(): void {
  sampleXrMotion({ x: 0, y: 1.6, z: 0, yaw: 0, locomotionStickActive: false, snapTurnActive: false, nowMs: 0 });
  sampleXrMotion({ x: 0, y: 1.6, z: 0, yaw: 0, locomotionStickActive: false, snapTurnActive: false, nowMs: 400 });
}

function detailPixels(): Uint8Array {
  return new Uint8Array(320 * 480 * 4).fill(120);
}

function focusSrc() {
  return { pixels: new Uint8Array(800 * 1200 * 4).fill(40), width: 800, height: 1200 };
}

test('queueTextureUpload returns explicit expensive-queue-cap rejection', () => {
  setUploadTurbo(true);
  setXrUploadPresenting(true);
  settle();
  const accepted = [];
  for (let i = 0; i < 12; i++) {
    accepted.push(queueTextureUpload(() => {}, 'priority', { cost: 'near', movieId: `n${i}` }));
  }
  const ok = accepted.filter((r) => r.accepted).length;
  const rejected = accepted.filter((r) => !r.accepted);
  assert.equal(ok, XR_EXPENSIVE_QUEUE_CAP - 1);
  assert.ok(rejected.length >= 1);
  assert.equal(rejected[0]?.reason, 'expensive-queue-cap');
  assert.ok(expensivePendingCount() <= XR_EXPENSIVE_QUEUE_CAP);
});

test('DETAIL rejection does not leave a pendingUpload dead lease', () => {
  setUploadTurbo(true);
  setXrUploadPresenting(true);
  settle();
  for (let i = 0; i < XR_EXPENSIVE_QUEUE_CAP; i++) {
    queueTextureUpload(() => {}, 'priority', { cost: 'near', movieId: `fill${i}` });
  }
  const residency = new PosterDetailResidency(4);
  const deps: DetailActivateDeps = {
    getMovie: () => ({ id: 'a', posterUrl: 'data:a' }),
    getGlobalIndex: () => 0,
    isDesired: () => true,
    isSelected: () => false,
    sceneGeneration: () => storeVisibleWork.currentGeneration(),
    getPixels: () => detailPixels(),
    loadPoster: () => {},
    queueUpload: (run, movieId, generation) => queueTextureUpload(run, 'priority', { movieId, generation, cost: 'near' }),
    uploadLayer: () => true,
    setLut: () => true,
    clearLut: () => {},
  };
  activateDetailTitle('a', deps, residency);
  const rec = residency.peekRecord('a');
  assert.ok(rec);
  assert.equal(rec.uploadInFlight, false);
  assert.notEqual(rec.phase, 'pendingUpload');
  assert.equal(residency.snapshot().pendingUpload, 0);
});

test('FOCUS still receives a reserved expensive slot under NEAR pressure', () => {
  setUploadTurbo(true);
  setXrUploadPresenting(true);
  settle();
  for (let i = 0; i < 9; i++) {
    queueTextureUpload(() => {}, 'priority', { cost: 'near', movieId: `n${i}` });
  }
  assert.equal(pendingUploadsByCost().near, XR_EXPENSIVE_QUEUE_CAP - 1);
  const focus = queueTextureUpload(() => {}, 'priority', { cost: 'focus', movieId: 'sel' });
  assert.equal(focus.accepted, true);
  assert.equal(pendingUploadsByCost().focus, 1);
  assert.ok(pendingTextureUploads() <= XR_EXPENSIVE_QUEUE_CAP);
});

test('deferred NEAR retries after drain without another movement sample', () => {
  setUploadTurbo(true);
  setXrUploadPresenting(true);
  settle();
  const ran = new Set<string>();
  for (let i = 0; i < 7; i++) {
    queueTextureUpload(() => { ran.add(`q${i}`); }, 'priority', { cost: 'near', movieId: `q${i}` });
  }
  const residency = new PosterDetailResidency(8);
  const deps: DetailActivateDeps = {
    getMovie: () => ({ id: 'later', posterUrl: 'data:l' }),
    getGlobalIndex: () => 3,
    isDesired: () => true,
    isSelected: () => false,
    sceneGeneration: () => storeVisibleWork.currentGeneration(),
    getPixels: () => detailPixels(),
    loadPoster: () => {},
    queueUpload: (run, movieId, generation) => queueTextureUpload(run, 'priority', { movieId, generation, cost: 'near' }),
    uploadLayer: () => true,
    setLut: () => true,
    clearLut: () => {},
    onUploadDeferred: () => requestPosterDetailWake(),
  };
  activateDetailTitle('later', deps, residency);
  assert.equal(residency.peekRecord('later')?.phase, 'pendingPixels');
  setPosterDetailWakeHandler(() => activateDetailTitle('later', deps, residency));
  for (let i = 0; i < 12; i++) {
    beginXrUploadFrame(i + 1);
    pumpTextureUploads();
    flushPosterDetailWake();
  }
  assert.equal(residency.peekRecord('later')?.phase, 'ready');
  assert.equal(residency.snapshot().pendingUpload, 0);
});

test('queue capacity is the primary wake and 90ms timer remains fallback only', () => {
  let wakes = 0;
  setPosterDetailWakeHandler(() => { wakes++; });
  requestPosterDetailWake();
  assert.equal(posterDetailWakeSnapshot().pending, true);
  notifyPosterDetailCapacityAvailable();
  assert.equal(wakes, 1);
  assert.equal(posterDetailWakeSnapshot().pending, false);
  assert.equal(posterDetailWakeSnapshot().capacityWakeCount, 1);
  assert.equal(posterDetailWakeSnapshot().fallbackTimerWakeCount, 0);
});

test('generation change while deferred does not resurrect content', () => {
  setUploadTurbo(true);
  setXrUploadPresenting(true);
  settle();
  for (let i = 0; i < 7; i++) {
    queueTextureUpload(() => {}, 'priority', { cost: 'near', movieId: `q${i}` });
  }
  const residency = new PosterDetailResidency(4);
  const gen = { n: storeVisibleWork.currentGeneration() };
  const lut = new Map<number, number>();
  const deps: DetailActivateDeps = {
    getMovie: () => ({ id: 'stale', posterUrl: 'data:s' }),
    getGlobalIndex: () => 4,
    isDesired: () => true,
    isSelected: () => false,
    sceneGeneration: () => gen.n,
    getPixels: () => detailPixels(),
    loadPoster: () => {},
    queueUpload: (run, movieId, generation) => queueTextureUpload(run, 'priority', { movieId, generation, cost: 'near' }),
    uploadLayer: () => true,
    setLut: (i, v) => { lut.set(i, v); return true; },
    clearLut: (i) => { lut.delete(i); },
  };
  activateDetailTitle('stale', deps, residency);
  assert.equal(residency.peekRecord('stale')?.phase, 'pendingPixels');
  storeVisibleWork.invalidateGeneration();
  gen.n = storeVisibleWork.currentGeneration();
  residency.release('stale');
  lut.clear();
  for (let i = 0; i < 12; i++) {
    beginXrUploadFrame(50 + i);
    pumpTextureUploads();
  }
  assert.equal(residency.peekRecord('stale'), null);
  assert.equal(lut.size, 0);
});

test('FOCUS activation rejection retains decoded pixels and retries without motion', async () => {
  setUploadTurbo(true);
  setXrUploadPresenting(true);
  settle();
  for (let i = 0; i < XR_EXPENSIVE_QUEUE_CAP; i++) noteExpensiveQueued(1);
  const residency = new PosterFocusResidency(2);
  const deps: FocusActivateDeps = {
    getGlobalIndex: () => 8,
    isSelected: () => true,
    sceneGeneration: () => storeVisibleWork.currentGeneration(),
    getSourcePixels: () => focusSrc(),
    loadSource: () => {},
    queueUpload: (run, movieId, generation) => queueTextureUpload(run, 'priority', { movieId, generation, cost: 'focus' }),
    createUploadTask: () => ({
      runChunk: () => ({ done: true, progress: 1, bytesUploaded: 640 * 960 * 4 }),
      cancel: () => {},
      snapshot: () => ({} as never),
    }),
    setActive: () => {},
    clearActive: () => {},
  };
  activateFocusTitle('sel', deps, residency);
  const rec = residency.peekRecord('sel');
  assert.ok(rec);
  assert.equal(rec.uploadInFlight, true);
  assert.equal(rec.phase, 'pendingUpload');
  assert.equal(residency.snapshot().pendingUpload, 1);
  assert.equal(pendingUploadsByCost().focus, 0);
  setExpensiveQueued(0);
  await new Promise((resolve) => setTimeout(resolve, 95));
  beginXrUploadFrame(99);
  pumpTextureUploads();
  assert.equal(residency.peekRecord('sel')?.phase, 'ready');
  assert.equal(residency.peekRecord('sel')?.uploadProgress, 1);
});

test('production admission probe covers pressure + FOCUS priority', () => {
  const result = runUploadAdmissionProbe();
  assert.equal(result.pass, true);
  assert.equal(result.QUEST_HARDWARE, 'NOT_EXECUTED');
  assert.equal(result.afterDrain.pendingUpload, 0);
  assert.equal(result.detailReject.uploadInFlight, false);
  assert.equal(typeof result.stale.lutEntryCount, 'number');
});
