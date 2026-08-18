// UNIT/CI + DESKTOP_BROWSER admission/activation integration.
// Not Quest hardware.

import { PosterDetailResidency } from '../poster-detail-residency.ts';
import { activateDetailTitle, demoteDetailTitle, type DetailActivateDeps } from '../poster-detail-activate.ts';
import { PosterFocusResidency } from '../poster-focus-residency.ts';
import { activateFocusTitle, type FocusActivateDeps } from '../poster-focus-activate.ts';
import {
  beginXrUploadFrame,
  expensivePendingCount,
  resetDetailUploadPolicyForTests,
  sampleXrMotion,
  XR_EXPENSIVE_QUEUE_CAP,
} from './xr-detail-upload-policy.ts';
import {
  pendingTextureUploads,
  pendingUploadsByCost,
  pumpTextureUploads,
  queueTextureUpload,
  resetTextureUploadQueueForTests,
  setUploadTurbo,
  type UploadEnqueueResult,
} from './texture-upload-queue.ts';
import { resetUploadPumpSchedulerForTests } from './texture-upload-scheduler.ts';
import { setXrUploadPresenting } from './upload-policy.ts';
import { storeVisibleWork } from './store-visible-work.ts';
import { flushPosterDetailWake, requestPosterDetailWake, resetPosterDetailWakeForTests, setPosterDetailWakeHandler } from './poster-detail-wake.ts';
import { resetXrUploadMetricsForTests, xrUploadMetricsSnapshot } from './xr-upload-metrics.ts';

function detailPixels(): Uint8Array {
  return new Uint8Array(320 * 480 * 4).fill(180);
}

function focusSource(): { pixels: Uint8Array; width: number; height: number } {
  return { pixels: new Uint8Array(800 * 1200 * 4).fill(90), width: 800, height: 1200 };
}

function settle(): void {
  sampleXrMotion({ x: 0, y: 1.6, z: 0, yaw: 0, locomotionStickActive: false, snapTurnActive: false, nowMs: 0 });
  sampleXrMotion({ x: 0, y: 1.6, z: 0, yaw: 0, locomotionStickActive: false, snapTurnActive: false, nowMs: 400 });
}

function drainExpensive(frames = 24): void {
  for (let i = 0; i < frames && pendingTextureUploads() > 0; i++) {
    beginXrUploadFrame(100 + i);
    pumpTextureUploads();
    flushPosterDetailWake();
  }
}

