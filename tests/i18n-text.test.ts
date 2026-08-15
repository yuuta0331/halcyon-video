import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BB_CJK,
  canvasFontStack,
  compareText,
  containsCjk,
  displayTitle,
  truncateText,
  wrapText,
} from '../src/i18n/text.ts';

const byChars = (s: string) => Array.from(s).length;

test('CJK detection and canvas family selection', () => {
  assert.equal(containsCjk('Back to the Future'), false);
  assert.equal(containsCjk('バック・トゥ・ザ・フューチャー'), true);
  assert.equal(containsCjk('The 七人の侍'), true);
  assert.equal(canvasFontStack('HALCYON', 'BBAnton'), 'BBAnton');
  assert.equal(canvasFontStack('七人の侍', 'BBAnton'), `${BB_CJK}, BBAnton`);
  assert.equal(BB_CJK, 'BBCjk');
});

test('English wrap stays greedy word wrap', () => {
  assert.deepEqual(wrapText('hello world foo', 8, (s) => s.length), ['hello', 'world', 'foo']);
  assert.deepEqual(wrapText('supercalifragilistic', 5, (s) => s.length), ['supercalifragilistic']);
});

test('Japanese titles wrap on characters with kinsoku', () => {
  const lines = wrapText('日本語の長い映画のタイトルです', 4, byChars);
  assert.ok(lines.length >= 2);
  assert.ok(lines.every((line) => byChars(line) <= 4));
  assert.equal(lines.join(''), '日本語の長い映画のタイトルです');
});

test('mixed Latin/Japanese strings wrap without dropping glyphs', () => {
  const src = 'The 進撃の巨人 movie';
  const lines = wrapText(src, 6, byChars);
  assert.equal(lines.join('').replace(/\s+/g, ''), src.replace(/\s+/g, ''));
  assert.ok(lines.some((line) => containsCjk(line)));
});

test('long Japanese titles truncate on code points', () => {
  const title = '非常に長い日本語の映画タイトルでellipsisが必要です';
  const out = truncateText(title, 8, byChars);
  assert.ok(out.endsWith('…'));
  assert.ok(byChars(out) <= 9);
  assert.equal(truncateText('短い', 20, byChars), '短い');
});

test('displayTitle uppercases Latin and preserves Japanese', () => {
  assert.equal(displayTitle('back to the future', 20), 'BACK TO THE FUTURE');
  assert.equal(displayTitle('もののけ姫', 20), 'もののけ姫');
  assert.equal(Array.from(displayTitle('あいうえおかきくけこさしすせそ', 5)).length, 5);
});

test('locale-aware ordering for Japanese titles', () => {
  assert.ok(compareText('エイリアン', 'マトリックス', 'ja') < 0);
  assert.ok(compareText('あ', 'い', 'ja') < 0);
  assert.ok(compareText('Alpha', 'beta', 'en') < 0);
  // Mixed strings must not throw and must be deterministic.
  assert.equal(
    compareText('The 七人の侍', 'The 七人の侍', 'ja'),
    0,
  );
});

test('English collation still alphabetizes mixed-case Latin', () => {
  const titles = ['zebra', 'Alpha', 'beta'];
  titles.sort((a, b) => compareText(a, b, 'en'));
  assert.deepEqual(titles, ['Alpha', 'beta', 'zebra']);
});
