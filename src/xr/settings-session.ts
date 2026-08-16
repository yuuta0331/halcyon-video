// Draft / apply / cancel over the existing settings store. No second database.

import { setLocale, type Locale } from '../i18n/locale.ts';
import { xrControlKeys, xrSettingExposure } from './settings-policy.ts';

export interface SettingsStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface CycleDef {
  key: string;
  values: string[];
}

export interface XrSettingsDraft {
  values: Record<string, unknown>;
  dirty: boolean;
}

export function readXrDraft(store: SettingsStore, keys: readonly string[] = xrControlKeys()): XrSettingsDraft {
  const values: Record<string, unknown> = {};
  for (const key of keys) values[key] = store.get(key);
  return { values, dirty: false };
}

export function cycleDraftValue(draft: XrSettingsDraft, def: CycleDef): XrSettingsDraft {
  const cur = String(draft.values[def.key] ?? def.values[0]);
  const idx = Math.max(0, def.values.indexOf(cur));
  const next = def.values[(idx + 1) % def.values.length];
  return { values: { ...draft.values, [def.key]: next }, dirty: true };
}

export function toggleDraftValue(draft: XrSettingsDraft, key: string): XrSettingsDraft {
  return { values: { ...draft.values, [key]: !draft.values[key] }, dirty: true };
}

export function stepDraftCycle(
  draft: XrSettingsDraft,
  def: CycleDef,
  dir: -1 | 1,
): XrSettingsDraft {
  const cur = String(draft.values[def.key] ?? def.values[0]);
  const idx = Math.max(0, def.values.indexOf(cur));
  const next = def.values[(idx + dir + def.values.length) % def.values.length];
  return { values: { ...draft.values, [def.key]: next }, dirty: true };
}

/**
 * Persist draft keys that are XR controls. Locale also updates the live i18n
 * table so the XR panel repaints without a page reload. rebuild-scene / reload
 * desktop apply modes are not executed here.
 */
export function applyXrDraft(
  store: SettingsStore,
  draft: XrSettingsDraft,
  keys: readonly string[] = xrControlKeys(),
): XrSettingsDraft {
  for (const key of keys) {
    if (xrSettingExposure(key) !== 'control') continue;
    const value = draft.values[key];
    store.set(key, value);
    if (key === 'bb_locale' && (value === 'en' || value === 'ja')) {
      setLocale(value as Locale);
    }
  }
  return { values: { ...draft.values }, dirty: false };
}

export function cancelXrDraft(
  store: SettingsStore,
  keys: readonly string[] = xrControlKeys(),
): XrSettingsDraft {
  return readXrDraft(store, keys);
}

export function memorySettingsStore(initial: Record<string, unknown> = {}): SettingsStore {
  const data = { ...initial };
  return {
    get(key) { return data[key]; },
    set(key, value) { data[key] = value; },
  };
}
