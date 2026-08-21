// Application localization. English is the default and the fallback.
//
// This is NOT a Brand Pack. brandString() still owns store identity (the
// wordmark, wrap address, clerk greeting, receipt lines). i18n owns chrome:
// HUD, help, settings labels, search prompts, walk-mode copy.
//
// Locale resolution is deterministic:
//   1. persisted bb_locale, if it is 'en' or 'ja'
//   2. otherwise 'en'
// Browser language is NEVER applied automatically — existing users keep the
// English experience. detectBrowserLocale() is available for a future
// "your browser is Japanese" hint, not for boot.

import { en, type MessageKey } from './en.ts';
import { ja } from './ja.ts';
import { getLocale, type Locale } from './locale.ts';

export type { Locale, MessageKey };
export { LOCALES, isLocale } from './types.ts';
export { en } from './en.ts';
export { ja } from './ja.ts';
export {
  activateLocale,
  detectBrowserLocale,
  getLocale,
  LOCALE_KEY,
  resetLocaleCache,
  setLocale,
} from './locale.ts';
export {
  BB_CJK,
  canvasFontStack,
  compareText,
  containsCjk,
  CRT_COLUMNS,
  displayTitle,
  fitCrtLine,
  truncateText,
  wrapText,
} from './text.ts';

const tables: Record<Locale, Partial<Record<MessageKey, string>>> = { en, ja };

/**
 * Look up `key` in `locale`, then English. Missing English (should not happen
 * for MessageKey) returns the key itself so a typo is visible, not blank.
 */
export function lookupMessage(
  key: string,
  locale: Locale,
  dicts: Record<Locale, Record<string, string | undefined>> = tables,
): string {
  if (locale === 'ja') {
    const jaVal = dicts.ja[key];
    if (typeof jaVal === 'string' && jaVal.length > 0) return jaVal;
  }
  const enVal = dicts.en[key];
  if (typeof enVal === 'string' && enVal.length > 0) return enVal;
  return key;
}

export function t(key: MessageKey, locale: Locale = getLocale()): string {
  return lookupMessage(key, locale, tables);
}

/** `t()` with `{name}` placeholders. Unknown names are left as `{name}`. */
export function tfill(
  key: MessageKey,
  vars: Record<string, string | number>,
  locale: Locale = getLocale(),
): string {
  return t(key, locale).replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] === undefined ? `{${name}}` : String(vars[name]));
}
