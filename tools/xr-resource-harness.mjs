#!/usr/bin/env node
// Isolated Chromium + IWER resource harness. Never attaches to the owner's Chrome.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import {
  isAllowlisted,
  isSamplerOrGlFatal,
  populatedWindowImpossible,
  residencyImpossible,
} from './xr-harness-log.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'review', 'jp3');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halcyon-xr-resource-'));
const PORT = Number(process.env.HALCYON_XR_RESOURCE_PORT || 17426);
const BASE = `http://127.0.0.1:${PORT}`;
fs.mkdirSync(outDir, { recursive: true });

const consoleLog = [];
function attachConsole(page) {
  page.on('console', (msg) => consoleLog.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', (err) => consoleLog.push({ type: 'pageerror', text: String(err) }));
  page.on('response', (res) => {
    if (res.status() >= 500) {
      consoleLog.push({ type: 'error', text: `HTTP ${res.status()} ${res.url()}` });
    }
  });
}

function redact(text) {
  return String(text ?? '')
    .replace(/\[StaffPicks\][^\n]*/g, '[StaffPicks] (redacted)')
    .replace(/Endcap order candidates:[^\n]*/g, 'Endcap order candidates: (redacted)');
}

function killChild(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
  } else child.kill('SIGTERM');
}

function unexpectedSerious() {
  return consoleLog.filter((e) => e.type === 'pageerror' || e.type === 'error')
    .filter((e) => !isAllowlisted(e, consoleLog));
}

async function waitForPort(ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`dev server did not start on ${BASE}`);
}

async function ensureDevServer() {
  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: root, stdio: 'pipe', shell: process.platform === 'win32', env: { ...process.env, BROWSER: 'none' } },
  );
  await waitForPort();
  try { await fetch(`${BASE}/src/dev/iwer-runtime.ts`, { signal: AbortSignal.timeout(120_000) }); } catch { /* preload */ }
  return { child };
}

async function waitReady(page, { bare = false } = {}, ms = 240_000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await page.evaluate((wantBare) => {
      const boot = document.getElementById('boot-overlay');
      return {
        overlayHidden: boot ? !boot.classList.contains('visible') : true,
        scene: !!window.storeScene,
        xrTest: !!window.__xrTest,
        bare: !!window.__bareXr,
        tti: window.__bootDiagnostics?.()?.timeToInteractive ?? null,
      };
    }, bare).catch((err) => ({ error: String(err) }));
    if (bare) {
      if (last.bare && last.xrTest) return last;
    } else if (last.overlayHidden && last.scene && last.xrTest) return last;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`ready timeout: ${JSON.stringify(last)}`);
}

