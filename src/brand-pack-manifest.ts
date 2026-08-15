// brand.json schema + structural validation. Kept free of fonts, fetch, and
// DOM so node tests and tools/list-slots.mjs share one implementation.

import type { LogoSpec } from './logo-spec';
import type { StoreTheme } from './themes';

/** One face the pack ships, registered under a collision-proof runtime family. */
export interface BrandPackFontSpec {
  /** The name the pack's own logo spec / strings refer to, e.g. 'Halcyon Display'. */
  family: string;
  /** Pack-relative file, e.g. 'fonts/display.ttf'. */
  file: string;
  descriptors?: FontFaceDescriptors;
}

/**
 * brand.json. Only `version` and `id` are required — every other field is an
 * override, and absence means "keep today's value". A pack that declares
 * nothing but those two is legal and changes nothing.
 */
export interface BrandPackManifest {
  version: number;
  id: string;
  /** Brand name for rendered prose (brandString's 'brand-name' default). */
  name?: string;
  /** Longer display name for UI chrome; falls back to `name`. */
  displayName?: string;
  /** Theme ids this identity is for. Absent/empty = every theme. */
  appliesTo?: string[];
  fonts?: BrandPackFontSpec[];
  /** LogoSpec partial, merged UNDER the user's own bb_logo edits. */
  logo?: Partial<LogoSpec>;
  palette?: Partial<StoreTheme['palette']>;
  /**
   * PER-ERA deviations from `palette`, keyed by theme id. A real chain that
   * spans decades is not one palette: it repaints. Without this a pack's single
   * palette flattens every era onto the one the pack was authored in — the
   * era's own wall colour, its own livery blue, gone. Merged AFTER `palette`,
   * so a theme lists only what it does differently.
   */
  themes?: Record<string, { palette?: Partial<StoreTheme['palette']> }>;
  /** Rendered-string overrides, keyed by the ids brandString() names. */
  strings?: Record<string, string>;
  /**
   * Flat wrap prints per medium, pack-relative (USER_WRAP_SPECS geometry).
   * A bare string is the one-print shorthand; a LIST is how a pack ships the
   * several prints a real chain used, each choosable in the settings drawer.
   */
  wraps?: { vhs?: string | BrandPackWrapSpec[]; dvd?: string | BrandPackWrapSpec[] };
  signageSet?: string;
}

/**
 * One selectable wrap print a pack ships. `layout` names which of the app's
 * print geometries the scan follows — the difference between "metadata is
 * TYPED INTO this print's blank form fields" and "this print is final art":
 *   base   — the medium's own scan geometry + its typed-metadata pass
 *   plain  — the medium's crops, nothing typed over the art (default)
 *   ticket — the all-emblem VHS crops (fold lines at the spine band's edges)
 */
export interface BrandPackWrapSpec {
  /** Persisted `bb_cover_<medium>` value, e.g. 'standard'. */
  id: string;
  /** Settings-drawer label; defaults to the id. */
  label?: string;
  /** Pack-relative image, e.g. 'wraps/vhs-standard.jpg'. */
  file: string;
  layout?: 'base' | 'plain' | 'ticket';
}

/**
 * Structural problems with a parsed brand.json, as human-readable lines (empty
 * = valid). Shared with `node tools/list-slots.mjs --check`, which validates an
 * installed manifest at build time — same rule set, one implementation.
 */
export function validateBrandManifest(raw: unknown): string[] {
  const problems: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['manifest is not a JSON object'];
  const m = raw as Record<string, unknown>;
  if (typeof m.version !== 'number') problems.push('version: required, must be a number');
  if (typeof m.id !== 'string' || !m.id.trim()) problems.push('id: required, must be a non-empty string');
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(m.id)) problems.push(`id: "${m.id}" must be kebab-case (a-z, 0-9, -)`);
  const str = (k: string) => {
    if (m[k] !== undefined && typeof m[k] !== 'string') problems.push(`${k}: must be a string`);
  };
  str('name'); str('displayName'); str('signageSet');
  if (m.appliesTo !== undefined && (!Array.isArray(m.appliesTo) || m.appliesTo.some((t) => typeof t !== 'string'))) {
    problems.push('appliesTo: must be an array of theme ids');
  }
  if (m.fonts !== undefined) {
    if (!Array.isArray(m.fonts)) problems.push('fonts: must be an array');
    else m.fonts.forEach((f, i) => {
      const face = f as Record<string, unknown> | null;
      if (!face || typeof face !== 'object') problems.push(`fonts[${i}]: must be an object`);
      else {
        if (typeof face.family !== 'string' || !face.family.trim()) problems.push(`fonts[${i}].family: required string`);
        if (typeof face.file !== 'string' || !face.file.trim()) problems.push(`fonts[${i}].file: required string`);
      }
    });
  }
  for (const k of ['logo', 'palette', 'strings', 'wraps', 'themes'] as const) {
    if (m[k] !== undefined && (typeof m[k] !== 'object' || m[k] === null || Array.isArray(m[k]))) {
      problems.push(`${k}: must be an object`);
    }
  }
  const themes = m.themes as Record<string, unknown> | undefined;
  if (themes && typeof themes === 'object' && !Array.isArray(themes)) {
    for (const [id, v] of Object.entries(themes)) {
      const entry = v as Record<string, unknown> | null;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        problems.push(`themes.${id}: must be an object`);
        continue;
      }
      if (entry.palette !== undefined
        && (typeof entry.palette !== 'object' || entry.palette === null || Array.isArray(entry.palette))) {
        problems.push(`themes.${id}.palette: must be an object`);
      }
    }
  }
  const strings = m.strings as Record<string, unknown> | undefined;
  if (strings && typeof strings === 'object' && !Array.isArray(strings)) {
    for (const [k, v] of Object.entries(strings)) {
      if (typeof v !== 'string') problems.push(`strings.${k}: must be a string`);
    }
  }
  const wraps = m.wraps as Record<string, unknown> | undefined;
  if (wraps && typeof wraps === 'object' && !Array.isArray(wraps)) {
    for (const [medium, v] of Object.entries(wraps)) {
      if (typeof v === 'string') continue;
      if (!Array.isArray(v)) { problems.push(`wraps.${medium}: must be a string or an array of prints`); continue; }
      v.forEach((w, i) => {
        const spec = w as Record<string, unknown> | null;
        const at = `wraps.${medium}[${i}]`;
        if (!spec || typeof spec !== 'object') { problems.push(`${at}: must be an object`); return; }
        if (typeof spec.id !== 'string' || !spec.id.trim()) problems.push(`${at}.id: required string`);
        if (typeof spec.file !== 'string' || !spec.file.trim()) problems.push(`${at}.file: required string`);
        if (spec.label !== undefined && typeof spec.label !== 'string') problems.push(`${at}.label: must be a string`);
        if (spec.layout !== undefined && !['base', 'plain', 'ticket'].includes(spec.layout as string)) {
          problems.push(`${at}.layout: must be one of base | plain | ticket`);
        }
      });
    }
  }
  return problems;
}
