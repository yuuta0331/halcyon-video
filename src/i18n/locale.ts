// Locale persistence. Split from index.ts so text.ts can read the active
// locale without a cycle (index re-exports text helpers).

import { isLocale, type Locale } from './types.ts';

export type { Locale };

export const LOCALE_KEY = 'bb_locale';

let current: Locale | null = null;

function readStored(): Locale | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LOCALE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Active locale. Defaults to English when nothing has been chosen. */
export function getLocale(): Locale {
  if (current) return current;
  current = readStored() ?? 'en';
  return current;
}

/** In-memory locale only. Persistence belongs to the settings registry. */
export function activateLocale(locale: Locale): void {
  current = locale;
}

/** Persist and activate a locale. Callers that paint chrome should reload. */
export function setLocale(locale: Locale): void {
  activateLocale(locale);
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    /* private mode */
  }
}

/** Test hook: drop the memo so the next getLocale() re-reads storage. */
export function resetLocaleCache(): void {
  current = null;
}

/**
 * Best-effort browser language. Not consulted at boot — applying it would
 * change the English default for anyone whose OS/browser is Japanese.
 */
export function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const langs = navigator.languages?.length
    ? navigator.languages
    : (navigator.language ? [navigator.language] : []);
  for (const lang of langs) {
    if (String(lang).toLowerCase().startsWith('ja')) return 'ja';
  }
  return 'en';
}
