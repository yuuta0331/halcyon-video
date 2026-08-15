import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { t, setLocale, resetLocaleCache } from '../src/i18n/index.ts';

const SRC = readFileSync('src/library-settings.ts', 'utf8');

test('dynamic library setting hints go through i18n, not English literals', () => {
  assert.match(SRC, /hint:\s*\(\)\s*=>\s*t\('setting\.carryLib\.hint'\)/);
  assert.match(SRC, /hint:\s*\(\)\s*=>\s*t\('setting\.tvLib\.hint'\)/);
  assert.equal(SRC.includes('OFF = this store does not carry the library'), false);
  assert.equal(SRC.includes('Feed the ceiling TVs from this library'), false);
  assert.match(SRC, /label:\s*lib\.name/);
  assert.equal(/label:\s*t\(/.test(SRC), false);
});

test('dynamic library setting hints have English and Japanese chrome', () => {
  assert.equal(
    t('setting.carryLib.hint'),
    'OFF = this store does not carry the library; its sync is skipped.',
  );
  assert.equal(
    t('setting.tvLib.hint'),
    'Feed the ceiling TVs from this library. All OFF = family picks.',
  );
  setLocale('ja');
  try {
    assert.equal(t('setting.carryLib.hint'), 'オフにするとこの店では取り扱わず、同期もスキップします。');
    assert.equal(t('setting.tvLib.hint'), 'このライブラリを天井テレビに流す。全部オフならおまかせ。');
  } finally {
    setLocale('en');
    resetLocaleCache();
  }
});
