// JP-1B seam for canvas painters that show localized chrome or catalog CJK.
//
// Painters should call crtPaintFont() / paintFont() instead of naming a host
// family like "Courier New". Latin bundled faces stay first; BBCjk is
// appended only when the string contains CJK, and ensureCjkFont() is kicked
// even when the UI locale is still English (search results can be Japanese).
//
// Do not import this from node --test: it pulls FontFace asset URLs.
import { BB_MONO } from '../bundled-fonts';
import { canvasFontStack, containsCjk } from './text';
import { ensureCjkFont } from './cjk-font';

export { BB_CJK, canvasFontStack, containsCjk } from './text';
export { BB_MONO };

/**
 * Canvas font string: shipped Latin family first, BBCjk after it when needed.
 * Requests the bundled CJK face before the caller measures.
 */
export function paintFont(
  px: number,
  text: string,
  latinFamily: string,
  style: 'bold' | '' = '',
): string {
  if (containsCjk(text)) ensureCjkFont();
  const prefix = style ? `${style} ` : '';
  return `${prefix}${Math.round(px)}px ${canvasFontStack(text, latinFamily)}`;
}

/** Desk CRT / search terminal: bundled mono, then BBCjk for Japanese glyphs. */
export function crtPaintFont(px: number, text: string, style: 'bold' | '' = ''): string {
  return paintFont(px, text, BB_MONO, style);
}

/**
 * If any string needs CJK, start loading BBCjk and optionally repaint once
 * it settles. Returns true when a load was requested. Callers must arm the
 * onReady callback at most once (see EntranceCheckout.terminalCjkRepaintArmed).
 */
export function ensureCjkForTexts(texts: readonly string[], onReady?: () => void): boolean {
  if (!texts.some(containsCjk)) return false;
  ensureCjkFont(onReady);
  return true;
}
