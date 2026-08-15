import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { BB_CJK } from '../src/i18n/text.ts';

const FONT = 'src/assets/noto-sans-jp-regular.woff2';
const LICENSE = 'src/assets/licenses/NotoSansJP-OFL.txt';

test('bundled Japanese font file and OFL license are present', () => {
  assert.ok(existsSync(FONT), FONT);
  assert.ok(existsSync(LICENSE), LICENSE);
  const buf = readFileSync(FONT);
  assert.ok(buf.length > 100_000, 'subset should be a real font, not a stub');
  assert.equal(buf.subarray(0, 4).toString('ascii'), 'wOF2');
  const license = readFileSync(LICENSE, 'utf8');
  assert.match(license, /SIL Open Font License/);
  assert.match(license, /Noto Sans JP/);
  assert.equal(/TSUTAYA|GEO|ツタヤ|ゲオ/.test(license), false);
});

test('canvas painters can name the bundled Japanese family', () => {
  assert.equal(BB_CJK, 'BBCjk');
});
