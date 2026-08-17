import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  beginXrUploadFrame,
  decideExpensiveUpload,
  noteExpensiveDeferred,
  noteExpensivePromotion,
  noteExpensiveQueued,
  resetDetailUploadPolicyForTests,
  sampleXrMotion,
  XR_EXPENSIVE_PER_FRAME,
  XR_EXPENSIVE_QUEUE_CAP,
  XR_FAIRNESS_MS,
  canEnqueueExpensive,
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

afterEach(() => {
  resetDetailUploadPolicyForTests();
  resetTextureUploadQueueForTests();
  resetUploadPumpSchedulerForTests();
  setXrUploadPresenting(false);
  setUploadTurbo(false);
});

test('HMD movement suppresses high-cost promotion', () => {
  sampleXrMotion({ x: 0, y: 1.6, z: 0, yaw: 0, locomotionStickActive: false, snapTurnActive: false, nowMs: 0 });
  sampleXrMotion({ x: 0.05, y: 1.6, z: 0, yaw: 0, locomotionStickActive: false, snapTurnActive: false, nowMs: 16 });
  const d = decideExpensiveUpload(16);
  assert.equal(d.motion, 'MOVING');
  assert.equal(d.allowExpensive, false);
});

test('locomotion stick suppresses high-cost promotion', () => {
  sampleXrMotion({ x: 0, y: 1.6, z: 0, yaw: 0, locomotionStickActive: true, snapTurnActive: false, nowMs: 0 });
  const d = decideExpensiveUpload(0);
  assert.equal(d.allowExpensive, false);
  assert.equal(d.motion, 'MOVING');
});

test('stable viewer allows one promotion', () => {
  sampleXrMotion({ x: 0, y: 1.6, z: 0, yaw: 0, locomotionStickActive: false, snapTurnActive: false, nowMs: 0 });
  sampleXrMotion({ x: 0, y: 1.6, z: 0, yaw: 0, locomotionStickActive: false, snapTurnActive: false, nowMs: 400 });
  beginXrUploadFrame(1);
  const d = decideExpensiveUpload(400);
  assert.equal(d.allowExpensive, true);
  noteExpensivePromotion(d);
  const d2 = decideExpensiveUpload(400);
  assert.equal(d2.allowExpensive, false);
  assert.equal(d2.reason, 'frame-cap');
  assert.equal(XR_EXPENSIVE_PER_FRAME, 1);
});

test('multiple expensive requests do not burst into one XR frame', () => {
  resetDetailUploadPolicyForTests();
  resetTextureUploadQueueForTests();
  setUploadTurbo(true);
  setXrUploadPresenting(true);
  sampleXrMotion({ x: 0, y: 1.6, z: 0, yaw: 0, locomotionStickActive: false, snapTurnActive: false, nowMs: 0 });
  sampleXrMotion({ x: 0, y: 1.6, z: 0, yaw: 0, locomotionStickActive: false, snapTurnActive: false, nowMs: 500 });
  beginXrUploadFrame(9);
  let ran = 0;
  queueTextureUpload(() => { ran++; }, 'priority', { cost: 'near' });
  queueTextureUpload(() => { ran++; }, 'priority', { cost: 'focus' });
  pumpTextureUploads();
  assert.equal(ran, 1);
  assert.ok(pendingTextureUploads() >= 1);
});

test('fairness eventually allows progress while slowly moving', () => {
  sampleXrMotion({ x: 0, y: 1.6, z: 0, yaw: 0, locomotionStickActive: true, snapTurnActive: false, nowMs: 0 });
  noteExpensiveDeferred();
  const early = decideExpensiveUpload(100);
  assert.equal(early.allowExpensive, false);
  const later = decideExpensiveUpload(XR_FAIRNESS_MS + 10);
  assert.equal(later.allowExpensive, true);
  assert.equal(later.reason, 'fairness');
});

test('queue pump during movement uses the motion clock, not wall-clock fairness', () => {
  setUploadTurbo(true);
  setXrUploadPresenting(true);
  sampleXrMotion({ x: 0, y: 1.6, z: 0, yaw: 0, locomotionStickActive: true, snapTurnActive: false, nowMs: 0 });
  beginXrUploadFrame(1);
  let ran = 0;
  queueTextureUpload(() => { ran++; }, 'priority', { cost: 'focus' });
  pumpTextureUploads();
  assert.equal(ran, 0);
  assert.equal(pendingTextureUploads(), 1);
});

test('expensive queue is bounded', () => {
  for (let i = 0; i < XR_EXPENSIVE_QUEUE_CAP; i++) noteExpensiveQueued(1);
  assert.equal(canEnqueueExpensive(), false);
  setUploadTurbo(true);
  setXrUploadPresenting(true);
  queueTextureUpload(() => {}, 'priority', { cost: 'focus' });
  assert.equal(pendingUploadsByCost().focus, 0);
});
