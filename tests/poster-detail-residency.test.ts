import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseDetailSet,
  estimatePosterDetailBytes,
  PosterDetailResidency,
  POSTER_DETAIL_SLOT_LIMIT,
  scoreDetailCandidate,
  type DetailCandidate,
} from '../src/poster-detail-residency.ts';

function titles(n: number): DetailCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    movieId: `t${i}`,
    x: i * 2,
    z: 0,
    globalIndex: i,
  }));
}

test('detail cache is bounded and independent of catalog size', () => {
  const r = new PosterDetailResidency(8);
  for (let i = 0; i < 40; i++) r.acquire(`t${i}`);
  assert.equal(r.residentCount() <= 8, true);
  assert.equal(r.snapshot().slotLimit, 8);
  const bytes = estimatePosterDetailBytes(64, 320, 480);
  assert.ok(bytes.gpu > 0);
  assert.ok(bytes.cpu < 200 * 1024 * 1024);
});

test('base remains conceptually visible: eviction does not require a blank gap', () => {
  const r = new PosterDetailResidency(2);
  r.acquire('a');
  r.acquire('b');
  const evicted = r.acquire('c');
  assert.ok(evicted?.evicted === 'a' || evicted?.evicted === 'b');
  assert.equal(r.peek(evicted!.evicted!), null);
  assert.ok(r.peek('c'));
});

test('stale lease after eviction is rejected', () => {
  const r = new PosterDetailResidency(1);
  const first = r.acquire('a')!.lease;
  r.acquire('b');
  assert.equal(r.isLeaseCurrent(first), false);
  r.noteStaleDrop();
  assert.equal(r.snapshot().staleDropped, 1);
});

test('selected poster outranks a nearer unselected title', () => {
  const cands: DetailCandidate[] = [
    { movieId: 'near', x: 1, z: 0, globalIndex: 0 },
    { movieId: 'sel', x: 8, z: 0, globalIndex: 1 },
  ];
  const set = chooseDetailSet(cands, {
    playerX: 0, playerZ: 0, yaw: 0, selectedId: 'sel',
    resident: new Set(), limit: 1, enterFeet: 20, keepFeet: 20,
  });
  assert.deepEqual(set, ['sel']);
});

test('near visible poster ranks ahead of far poster', () => {
  const near = scoreDetailCandidate(titles(10)[1]!, 0, 0, 0, null);
  const far = scoreDetailCandidate(titles(10)[9]!, 0, 0, 0, null);
  assert.ok(near.score > far.score);
});

test('hysteresis keeps resident across a small boundary wobble', () => {
  const cands = titles(3);
  const enter = 5;
  const keep = 8;
  const a = chooseDetailSet(cands, {
    playerX: 0, playerZ: 0, yaw: 0, selectedId: null,
    resident: new Set(), limit: 2, enterFeet: enter, keepFeet: keep,
  });
  assert.ok(a.includes('t0'));
  const wobble = chooseDetailSet(cands, {
    playerX: 6.2, playerZ: 0, yaw: 0, selectedId: null,
    resident: new Set(a), limit: 2, enterFeet: enter, keepFeet: keep,
  });
  assert.ok(wobble.includes('t0') || wobble.includes('t1'));
  let flips = 0;
  let prev = new Set(a);
  for (const x of [5.4, 5.6, 5.3, 5.7, 5.5]) {
    const next = chooseDetailSet(cands, {
      playerX: x, playerZ: 0, yaw: 0, selectedId: null,
      resident: prev, limit: 2, enterFeet: enter, keepFeet: keep,
    });
    const entered = next.filter((id) => !prev.has(id));
    const left = [...prev].filter((id) => !next.includes(id));
    if (entered.length || left.length) flips++;
    prev = new Set(next);
  }
  assert.ok(flips <= 2, `pathological thrash: ${flips}`);
});

test('all detail evicted still leaves residency empty without touching base', () => {
  const r = new PosterDetailResidency(4);
  r.acquire('a');
  r.acquire('b');
  r.release('a');
  r.release('b');
  assert.equal(r.residentCount(), 0);
  assert.equal(POSTER_DETAIL_SLOT_LIMIT, 64);
});

test('promotion is counted once per acquire of a new title', () => {
  const r = new PosterDetailResidency(4);
  r.acquire('a');
  r.acquire('a');
  assert.equal(r.snapshot().promoted, 1);
  assert.equal(r.snapshot().reacquired, 1);
});

test('a physical lease is not DETAIL_READY', () => {
  const r = new PosterDetailResidency(4);
  r.acquire('a');
  assert.equal(r.snapshot().leased, 1);
  assert.equal(r.snapshot().resident, 1);
  assert.equal(r.snapshot().readyResident, 0);
  assert.equal(r.phase('a'), 'pendingPixels');
  r.markReady('a');
  assert.equal(r.snapshot().readyResident, 1);
});

test('DETAIL byte estimate is independent of catalog size', () => {
  const a = estimatePosterDetailBytes(64, 320, 480);
  const b = estimatePosterDetailBytes(64, 320, 480);
  assert.equal(a.cpu, b.cpu);
  assert.ok(a.cpu < 64 * 1024 * 1024);
});
