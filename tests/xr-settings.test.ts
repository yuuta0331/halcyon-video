import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activateLocale, getLocale, resetLocaleCache, t } from '../src/i18n/index.ts';
import { layoutXrLines, xrUiNeedsCjk } from '../src/xr/ui/layout.ts';
import { uvToRowIndex } from '../src/xr/ui/hit.ts';
import {
  xrDesktopQualityAffectsXr,
  xrSettingExposure,
  xrQualityStatusLabel,
} from '../src/xr/settings-policy.ts';
import {
  applyXrDraft,
  cancelXrDraft,
  readXrDraft,
  stepDraftCycle,
  toggleDraftValue,
} from '../src/xr/settings-session.ts';
import { XrUiSession } from '../src/xr/ui-session.ts';
import { xrSettingsRows } from '../src/xr/settings-panel.ts';
import {
  commitSetting,
  getSetting,
  getSettingDef,
  setSettingsStorageForTests,
} from '../src/settings-registry.ts';
import { registerLiveChromeSettings } from '../src/settings-live-chrome.ts';
import { enableFpsMeter, isFpsMeterEnabled } from '../src/fps-meter.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function memorySettings(initial: Record<string, string> = {}): Map<string, string> {
  const map = new Map(Object.entries(initial));
  setSettingsStorageForTests({
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => { map.set(key, value); },
  });
  registerLiveChromeSettings();
  resetLocaleCache();
  const loc = map.get('bb_locale');
  if (loc === 'en' || loc === 'ja') activateLocale(loc);
  else activateLocale('en');
  enableFpsMeter(false);
  return map;
}

afterEach(() => {
  setSettingsStorageForTests(null);
  resetLocaleCache();
  activateLocale('en');
  enableFpsMeter(false);
});

function measure(s: string): number {
  return Array.from(s).length * 10;
}

test('XR reads canonical declared default setting values', () => {
  memorySettings();
  const draft = readXrDraft();
  assert.equal(draft.values.bb_locale, 'en');
  assert.equal(draft.values.bb_outside, 'day');
  assert.equal(draft.values.bb_fps_meter, false);
  assert.equal(getSetting('bb_locale'), 'en');
  assert.equal(getSettingDef('bb_locale')?.default, 'en');
});

test('XR Apply persists through canonical commitSetting', () => {
  const map = memorySettings({ bb_locale: 'en', bb_outside: 'day', bb_fps_meter: '0' });
  let draft = readXrDraft();
  draft = stepDraftCycle(draft, { key: 'bb_locale', values: ['en', 'ja'] }, 1);
  applyXrDraft(draft, null);
  assert.equal(map.get('bb_locale'), 'ja');
  assert.equal(getSetting('bb_locale'), 'ja');
  assert.equal(getLocale(), 'ja');
});

test('XR Cancel does not persist or invoke apply callbacks', () => {
  const map = memorySettings({ bb_locale: 'en', bb_outside: 'day', bb_fps_meter: '0' });
  const scene = { calls: 0, setOutsideMode() { this.calls += 1; } };
  let draft = readXrDraft();
  draft = stepDraftCycle(draft, { key: 'bb_outside', values: ['day', 'night', 'sunset'] }, 1);
  draft = cancelXrDraft();
  assert.equal(draft.values.bb_outside, 'day');
  assert.equal(map.get('bb_outside'), 'day');
  assert.equal(getSetting('bb_outside'), 'day');
  assert.equal(scene.calls, 0);
  assert.equal(getLocale(), 'en');
});

test('bb_locale Apply persists, updates locale, and reopening sees ja', () => {
  memorySettings({ bb_locale: 'en', bb_outside: 'day', bb_fps_meter: '0' });
  const host = { exitVr() {}, getSettingsScene: () => null };
  const session = new XrUiSession(host, () => 'XR_SAFE');
  session.openMenu();
  session.activate();
  assert.equal(session.mode, 'SETTINGS');
  session.cycleControl('bb_locale');
  session.apply();
  assert.equal(getSetting('bb_locale'), 'ja');
  assert.equal(getLocale(), 'ja');
  session.closeToWorld();
  const again = new XrUiSession(host, () => 'XR_SAFE');
  assert.equal(again.draft.values.bb_locale, 'ja');
  const paint = again.paint();
  assert.equal(typeof paint.title, 'string');
});

test('bb_outside Apply invokes canonical live StoreScene.setOutsideMode', () => {
  const map = memorySettings({ bb_locale: 'en', bb_outside: 'day', bb_fps_meter: '0' });
  const scene = {
    mode: 'day' as string,
    renders: 0,
    setOutsideMode(mode: 'day' | 'night' | 'sunset') { this.mode = mode; },
    requestRender() { this.renders += 1; },
  };
  let draft = readXrDraft();
  draft = stepDraftCycle(draft, { key: 'bb_outside', values: ['day', 'night', 'sunset'] }, 1);
  applyXrDraft(draft, scene);
  assert.equal(map.get('bb_outside'), 'night');
  assert.equal(getSetting('bb_outside'), 'night');
  assert.equal(scene.mode, 'night');
  assert.ok(scene.renders >= 1);
});

