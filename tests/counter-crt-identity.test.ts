import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CONSUMER = 'src/entrance/index.ts';
const MANIFEST = 'public/brand-packs/halcyon-jp/brand.json';

function drawTerminalBody(): string {
  const src = readFileSync(CONSUMER, 'utf8');
  const start = src.indexOf('private drawTerminal()');
  const end = src.indexOf('setTerminalText(', start);
  assert.ok(start >= 0 && end > start, 'drawTerminal body');
  return src.slice(start, end);
}

test('idle CRT store line fallback stays the Green Bay Halcyon identity', () => {
  const body = drawTerminalBody();
  assert.match(body, /brandString\(\s*'pos-store-line',\s*'STORE #55746   GREEN BAY, WI'\s*\)/);
  assert.equal(/terminalLines \?\? \[[^\]]*GREEN BAY/.test(body), false);
});

test('idle CRT footer fallbacks stay REMEMBER TO REWIND / PLEASE REWIND', () => {
  const body = drawTerminalBody();
  assert.match(body, /brandString\(\s*'pos-footer-left',\s*'REMEMBER TO REWIND'\s*\)/);
  assert.match(body, /brandString\(\s*'pos-footer-right',\s*'PLEASE REWIND'\s*\)/);
});

test('desk CRT resolves title, store line, and footer through brandString', () => {
  const body = drawTerminalBody();
  assert.match(body, /brandString\(\s*'pos-system-title',\s*'HALCYON RENTAL SYSTEM'\s*\)/);
  assert.match(body, /const storeLine = brandString\('pos-store-line'/);
  assert.match(body, /const footLeft = brandString\('pos-footer-left'/);
  assert.match(body, /const footRight = brandString\('pos-footer-right'/);
  assert.match(body, /terminalLines \?\? \[\s*storeLine/);
});

test('desk CRT CJK path includes the resolved store and footer strings', () => {
  const body = drawTerminalBody();
  assert.match(body, /const cjkTexts = \[title, storeLine, \.\.\.lines, footLeft, footRight\]/);
  assert.match(body, /ensureCjkForTexts\(cjkTexts/);
  assert.match(body, /crtPaintFont/);
  assert.match(body, /fitCrtLine\(line, SAFE_W/);
  assert.match(body, /fitCrtLine\(footLeft, footBudget/);
  assert.match(body, /fitCrtLine\(footRight, footBudget/);
  assert.equal(/bb_locale/.test(body), false);
});

test('halcyon-jp overrides CRT identity and drops Green Bay', () => {
  const raw = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const strings = raw.strings as Record<string, string>;
  assert.equal(typeof strings['pos-system-title'], 'string');
  assert.equal(typeof strings['pos-store-line'], 'string');
  assert.equal(typeof strings['pos-footer-left'], 'string');
  assert.equal(typeof strings['pos-footer-right'], 'string');
  const store = strings['pos-store-line'];
  assert.ok(store.trim().length > 0);
  assert.equal(/GREEN BAY|\bWI\b|\bUSA\b/i.test(store), false);
  assert.match(store, /ハルシオン/);
  assert.match(strings['pos-footer-left'], /巻/);
  assert.match(strings['pos-footer-right'], /返却/);
});
