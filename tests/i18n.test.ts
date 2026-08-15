import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectBrowserLocale,
  getLocale,
  lookupMessage,
  resetLocaleCache,
  setLocale,
  t,
  tfill,
} from '../src/i18n/index.ts';
import { en } from '../src/i18n/en.ts';
import { ja } from '../src/i18n/ja.ts';

test('English is the default locale', () => {
  resetLocaleCache();
  assert.equal(getLocale(), 'en');
  assert.equal(t('locale.label'), 'Language');
  assert.equal(t('hud.walkAround'), en['hud.walkAround']);
});

test('Japanese locale selects Japanese strings', () => {
  setLocale('ja');
  try {
    assert.equal(getLocale(), 'ja');
    assert.equal(t('locale.label'), '表示言語');
    assert.equal(t('hud.walkAround'), ja['hud.walkAround']);
    assert.equal(t('settings.title'), 'ストア設定');
  } finally {
    setLocale('en');
    resetLocaleCache();
  }
});

test('missing Japanese entries fall back to English', () => {
  const dicts = {
    en: { 'only.en': 'Hello', 'both': 'Yes' },
    ja: { 'both': 'はい' },
  };
  assert.equal(lookupMessage('only.en', 'ja', dicts), 'Hello');
  assert.equal(lookupMessage('both', 'ja', dicts), 'はい');
  assert.equal(lookupMessage('both', 'en', dicts), 'Yes');
  assert.equal(lookupMessage('missing', 'ja', dicts), 'missing');
});

test('browser locale detection does not change the active locale', () => {
  resetLocaleCache();
  const suggested = detectBrowserLocale();
  assert.ok(suggested === 'en' || suggested === 'ja');
  assert.equal(getLocale(), 'en');
});

test('new chrome keys have Japanese entries and English fallback still works', () => {
  assert.equal(t('setting.theme.label'), 'Store Theme');
  assert.equal(t('gate.open2d'), 'Open the 2D store');
  assert.equal(t('flat.menu'), 'Menu');
  assert.equal(t('setup.title'), 'NEW STORE SETUP — OPENING DAY');
  assert.equal(t('setting.carryLib.hint'), 'OFF = this store does not carry the library; its sync is skipped.');
  assert.equal(t('setting.tvLib.hint'), 'Feed the ceiling TVs from this library. All OFF = family picks.');
  setLocale('ja');
  try {
    assert.equal(t('setting.theme.label'), '店の時代');
    assert.equal(t('gate.open2d'), '2Dの店を開く');
    assert.equal(t('flat.menu'), 'メニュー');
    assert.equal(t('setup.title'), '新規開店 — セットアップ');
    assert.equal(t('crt.idle.search'), '検索: / キー');
    assert.equal(t('setting.carryLib.hint'), 'オフにするとこの店では取り扱わず、同期もスキップします。');
    assert.equal(t('setting.tvLib.hint'), 'このライブラリを天井テレビに流す。全部オフならおまかせ。');
  } finally {
    setLocale('en');
    resetLocaleCache();
  }
});

test('tfill substitutes placeholders and leaves unknown names', () => {
  assert.equal(
    tfill('clerk.mustSee', { title: 'Alien', year: ' (1979)', reason: 'A keeper.' }),
    'you have to see "Alien" (1979). A keeper.',
  );
  setLocale('ja');
  try {
    assert.equal(
      tfill('clerk.mustSee', { title: 'エイリアン', year: ' (1979)', reason: 'はずさない。' }),
      '「エイリアン」 (1979) は見ておいたほうがいい。はずさない。',
    );
  } finally {
    setLocale('en');
    resetLocaleCache();
  }
});

test('every Japanese catalog key exists in English', () => {
  for (const key of Object.keys(ja)) {
    assert.ok(key in en, key);
  }
});

test('catalogs do not contain third-party rental-chain brands', () => {
  const blob = JSON.stringify(en) + JSON.stringify(ja);
  assert.equal(/tsutaya|geo\b|ゲオ|ツタヤ/i.test(blob), false);
});
