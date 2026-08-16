import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  pageUploadPumpGeneration,
  resetUploadPumpSchedulerForTests,
  setPageUploadRafForTests,
  uploadPumpOwner,
  type PageRafScheduler,
} from '../src/perf/texture-upload-scheduler.ts';
import { setXrUploadPresenting } from '../src/perf/upload-policy.ts';
import {
  pendingTextureUploads,
  pumpTextureUploads,
  queueTextureUpload,
  resetTextureUploadQueueForTests,
  setUploadTurbo,
} from '../src/perf/texture-upload-queue.ts';

class WithholdingPageRaf implements PageRafScheduler {
  queued: FrameRequestCallback[] = [];
  requestAnimationFrame(cb: FrameRequestCallback): number {
    this.queued.push(cb);
    return this.queued.length;
  }
  fireAll(time = 16): void {
    const batch = this.queued.splice(0);
    for (const cb of batch) cb(time);
  }
}

function resetScheduler(): void {
  setUploadTurbo(true);
  resetTextureUploadQueueForTests();
  resetUploadPumpSchedulerForTests();
  setXrUploadPresenting(false);
}

afterEach(() => {
  resetTextureUploadQueueForTests();
  resetUploadPumpSchedulerForTests();
  setPageUploadRafForTests(null);
  setXrUploadPresenting(false);
  setUploadTurbo(false);
});

test('legacy page-rAF-only + withheld page rAF leaves the upload stuck', () => {
  resetScheduler();
  const page = new WithholdingPageRaf();
  setPageUploadRafForTests(page);
  let commits = 0;
  queueTextureUpload(() => { commits += 1; });
  assert.equal(pendingTextureUploads(), 1);
  assert.ok(page.queued.length >= 1);
  // Do not fire page rAF. Do not pump XR. This is the legacy stall.
  assert.equal(commits, 0);
  assert.equal(pendingTextureUploads(), 1);
});

test('page rAF withheld + XR frames drain the upload exactly once', () => {
  resetScheduler();
  const page = new WithholdingPageRaf();
  setPageUploadRafForTests(page);
  let commits = 0;
  queueTextureUpload(() => { commits += 1; });
  assert.equal(pendingTextureUploads(), 1);
  assert.ok(page.queued.length >= 1);
  const stale = [...page.queued];

  setXrUploadPresenting(true);
  assert.equal(uploadPumpOwner(), 'xr');
  pumpTextureUploads();
  assert.equal(commits, 1);
  assert.equal(pendingTextureUploads(), 0);

  for (const cb of stale) cb(32);
  page.fireAll(32);
  assert.equal(commits, 1);
  assert.equal(pendingTextureUploads(), 0);

  setXrUploadPresenting(false);
  assert.equal(uploadPumpOwner(), 'page');
});

test('stale page callback after XR drain does not double-upload', () => {
  resetScheduler();
  const page = new WithholdingPageRaf();
  setPageUploadRafForTests(page);
  let commits = 0;
  queueTextureUpload(() => { commits += 1; });
  setXrUploadPresenting(true);
  pumpTextureUploads();
  assert.equal(commits, 1);
  page.fireAll();
  assert.equal(commits, 1);
});

test('page to XR ownership transition withholds the pending page callback', () => {
  resetScheduler();
  const page = new WithholdingPageRaf();
  setPageUploadRafForTests(page);
  queueTextureUpload(() => {});
  const genBefore = pageUploadPumpGeneration();
  setXrUploadPresenting(true);
  assert.equal(uploadPumpOwner(), 'xr');
  assert.ok(pageUploadPumpGeneration() > genBefore);
  page.fireAll();
  assert.equal(pendingTextureUploads(), 1);
  pumpTextureUploads();
  assert.equal(pendingTextureUploads(), 0);
});

test('XR to page ownership resumes page scheduling', () => {
  resetScheduler();
  const page = new WithholdingPageRaf();
  setPageUploadRafForTests(page);
  setXrUploadPresenting(true);
  let commits = 0;
  queueTextureUpload(() => { commits += 1; });
  assert.equal(page.queued.length, 0);
  assert.equal(pendingTextureUploads(), 1);
  setXrUploadPresenting(false);
  assert.equal(uploadPumpOwner(), 'page');
  assert.ok(page.queued.length >= 1);
  page.fireAll();
  assert.equal(commits, 1);
  assert.equal(pendingTextureUploads(), 0);
});

test('repeated enter/exit has a single pump owner', () => {
  resetScheduler();
  for (let i = 0; i < 4; i++) {
    setXrUploadPresenting(true);
    assert.equal(uploadPumpOwner(), 'xr');
    setXrUploadPresenting(false);
    assert.equal(uploadPumpOwner(), 'page');
  }
  setXrUploadPresenting(true);
  assert.equal(uploadPumpOwner(), 'xr');
  const page = new WithholdingPageRaf();
  setPageUploadRafForTests(page);
  queueTextureUpload(() => {});
  assert.equal(page.queued.length, 0);
  pumpTextureUploads();
  assert.equal(pendingTextureUploads(), 0);
});

test('upload enqueued during XR does not require window rAF', () => {
  resetScheduler();
  const page = new WithholdingPageRaf();
  setPageUploadRafForTests(page);
  setXrUploadPresenting(true);
  let commits = 0;
  queueTextureUpload(() => { commits += 1; });
  assert.equal(page.queued.length, 0);
  pumpTextureUploads();
  assert.equal(commits, 1);
  assert.equal(pendingTextureUploads(), 0);
});
