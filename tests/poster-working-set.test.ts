import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PosterResidencyWindow } from '../src/poster-residency.ts';
import {
  computeDesiredWorkingSet,
  reconcilePosterWindow,
  selectGpuWorkingSet,
  shouldReconcileWorkingSet,
  shouldUpdateWorkingSet,
  type SpatialTitle,
} from '../src/poster-working-set.ts';
import { uniqueTitlePriority } from '../src/perf/store-readiness.ts';

function assertInv(win: PosterResidencyWindow, label: string) {
  const inv = win.validateInvariants();
  assert.equal(inv.ok, true, `${label}: ${JSON.stringify(inv)}`);
  assert.ok(win.residentCount <= win.slots, label);
  assert.equal(win.uniquePhysicalOwners(), win.residentCount, label);
}

function title(id: string, x: number, z: number, extra: Partial<SpatialTitle> = {}): SpatialTitle {
  return {
    movieId: id,
    x,
    z,
    unitIdx: extra.unitIdx ?? 0,
    libraryIdx: extra.libraryIdx ?? 0,
    key: extra.key ?? id,
  };
}

const qBase = {
  backWallUnitIdx: 999,
  p0Radius: 8,
  p1Radius: 16,
  storeCenterX: 11,
  budget: 4,
};

test('working set: boot pin, unpin, then movement rotates 4-slot window', () => {
  const win = new PosterResidencyWindow(4);
  win.acquire('A', 'P0');
  win.pin('A');
  win.acquire('B', 'P1');
  win.acquire('C', 'P1');
  win.acquire('D', 'P1');
  assert.equal(win.acquire('E', 'P1').ok, true);
  assert.equal(win.peek('A') != null, true, 'pinned A survives extra P1');
  assertInv(win, 'boot full');

  win.unpinAll();
  const moved = reconcilePosterWindow(win, new Map([
    ['C', 'P1'],
    ['D', 'P1'],
    ['E', 'P1'],
    ['F', 'P0'],
  ]));
  assert.ok(moved.entered.includes('F') || win.peek('F') != null);
  assert.equal(win.peek('F') != null, true);
  assert.equal(win.peek('C') != null, true);
  assert.equal(win.peek('D') != null, true);
  assert.equal(win.residentCount, 4);
  assert.ok(win.evictionCount > 0);
  assert.equal(win.peek('A'), null);
  assertInv(win, 'after move');
});

test('selected nonresident title evicts stale P1', () => {
  const win = new PosterResidencyWindow(3);
  win.acquire('stale-a', 'P1');
  win.acquire('stale-b', 'P1');
  win.acquire('stale-c', 'P1');
  const r = reconcilePosterWindow(win, new Map([
    ['stale-b', 'P1'],
    ['stale-c', 'P1'],
    ['selected', 'P0'],
  ]));
  assert.equal(win.peek('selected') != null, true);
  assert.equal(win.peek('stale-a'), null);
  assert.ok(r.entered.includes('selected'));
  assertInv(win, 'selected wins');
});

test('force recompute does not unpin boot P0 before critical-ready', () => {
  assert.equal(shouldReconcileWorkingSet(true, true), false);
  assert.equal(shouldReconcileWorkingSet(true, false), false);
  assert.equal(shouldReconcileWorkingSet(false, true), true);
  const win = new PosterResidencyWindow(3);
  win.acquire('A', 'P0');
  win.pin('A');
  win.acquire('B', 'P1');
  win.acquire('C', 'P1');
  const r = reconcilePosterWindow(win, new Map([
    ['C', 'P1'],
    ['D', 'P1'],
    ['E', 'P0'],
  ]), ['A']);
  assert.equal(win.peek('A') != null, true);
  assert.equal(win.isPinned('A'), true);
  assert.equal(win.peek('E') != null, true);
  assert.equal(win.residentCount, 3);
  assertInv(win, 'boot pins survive force reconcile');
  void r;
});

test('player position changes desired working set across regions', () => {
  const titles: SpatialTitle[] = [];
  const regions = [
    { name: 'entrance', x: 13, z: 12, ids: ['e0', 'e1', 'e2', 'e3', 'e4'] },
    { name: 'aisleA', x: 4, z: 0, ids: ['a0', 'a1', 'a2', 'a3', 'a4'] },
    { name: 'aisleB', x: 18, z: 0, ids: ['b0', 'b1', 'b2', 'b3', 'b4'] },
    { name: 'back', x: 11, z: -24, ids: ['w0', 'w1', 'w2', 'w3', 'w4'] },
  ];
  for (const region of regions) {
    for (let i = 0; i < region.ids.length; i++) {
      titles.push(title(region.ids[i], region.x + (i % 3), region.z + Math.floor(i / 3)));
    }
  }
  const budget = 6;
  const at = (x: number, z: number) => computeDesiredWorkingSet(titles, { ...qBase, budget, playerX: x, playerZ: z, p0Radius: 6, p1Radius: 10 });
  const entrance = at(13, 12);
  const aisleA = at(4, 0);
  const aisleB = at(18, 0);
  const back = at(11, -24);
  const win = new PosterResidencyWindow(budget);
  reconcilePosterWindow(win, entrance.desired);
  const entranceSet = new Set(win.residentIds());
  reconcilePosterWindow(win, aisleA.desired);
  const aisleASet = new Set(win.residentIds());
  assert.ok([...aisleASet].some((id) => !entranceSet.has(id)), 'aisle A introduces new titles');
  assert.ok([...entranceSet].some((id) => !aisleASet.has(id)), 'old entrance titles leave');
  reconcilePosterWindow(win, aisleB.desired);
  const aisleBSet = new Set(win.residentIds());
  assert.ok([...aisleBSet].some((id) => !aisleASet.has(id)));
  reconcilePosterWindow(win, back.desired);
  reconcilePosterWindow(win, entrance.desired);
  assert.ok(win.residentIds().some((id) => entrance.desired.has(id)));
  assert.ok(win.residentCount <= budget);
  assert.ok(win.evictionCount > 0);
  assertInv(win, 'regions');
});

