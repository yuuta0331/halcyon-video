import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PosterDetailResidency, estimatePosterDetailBytes } from '../src/poster-detail-residency.ts';
import { activateDetailTitle, demoteDetailTitle, type DetailActivateDeps } from '../src/poster-detail-activate.ts';

function pixels(): Uint8Array {
  return new Uint8Array(320 * 480 * 4).fill(200);
}

function host(opts?: {
  pixels?: Map<string, Uint8Array>;
  desired?: Set<string>;
  selected?: string | null;
  gen?: { n: number };
}) {
  const pix = opts?.pixels ?? new Map<string, Uint8Array>();
  const desired = opts?.desired ?? new Set<string>(['a']);
  const selected = { id: opts?.selected ?? 'a' as string | null };
  const gen = opts?.gen ?? { n: 1 };
  const loads: string[] = [];
  const delayed = new Map<string, (p: Uint8Array) => void>();
  const lut = new Map<number, number>();
  const uploads: number[] = [];
  const movies = new Map([['a', { id: 'a', posterUrl: 'data:image/png,a' }], ['b', { id: 'b', posterUrl: 'data:image/png,b' }]]);
  const deps: DetailActivateDeps = {
    getMovie: (id) => movies.get(id) ?? null,
    getGlobalIndex: (id) => id === 'b' ? 1 : 0,
    isDesired: (id) => desired.has(id),
    isSelected: (id) => selected.id === id,
    sceneGeneration: () => gen.n,
    getPixels: (id) => pix.get(id) ?? null,
    loadPoster: (movie, _p, cb) => {
      loads.push(movie.id);
      delayed.set(movie.id, cb);
    },
    queueUpload: (run) => { run(); },
    uploadLayer: (slot, data) => {
      if (data.length < 320 * 480 * 4) return false;
      uploads.push(slot);
      return true;
    },
    setLut: (i, v) => { lut.set(i, v); return true; },
    clearLut: (i) => { lut.set(i, 0); },
  };
  return { deps, pix, desired, selected, gen, loads, delayed, lut, uploads, residency: new PosterDetailResidency(4) };
}

test('CPU cache HIT reaches DETAIL_READY and lease alone is not ready', () => {
  const h = host();
  h.pix.set('a', pixels());
  activateDetailTitle('a', h.deps, h.residency);
  assert.equal(h.residency.phase('a'), 'ready');
  assert.equal(h.residency.snapshot().readyResident, 1);
  assert.equal(h.residency.snapshot().uploaded, 1);
  assert.equal(h.residency.snapshot().decoded, 1);
  assert.ok((h.lut.get(0) ?? 0) > 0);
});

test('CPU cache MISS enters pendingPixels, dedupes load, then reaches READY', () => {
  const h = host();
  activateDetailTitle('a', h.deps, h.residency);
  assert.equal(h.residency.phase('a'), 'pendingPixels');
  assert.equal(h.residency.snapshot().readyResident, 0);
  assert.equal(h.residency.snapshot().leased, 1);
  activateDetailTitle('a', h.deps, h.residency);
  assert.equal(h.loads.length, 1);
  h.delayed.get('a')!(pixels());
  assert.equal(h.residency.phase('a'), 'ready');
  assert.equal(h.residency.snapshot().decoded, 1);
  assert.equal(h.residency.snapshot().uploaded, 1);
  assert.equal(h.residency.snapshot().readyResident, 1);
});

test('leaving the desired set cancels promotion; stale callback cannot reuse the slot', () => {
  const h = host({ desired: new Set(['a']) });
  activateDetailTitle('a', h.deps, h.residency);
  const leaseA = h.residency.peek('a')!;
  h.desired.delete('a');
  h.selected.id = null;
  demoteDetailTitle('a', h.deps, h.residency);
  h.desired.add('b');
  h.pix.set('b', pixels());
  activateDetailTitle('b', h.deps, h.residency);
  h.delayed.get('a')!(pixels());
  assert.equal(h.residency.isLeaseCurrent(leaseA), false);
  assert.equal(h.residency.isReady('b'), true);
  assert.equal(h.residency.isReady('a'), false);
  assert.ok(h.residency.snapshot().staleDropped >= 1);
  assert.equal(h.lut.get(0), 0);
  assert.ok((h.lut.get(1) ?? 0) > 0);
});

test('scene generation change rejects old callbacks', () => {
  const h = host();
  activateDetailTitle('a', h.deps, h.residency);
  h.gen.n = 99;
  h.delayed.get('a')!(pixels());
  assert.equal(h.residency.isReady('a'), false);
  assert.ok(h.residency.snapshot().staleDropped >= 1);
});

test('released title can be reacquired and succeed later', () => {
  const h = host();
  h.pix.set('a', pixels());
  activateDetailTitle('a', h.deps, h.residency);
  demoteDetailTitle('a', h.deps, h.residency);
  assert.equal(h.lut.get(0), 0);
  assert.equal(h.residency.snapshot().readyResident, 0);
  activateDetailTitle('a', h.deps, h.residency);
  assert.equal(h.residency.isReady('a'), true);
  assert.ok((h.lut.get(0) ?? 0) > 0);
});

test('DETAIL memory stays bounded for 200/1000/2001/4000 logical titles', () => {
  const bytes = estimatePosterDetailBytes(64, 320, 480);
  for (const n of [200, 1000, 2001, 4000]) {
    const r = new PosterDetailResidency(64);
    for (let i = 0; i < n; i++) r.acquire(`t${i}`);
    assert.ok(r.residentCount() <= 64, `${n} leased ${r.residentCount()}`);
    assert.equal(r.snapshot().cpuBytesEstimated, bytes.cpu);
    assert.equal(r.snapshot().gpuBytesEstimated, bytes.gpu);
  }
});
