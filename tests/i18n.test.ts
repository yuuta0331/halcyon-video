import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectBrowserLocale,
  getLocale,
  lookupMessage,
  resetLocaleCache,
  setLocale,
  t,
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

test('catalogs do not contain third-party rental-chain brands', () => {
  const blob = JSON.stringify(en) + JSON.stringify(ja);
  assert.equal(/tsutaya|geo\b|ゲオ|ツタヤ/i.test(blob), false);
});
