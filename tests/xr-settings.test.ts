import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLocale, resetLocaleCache, setLocale, t } from '../src/i18n/index.ts';
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
  memorySettingsStore,
  readXrDraft,
  stepDraftCycle,
} from '../src/xr/settings-session.ts';
import { XrUiSession } from '../src/xr/ui-session.ts';
import { xrSettingsRows } from '../src/xr/settings-panel.ts';

function measure(s: string): number {
  return Array.from(s).length * 10;
}

test('settings reads from the existing setting source', () => {
  const store = memorySettingsStore({ bb_locale: 'en', bb_outside: 'night', bb_fps_meter: false });
  const draft = readXrDraft(store);
  assert.equal(draft.values.bb_locale, 'en');
  assert.equal(draft.values.bb_outside, 'night');
});

test('changing an XR-exposed setting persists through the existing mechanism', () => {
  const store = memorySettingsStore({ bb_locale: 'en', bb_outside: 'day', bb_fps_meter: false });
  let draft = readXrDraft(store);
  draft = stepDraftCycle(draft, { key: 'bb_locale', values: ['en', 'ja'] }, 1);
  applyXrDraft(store, draft);
  assert.equal(store.get('bb_locale'), 'ja');
  assert.equal(getLocale(), 'ja');
  setLocale('en');
  resetLocaleCache();
});

test('cancel does not persist unintended changes', () => {
  const store = memorySettingsStore({ bb_locale: 'en', bb_outside: 'day', bb_fps_meter: false });
  let draft = readXrDraft(store);
  draft = stepDraftCycle(draft, { key: 'bb_locale', values: ['en', 'ja'] }, 1);
  assert.equal(draft.values.bb_locale, 'ja');
  draft = cancelXrDraft(store);
  assert.equal(draft.values.bb_locale, 'en');
  assert.equal(store.get('bb_locale'), 'en');
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

test('unsupported desktop-only quality options are not falsely presented as active XR controls', () => {
  assert.equal(xrSettingExposure('bb_quality'), 'status');
  assert.equal(xrSettingExposure('bb_ao'), 'status');
  assert.equal(xrSettingExposure('bb_render_mode'), 'status');
  assert.equal(xrDesktopQualityAffectsXr('bb_quality', 'XR_SAFE'), false);
  assert.equal(xrQualityStatusLabel('XR_SAFE'), 'XR_SAFE');
  const store = memorySettingsStore({ bb_locale: 'en', bb_outside: 'day', bb_fps_meter: false });
  const rows = xrSettingsRows(readXrDraft(store), 'XR_SAFE');
  const quality = rows.find((r) => r.id === 'bb_quality' || r.id === 'xr-quality');
  assert.ok(quality);
  assert.equal(quality!.kind, 'status');
  assert.equal(rows.some((r) => r.id === 'bb_quality' && r.kind === 'cycle'), false);
});

test('existing desktop Settings behavior is unchanged', () => {
  assert.equal(xrSettingExposure('bb_theme'), 'hidden');
  assert.equal(xrSettingExposure('bb_quality'), 'status');
  const store = memorySettingsStore({ bb_quality: 'high' });
  assert.equal(store.get('bb_quality'), 'high');
  applyXrDraft(store, readXrDraft(store));
  assert.equal(store.get('bb_quality'), 'high');
});

test('XR UI session apply then reopen sees persisted locale', () => {
  const store = memorySettingsStore({ bb_locale: 'en', bb_outside: 'day', bb_fps_meter: false });
  const session = new XrUiSession(store, { exitVr() {} }, () => 'XR_SAFE');
  session.openMenu();
  session.activate();
  assert.equal(session.mode, 'SETTINGS');
  session.settingsIndex = 0;
  session.activate();
  session.apply();
  assert.equal(store.get('bb_locale'), 'ja');
  session.closeToWorld();
  const again = new XrUiSession(store, { exitVr() {} }, () => 'XR_SAFE');
  assert.equal(again.draft.values.bb_locale, 'ja');
  setLocale('en');
  resetLocaleCache();
});

test('uv row mapping stays inside the panel body', () => {
  assert.equal(uvToRowIndex(0.05, 4), null);
  assert.equal(uvToRowIndex(0.2, 4), 0);
  assert.equal(uvToRowIndex(0.95, 4), null);
});