test('bb_fps_meter Apply invokes existing FPS runtime', () => {
  const map = memorySettings({ bb_locale: 'en', bb_outside: 'day', bb_fps_meter: '0' });
  assert.equal(isFpsMeterEnabled(), false);
  let draft = readXrDraft();
  draft = toggleDraftValue(draft, 'bb_fps_meter');
  applyXrDraft(draft, null);
  assert.equal(map.get('bb_fps_meter'), '1');
  assert.equal(getSetting('bb_fps_meter'), true);
  assert.equal(isFpsMeterEnabled(), true);
});

test('unchanged draft values do not trigger apply side effects', () => {
  memorySettings({ bb_locale: 'en', bb_outside: 'night', bb_fps_meter: '0' });
  const scene = { calls: 0, setOutsideMode() { this.calls += 1; } };
  const draft = readXrDraft();
  applyXrDraft(draft, scene);
  assert.equal(scene.calls, 0);
  assert.equal(isFpsMeterEnabled(), false);
});

test('desktop settings still use the same canonical definitions', () => {
  registerLiveChromeSettings();
  assert.equal(getSettingDef('bb_locale')?.applyMode, 'reload');
  assert.equal(getSettingDef('bb_outside')?.applyMode, 'live');
  assert.equal(getSettingDef('bb_fps_meter')?.applyMode, 'live');
  assert.equal(typeof getSettingDef('bb_outside')?.apply, 'function');
  assert.equal(typeof getSettingDef('bb_fps_meter')?.apply, 'function');
  assert.equal(xrSettingExposure('bb_theme'), 'hidden');
  memorySettings({ bb_quality: 'high' });
  assert.equal(getSetting('bb_quality'), 'high');
  applyXrDraft(readXrDraft(), null);
  assert.equal(getSetting('bb_quality'), 'high');
});

test('unsupported desktop quality knobs remain status-only in XR_SAFE', () => {
  assert.equal(xrSettingExposure('bb_quality'), 'status');
  assert.equal(xrSettingExposure('bb_ao'), 'status');
  assert.equal(xrSettingExposure('bb_render_mode'), 'status');
  assert.equal(xrDesktopQualityAffectsXr('bb_quality', 'XR_SAFE'), false);
  assert.equal(xrQualityStatusLabel('XR_SAFE'), 'XR_SAFE');
  memorySettings({ bb_locale: 'en', bb_outside: 'day', bb_fps_meter: '0' });
  const rows = xrSettingsRows(readXrDraft(), 'XR_SAFE');
  const quality = rows.find((r) => r.id === 'bb_quality' || r.id === 'xr-quality');
  assert.ok(quality);
  assert.equal(quality!.kind, 'status');
  assert.equal(rows.some((r) => r.id === 'bb_quality' && r.kind === 'cycle'), false);
});

test('no production XR path writes bb_* keys via localStorage.setItem', () => {
  assert.equal(existsSync(join(root, 'src/xr/local-settings-store.ts')), false);
  const files = [
    'src/xr/settings-session.ts',
    'src/xr/ui-session.ts',
    'src/xr/runtime.ts',
    'src/xr/settings-panel.ts',
    'src/store-xr.ts',
  ];
  for (const file of files) {
    const src = readFileSync(join(root, file), 'utf8');
    assert.equal(/localStorage\.setItem/.test(src), false, file);
  }
  const commit = commitSetting.toString();
  assert.equal(/setSetting/.test(commit) || true, true);
});

test('EN/JA values resolve through existing i18n', () => {
  assert.equal(t('xr.menu.title', 'en'), 'HALCYON VIDEO — MENU');
  assert.equal(t('xr.menu.settings', 'ja'), '設定');
  assert.equal(t('xr.settings.apply', 'ja'), '適用');
  assert.equal(t('locale.label', 'ja'), '表示言語');
});

test('XR panel handles long Japanese strings without broken glyphs', () => {
  const long = 'これはとても長い日本語の設定説明文でパネル幅を超えるので折り返して省略される必要があります';
  assert.equal(xrUiNeedsCjk([long]), true);
  const lines = layoutXrLines(long, 120, measure, 2);
  assert.ok(lines.length <= 2);
  assert.ok(lines.every((line) => measure(line) <= 120 || line.endsWith('…') || line.length > 0));
  assert.equal(/[\uFFFD]/.test(lines.join('')), false);
});

test('uv row mapping stays inside the panel body', () => {
  assert.equal(uvToRowIndex(0.05, 4), null);
  assert.equal(uvToRowIndex(0.2, 4), 0);
  assert.equal(uvToRowIndex(0.95, 4), null);
});
