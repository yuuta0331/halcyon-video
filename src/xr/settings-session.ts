// Draft / apply / cancel over the canonical settings registry.
// XR owns presentation; src/settings.ts owns persist + apply semantics.

import {
  commitSetting,
  cycleValueIds,
  getSetting,
  settingValuesEqual,
  type SettingsApplyTarget,
} from '../settings-registry.ts';
import { registerLiveChromeSettings } from '../settings-live-chrome.ts';
import { xrControlKeys, xrSettingExposure } from './settings-policy.ts';

export interface XrSettingsDraft {
  values: Record<string, unknown>;
  dirty: boolean;
}

export interface CycleDef {
  key: string;
  values: string[];
}

export function readXrDraft(keys: readonly string[] = xrControlKeys()): XrSettingsDraft {
  registerLiveChromeSettings();
  const values: Record<string, unknown> = {};
  for (const key of keys) values[key] = getSetting(key);
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

export function canonicalCycleDef(key: string): CycleDef {
  const values = cycleValueIds(key);
  return { key, values: values.length ? values : [String(getSetting(key) ?? '')] };
}

/**
 * Commit only changed XR control keys through commitSetting.
 * Does not write storage or invoke apply for unchanged draft values.
 * Cancel is a re-read, never a write-back of old values.
 */
export function applyXrDraft(
  draft: XrSettingsDraft,
  scene: SettingsApplyTarget | null = null,
  keys: readonly string[] = xrControlKeys(),
): XrSettingsDraft {
  registerLiveChromeSettings();
  for (const key of keys) {
    if (xrSettingExposure(key) !== 'control') continue;
    const value = draft.values[key];
    if (settingValuesEqual(key, getSetting(key), value)) continue;
    commitSetting(key, value, {
      scene,
      allowReload: false,
      allowRebuild: false,
    });
  }
  return { values: { ...draft.values }, dirty: false };
}

export function cancelXrDraft(keys: readonly string[] = xrControlKeys()): XrSettingsDraft {
  return readXrDraft(keys);
}
