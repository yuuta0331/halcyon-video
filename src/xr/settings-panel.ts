import { t } from '../i18n/index.ts';
import { cycleValueIds } from '../settings-registry.ts';
import { xrControlKeys, xrQualityStatusLabel, xrStatusKeys } from './settings-policy.ts';
import type { XrSettingsDraft } from './settings-session.ts';

export type XrSettingsRowKind = 'cycle' | 'toggle' | 'status' | 'action';

export type XrSettingsAction = 'apply' | 'cancel' | 'back';

export interface XrSettingsRow {
  id: string;
  kind: XrSettingsRowKind;
  label: string;
  value: string;
}

export function localeCycleValues(): readonly string[] {
  const ids = cycleValueIds('bb_locale');
  return ids.length ? ids : ['en', 'ja'];
}

export function outsideCycleValues(): readonly string[] {
  const ids = cycleValueIds('bb_outside');
  return ids.length ? ids : ['day', 'night', 'sunset'];
}

export function xrSettingsTitle(): string {
  return t('xr.settings.title');
}

function controlLabel(key: string): string {
  if (key === 'bb_locale') return t('locale.label');
  if (key === 'bb_outside') return t('setting.environment.label');
  if (key === 'bb_fps_meter') return t('setting.fpsMeter.label');
  return key;
}

function localeValueLabel(id: string): string {
  return id === 'ja' ? t('locale.ja') : t('locale.en');
}

function outsideValueLabel(id: string): string {
  if (id === 'night') return t('setting.environment.night');
  if (id === 'sunset') return t('setting.environment.sunset');
  return t('setting.environment.day');
}

export function xrSettingsRows(
  draft: XrSettingsDraft,
  resourceProfile: string,
): XrSettingsRow[] {
  const rows: XrSettingsRow[] = [];
  for (const key of xrControlKeys()) {
    if (key === 'bb_locale') {
      const id = String(draft.values[key] ?? 'en');
      rows.push({ id: key, kind: 'cycle', label: controlLabel(key), value: localeValueLabel(id) });
    } else if (key === 'bb_outside') {
      const id = String(draft.values[key] ?? 'day');
      rows.push({ id: key, kind: 'cycle', label: controlLabel(key), value: outsideValueLabel(id) });
    } else if (key === 'bb_fps_meter') {
      rows.push({
        id: key,
        kind: 'toggle',
        label: controlLabel(key),
        value: draft.values[key] ? t('value.on') : t('value.off'),
      });
    }
  }
  rows.push({
    id: 'xr-quality',
    kind: 'status',
    label: t('xr.settings.quality'),
    value: xrQualityStatusLabel(resourceProfile),
  });
  for (const key of xrStatusKeys()) {
    if (key === 'bb_quality') {
      rows.push({
        id: key,
        kind: 'status',
        label: t('setting.quality.label'),
        value: t('xr.settings.qualityHint'),
      });
    }
  }
  rows.push({ id: 'apply', kind: 'action', label: t('xr.settings.apply'), value: '' });
  rows.push({ id: 'cancel', kind: 'action', label: t('xr.settings.cancel'), value: '' });
  rows.push({ id: 'back', kind: 'action', label: t('settings.back'), value: '' });
  return rows;
}

export function settingsActionAt(rows: readonly XrSettingsRow[], index: number): XrSettingsAction | null {
  const row = rows[index];
  if (!row || row.kind !== 'action') return null;
  if (row.id === 'apply' || row.id === 'cancel' || row.id === 'back') return row.id;
  return null;
}