test('reacquire after eviction uses a new lease generation', () => {
  const win = new PosterResidencyWindow(1);
  const a = win.acquire('A', 'P1');
  const aLease = win.peekLease('A')!;
  win.acquire('B', 'P1');
  assert.equal(win.isLeaseCurrent(aLease), false);
  assert.equal(win.peek('A'), null);
  const again = win.acquire('A', 'P1');
  assert.equal(again.ok, true);
  assert.ok(again.generation > aLease.generation);
  assert.equal(win.isLeaseCurrent(aLease), false);
  assert.equal(win.isLeaseCurrent(win.peekLease('A')!), true);
  assert.ok(win.reacquisitionCount >= 1);
  assertInv(win, 'reacquire');
});

test('stale async upload is rejected after working-set rotation', () => {
  const win = new PosterResidencyWindow(1);
  win.acquire('A', 'P1');
  const aLease = win.peekLease('A')!;
  win.acquire('B', 'P1');
  assert.equal(win.isLeaseCurrent(aLease), false);
  const flags = new Uint8Array(1);
  const commit = (lease: NonNullable<typeof aLease>, v: number) => {
    if (!win.isLeaseCurrent(lease)) return false;
    flags[lease.index] = v;
    return true;
  };
  assert.equal(commit(aLease, 128), false);
  const bLease = win.peekLease('B')!;
  assert.equal(commit(bLease, 255), true);
  assert.equal(flags[0], 255);
  win.acquire('A', 'P1');
  const a2 = win.peekLease('A')!;
  assert.notEqual(a2.generation, aLease.generation);
  assert.equal(commit(aLease, 1), false);
  assert.equal(commit(a2, 200), true);
  assertInv(win, 'stale rotation');
});

test('initial GPU working set stays bounded as catalog grows 200→4000', () => {
  const scheduled: number[] = [];
  for (const n of [200, 1000, 2000, 4000]) {
    const items = [];
    for (let i = 0; i < n; i++) {
      items.push({
        movieId: `t${i}`,
        dist: (i % 80) + Math.floor(i / 80) * 0.1,
        cls: (i < 40 ? 'P0' : i < 200 ? 'P1' : i < 800 ? 'P2' : 'P3') as const,
      });
    }
    const desired = selectGpuWorkingSet(uniqueTitlePriority(items), 128);
    assert.ok(desired.desiredCount <= 128, `${n} desired`);
    assert.ok(desired.p0Ids.length + desired.p1Ids.length <= 128);
    scheduled.push(desired.p1Ids.length);
  }
  assert.equal(scheduled[0] <= 128, true);
  assert.ok(scheduled[3] <= scheduled[1] * 1.1 + 8, '4000 must not schedule ~4x P1 GPU jobs vs 1000');
});

test('shouldUpdateWorkingSet ignores tiny motion and fires on aisle-scale moves', () => {
  const prev = { x: 13, z: 12.5, yaw: 0, selectedMovieId: null, selectedKey: 'a', selectedLibraryIdx: 0 };
  assert.equal(shouldUpdateWorkingSet(prev, { ...prev, x: 13.2, z: 12.6 }), false);
  assert.equal(shouldUpdateWorkingSet(prev, { ...prev, x: 18, z: 12.5 }), true);
  assert.equal(shouldUpdateWorkingSet(prev, { ...prev, selectedMovieId: 'sel' }), true);
});

test('computeDesiredWorkingSet is unique-id based, not slot copies', () => {
  const titles = [
    title('dup', 13, 12.5, { key: 'a' }),
    title('dup', 13.2, 12.6, { key: 'b' }),
    title('other', 40, -40, { key: 'c' }),
  ];
  const desired = computeDesiredWorkingSet(titles, { ...qBase, budget: 2, playerX: 13, playerZ: 12.5 });
  assert.equal(desired.desired.has('dup'), true);
  const ids = [...desired.desired.keys()];
  assert.equal(ids.filter((id) => id === 'dup').length, 1);
});
