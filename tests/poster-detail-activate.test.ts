import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PosterDetailResidency, POSTER_DETAIL_SLOT_LIMIT, estimatePosterDetailBytes } from '../src/poster-detail-residency.ts';
import { activateDetailTitle, demoteDetailTitle, type DetailActivateDeps } from '../src/poster-detail-activate.ts';
import { DetailRetryBook, DETAIL_MAX_ATTEMPTS, DETAIL_RETRY_DELAYS_MS } from '../src/poster-detail-retry.ts';

function pixels(): Uint8Array {
  return new Uint8Array(320 * 480 * 4).fill(200);
}

function host(opts?: {
  pixels?: Map<string, Uint8Array>;
  desired?: Set<string>;
  selected?: string | null;
  gen?: { n: number };
  uploadOk?: () => boolean;
  lutOk?: () => boolean;
}) {
  const pix = opts?.pixels ?? new Map<string, Uint8Array>();
  const desired = opts?.desired ?? new Set<string>(['a']);
  const selected = { id: opts?.selected ?? 'a' as string | null };
  const gen = opts?.gen ?? { n: 1 };
  const now = { t: 0 };
  const loads: string[] = [];
  const delayed = new Map<string, (p: Uint8Array) => void>();
  const settled = new Map<string, () => void>();
  const lut = new Map<number, number>();
  const uploads: number[] = [];
  const movies = new Map([['a', { id: 'a', posterUrl: 'data:image/png,a' }], ['b', { id: 'b', posterUrl: 'data:image/png,b' }]]);
  const retry = new DetailRetryBook();
  const residency = new PosterDetailResidency(4);
  const deps: DetailActivateDeps = {
    getMovie: (id) => movies.get(id) ?? null,
    getGlobalIndex: (id) => id === 'b' ? 1 : 0,
    isDesired: (id) => desired.has(id),
    isSelected: (id) => selected.id === id,
    sceneGeneration: () => gen.n,
    getPixels: (id) => pix.get(id) ?? null,
    loadPoster: (movie, _p, cb, onSettled) => {
      loads.push(movie.id);
      delayed.set(movie.id, cb);
      if (onSettled) settled.set(movie.id, onSettled);
    },
    queueUpload: (run) => { run(); },
    uploadLayer: (slot, data) => {
      if (data.length < 320 * 480 * 4) return false;
      if (opts?.uploadOk && !opts.uploadOk()) return false;
      uploads.push(slot);
      return true;
    },
    setLut: (i, v) => {
      if (opts?.lutOk && !opts.lutOk()) return false;
      lut.set(i, v);
      return true;
    },
    clearLut: (i) => { lut.set(i, 0); },
    now: () => now.t,
  };
  const act = (id: string) => activateDetailTitle(id, deps, residency, retry);
  return {
    deps, pix, desired, selected, gen, now, loads, delayed, settled, lut, uploads,
    residency, retry, movies, act,
  };
}

test('CPU cache HIT reaches DETAIL_READY and lease alone is not ready', () => {
  const h = host();
  h.pix.set('a', pixels());
  h.act('a');
  assert.equal(h.residency.phase('a'), 'ready');
  assert.equal(h.residency.snapshot().readyResident, 1);
  assert.equal(h.residency.snapshot().uploaded, 1);
  assert.equal(h.residency.snapshot().decoded, 1);
  assert.ok((h.lut.get(0) ?? 0) > 0);
});

test('CPU cache MISS enters pendingPixels, dedupes load, then reaches READY', () => {
  const h = host();
  h.act('a');
  assert.equal(h.residency.phase('a'), 'pendingPixels');
  assert.equal(h.residency.snapshot().readyResident, 0);
  assert.equal(h.residency.snapshot().leased, 1);
  h.act('a');
  assert.equal(h.loads.length, 1);
  h.delayed.get('a')!(pixels());
  h.settled.get('a')?.();
  assert.equal(h.residency.phase('a'), 'ready');
  assert.equal(h.residency.snapshot().decoded, 1);
  assert.equal(h.residency.snapshot().uploaded, 1);
  assert.equal(h.residency.snapshot().readyResident, 1);
});

