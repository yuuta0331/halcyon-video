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
  assert.equal(BB_CJK, 'BBCjk');
});

test('Latin-only canvas stack is unchanged', () => {
  assert.equal(canvasFontStack('HALCYON', 'BBMono'), 'BBMono');
  assert.equal(canvasFontStack('SEARCH> ALIEN', 'BBAnton'), 'BBAnton');
  assert.equal(canvasFontStack('', 'BBMono').includes(BB_CJK), false);
});

test('Japanese canvas stack appends BBCjk after the shipped Latin family', () => {
  const stack = canvasFontStack('七人の侍', 'BBMono');
  assert.equal(stack, `BBMono, ${BB_CJK}`);
  assert.ok(stack.startsWith('BBMono'));
  assert.ok(!stack.startsWith(BB_CJK));
});

test('mixed Latin/Japanese keeps the Latin family first', () => {
  const latin = 'BBMono';
  const stack = canvasFontStack('The 七人の侍', latin);
  assert.equal(stack, `${latin}, ${BB_CJK}`);
  assert.equal(stack.indexOf(latin), 0);
  assert.ok(stack.indexOf(latin) < stack.indexOf(BB_CJK));
});

test('CJK face is requested only when the string needs it', () => {
  assert.equal(containsCjk('READY.'), false);
  assert.equal(containsCjk('検索> エイリアン'), true);
  assert.equal(canvasFontStack('READY.', 'BBMono').includes(BB_CJK), false);
  assert.equal(canvasFontStack('検索> エイリアン', 'BBMono').endsWith(BB_CJK), true);
});

test('BBCjk is never the first family in a canvas stack', () => {
  for (const s of ['HALCYON', '七人の侍', 'The 七人の侍', '検索> ALIEN', '']) {
    const stack = canvasFontStack(s, 'BBMono');
    assert.equal(stack.startsWith(BB_CJK), false, s);
  }
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

test('English compareText preserves pre-PR localeCompare semantics', () => {
  const pairs: Array<[string, string]> = [
    ['Movie 2', 'Movie 10'],
    ['2 Fast 2 Furious', '10 Things I Hate About You'],
    ['cafe', 'café'],
    ['Alpha', 'beta'],
    ['zebra', 'Alpha'],
  ];
  for (const [a, b] of pairs) {
    assert.equal(compareText(a, b, 'en'), a.localeCompare(b), `${a} vs ${b}`);
  }
});

test('English numeric titles do not pick up Collator numeric sorting', () => {
  // Pre-PR localeCompare is lexicographic: "Movie 10" files before "Movie 2"
  // because '1' < '2'. Intl.Collator({ numeric: true }) reverses that.
  assert.equal(compareText('Movie 10', 'Movie 2', 'en'), 'Movie 10'.localeCompare('Movie 2'));
  assert.ok(compareText('Movie 10', 'Movie 2', 'en') < 0);
  const numeric = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  assert.notEqual(
    Math.sign(compareText('Movie 2', 'Movie 10', 'en')) || 1,
    Math.sign(numeric.compare('Movie 2', 'Movie 10')) || 1,
  );
});

test('Japanese ordering still uses the ja collator', () => {
  const ja = new Intl.Collator('ja');
  assert.equal(compareText('エイリアン', 'マトリックス', 'ja'), ja.compare('エイリアン', 'マトリックス'));
  assert.ok(compareText('あ', 'い', 'ja') < 0);
  assert.equal(compareText('The 七人の侍', 'The 七人の侍', 'ja'), 0);
});

test('English collation still alphabetizes mixed-case Latin', () => {
  const titles = ['zebra', 'Alpha', 'beta'];
  titles.sort((a, b) => compareText(a, b, 'en'));
  assert.deepEqual(titles, ['Alpha', 'beta', 'zebra']);
});
