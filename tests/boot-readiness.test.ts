import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySlotPriority,
  capP0UniqueToBudget,
  countPriorityUniques,
  criticalReadyFromCounts,
  DEFAULT_PRIORITY_CONTEXT,
  navigationPriority,
  posterPriorityNumber,
  revealMustNotWaitForAllTextures,
  uniqueTitlePriority,
  xrUploadBudget,
  type PriorityContext,
} from '../src/perf/store-readiness.ts';
import {
  bootDiagnosticsOrderingOk,
  bootDiagnosticsSnapshot,
  bootMark,
  type BootDiagnostics,
} from '../src/perf/boot-diagnostics.ts';
import { constructRecord, constructProfileSnapshot } from '../src/perf/construct-profile.ts';
import { BACK_WALL_UNIT_IDX } from '../src/store-layout.ts';

const ctx: PriorityContext = {
  ...DEFAULT_PRIORITY_CONTEXT,
  backWallUnitIdx: BACK_WALL_UNIT_IDX,
  selectedKey: 'sel',
  selectedLibraryIdx: 0,
};

test('progressive critical-ready does not require every cover', () => {
  assert.equal(criticalReadyFromCounts({ p0Total: 12, p0Settled: 12, geometryReady: true }), true);
  assert.equal(criticalReadyFromCounts({ p0Total: 12, p0Settled: 3, geometryReady: true }), false);
  assert.equal(criticalReadyFromCounts({ p0Total: 0, p0Settled: 0, geometryReady: true }), true);
  assert.equal(revealMustNotWaitForAllTextures({ revealedAtSettledFraction: 0.08 }), true);
  assert.equal(revealMustNotWaitForAllTextures({ revealedAtSettledFraction: 1 }), false);
});

test('priority classification is spatial, not a blind count', () => {
  assert.equal(classifySlotPriority({
    unitIdx: 0, restingX: 13, restingZ: 12.5, key: 'sel', libraryIdx: 0,
  }, ctx), 'P0');
  assert.equal(classifySlotPriority({
    unitIdx: BACK_WALL_UNIT_IDX, restingX: 11, restingZ: -20, key: 'nr', libraryIdx: 0,
  }, ctx), 'P0');
  assert.equal(classifySlotPriority({
    unitIdx: 2, restingX: 40, restingZ: -40, key: 'far', libraryIdx: 3,
  }, ctx), 'P3');
  assert.equal(posterPriorityNumber('P0') > posterPriorityNumber('P3'), true);
});

test('navigation raises unloaded distant titles', () => {
  assert.equal(navigationPriority('P3'), 'P1');
  assert.equal(navigationPriority('P2'), 'P1');
  assert.equal(navigationPriority('P0'), 'P0');
});

test('XR upload throttling keeps high-priority while cutting bulk', () => {
  const idle = xrUploadBudget({ presenting: false, moving: false, highPriorityPending: false });
  const xrMove = xrUploadBudget({ presenting: true, moving: true, highPriorityPending: true });
  const xrIdle = xrUploadBudget({ presenting: true, moving: false, highPriorityPending: false });
  assert.ok(xrMove.maxPerFrame < idle.maxPerFrame);
  assert.equal(xrMove.bulkMaxPerFrame, 0);
  assert.ok(xrIdle.bulkMaxPerFrame >= 1);
  assert.ok(xrMove.maxPerFrame >= 1);
});

test('boot diagnostic ordering invariants', () => {
  bootMark('appStart', 1);
  bootMark('qualityCalibrationStart', 10);
  bootMark('qualityCalibrationEnd', 40);
  bootMark('storeSceneConstructStart', 50);
  bootMark('storeSceneConstructEnd', 80);
  bootMark('criticalTextureReady', 120);
  bootMark('storeInteractive', 121);
  bootMark('allTexturesSettled', 400);
  const d: BootDiagnostics = bootDiagnosticsSnapshot();
  assert.equal(bootDiagnosticsOrderingOk(d), true);
  assert.ok((d.timeToInteractive ?? 0) < (d.timeToFullTextures ?? 0));
  assert.equal(d.criticalReadyBeforeAllTextures, true);
  assert.ok(Array.isArray(d.construct.top3));
});

test('construct profile records stages and top3 by cost', () => {
  constructRecord('cheap', 1);
  constructRecord('mid', 4);
  constructRecord('expensive', 20);
  const snap = constructProfileSnapshot();
  assert.ok(snap.stages.some((s) => s.name === 'cheap'));
  assert.equal(snap.top3[0]?.name, 'expensive');
  assert.equal(snap.top3[1]?.name, 'mid');
  assert.ok(snap.totalMs >= 25);
});

test('P0 unique working set is capped to physical poster slots', () => {
  const items = Array.from({ length: 300 }, (_, i) => ({
    movieId: `m${i}`,
    dist: i,
    cls: 'P0' as const,
  }));
  const capped = capP0UniqueToBudget(uniqueTitlePriority(items), 128);
  const counts = countPriorityUniques(capped);
  assert.equal(counts.p0UniqueTitles, 128);
  assert.ok(counts.p0UniqueTitles <= 128);
  assert.ok(counts.p1UniqueTitles >= 1);
});

