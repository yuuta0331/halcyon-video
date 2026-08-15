// Locale ids and the message catalog shape. Kept Tiny and importable from
// pure tests: no DOM, no Three.js, no Brand Pack.

export const LOCALES = ['en', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'ja';
}