export function runUploadAdmissionProbe() {
  resetDetailUploadPolicyForTests();
  resetTextureUploadQueueForTests();
  resetUploadPumpSchedulerForTests();
  resetPosterDetailWakeForTests();
  resetXrUploadMetricsForTests();
  setUploadTurbo(true);
  setXrUploadPresenting(true);
  settle();

  const pix = new Map<string, Uint8Array>();
  for (let i = 0; i < 12; i++) pix.set(`n${i}`, detailPixels());
  pix.set('sel', detailPixels());
  const desired = new Set(pix.keys());
  const selected = { id: null as string | null };
  const gen = { n: storeVisibleWork.currentGeneration() };
  const lut = new Map<number, number>();
  const focusActive = { slot: -1, index: -1 };
  const detailRes = new PosterDetailResidency(16);
  const focusRes = new PosterFocusResidency(2);
  const wakes: string[] = [];

  setPosterDetailWakeHandler(() => {
    for (const id of desired) {
      if (id === 'sel') continue;
      activateDetailTitle(id, detailDeps, detailRes);
    }
    if (selected.id) activateFocusTitle(selected.id, focusDeps, focusRes);
  });

  const detailDeps: DetailActivateDeps = {
    getMovie: (id) => ({ id, posterUrl: `data:${id}` }),
    getGlobalIndex: (id) => Number(id.replace(/\D/g, '')) || 0,
    isDesired: (id) => desired.has(id),
    isSelected: (id) => selected.id === id,
    sceneGeneration: () => gen.n,
    getPixels: (id) => pix.get(id) ?? null,
    loadPoster: () => {},
    queueUpload: (run, movieId, generation) => {
      return queueTextureUpload(run, 'priority', {
        movieId,
        generation,
        cost: 'near',
        onEvict: () => {
          const rec = detailRes.peekRecord(movieId);
          if (!rec) return;
          rec.uploadInFlight = false;
          detailRes.markPendingPixels(movieId);
          requestPosterDetailWake();
        },
      });
    },
    uploadLayer: () => true,
    setLut: (globalIndex, slotPlusOne) => {
      lut.set(globalIndex, slotPlusOne);
      return true;
    },
    clearLut: (globalIndex) => { lut.delete(globalIndex); },
    onUploadDeferred: (id) => { wakes.push(id); requestPosterDetailWake(); },
  };

  const focusDeps: FocusActivateDeps = {
    getGlobalIndex: () => 99,
    isSelected: (id) => selected.id === id,
    sceneGeneration: () => gen.n,
    getSourcePixels: () => focusSource(),
    loadSource: () => {},
    queueUpload: (run, movieId, generation) => {
      return queueTextureUpload(run, 'priority', {
        movieId,
        generation,
        cost: 'focus',
        onEvict: () => {
          const rec = focusRes.peekRecord(movieId);
          if (!rec) return;
          rec.uploadInFlight = false;
          focusRes.markPendingPixels(movieId);
          requestPosterDetailWake();
        },
      });
    },
    uploadFocus: () => true,
    setActive: (slot, globalIndex) => { focusActive.slot = slot; focusActive.index = globalIndex; },
    clearActive: () => { focusActive.slot = -1; focusActive.index = -1; },
    onUploadDeferred: (id) => { wakes.push(id); requestPosterDetailWake(); },
  };

  sampleXrMotion({ x: 0.2, y: 1.6, z: 0, yaw: 0, locomotionStickActive: true, snapTurnActive: false, nowMs: 0 });
  for (let i = 0; i < 9; i++) activateDetailTitle(`n${i}`, detailDeps, detailRes);
  const afterPressure = {
    pendingExpensive: expensivePendingCount(),
    queued: pendingUploadsByCost(),
    pendingUpload: detailRes.snapshot().pendingUpload,
    leased: detailRes.snapshot().leased,
  };

  selected.id = 'sel';
  activateFocusTitle('sel', focusDeps, focusRes);
  const afterFocus = {
    queued: pendingUploadsByCost(),
    focusPendingUpload: focusRes.snapshot().pendingUpload,
    focusInFlight: focusRes.peekRecord('sel')?.uploadInFlight === true,
    focusPhase: focusRes.peekRecord('sel')?.phase ?? null,
  };

  settle();
  drainExpensive(20);
  const afterDrain = {
    pending: pendingTextureUploads(),
    pendingExpensive: expensivePendingCount(),
    focusReady: focusRes.peekRecord('sel')?.phase === 'ready',
    focusActive: focusActive.index === 99,
    nearReady: detailRes.snapshot().readyResident,
    pendingUpload: detailRes.snapshot().pendingUpload,
    leased: detailRes.snapshot().leased,
    lutStaleFocus: lut.get(99) ?? null,
  };

  // Rejection dead-lease: fill cap with dummy near tasks, then DETAIL/FOCUS reject.
  resetDetailUploadPolicyForTests();
  resetTextureUploadQueueForTests();
  settle();
  beginXrUploadFrame(1);
  const fillers: UploadEnqueueResult[] = [];
  for (let i = 0; i < XR_EXPENSIVE_QUEUE_CAP; i++) {
    fillers.push(queueTextureUpload(() => {}, 'priority', { cost: 'near', movieId: `fill${i}` }));
  }
  const detailRes2 = new PosterDetailResidency(4);
  pix.set('dead', detailPixels());
  desired.add('dead');
  activateDetailTitle('dead', {
    ...detailDeps,
    getPixels: () => detailPixels(),
    isDesired: () => true,
    isSelected: () => false,
    queueUpload: (run, movieId, generation) => queueTextureUpload(run, 'priority', { movieId, generation, cost: 'near' }),
  }, detailRes2);
  const deadDetail = detailRes2.peekRecord('dead');
  const detailReject = {
    acceptedFillers: fillers.filter((r) => r.accepted).length,
    phase: deadDetail?.phase ?? null,
    uploadInFlight: deadDetail?.uploadInFlight === true,
    pendingUpload: detailRes2.snapshot().pendingUpload,
  };

  const focusRes2 = new PosterFocusResidency(2);
  activateFocusTitle('sel', {
    ...focusDeps,
    queueUpload: (run, movieId, generation) => queueTextureUpload(run, 'priority', { movieId, generation, cost: 'focus' }),
  }, focusRes2);
  const focusRec = focusRes2.peekRecord('sel');
  const focusRejectOrPriority = {
    phase: focusRec?.phase ?? null,
    uploadInFlight: focusRec?.uploadInFlight === true,
    queuedFocus: pendingUploadsByCost().focus,
    pendingUpload: focusRes2.snapshot().pendingUpload,
  };

  // Generation change while deferred must not resurrect into LUT.
  storeVisibleWork.invalidateGeneration();
  gen.n = storeVisibleWork.currentGeneration();
  demoteDetailTitle('dead', {
    ...detailDeps,
    clearLut: (i) => { lut.delete(i); },
  }, detailRes2);
  drainExpensive(12);
  const stale = {
    deadResident: detailRes2.peekRecord('dead') != null,
    lutHasDead: [...lut.keys()].length,
  };

  setXrUploadPresenting(false);
  setUploadTurbo(false);
  resetTextureUploadQueueForTests();
  resetDetailUploadPolicyForTests();
  resetPosterDetailWakeForTests();

  const metrics = xrUploadMetricsSnapshot();
  const pass = afterPressure.pendingExpensive <= XR_EXPENSIVE_QUEUE_CAP
    && afterFocus.queued.focus >= 1
    && afterDrain.focusReady
    && afterDrain.focusActive
    && afterDrain.pendingUpload === 0
    && detailReject.uploadInFlight === false
    && detailReject.phase !== 'pendingUpload'
    && (focusRejectOrPriority.queuedFocus >= 1 || focusRejectOrPriority.phase !== 'pendingUpload')
    && stale.deadResident === false
    && metrics.texSubImageCalls === 0;

  return {
    classification: 'DESKTOP_BROWSER' as const,
    QUEST_HARDWARE: 'NOT_EXECUTED',
    pass,
    queueCap: XR_EXPENSIVE_QUEUE_CAP,
    afterPressure,
    afterFocus,
    afterDrain,
    detailReject,
    focusRejectOrPriority,
    stale,
    metrics: {
      texSubImageCalls: metrics.texSubImageCalls,
      texturesScheduledForUpload: metrics.texturesScheduledForUpload,
      bytesScheduledForUpload: metrics.bytesScheduledForUpload,
    },
    note: 'Admission/activation integration. Not Quest GPU time.',
  };
}
