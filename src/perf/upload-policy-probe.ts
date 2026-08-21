// DESKTOP_BROWSER / logic evidence of motion-gated expensive uploads. Not Quest GPU time.

import {
  beginXrUploadFrame,
  decideExpensiveUpload,
  resetDetailUploadPolicyForTests,
  sampleXrMotion,
} from './xr-detail-upload-policy.ts';
import {
  pendingTextureUploads,
  pumpTextureUploads,
  queueTextureUpload,
  resetTextureUploadQueueForTests,
  setUploadTurbo,
} from './texture-upload-queue.ts';
import { setXrUploadPresenting } from './upload-policy.ts';
import { resetUploadPumpSchedulerForTests } from './texture-upload-scheduler.ts';

export function runUploadPolicyProbe() {
  resetDetailUploadPolicyForTests();
  resetTextureUploadQueueForTests();
  resetUploadPumpSchedulerForTests();
  setUploadTurbo(true);
  setXrUploadPresenting(true);
  sampleXrMotion({ x: 0, y: 1.6, z: 0, yaw: 0, locomotionStickActive: true, snapTurnActive: false, nowMs: 0 });
  sampleXrMotion({ x: 0.2, y: 1.6, z: 0, yaw: 0, locomotionStickActive: true, snapTurnActive: false, nowMs: 16 });
  const movingDecision = decideExpensiveUpload(16);
  beginXrUploadFrame(1);
  let movingRan = 0;
  queueTextureUpload(() => { movingRan++; }, 'priority', { cost: 'focus' });
  pumpTextureUploads();
  const deferredWhileMoving = movingRan === 0 && pendingTextureUploads() === 1
    && movingDecision.allowExpensive === false;

  resetDetailUploadPolicyForTests();
  resetTextureUploadQueueForTests();
  sampleXrMotion({ x: 0, y: 1.6, z: 0, yaw: 0, locomotionStickActive: false, snapTurnActive: false, nowMs: 0 });
  sampleXrMotion({ x: 0, y: 1.6, z: 0, yaw: 0, locomotionStickActive: false, snapTurnActive: false, nowMs: 500 });
  beginXrUploadFrame(2);
  let stableRan = 0;
  queueTextureUpload(() => { stableRan++; }, 'priority', { cost: 'near' });
  queueTextureUpload(() => { stableRan++; }, 'priority', { cost: 'focus' });
  pumpTextureUploads();
  const oneWhileStable = stableRan === 1 && pendingTextureUploads() === 1;

  setXrUploadPresenting(false);
  setUploadTurbo(false);
  resetTextureUploadQueueForTests();
  resetDetailUploadPolicyForTests();
  return {
    classification: 'DESKTOP_BROWSER' as const,
    QUEST_HARDWARE: 'NOT_EXECUTED',
    pass: deferredWhileMoving && oneWhileStable,
    deferredWhileMoving,
    oneWhileStable,
    note: 'JS submission policy only. Not Quest GPU timings.',
    movingDecision: movingDecision.reason,
  };
}