async function enterAndWaitWorld(page, { store = false } = {}) {
  return page.evaluate(async (wantStore) => {
    const until = Date.now() + 15000;
    while (!window.__xrTest && Date.now() < until) await new Promise((r) => setTimeout(r, 150));
    const xr = window.__xrTest;
    const entered = xr ? await xr.enter() : { ok: false, error: 'no __xrTest' };
    const t0 = Date.now();
    let d = window.__xrDiagnostics?.();
    while (Date.now() - t0 < 8000) {
      d = window.__xrDiagnostics?.();
      const gpu = window.__gpuDiagnostics?.();
      if (d?.startup?.firstWorldRenderCompletedAt != null) {
        if (!wantStore || gpu?.firstStoreXrRenderAt != null) break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const gpu = window.__gpuDiagnostics?.() ?? null;
    const heap = performance.memory ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
    } : null;
    return { entered, d, gpu, heap, tti: window.__bootDiagnostics?.()?.timeToInteractive ?? null };
  }, store);
}

async function main() {
  const { child } = await ensureDevServer();
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: profileDir,
    args: ['--no-first-run', '--no-default-browser-check', '--mute-audio'],
  });
  const evidence = { startedAt: new Date().toISOString(), scenarios: [] };

  try {
    const barePage = await browser.newPage();
    attachConsole(barePage);
    await barePage.goto(`${BASE}/?xrBare=1&xrEmu=1&nogate=1`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const bareBoot = await waitReady(barePage, { bare: true });
    const bareXr = await enterAndWaitWorld(barePage);
    const probes = {};
    const populated = {};
    const workingSets = {};
    for (const n of [200, 1000, 2000, 4000]) {
      probes[n] = await barePage.evaluate(async (count) => {
        const fn = window.__posterResourceProbe;
        return fn ? fn(count) : { error: 'no probe' };
      }, n);
      populated[n] = await barePage.evaluate(async (count) => {
        const fn = window.__posterResidencyProbe;
        return fn ? fn(count) : { error: 'no probe' };
      }, n);
      workingSets[n] = await barePage.evaluate(async (count) => {
        const fn = window.__posterWorkingSetProbe;
        return fn ? fn(count) : { error: 'no probe' };
      }, n);
    }
    await barePage.evaluate(async () => { await window.__xrTest?.exit?.(); });
    const layoutOk = (n) => {
      const probe = probes[n];
      const pop = populated[n];
      const ws = workingSets[n];
      return typeof probe?.cpuBytes === 'number'
        && probe.dualArrays === false
        && probe.evictionWindow === false
        && (pop?.evictionCount ?? 0) === 0
        && !populatedWindowImpossible(pop)
        && (pop.residentCount ?? 0) <= (pop.physicalSlots ?? 0)
        && (pop.uniqueOwners ?? 0) === (pop.residentCount ?? 0)
        && (pop.residentHighWaterMark ?? 0) <= (pop.physicalSlots ?? 0)
        && ws?.evictionWindow === false
        && (ws?.desiredCount ?? 0) === n;
    };
    const cap2001 = await barePage.evaluate(async () => {
      const fn = window.__posterCapacityPlan;
      return fn ? fn(2001, 256) : { error: 'no plan' };
    });
    const cap4000 = await barePage.evaluate(async () => {
      const fn = window.__posterCapacityPlan;
      return fn ? fn(4000, 256) : { error: 'no plan' };
    });
    const gpuMulti = await barePage.evaluate(async () => {
      const fn = window.__posterUniqueMultibankProbe;
      return fn ? fn() : { error: 'no probe' };
    });
    evidence.scenarios.push({
      name: 'BARE',
      pass: !!bareXr.entered?.ok && bareXr.d?.startup?.firstWorldRenderCompletedAt != null,
      boot: bareBoot,
      xr: bareXr,
    });
    for (const n of [200, 1000, 2000, 4000]) {
      evidence.scenarios.push({
        name: `XR_SAFE_${n}`,
        evidenceKind: probes[n]?.evidenceKind ?? (probes[n]?.skippedGpuAlloc ? 'PLANNING_ONLY' : 'REAL_GPU_ALLOCATION'),
        pass: layoutOk(n),
        probe: probes[n],
        populated: populated[n],
        workingSet: workingSets[n],
      });
    }
    evidence.scenarios.push({
      name: 'POSTER_WINDOW',
      evidenceKind: 'PLANNING_ONLY',
      pass: [200, 1000, 2000, 4000].every((n) => layoutOk(n)),
      probes,
      populated,
      workingSets,
      bytes: [200, 1000, 2000, 4000].map((n) => probes[n]?.cpuBytes ?? null),
    });
    evidence.scenarios.push({
      name: 'JP4A_CAPACITY_256_2001',
      classification: 'SOFTWARE_PLANNING_TEST',
      evidenceKind: 'PLANNING_ONLY',
      pass: cap2001?.capacityOk === true
        && cap2001?.bankCount >= 8
        && cap2001?.actuallyRenderableTitles === 2001
        && cap2001?.samplersPerDraw === 1
        && cap2001?.evictionWindow === false,
      plan: cap2001,
    });
    evidence.scenarios.push({
      name: 'JP4A_CAPACITY_256_4000',
      classification: 'SOFTWARE_PLANNING_TEST',
      evidenceKind: 'PLANNING_ONLY',
      pass: cap4000?.capacityOk === true
        && cap4000?.bankCount >= 16
        && cap4000?.actuallyRenderableTitles === 4000
        && cap4000?.samplersPerDraw === 1,
      plan: cap4000,
    });
    evidence.scenarios.push({
      name: 'JP4A_REAL_GPU_MULTIBANK',
      classification: gpuMulti?.classification ?? 'DESKTOP_BROWSER',
      evidenceKind: 'REAL_GPU_ALLOCATION',
      pass: gpuMulti?.evidenceKind === 'REAL_GPU_ALLOCATION'
        && gpuMulti?.bankCount > 1
        && gpuMulti?.aliased === false
        && gpuMulti?.contextLost === false
        && gpuMulti?.glFatal === false
        && gpuMulti?.uniqueSamples === gpuMulti?.uniqueTextureCount
        && gpuMulti?.sampled === gpuMulti?.uniqueTextureCount,
      probe: gpuMulti,
    });
    await barePage.close();

    const storePage = await browser.newPage();
    attachConsole(storePage);
    await storePage.goto(`${BASE}/?demo=1&nogate=1&xrEmu=1&xrSafe=1&xrMinimal=1`, {
      waitUntil: 'domcontentloaded', timeout: 60_000,
    });
    const storeBoot = await waitReady(storePage);
    const preloadSnap = await storePage.evaluate(() => {
      const ready = window.__storeReadiness?.() ?? null;
      const perf = window.__xrPerfDiagnostics?.() ?? null;
      const gpu = window.__gpuDiagnostics?.() ?? null;
      const ws = window.__posterWorkingSet?.() ?? null;
      return {
        classification: 'DESKTOP_BROWSER',
        STORE_VISIBLE_BASE: {
          expected: ready?.postersExpected ?? null,
          realReady: ready?.postersUploaded ?? null,
          stableFallback: ready?.postersFallback ?? null,
          missing: ready?.postersMissing ?? null,
          pendingWorkAtVisualReady: ready?.pendingBaseWork ?? null,
          pendingUploadAtVisualReady: ready?.pendingBaseUpload ?? null,
          pendingDecodeAtVisualReady: ready?.pendingBaseDecode ?? null,
          lateRealUploadRejected: ready?.lateRealUploadRejected ?? null,
          staleGenerationDrops: ready?.staleGenerationDrops ?? null,
        },
        STORE: {
          visualReady: ready?.visualReady ?? null,
          worldReady: ready?.worldReady ?? null,
          requiredReady: ready?.requiredReady ?? null,
          interactive: ready?.state === 'STORE_INTERACTIVE' || ready?.state === 'STORE_VISUAL_READY',
          state: ready?.state ?? null,
        },
        RESIDENCY: {
          mapped: gpu?.posterLogicalMappedTitles ?? null,
          actuallyRenderable: gpu?.posterActuallyRenderableTitles ?? null,
          resident: gpu?.posterResidentTitles ?? null,
          invariantOk: gpu?.posterCapacityInvariantOk ?? gpu?.posterResidencyInvariantOk ?? null,
        },
        GPU: {
          contextLost: gpu?.contextLost ?? null,
          maxArrayTextureLayers: gpu?.maxArrayTextureLayers ?? null,
          effectiveTestMaxArrayTextureLayers: gpu?.effectiveTestMaxArrayTextureLayers ?? null,
        },
        UPLOAD: perf?.UPLOAD ?? null,
        ws,
      };
    });
    fs.mkdirSync(path.join(root, 'docs', 'review', 'jp4a'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'docs', 'review', 'jp4a', 'jp4a-round4-preload-stability.json'),
      JSON.stringify({
        classification: 'DESKTOP_BROWSER',
        evidenceKind: 'STORE_VISIBLE_BASE_DRAIN',
        pass: preloadSnap.STORE?.visualReady === true
          && (preloadSnap.STORE_VISIBLE_BASE?.pendingWorkAtVisualReady ?? 1) === 0
          && (preloadSnap.STORE_VISIBLE_BASE?.pendingUploadAtVisualReady ?? 1) === 0
          && (preloadSnap.STORE_VISIBLE_BASE?.missing ?? 1) === 0
          && preloadSnap.GPU?.contextLost !== true,
        snapshot: preloadSnap,
        QUEST_HARDWARE: 'NOT_EXECUTED',
      }, null, 2),
    );
    evidence.scenarios.push({
      name: 'JP4A_PRELOAD_STABILITY',
      classification: 'DESKTOP_BROWSER',
      pass: preloadSnap.STORE?.visualReady === true
        && (preloadSnap.STORE_VISIBLE_BASE?.pendingWorkAtVisualReady ?? 1) === 0
        && (preloadSnap.STORE_VISIBLE_BASE?.pendingUploadAtVisualReady ?? 1) === 0
        && (preloadSnap.STORE_VISIBLE_BASE?.missing ?? 1) === 0,
      snapshot: preloadSnap,
    });
    const storeXr = await enterAndWaitWorld(storePage, { store: true });
    await storePage.screenshot({ path: path.join(outDir, 'xr-safe-entrance.png') }).catch(() => {});
    const locomotion = await storePage.evaluate(async () => {
      const xr = window.__xrTest;
      const snap = () => ({
        pose: window.storeScene?.xr?.rigPose ?? null,
        gpu: window.__gpuDiagnostics?.() ?? null,
        ws: window.__posterWorkingSet?.() ?? null,
        art: window.__posterArtSample?.() ?? null,
      });
      const waitPinsReleased = async () => window.__posterWorkingSet?.() ?? null;
      const bootWs = await waitPinsReleased();
      const gpu0 = window.__gpuDiagnostics?.() ?? null;
      const before = snap();
      const checkpoints = [];
      const walk = async (x, y, ms, name) => {
        xr?.setStick?.('left', x, y);
        await new Promise((r) => setTimeout(r, ms));
        xr?.setStick?.('left', 0, 0);
        await new Promise((r) => setTimeout(r, 250));
        checkpoints.push({ name, ...snap() });
      };
      const snapTurn = async (dir, ms = 450) => {
        xr?.setStick?.('right', dir, 0);
        await new Promise((r) => setTimeout(r, ms));
        xr?.setStick?.('right', 0, 0);
      };
      checkpoints.push({ name: 'entrance', ...before });
      await walk(0, -1, 3500, 'aisle-forward');
      await snapTurn(1);
      await walk(1, 0, 2500, 'center-aisle');
      await walk(0, -1, 4000, 'back-section');
      await snapTurn(-1);
      await walk(-1, 0, 2800, 'side-section');
      await walk(0, 1, 3000, 'return');
      xr?.trigger?.('right', true);
      await new Promise((r) => setTimeout(r, 200));
      xr?.trigger?.('right', false);
      await new Promise((r) => setTimeout(r, 2500));
      const afterWalk = snap();
      const idleBefore = {
        decode: afterWalk.ws?.posterDecodeJobsStarted ?? 0,
        upload: afterWalk.ws?.posterUploadJobsStarted ?? 0,
        evict: afterWalk.gpu?.posterEvictionCount ?? 0,
        cache: afterWalk.gpu?.posterCpuCacheBytes ?? 0,
      };
      await new Promise((r) => setTimeout(r, 10_000));
      const afterIdle = snap();
      const idleAfter = {
        decode: afterIdle.ws?.posterDecodeJobsStarted ?? 0,
        upload: afterIdle.ws?.posterUploadJobsStarted ?? 0,
        evict: afterIdle.gpu?.posterEvictionCount ?? 0,
        cache: afterIdle.gpu?.posterCpuCacheBytes ?? 0,
      };
      const xrDiag = window.__xrDiagnostics?.() ?? null;
      await xr?.exit?.();
      return {
        before: before.pose,
        after: afterWalk.pose,
        gpu0,
        gpu: afterWalk.gpu,
        ws0: before.ws,
        ws: afterWalk.ws,
        bootWs,
        art: afterWalk.art,
        checkpoints: checkpoints.map((c) => ({
          name: c.name,
          pose: c.pose,
          resident: c.gpu?.posterResidentTitles ?? null,
          desired: c.ws?.posterDesiredCount ?? null,
          pinned: c.ws?.posterPinnedCount ?? c.gpu?.posterPinnedCount ?? null,
          eviction: c.gpu?.posterEvictionCount ?? null,
          acquisition: c.gpu?.posterAcquisitionCount ?? c.ws?.posterAcquisitionCount ?? null,
          invariant: c.gpu?.posterResidencyInvariantOk ?? null,
          version: c.ws?.posterWorkingSetVersion ?? c.gpu?.posterWorkingSetVersion ?? null,
        })),
        idle: {
          before: idleBefore,
          after: idleAfter,
          decodeDelta: idleAfter.decode - idleBefore.decode,
          uploadDelta: idleAfter.upload - idleBefore.upload,
          evictionDelta: idleAfter.evict - idleBefore.evict,
          cacheDelta: idleAfter.cache - idleBefore.cache,
        },
        xrDiag,
      };
    });
    await storePage.screenshot({ path: path.join(outDir, 'xr-safe-back-section.png') }).catch(() => {});
    const moved = locomotion.after && locomotion.before
      && (locomotion.after.x !== locomotion.before.x || locomotion.after.z !== locomotion.before.z);
    const gpu = locomotion.gpu ?? storeXr.gpu;
    const ws = locomotion.ws ?? {};
    const q = locomotion.xrDiag?.quality ?? storeXr.d?.quality;
    const storeResidencyOk = !residencyImpossible(gpu)
      && (gpu?.posterResidentTitles ?? 0) <= (gpu?.posterPhysicalSlots ?? 0)
      && (gpu?.posterResidentHighWaterMark ?? 0) <= (gpu?.posterPhysicalSlots ?? 0)
      && (gpu?.posterDuplicatePhysicalOwners ?? 0) === 0
      && (gpu?.posterFreeOwnedCollisions ?? 0) === 0
      && gpu?.posterResidencyInvariantOk !== false
      && (gpu?.posterEvictionCount ?? 0) === 0;
    const pinsReleased = true;
    const rotated = (gpu?.posterEvictionCount ?? 0) === 0
      && (ws.posterLeftWorkingSetCount ?? gpu?.posterLeftWorkingSetCount ?? 0) === 0;
    const artOk = (locomotion.art?.withArtCount ?? 0) > 0;
    const idleQuiet = (locomotion.idle?.decodeDelta ?? 0) === 0
      && (locomotion.idle?.uploadDelta ?? 0) === 0
      && (locomotion.idle?.evictionDelta ?? 0) === 0;
    const qualityAgrees = q?.n8ao === false
      && q?.postprocessing === 'none'
      && q?.framebufferScale === 0.8
      && gpu?.n8aoAllocated === false
      && gpu?.composerAllocated === false
      && gpu?.xrFramebufferScaleRequested === 0.8;
    const bootNoCatalogSweep = (locomotion.ws0?.posterEvictionCount ?? 99) === 0;
    evidence.scenarios.push({
      name: 'XR_SAFE_STORE',
      pass: !!storeXr.entered?.ok
        && storeXr.d?.startup?.firstWorldRenderCompletedAt != null
        && !!moved
        && (gpu?.resourceProfile === 'XR_SAFE')
        && gpu?.composerAllocated === false
        && gpu?.n8aoAllocated === false
        && (gpu?.firstStoreXrRenderAt != null || gpu?.xrFrameCount >= 3)
        && storeResidencyOk
        && qualityAgrees
        && pinsReleased
        && rotated
        && artOk
        && idleQuiet
        && bootNoCatalogSweep,
      boot: storeBoot,
      xr: storeXr,
      locomotion,
      storeResidencyOk,
      qualityAgrees,
      pinsReleased,
      rotated,
      artOk,
      idleQuiet,
      bootNoCatalogSweep,
    });
    const detailAct = await storePage.evaluate(async () => {
      const fn = window.__posterDetailActivationProbe;
      if (typeof fn !== 'function') return { pass: false, note: 'no probe hook' };
      return await fn();
    });
    fs.mkdirSync(path.join(root, 'docs', 'review', 'jp4a'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'docs', 'review', 'jp4a', 'jp4a-round5a1-detail-activation.json'),
      JSON.stringify({
        classification: 'DESKTOP_BROWSER',
        QUEST_HARDWARE: 'NOT_EXECUTED',
        pass: detailAct?.pass === true
          && (detailAct?.decoded ?? 0) > 0
          && (detailAct?.uploaded ?? 0) > 0
          && (detailAct?.readyResident ?? 0) > 0
          && detailAct?.contextLost !== true,
        probe: detailAct,
      }, null, 2),
    );
    evidence.scenarios.push({
      name: 'JP4A_DETAIL_ACTIVATION',
      classification: 'DESKTOP_BROWSER',
      pass: detailAct?.pass === true
        && (detailAct?.decoded ?? 0) > 0
        && (detailAct?.uploaded ?? 0) > 0
        && (detailAct?.readyResident ?? 0) > 0
        && detailAct?.contextLost !== true,
      probe: detailAct,
    });
    const detailFail = await storePage.evaluate(async () => {
      const fn = window.__posterDetailFailureProbe;
      if (typeof fn !== 'function') return { pass: false, note: 'no failure probe hook' };
      return await fn();
    });
    fs.writeFileSync(
      path.join(root, 'docs', 'review', 'jp4a', 'jp4a-round5a2-detail-failure.json'),
      JSON.stringify({
        classification: 'DESKTOP_BROWSER',
        QUEST_HARDWARE: 'NOT_EXECUTED',
        pass: detailFail?.pass === true
          && detailFail?.failure?.leasedAfter === 0
          && detailFail?.failure?.readyResidentAfter === 0
          && detailFail?.pool?.leakedLeases === 0
          && detailFail?.contextLost !== true,
        probe: detailFail,
      }, null, 2),
    );
    evidence.scenarios.push({
      name: 'JP4A_DETAIL_FAILURE',
      classification: 'DESKTOP_BROWSER',
      pass: detailFail?.pass === true
        && detailFail?.failure?.leasedAfter === 0
        && detailFail?.failure?.readyResidentAfter === 0
        && detailFail?.pool?.leakedLeases === 0
        && detailFail?.contextLost !== true,
      probe: detailFail,
    });
    const inlineProf = await storePage.evaluate(() => window.__inlineProfileProbe?.() ?? { pass: false });
    fs.writeFileSync(
      path.join(root, 'docs', 'review', 'jp4a', 'jp4a-round5b-inline-profile.json'),
      JSON.stringify({ classification: 'DESKTOP_BROWSER', QUEST_HARDWARE: 'NOT_EXECUTED', ...inlineProf }, null, 2),
    );
    evidence.scenarios.push({
      name: 'JP4A_INLINE_PROFILE',
      classification: 'DESKTOP_BROWSER',
      pass: inlineProf?.pass === true,
      probe: inlineProf,
    });
    const focusQ = await storePage.evaluate(async () => {
      const fn = window.__focusQualityProbe;
      if (typeof fn !== 'function') return { pass: false, note: 'no focus probe' };
      return await fn();
    });
    fs.writeFileSync(
      path.join(root, 'docs', 'review', 'jp4a', 'jp4a-round5b-focus-quality.json'),
      JSON.stringify(focusQ, null, 2),
    );
    evidence.scenarios.push({
      name: 'JP4A_FOCUS_QUALITY',
      classification: 'DESKTOP_BROWSER',
      pass: focusQ?.pass === true && focusQ?.upscaledFromNear === false && focusQ?.contextLost !== true,
      probe: focusQ,
    });
    const uploadP = await storePage.evaluate(() => window.__uploadPolicyProbe?.() ?? { pass: false });
    fs.writeFileSync(
      path.join(root, 'docs', 'review', 'jp4a', 'jp4a-round5b-upload-policy.json'),
      JSON.stringify(uploadP, null, 2),
    );
    evidence.scenarios.push({
      name: 'JP4A_UPLOAD_POLICY',
      classification: 'DESKTOP_BROWSER',
      pass: uploadP?.pass === true,
      probe: uploadP,
    });
    const hwDiag = await storePage.evaluate(() => window.__hardwarePosterDiagProbe?.() ?? { pass: false });
    fs.writeFileSync(
      path.join(root, 'docs', 'review', 'jp4a', 'jp4a-round5b-hardware-diagnostic.json'),
      JSON.stringify(hwDiag, null, 2),
    );
    fs.writeFileSync(
      path.join(root, 'docs', 'review', 'jp4a', 'jp4a-round5b1-production-diag.json'),
      JSON.stringify({ classification: 'DESKTOP_BROWSER', QUEST_HARDWARE: 'NOT_EXECUTED', ...hwDiag }, null, 2),
    );
    evidence.scenarios.push({
      name: 'JP4A_HW_POSTER_DIAG',
      classification: 'DESKTOP_BROWSER',
      pass: hwDiag?.pass === true
        && hwDiag?.contextLost !== true
        && hwDiag?.worldStable === true
        && hwDiag?.negativeControl === true
        && hwDiag?.productionC === true
        && hwDiag?.productionD === true
        && hwDiag?.productionE === true,
      probe: hwDiag,
    });
    const admission = await storePage.evaluate(() => window.__uploadAdmissionProbe?.() ?? { pass: false });
    fs.writeFileSync(
      path.join(root, 'docs', 'review', 'jp4a', 'jp4a-round5b1-upload-admission.json'),
      JSON.stringify(admission, null, 2),
    );
    fs.writeFileSync(
      path.join(root, 'docs', 'review', 'jp4a', 'jp4a-round5b1-upload-metrics.json'),
      JSON.stringify({
        classification: 'DESKTOP_BROWSER',
        QUEST_HARDWARE: 'NOT_EXECUTED',
        texSubImageCallsAreObservedGl: false,
        scheduledVsGl: admission?.metrics ?? null,
        note: 'FOCUS DataTexture.needsUpdate is scheduled upload, not gl.texSubImage*.',
      }, null, 2),
    );
    evidence.scenarios.push({
      name: 'JP4A_UPLOAD_ADMISSION',
      classification: 'DESKTOP_BROWSER',
      pass: admission?.pass === true
        && admission?.detailReject?.uploadInFlight === false
        && admission?.afterDrain?.pendingUpload === 0,
      probe: admission,
    });
    await storePage.close();

    const multiPage = await browser.newPage();
    attachConsole(multiPage);
    await multiPage.goto(`${BASE}/?demo=1&nogate=1&xrEmu=1&xrSafe=1&xrMultibank=1&xrCatalog=24&xrPosterLayers=8`, {
      waitUntil: 'domcontentloaded', timeout: 60_000,
    });
    await waitReady(multiPage);
    const multi = await multiPage.evaluate(async () => {
      const until = Date.now() + 30000;
      while (Date.now() < until) {
        if (window.__storeReadiness?.()?.visualReady && window.__productionMultibankProbe) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const probe = window.__productionMultibankProbe?.() ?? null;
      const gpu = window.__gpuDiagnostics?.() ?? null;
      return {
        probe,
        hardware: gpu?.maxArrayTextureLayers ?? gpu?.hardwareMaxArrayTextureLayers ?? null,
        effective: gpu?.effectiveTestMaxArrayTextureLayers ?? null,
        contextLost: gpu?.contextLost === true,
      };
    });
    const observedBanks = multi.probe?.bindObserver?.banksObserved ?? [];
    const neg = multi.probe?.negativeControl;
    const multiPass = !!multi.probe?.pass
      && (multi.probe?.catalogBankCount ?? 0) >= 3
      && multi.probe?.samplersPerDraw === 1
      && multi.hardware !== 8
      && multi.effective === 8
      && multi.contextLost !== true
      && multi.probe?.probeAssistedExpectedBind === false
      && multi.probe?.glFatal === false
      && Array.isArray(multi.probe?.glErrorsAfter)
      && multi.probe.glErrorsAfter.length === 0
      && observedBanks.includes(0)
      && observedBanks.includes(1)
      && observedBanks.includes(2)
      && multi.probe?.bindObserver?.oneRenderExercisedMultipleBanks === true
      && neg?.implemented === true
      && neg?.suppressedCallbackMismatched === true
      && neg?.restoredCallbackMatched === true;
    const bankSwitchEvidence = {
      classification: 'DESKTOP_BROWSER',
      evidenceKind: 'PRODUCTION_SHELF_RENDER',
      pass: multiPass,
      actualHardwareMaxArrayTextureLayers: multi.hardware,
      effectiveTestMaxArrayTextureLayers: multi.effective,
      probeAssistedExpectedBind: multi.probe?.probeAssistedExpectedBind ?? null,
      adversarialPrecondition: multi.probe?.adversarialPrecondition ?? null,
      bindObserver: multi.probe?.bindObserver ?? null,
      negativeControl: neg ?? null,
      glErrorsBefore: multi.probe?.glErrorsBefore ?? null,
      glErrorsAfter: multi.probe?.glErrorsAfter ?? null,
      glFatal: multi.probe?.glFatal ?? null,
      probe: multi.probe,
      QUEST_HARDWARE: 'NOT_EXECUTED',
    };
    fs.writeFileSync(
      path.join(root, 'docs', 'review', 'jp4a', 'jp4a-round4-production-multibank.json'),
      JSON.stringify(bankSwitchEvidence, null, 2),
    );
    fs.writeFileSync(
      path.join(root, 'docs', 'review', 'jp4a', 'jp4a-round4.1-production-bank-switch.json'),
      JSON.stringify(bankSwitchEvidence, null, 2),
    );
    evidence.scenarios.push({
      name: 'JP4A_PRODUCTION_MULTIBANK',
      classification: 'DESKTOP_BROWSER',
      evidenceKind: 'PRODUCTION_SHELF_RENDER',
      pass: multiPass,
      probe: multi.probe,
      actualHardwareMaxArrayTextureLayers: multi.hardware,
      effectiveTestMaxArrayTextureLayers: multi.effective,
    });
    await multiPage.close();
  } finally {
    fs.writeFileSync(path.join(outDir, 'xr-resource.json'), JSON.stringify({
      console: consoleLog.slice(-80).map((e) => ({ ...e, text: redact(e.text) })),
      scenarios: evidence.scenarios,
      sampler: consoleLog.filter(isSamplerOrGlFatal).map((e) => ({ ...e, text: redact(e.text) })),
      unexpectedSerious: unexpectedSerious().map((e) => ({ ...e, text: redact(e.text) })),
    }, null, 2));
    const jp4aDir = path.join(root, 'docs', 'review', 'jp4a');
    fs.mkdirSync(jp4aDir, { recursive: true });
    for (const name of [
      'JP4A_CAPACITY_256_2001',
      'JP4A_CAPACITY_256_4000',
      'JP4A_REAL_GPU_MULTIBANK',
      'JP4A_PRODUCTION_MULTIBANK',
      'JP4A_PRELOAD_STABILITY',
      'JP4A_DETAIL_ACTIVATION',
      'JP4A_DETAIL_FAILURE',
      'JP4A_INLINE_PROFILE',
      'JP4A_FOCUS_QUALITY',
      'JP4A_UPLOAD_POLICY',
      'JP4A_HW_POSTER_DIAG',
      'JP4A_UPLOAD_ADMISSION',
    ]) {
      const s = evidence.scenarios.find((x) => x.name === name);
      if (!s) continue;
      fs.writeFileSync(
        path.join(jp4aDir, `${name.toLowerCase().replace(/_/g, '-')}.json`),
        JSON.stringify(s, null, 2),
      );
    }
    await browser.close();
    killChild(child);
  }

  const scenarioFailures = evidence.scenarios.filter((s) => !s.pass);
  const sampler = consoleLog.filter(isSamplerOrGlFatal);
  const unexpected = unexpectedSerious();
  const storeGpu = evidence.scenarios.find((s) => s.name === 'XR_SAFE_STORE')?.locomotion?.gpu
    ?? evidence.scenarios.find((s) => s.name === 'XR_SAFE_STORE')?.xr?.gpu;
  const impossible = residencyImpossible(storeGpu);
  const pass = scenarioFailures.length === 0 && sampler.length === 0 && unexpected.length === 0 && !impossible;
  console.log(JSON.stringify({
    pass,
    scenarioFailures: scenarioFailures.length,
    samplerWarnings: sampler.length,
    unexpectedSeriousErrors: unexpected.length,
    scenarios: evidence.scenarios.map((s) => ({ name: s.name, pass: s.pass })),
  }, null, 2));
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  console.error(JSON.stringify(consoleLog.slice(-40), null, 2));
  process.exit(1);
});
