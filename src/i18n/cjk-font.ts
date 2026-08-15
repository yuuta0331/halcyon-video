// Lazy registration of the bundled Japanese-capable face.
//
// The WOFF2 is a separate Vite asset (~1.1MB Japanese subset). It is NOT in
// bundled-fonts' default FACES list, so an English boot does not decode it.
// Call ensureCjkFont() when:
//   • the active locale is 'ja' (boot funnel, before the store bakes canvases)
//   • a painter is about to measure a string that containsCjk()
//
// Family name is BBCjk — same BB-prefix rule as Anton / Archivo Black, so a
// host "Noto Sans JP" can never win the measurement.

import { registerRuntimeFace, ensureBundledFont, bundledFontReady } from '../bundled-fonts';
import { BB_CJK } from './text';
import notoSansJpUrl from '../assets/noto-sans-jp-regular.woff2';

export { BB_CJK };

/** The Vite-resolved URL of the bundled Japanese face. */
export function bundledCjkFontUrl(): string {
  return notoSansJpUrl;
}

export function ensureCjkFont(onReady?: () => void): void {
  registerRuntimeFace(BB_CJK, notoSansJpUrl, { weight: '400' });
  ensureBundledFont(BB_CJK, onReady);
}

export function cjkFontReady(): boolean {
  return bundledFontReady(BB_CJK);
}

/** Resolves once the Japanese face has settled (or immediately in node). */
export function cjkFontsReady(): Promise<void> {
  return new Promise((resolve) => ensureCjkFont(resolve));
}
