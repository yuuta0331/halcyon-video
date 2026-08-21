// Canonical settings registry: keys, defaults, persist, and commit/apply.
// Heavy desktop drawer registrations live in settings.ts so Node tests can
// import this module without pulling font/asset graphs.

import { isDemoMode } from './demo-mode.ts';

export type SettingKind = 'toggle' | 'cycle' | 'text' | 'secret';
export type ApplyMode = 'live' | 'rebuild-scene' | 'reload';
export type SettingGroup = 'Connection' | 'Store Look' | 'Store Brand' | 'Playback' | 'Performance' | 'Video Games';

export interface SettingChoice {
  id: string;
  label: string;
}

export interface SettingsApplyTarget {
  setOutsideMode?(mode: 'day' | 'night' | 'sunset'): void;
  requestRender?(): void;
}

export interface SettingDef<T = unknown> {
  key: string;
  label: string;
  kind: SettingKind;
  group: SettingGroup;
  values?: SettingChoice[];
  default: T;
  applyMode: ApplyMode;
  apply?: (value: T, scene?: any) => void;
  hint?: string | (() => string);
  valueLabel?: (label: string) => string;
  onChange?: (value: unknown) => string | void;
  hidden?: boolean;
  subpage?: string;
  visibleWhen?: () => boolean;
}

const registry = new Map<string, SettingDef>();
const order: string[] = [];

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let storageOverride: SettingsStorage | null = null;

export function setSettingsStorageForTests(storage: SettingsStorage | null): void {
  storageOverride = storage;
}

function settingsStorage(): SettingsStorage | null {
  if (storageOverride) return storageOverride;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

export interface CommitSettingOptions {
  scene?: SettingsApplyTarget | null;
  allowReload?: boolean;
  allowRebuild?: boolean;
}

export interface SettingCommitResult {
  key: string;
  persisted: boolean;
  changed: boolean;
  appliedLive: boolean;
  needsRebuild: boolean;
  needsReload: boolean;
  onChangeMessage?: string;
}

export function settingValuesEqual(key: string, a: unknown, b: unknown): boolean {
  const def = registry.get(key);
  if (def?.kind === 'toggle') return !!a === !!b;
  return String(a ?? '') === String(b ?? '');
}

export function cycleValueIds(key: string): string[] {
  return registry.get(key)?.values?.map((v) => v.id) ?? [];
}

export function registerSetting(def: SettingDef): void {
  if (!registry.has(def.key)) order.push(def.key);
  registry.set(def.key, def as SettingDef);
}

export function getSettingDef(key: string): SettingDef | undefined {
  return registry.get(key);
}

export function allSettings(): SettingDef[] {
  return order.map((k) => registry.get(k)!).filter(Boolean);
}

export function settingsInGroup(group: SettingGroup): SettingDef[] {
  return allSettings().filter((d) => d.group === group && !d.hidden && !d.subpage && (!d.visibleWhen || d.visibleWhen()));
}

export function settingsInSubpage(group: SettingGroup, subpage: string): SettingDef[] {
  return allSettings().filter((d) => d.group === group && !d.hidden && d.subpage === subpage && (!d.visibleWhen || d.visibleWhen()));
}

export function subpagesInGroup(group: SettingGroup): string[] {
  const names: string[] = [];
  for (const d of allSettings()) {
    if (d.group !== group || !d.subpage || d.hidden) continue;
    if (d.visibleWhen && !d.visibleWhen()) continue;
    if (!names.includes(d.subpage)) names.push(d.subpage);
  }
  return names;
}

export function serviceSettings(): SettingDef[] {
  return allSettings().filter((d) => d.hidden);
}

export function visibleGroups(): SettingGroup[] {
  const wanted: SettingGroup[] = ['Store Look', 'Store Brand', 'Playback', 'Video Games', 'Performance', 'Connection'];
  return wanted.filter((g) =>
    !(isDemoMode && g === 'Connection') && (g === 'Store Brand' || settingsInGroup(g).length > 0 || subpagesInGroup(g).length > 0));
}

export function getSetting<T = unknown>(key: string): T {
  const def = registry.get(key);
  const store = settingsStorage();
  if (store) {
    const raw = store.getItem(key);
    if (raw !== null) {
      if (def?.kind === 'toggle') return (raw === '1') as unknown as T;
      return raw as unknown as T;
    }
  }
  if (typeof import.meta.env !== 'undefined') {
    const envKey = `VITE_${key.toUpperCase()}`;
    const envVal = (import.meta.env as Record<string, string | undefined>)[envKey];
    if (envVal !== undefined && envVal !== '') {
      if (def?.kind === 'toggle') return (envVal === '1' || envVal === 'true') as unknown as T;
      return envVal as unknown as T;
    }
  }
  return (def ? (def.default as unknown as T) : (undefined as unknown as T));
}

export function setSetting<T = unknown>(key: string, value: T): void {
  const store = settingsStorage();
  if (!store) return;
  const def = registry.get(key);
  if (def?.kind === 'toggle') {
    store.setItem(key, value ? '1' : '0');
  } else {
    store.setItem(key, String(value));
  }
}

export function commitSetting(
  key: string,
  value: unknown,
  opts: CommitSettingOptions = {},
): SettingCommitResult {
  const def = registry.get(key);
  const current = getSetting(key);
  if (settingValuesEqual(key, current, value)) {
    return {
      key,
      persisted: false,
      changed: false,
      appliedLive: false,
      needsRebuild: false,
      needsReload: false,
    };
  }
  setSetting(key, value);
  let onChangeMessage: string | undefined;
  const note = def?.onChange?.(getSetting(key));
  if (typeof note === 'string') onChangeMessage = note;
  let appliedLive = false;
  if (def?.apply) {
    def.apply(getSetting(key), opts.scene ?? null);
    appliedLive = true;
    opts.scene?.requestRender?.();
  }
  const needsRebuild = def?.applyMode === 'rebuild-scene' && opts.allowRebuild !== false;
  const needsReload = def?.applyMode === 'reload' && opts.allowReload === true;
  return {
    key,
    persisted: true,
    changed: true,
    appliedLive,
    needsRebuild,
    needsReload,
    onChangeMessage,
  };
}

export function nextCycleValue(key: string): string {
  const def = registry.get(key);
  if (!def?.values || def.values.length === 0) return String(getSetting(key));
  const cur = String(getSetting(key));
  const idx = def.values.findIndex((v) => v.id === cur);
  return def.values[(idx + 1) % def.values.length].id;
}
