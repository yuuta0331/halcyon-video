#!/usr/bin/env node
// Measure cold/warm TTI for Vite dev vs production preview on the same machine.
// Dedicated ports so this never attaches to an already-running :1420 instance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'review', 'jp3');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halcyon-boot-measure-'));
const DEV_PORT = Number(process.env.HALCYON_BOOT_DEV_PORT || 1426);
const PROD_PORT = Number(process.env.HALCYON_BOOT_PROD_PORT || 1427);

fs.mkdirSync(outDir, { recursive: true });

async function waitFor(url, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timeout waiting for ${url}`);
}

function start(cmd, args) {
  return spawn(cmd, args, {
    cwd: root,
    stdio: 'pipe',
    shell: process.platform === 'win32',
    env: { ...process.env, BROWSER: 'none' },
  });
}

function killChild(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function npx() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

async function measure(page, url) {
  const tNav = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const t0 = Date.now();
  let tti = null;
  while (Date.now() - t0 < 180_000) {
    const diag = await page.evaluate(() => window.__bootDiagnostics?.() ?? null);
    if (diag?.timeToInteractive != null) {
      tti = { wallMs: Date.now() - tNav, diag };
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!tti) throw new Error(`TTI timeout at ${url}`);
  const tFull = Date.now();
  while (Date.now() - tFull < 240_000) {
    const diag = await page.evaluate(() => window.__bootDiagnostics?.() ?? null);
    if (diag?.timeToFullTextures != null) {
      return { wallMs: Date.now() - tNav, diag, waitedForFullTextures: true };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const diag = await page.evaluate(() => window.__bootDiagnostics?.() ?? null);
  return { wallMs: Date.now() - tNav, diag, waitedForFullTextures: false };
}

async function runMode(label, url) {
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: path.join(profileDir, label),
    args: ['--no-first-run', '--mute-audio'],
  });
  const page = await browser.newPage();
  const cold = await measure(page, url);
  const warm = await measure(page, url);
  await browser.close();
  return { label, url, cold, warm };
}

async function main() {
  const results = { measuredAt: new Date().toISOString() };
  const npxBin = npx();

  let child = start(npxBin, ['vite', '--port', String(DEV_PORT), '--strictPort', '--host', '127.0.0.1']);
  try {
    await waitFor(`http://127.0.0.1:${DEV_PORT}/`);
    results.dev = await runMode('dev', `http://127.0.0.1:${DEV_PORT}/?demo=1&nogate=1`);
  } finally {
    killChild(child);
    await new Promise((r) => setTimeout(r, 1500));
  }

  child = start(npxBin, ['vite', 'preview', '--port', String(PROD_PORT), '--strictPort', '--host', '127.0.0.1']);
  try {
    await waitFor(`http://127.0.0.1:${PROD_PORT}/`);
    results.production = await runMode('production', `http://127.0.0.1:${PROD_PORT}/?demo=1&nogate=1`);
  } finally {
    killChild(child);
    await new Promise((r) => setTimeout(r, 1500));
  }

  const file = path.join(outDir, 'boot-performance.json');
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...prev, ...results }, null, 2));
  console.log(JSON.stringify({
    measuredAt: results.measuredAt,
    dev: summarize(results.dev),
    production: summarize(results.production),
  }, null, 2));
}

function summarize(mode) {
  if (!mode) return null;
  const pick = (run) => ({
    wallMs: run.wallMs,
    timeToInteractive: run.diag?.timeToInteractive,
    timeToFullTextures: run.diag?.timeToFullTextures,
    criticalReadyBeforeAllTextures: run.diag?.criticalReadyBeforeAllTextures,
    qualityCalibrationMs: run.diag?.qualityCalibrationMs,
    storeSceneConstructMs: run.diag?.storeSceneConstructMs,
    constructTop3: run.diag?.construct?.top3 ?? [],
    waitedForFullTextures: run.waitedForFullTextures,
  });
  return { url: mode.url, cold: pick(mode.cold), warm: pick(mode.warm) };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
