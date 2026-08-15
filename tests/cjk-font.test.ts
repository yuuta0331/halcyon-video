import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { BB_CJK } from '../src/i18n/text.ts';

const FONT = 'src/assets/noto-sans-jp-regular.woff2';
const LICENSE = 'src/assets/licenses/NotoSansJP-OFL.txt';
const PROVENANCE = 'src/assets/licenses/NotoSansJP-PROVENANCE.txt';

test('bundled Japanese font file and OFL license are present', () => {
  assert.ok(existsSync(FONT), FONT);
  assert.ok(existsSync(LICENSE), LICENSE);
  assert.ok(existsSync(PROVENANCE), PROVENANCE);
  const buf = readFileSync(FONT);
  assert.ok(buf.length > 100_000, 'subset should be a real font, not a stub');
  assert.equal(buf.subarray(0, 4).toString('ascii'), 'wOF2');
  const license = readFileSync(LICENSE, 'utf8');
  assert.match(license, /^Copyright 2014-2021 Adobe/);
  assert.match(license, /Reserved Font Name 'Source'/);
  assert.match(license, /SIL Open Font License/);
  assert.equal(/Copyright Google Inc/.test(license), false);
  assert.equal(/fontsource/.test(license), false);
  assert.equal(/TSUTAYA|GEO|ツタヤ|ゲオ/.test(license), false);
  const provenance = readFileSync(PROVENANCE, 'utf8');
  assert.match(provenance, /@fontsource\/noto-sans-jp 5\.2\.5/);
  assert.match(provenance, /NOT part of the SIL OFL notice/);
});

test('canvas painters can name the bundled Japanese family', () => {
  assert.equal(BB_CJK, 'BBCjk');
});

test('desk CRT painter uses the JP-1B canvas-font seam, not host Courier New', () => {
  const seam = readFileSync('src/i18n/canvas-font.ts', 'utf8');
  assert.match(seam, /export function crtPaintFont/);
  assert.match(seam, /export function paintFont/);
  assert.match(seam, /export function ensureCjkForTexts/);
  assert.match(seam, /BB_MONO/);
  assert.match(seam, /canvasFontStack\(text, latinFamily\)/);
  assert.match(seam, /if \(containsCjk\(text\)\) ensureCjkFont\(\)/);

  const src = readFileSync('src/entrance/index.ts', 'utf8');
  const start = src.indexOf('private drawTerminal()');
  const end = src.indexOf('setTerminalText(', start);
  assert.ok(start >= 0 && end > start, 'drawTerminal body');
  const body = src.slice(start, end);
  assert.match(body, /crtPaintFont/);
  assert.match(body, /fitCrtLine/);
  assert.equal(/slice\(0,\s*40\)/.test(body), false);
  assert.equal(/Courier New/.test(body), false);
  assert.equal(/monospace/.test(body), false);
});
