import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PosterResidencyWindow } from '../src/poster-residency.ts';
import {
  capP0UniqueToBudget,
  countPriorityUniques,
  uniqueTitlePriority,
} from '../src/perf/store-readiness.ts';

function assertStep(win: PosterResidencyWindow, label: string) {
  const inv = win.validateInvariants();
  assert.equal(inv.ok, true, `${label}: ${JSON.stringify(inv)}`);
  assert.ok(win.residentCount <= win.slots, `${label} residentCount`);
  assert.equal(win.uniquePhysicalOwners(), win.residentCount, `${label} unique owners`);
  assert.equal(win.freeCount + win.residentCount, win.slots, `${label} free+resident`);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('first eviction does not leak reused index into free; second acquire does not alias', () => {
  const win = new PosterResidencyWindow(2);
  const a = win.acquire('a', 'P0');
  assertStep(win, 'after a');
  const b = win.acquire('b', 'P3');
  assertStep(win, 'after b');
  const c = win.acquire('c', 'P1');
  assertStep(win, 'after c');
  assert.equal(c.evicted, 'b');
  assert.equal(win.peek('b'), null);
  assert.equal(win.peek('c'), c.index);
  const inv = win.validateInvariants();
  assert.equal(inv.freeOwnedCollisions, 0);
  assert.equal(c.ok, true);

  const d = win.acquire('d', 'P1');
  assertStep(win, 'after d');
  assert.equal(d.ok, false);
  assert.equal(win.peek('c'), c.index);
  assert.equal(win.peek('d'), null);
});

test('two post-eviction P1 titles occupy distinct physical slots', () => {
  const win = new PosterResidencyWindow(2);
  win.acquire('a', 'P3');
  win.acquire('b', 'P3');
  const c = win.acquire('c', 'P1');
  assert.equal(c.ok, true);
  assertStep(win, 'c');
  const d = win.acquire('d', 'P1');
  assert.equal(d.ok, true);
  assert.notEqual(d.index, c.index);
  assert.equal(win.peek('c'), c.index);
  assert.equal(win.peek('d'), d.index);
  assertStep(win, 'd');
});

test('P0 is protected from P3 and does not evict another P0', () => {
  const win = new PosterResidencyWindow(2);
  win.acquire('a', 'P0');
  win.acquire('b', 'P0');
  const denied = win.acquire('c', 'P0');
  assert.equal(denied.ok, false);
  assert.equal(win.peek('a') != null, true);
  assert.equal(win.peek('b') != null, true);
  const p3 = win.acquire('d', 'P3');
  assert.equal(p3.ok, false);
  win.acquire('e', 'P1');
  assert.equal(win.peek('a') != null && win.peek('b') != null, true);
  assertStep(win, 'p0 protected');
});

test('P1 evicts P3, explicit release/reacquire is unique, maps stay bidirectional', () => {
  const win = new PosterResidencyWindow(2);
  win.acquire('a', 'P0');
  win.acquire('b', 'P3');
  const c = win.acquire('c', 'P1');
  assert.equal(c.evicted, 'b');
  const released = win.release('c');
  assert.equal(released, c.index);
  assert.equal(win.peek('c'), null);
  assertStep(win, 'after release c');
  const again = win.acquire('c', 'P1');
  assert.equal(again.ok, true);
  assertStep(win, 'reacquire c');
});

test('stale async upload lease is rejected after slot reuse; new owner lease succeeds', () => {
  const win = new PosterResidencyWindow(1);
  const a = win.acquire('A', 'P3');
  const aLease = win.peekLease('A');
  assert.ok(aLease);
  assert.equal(win.isLeaseCurrent(aLease!), true);
  const flags = new Uint8Array(1);
  const commitFlag = (lease: NonNullable<typeof aLease>, value: number) => {
    if (!win.isLeaseCurrent(lease)) return false;
    flags[lease.index] = value;
    return true;
  };
  assert.equal(commitFlag(aLease!, 255), true);
  const b = win.acquire('B', 'P1');
  assert.equal(b.evicted, 'A');
  assert.equal(b.index, a.index);
  assert.equal(win.isLeaseCurrent(aLease!), false);
  assert.equal(commitFlag(aLease!, 128), false, 'stale loaded-flag write rejected');
  const bLease = win.peekLease('B');
  assert.ok(bLease);
  assert.equal(win.isLeaseCurrent(bLease!), true);
  flags[0] = 0;
  assert.equal(commitFlag(bLease!, 255), true);
  assert.equal(flags[0], 255);
  assert.equal(bLease!.generation, aLease!.generation + 1);
  assertStep(win, 'lease reuse');
});

test('resident metadata does not grow with catalog walk', () => {
  const win = new PosterResidencyWindow(8);
  for (let i = 0; i < 5000; i++) {
    win.acquire(`m${i}`, i % 4 === 0 ? 'P0' : 'P3');
    if (i % 17 === 0) win.release(`m${i}`);
  }
  const inv = win.validateInvariants();
  assert.equal(inv.ok, true);
  assert.equal(inv.stalePriorityEntries, 0);
  assert.ok(win.residentCount <= 8);
  assert.ok(win.residentHighWaterMark <= 8);
});

test('P0 unique titles are capped to the physical budget', () => {
  const items = [];
  for (let i = 0; i < 400; i++) {
    items.push({ movieId: `t${i}`, dist: i, cls: 'P0' as const });
  }
  items.push({ movieId: 'near-copy', dist: 0.5, cls: 'P0' as const });
  const capped = capP0UniqueToBudget(uniqueTitlePriority(items), 128);
  const counts = countPriorityUniques(capped);
  assert.equal(counts.p0UniqueTitles, 128);
  assert.ok(counts.p0UniqueTitles <= 128);
  assert.equal(capped.get('t0'), 'P0');
  assert.equal(capped.get('t200'), 'P1');
});

test('populated windows stay bounded for 200/1000/2000/4000 logical titles', () => {
  for (const n of [200, 1000, 2000, 4000]) {
    const win = new PosterResidencyWindow(128);
    const classes = ['P0', 'P1', 'P2', 'P3'] as const;
    for (let i = 0; i < n; i++) {
      win.acquire(`id-${i}`, classes[i % 4]);
      if (i % 64 === 0) assertStep(win, `${n}@${i}`);
    }
    assertStep(win, `end ${n}`);
    assert.ok(win.residentHighWaterMark <= 128);
    assert.ok(win.residentCount <= 128);
    assert.equal(win.uniquePhysicalOwners(), win.residentCount);
  }
});

test('10k-operation stress on 1/2/4/16/128 slots never aliases', () => {
  for (const slots of [1, 2, 4, 16, 128]) {
    const win = new PosterResidencyWindow(slots);
    const rng = mulberry32(slots * 997);
    const classes = ['P0', 'P1', 'P2', 'P3'] as const;
    const catalog = Math.max(slots * 8, 1000);
    for (let i = 0; i < 10_000; i++) {
      const id = `m${Math.floor(rng() * catalog)}`;
      const op = rng();
      if (op < 0.08) win.release(id);
      else if (op < 0.2) {
        win.notePriority(id, classes[Math.floor(rng() * 4)]);
        if (win.peek(id) != null) win.acquire(id, classes[Math.floor(rng() * 4)]);
      } else {
        win.acquire(id, classes[Math.floor(rng() * 4)]);
      }
      if (i % 50 === 0) assertStep(win, `slots=${slots} i=${i}`);
    }
    assertStep(win, `slots=${slots} end`);
    assert.ok(win.residentHighWaterMark <= slots);
  }
});
