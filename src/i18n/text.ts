// Pure CJK / mixed-script text helpers for canvas painters and catalog order.
// No DOM, no FontFace, no Three.js — unit-tested under node --test.
//
// Canvas painters that need the bundled Japanese face should:
//   1. name BB_CJK via canvasFontStack() (never a host family)
//   2. call ensureCjkFont() from ./cjk-font so the face is actually loaded
// Latin display faces (Anton, Archivo Black, …) stay first in the stack.
// BBCjk is appended only when the string contains CJK.

import { getLocale } from './locale.ts';
import type { Locale } from './types.ts';

/** Bundled Japanese-capable family. Registered at runtime by ./cjk-font. */
export const BB_CJK = 'BBCjk';

const CJK_RE = /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9d]/;

export function containsCjk(text: string): boolean {
  return CJK_RE.test(text);
}

/**
 * Canvas `ctx.font` family list. Latin faces the store actually ships stay
 * FIRST so mixed strings keep their retro metrics; BBCjk is appended only
 * when the string contains CJK, so Japanese glyphs do not fall back to a
 * host face. Latin-only strings are unchanged (no BBCjk in the stack).
 *
 *   canvasFontStack('HALCYON', BB_MONO)     → 'BBMono'
 *   canvasFontStack('七人の侍', BB_MONO)     → 'BBMono, BBCjk'
 *   canvasFontStack('The 七人の侍', BB_MONO) → 'BBMono, BBCjk'
 */
export function canvasFontStack(text: string, latinFamily: string): string {
  return containsCjk(text) ? `${latinFamily}, ${BB_CJK}` : latinFamily;
}

let jaCollator: Intl.Collator | null = null;

/**
 * User-visible string order.
 *   en — the pre-i18n `String.localeCompare()` semantics (no numeric collation,
 *        no sensitivity override). English shelf order must not drift.
 *   ja — `Intl.Collator('ja')`.
 */
export function compareText(a: string, b: string, locale: Locale = getLocale()): number {
  if (locale === 'ja') {
    jaCollator ??= new Intl.Collator('ja');
    return jaCollator.compare(a, b);
  }
  return a.localeCompare(b);
}

// Kinsoku-ish: don't start a line with these, don't end a line with these.
const NO_LINE_START = /[、。，．,.!?）)\]］\}｝」』】〉》〟ゝゞーァィゥェォッャュョぁぃぅぇぉっゃゅょ]/;
const NO_LINE_END = /[（(\[［\{｛「『【〈《]/;

function canBreakAfter(chars: string[], i: number): boolean {
  const cur = chars[i];
  const next = chars[i + 1];
  if (next === undefined) return true;
  if (NO_LINE_START.test(next)) return false;
  if (NO_LINE_END.test(cur)) return false;
  if (cur === ' ') return true;
  if (containsCjk(cur) || containsCjk(next)) return true;
  return false;
}

/**
 * Width-aware wrap. Latin keeps greedy word wrap; CJK may break between
 * characters, with a small kinsoku rule so punctuation does not start a line.
 * `measure` is injected so tests can run without Canvas.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  if (!containsCjk(text)) return wrapLatin(text, maxWidth, measure);

  const chars = Array.from(text.trim());
  if (chars.length === 0) return [];

  const lines: string[] = [];
  let line = '';
  let breakAt = -1;

  const flush = (nextLine: string) => {
    const trimmed = line.trimEnd();
    if (trimmed) lines.push(trimmed);
    line = nextLine;
    breakAt = -1;
  };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const candidate = line + ch;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      if (canBreakAfter(chars, i)) breakAt = Array.from(line).length;
      continue;
    }
    if (!line) {
      lines.push(ch);
      continue;
    }
    const parts = Array.from(line);
    if (breakAt > 0 && breakAt < parts.length) {
      lines.push(parts.slice(0, breakAt).join('').trimEnd());
      line = parts.slice(breakAt).join('').trimStart() + ch;
      breakAt = canBreakAfter(Array.from(line), Array.from(line).length - 1)
        ? Array.from(line).length
        : -1;
    } else {
      flush(ch === ' ' ? '' : ch);
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

function wrapLatin(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (measure(test) <= maxWidth) cur = test;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Ellipsize to `maxWidth` using code points, not UTF-16 units. */
export function truncateText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  ellipsis = '…',
): string {
  if (measure(text) <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 1 && measure(chars.join('') + ellipsis) > maxWidth) {
    chars.pop();
  }
  return chars.length ? chars.join('') + ellipsis : ellipsis;
}

/** Historical English CRT column count. Latin lines still clip here. */
export const CRT_COLUMNS = 40;

/**
 * One CRT body line.
 *   Latin-only — the pre-i18n 40-column contract: code-point slice, no ellipsis.
 *   CJK / mixed — measured pixel width via truncateText (ellipsis, code points).
 * `measure` must use the same font stack the painter will fill with.
 */
export function fitCrtLine(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  columns = CRT_COLUMNS,
): string {
  if (!containsCjk(text)) return Array.from(text).slice(0, columns).join('');
  return truncateText(text, maxWidth, measure);
}

/**
 * Search-terminal / label display: Latin titles stay uppercased the way the
 * CRT already painted them. CJK titles are left intact — pixel fitting is
 * `fitCrtLine`'s job, not a character budget.
 */
export function displayTitle(title: string, maxChars = 30): string {
  if (containsCjk(title)) return title;
  return Array.from(title.toUpperCase()).slice(0, maxChars).join('');
}