test('leaving the desired set cancels promotion; stale callback cannot reuse the slot', () => {
  const h = host({ desired: new Set(['a']) });
  h.act('a');
  const leaseA = h.residency.peek('a')!;
  h.desired.delete('a');
  h.selected.id = null;
  demoteDetailTitle('a', h.deps, h.residency);
  h.desired.add('b');
  h.pix.set('b', pixels());
  h.act('b');
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
  h.act('a');
  h.gen.n = 99;
  h.delayed.get('a')!(pixels());
  assert.equal(h.residency.isReady('a'), false);
  assert.ok(h.residency.snapshot().staleDropped >= 1);
});

test('released title can be reacquired and succeed later', () => {
  const h = host();
  h.pix.set('a', pixels());
  h.act('a');
  demoteDetailTitle('a', h.deps, h.residency);
  assert.equal(h.lut.get(0), 0);
  assert.equal(h.residency.snapshot().readyResident, 0);
  h.act('a');
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

test('failed poster load clears pending state, does not ready, and releases the lease', () => {
  const h = host();
  h.act('a');
  assert.equal(h.residency.peekRecord('a')?.loadInFlight, true);
  h.settled.get('a')!();
  assert.equal(h.residency.peek('a'), null);
  const snap = h.residency.snapshot();
  assert.equal(snap.pendingPixels, 0);
  assert.equal(snap.pendingUpload, 0);
  assert.equal(snap.readyResident, 0);
  assert.equal(snap.leased, 0);
  assert.equal(snap.loadFailed, 1);
  assert.equal(h.lut.get(0) ?? 0, 0);
  assert.equal(h.residency.peekRecord('a')?.loadInFlight, undefined);
});

test('selected title retries after backoff then succeeds; retries are bounded', () => {
  const h = host();
  h.act('a');
  h.settled.get('a')!();
  assert.equal(h.loads.length, 1);
  h.act('a');
  assert.equal(h.loads.length, 1, 'no retry during backoff');
  h.now.t += DETAIL_RETRY_DELAYS_MS[0]!;
  h.act('a');
  assert.equal(h.loads.length, 2);
  h.delayed.get('a')!(pixels());
  assert.equal(h.residency.isReady('a'), true);
  assert.equal(h.residency.snapshot().readyResident, 1);

  const storm = host();
  for (let i = 0; i < 20; i++) {
    storm.act('a');
    storm.settled.get('a')?.();
    storm.now.t += 60_000;
  }
  assert.ok(storm.loads.length <= DETAIL_MAX_ATTEMPTS);
  assert.equal(storm.residency.snapshot().readyResident, 0);
  assert.equal(storm.residency.snapshot().leased, 0);
});

test('64 failed titles do not starve the pool; a healthy title can still ready', () => {
  const residency = new PosterDetailResidency(POSTER_DETAIL_SLOT_LIMIT);
  const retry = new DetailRetryBook();
  const desired = new Set<string>();
  const settled = new Map<string, () => void>();
  const lut = new Map<number, number>();
  const now = { t: 0 };
  const gen = { n: 1 };
  const movies = new Map<string, { id: string; posterUrl?: string }>();
  for (let i = 0; i < POSTER_DETAIL_SLOT_LIMIT; i++) {
    movies.set(`f${i}`, { id: `f${i}`, posterUrl: `data:image/png,f${i}` });
  }
  movies.set('ok', { id: 'ok', posterUrl: 'data:image/png,ok' });
  const pix = new Map<string, Uint8Array>();
  const deps: DetailActivateDeps = {
    getMovie: (id) => movies.get(id) ?? null,
    getGlobalIndex: (id) => id === 'ok' ? 99 : Number(id.slice(1)),
    isDesired: (id) => desired.has(id),
    isSelected: () => false,
    sceneGeneration: () => gen.n,
    getPixels: (id) => pix.get(id) ?? null,
    loadPoster: (movie, _p, _cb, onSettled) => {
      if (onSettled) settled.set(movie.id, onSettled);
    },
    queueUpload: (run) => { run(); },
    uploadLayer: () => true,
    setLut: (i, v) => { lut.set(i, v); return true; },
    clearLut: (i) => { lut.set(i, 0); },
    now: () => now.t,
  };
  for (let i = 0; i < POSTER_DETAIL_SLOT_LIMIT; i++) {
    const id = `f${i}`;
    desired.add(id);
    activateDetailTitle(id, deps, residency, retry);
    settled.get(id)?.();
    desired.delete(id);
  }
  assert.equal(residency.snapshot().leased, 0);
  assert.equal(residency.snapshot().readyResident, 0);
  assert.equal(residency.snapshot().loadFailed, POSTER_DETAIL_SLOT_LIMIT);
  desired.add('ok');
  pix.set('ok', pixels());
  activateDetailTitle('ok', deps, residency, retry);
  assert.equal(residency.isReady('ok'), true);
  assert.equal(residency.snapshot().leased, 1);
});

test('stale failure settlement cannot mutate a reused slot owner', () => {
  const h = host({ desired: new Set(['a']) });
  h.act('a');
  const leaseA = h.residency.peek('a')!;
  const failA = h.settled.get('a')!;
  h.desired.delete('a');
  h.selected.id = null;
  demoteDetailTitle('a', h.deps, h.residency);
  h.desired.add('b');
  h.pix.set('b', pixels());
  h.act('b');
  assert.equal(h.residency.isReady('b'), true);
  const lutB = h.lut.get(1);
  failA();
  assert.equal(h.residency.isLeaseCurrent(leaseA), false);
  assert.equal(h.residency.isReady('b'), true);
  assert.equal(h.lut.get(1), lutB);
  assert.equal(h.residency.snapshot().readyResident, 1);
});

test('old scene-generation failure cannot affect the new generation', () => {
  const h = host();
  h.act('a');
  assert.equal(h.residency.snapshot().leased, 1);
  const fail = h.settled.get('a')!;
  h.gen.n = 2;
  fail();
  assert.equal(h.residency.isReady('a'), false);
  assert.equal(h.residency.snapshot().loadFailed, 0);
  assert.ok(h.residency.snapshot().staleDropped >= 1);
});

test('old scene-generation success cannot affect the new generation', () => {
  const h = host();
  h.act('a');
  const succeed = h.delayed.get('a')!;
  h.gen.n = 2;
  succeed(pixels());
  assert.equal(h.residency.isReady('a'), false);
  assert.equal(h.residency.snapshot().uploaded, 0);
  assert.ok(h.residency.snapshot().staleDropped >= 1);
});

test('undersized DETAIL buffer never reaches READY and does not leak a lease', () => {
  const h = host();
  h.act('a');
  h.delayed.get('a')!(new Uint8Array(16));
  assert.equal(h.residency.isReady('a'), false);
  assert.equal(h.residency.snapshot().leased, 0);
  assert.equal(h.residency.snapshot().pendingPixels, 0);
  assert.equal(h.residency.snapshot().malformedDropped, 1);
  assert.equal(h.lut.get(0) ?? 0, 0);
});

test('uploadLayer and LUT failures settle to BASE without leaking pendingUpload', () => {
  const up = { ok: false };
  const h = host({ uploadOk: () => up.ok });
  h.pix.set('a', pixels());
  h.act('a');
  assert.equal(h.residency.snapshot().readyResident, 0);
  assert.equal(h.residency.snapshot().leased, 0);
  assert.equal(h.residency.snapshot().pendingUpload, 0);
  assert.equal(h.residency.snapshot().uploadFailed, 1);

  const lutGate = { ok: false };
  const h2 = host({ lutOk: () => lutGate.ok });
  h2.pix.set('a', pixels());
  h2.act('a');
  assert.equal(h2.residency.snapshot().readyResident, 0);
  assert.equal(h2.residency.snapshot().leased, 0);
  assert.equal(h2.residency.snapshot().lutFailed, 1);
});
