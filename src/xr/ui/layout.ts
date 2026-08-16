// Width-aware XR panel text. Reuses i18n wrap/truncate; no second font stack.

import { canvasFontStack, containsCjk, truncateText, wrapText } from '../../i18n/text.ts';

export const XR_UI_LATIN = 'BBMono';

export function xrUiFontStack(text: string): string {
  return canvasFontStack(text, XR_UI_LATIN);
}

export function xrUiNeedsCjk(lines: readonly string[]): boolean {
  return lines.some(containsCjk);
}

export function layoutXrLines(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  maxLines: number,
): string[] {
  const wrapped = wrapText(text, maxWidth, measure);
  if (wrapped.length <= maxLines) return wrapped;
  const kept = wrapped.slice(0, maxLines);
  const last = kept[maxLines - 1] ?? '';
  kept[maxLines - 1] = truncateText(last, maxWidth, measure);
  return kept;
}

export function clipXrLabel(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string {
  return truncateText(text, maxWidth, measure);
}
