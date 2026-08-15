import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BB_CJK,
  canvasFontStack,
  compareText,
  containsCjk,
  CRT_COLUMNS,
  displayTitle,
  fitCrtLine,
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
  assert.ok(byChars(out) <= 8);
  assert.equal(truncateText('短い', 20, byChars), '短い');
});

test('truncateText never exceeds maxWidth on the measured path', () => {
  const wide = (s: string) => Array.from(s).length * 2;
  const ja = '非常に長い日本語の映画タイトル';
  const mixed = 'The 七人の侍 and then a very long continuation';

  const normal = truncateText(ja, 10, wide);
  assert.ok(normal.endsWith('…'));
  assert.ok(wide(normal) <= 10);

  const mixedOut = truncateText(mixed, 12, wide);
  assert.ok(mixedOut.endsWith('…'));
  assert.ok(wide(mixedOut) <= 12);

  assert.equal(truncateText('短い', 20, wide), '短い');
  assert.ok(wide(truncateText('短い', 20, wide)) <= 20);

  const onePlusEllipsis = truncateText(ja, 4, wide);
  assert.equal(wide(onePlusEllipsis), 4);
  assert.ok(Array.from(onePlusEllipsis).length === 2);
  assert.ok(onePlusEllipsis.endsWith('…'));

  assert.equal(truncateText(ja, 2, wide), '…');
  assert.ok(wide(truncateText(ja, 2, wide)) <= 2);

  assert.equal(truncateText(ja, 1, wide), '');
  assert.ok(wide('') <= 1);

  const pair = '𩸽あいうえおかきくけこ';
  const clipped = truncateText(pair, 6, wide);
  assert.ok(wide(clipped) <= 6);
  const points = Array.from(clipped);
  assert.ok(points.every((p) => {
    const c = p.codePointAt(0)!;
    return p.length === 2 || c < 0xD800 || c > 0xDFFF;
  }), 'must not emit a lone UTF-16 surrogate');

  for (const sample of [ja, mixed, pair, 'あ', 'The 侍', '']) {
    for (const max of [0, 1, 2, 3, 4, 8, 12, 100]) {
      const result = truncateText(sample, max, wide);
      assert.ok(wide(result) <= max, `"${sample}" @ ${max} → "${result}"`);
    }
  }
});

test('displayTitle uppercases Latin and leaves Japanese for width-fitting', () => {
  assert.equal(displayTitle('back to the future', 20), 'BACK TO THE FUTURE');
  assert.equal(displayTitle('もののけ姫', 20), 'もののけ姫');
  assert.equal(displayTitle('あいうえおかきくけこさしすせそ', 5), 'あいうえおかきくけこさしすせそ');
});

test('Latin CRT lines keep the 40-column contract without ellipsis', () => {
  const measure = (s: string) => s.length * 10;
  assert.equal(fitCrtLine('PRESS / TO SEARCH CATALOG', 400, measure), 'PRESS / TO SEARCH CATALOG');
  assert.equal(fitCrtLine('A'.repeat(50), 400, measure), 'A'.repeat(CRT_COLUMNS));
  assert.equal(fitCrtLine('A'.repeat(50), 400, measure).includes('…'), false);
});

test('Japanese CRT lines fit measured width and do not split surrogates', () => {
  const wide = (s: string) => Array.from(s).length * 2;
  const long = '非常に長い日本語の映画タイトルで画面からはみ出してはいけない';
  const out = fitCrtLine(long, 10, wide);
  assert.ok(wide(out) <= 10);
  assert.ok(out.endsWith('…'));
  const mixed = fitCrtLine('The 七人の侍 and then a very long continuation', 12, wide);
  assert.ok(wide(mixed) <= 12);
  const pair = '𩸽あいうえおかきくけこ';
  const clipped = fitCrtLine(pair, 8, wide);
  const points = Array.from(clipped);
  assert.ok(points.every((p) => {
    const c = p.codePointAt(0)!;
    return p.length === 2 || c < 0xD800 || c > 0xDFFF;
  }), 'must not emit a lone UTF-16 surrogate');
  assert.ok(wide(clipped) <= 8);
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
