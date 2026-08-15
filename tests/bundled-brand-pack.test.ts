import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUNDLED_BRAND_PACK_IDS,
  HALCYON_JP_PACK_ID,
  brandPackLookupPlan,
  bundledBrandPackPublicDir,
  builtinIdentitySelection,
  isBundledBrandPackId,
} from '../src/bundled-brand-packs.ts';
import { validateBrandManifest } from '../src/brand-pack-manifest.ts';

const PACK_DIR = 'public/brand-packs/halcyon-jp';
const MANIFEST_PATH = join(PACK_DIR, 'brand.json');

test('bundled registry lists only the fictional Japanese identity', () => {
  assert.deepEqual([...BUNDLED_BRAND_PACK_IDS], ['halcyon-jp']);
  assert.equal(HALCYON_JP_PACK_ID, 'halcyon-jp');
  assert.equal(isBundledBrandPackId('halcyon-jp'), true);
  assert.equal(isBundledBrandPackId('tsutaya'), false);
  assert.equal(isBundledBrandPackId('my-video'), false);
  assert.equal(bundledBrandPackPublicDir('halcyon-jp'), 'brand-packs/halcyon-jp');
  assert.equal(bundledBrandPackPublicDir('my-video'), null);
});

test('blank pack id is the drop/no-pack path, never a bundled identity', () => {
  assert.deepEqual(brandPackLookupPlan(null), { kind: 'drop' });
  assert.deepEqual(brandPackLookupPlan(''), { kind: 'drop' });
  assert.deepEqual(brandPackLookupPlan('   '), { kind: 'drop' });
});

test('unknown ids only probe the private user-assets tree', () => {
  const plan = brandPackLookupPlan('my-private-chain');
  assert.equal(plan.kind, 'user-only');
  if (plan.kind !== 'user-only') return;
  assert.equal(plan.userPath, 'user-assets/brands/my-private-chain/brand.json');
  assert.equal('bundledPath' in plan, false);
});

test('registered bundled ids try a local override first', () => {
  const plan = brandPackLookupPlan('halcyon-jp');
  assert.equal(plan.kind, 'user-then-bundled');
  if (plan.kind !== 'user-then-bundled') return;
  assert.equal(plan.userPath, 'user-assets/brands/halcyon-jp/brand.json');
  assert.equal(plan.bundledPath, 'brand-packs/halcyon-jp/brand.json');
});

test('built-in selector does not treat unknown private ids as Original', () => {
  assert.equal(builtinIdentitySelection(null), 'original');
  assert.equal(builtinIdentitySelection(''), 'original');
  assert.equal(builtinIdentitySelection('halcyon-jp'), 'halcyon-jp');
  assert.equal(builtinIdentitySelection('my-private-chain'), 'custom');
});

test('committed bundled manifest is valid and id matches the directory', () => {
  assert.ok(existsSync(MANIFEST_PATH), MANIFEST_PATH);
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const problems = validateBrandManifest(raw);
  assert.deepEqual(problems, []);
  assert.equal(raw.id, 'halcyon-jp');
  assert.equal(raw.id, PACK_DIR.split(/[/\\]/).pop());
});

test('validateBrandManifest rejects a malformed bundled-style object', () => {
  assert.ok(validateBrandManifest(null).length > 0);
  assert.ok(validateBrandManifest({ id: 'halcyon-jp' }).some((p) => p.startsWith('version:')));
  assert.ok(validateBrandManifest({ version: 1, id: 'Halcyon JP' }).some((p) => p.includes('kebab-case')));
  assert.ok(validateBrandManifest({ version: 1, id: 'halcyon-jp', strings: { a: 1 } }).some((p) => p.startsWith('strings.')));
});

test('default Halcyon house blue is unchanged by the bundled pack module', () => {
  const logo = readFileSync('src/logo-spec.ts', 'utf8');
  assert.match(logo, /mainText: 'HALCYON'/);
  assert.match(logo, /HALCYON_BLUE = '#1a49c2'/);
});

test('locale and identity stay independent in source', () => {
  const registry = readFileSync('src/bundled-brand-packs.ts', 'utf8');
  assert.equal(/bb_locale|setLocale|from '\.\/i18n/.test(registry), false);
  const settings = readFileSync('src/settings.ts', 'utf8');
  const start = settings.indexOf('Built-in store identity');
  const end = settings.indexOf('Preset strip', start);
  assert.ok(start >= 0 && end > start, 'identity selector block');
  const block = settings.slice(start, end);
  assert.match(block, /builtinIdentitySelection\(activeBrandPackId\(\)\)/);
  assert.match(block, /hooks\.onNeedsReload/);
  assert.equal(/setLocale|bb_locale/.test(block), false);
  assert.equal(/localStorage\.setItem\('bb_brand_pack'/.test(block.split('applyIdentity')[0]), false);
});

test('Japanese LogoSpec / sign painters name BBCjk, not a host family', () => {
  const logo = readFileSync('src/logo-renderer.ts', 'utf8');
  assert.match(logo, /ensureCjkFont/);
  assert.match(logo, /BB_CJK/);
  assert.match(logo, /containsCjk\(text\)/);
  assert.equal(/Noto Sans JP|Yu Gothic|Meiryo|MS Gothic|Courier New/.test(logo), false);
  const signs = readFileSync('src/canvas-textures.ts', 'utf8');
  assert.match(signs, /BB_CJK/);
  assert.match(signs, /brandGenreLabel/);
  assert.match(signs, /sign-new-releases/);
});

test('committed fictional pack sources do not name real chains', () => {
  const forbidden = /TSUTAYA|ツタヤ|\bGEO\b|ゲオ|BLOCKBUSTER/i;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(json|svg|txt|html)$/i.test(name)) continue;
      const text = readFileSync(p, 'utf8');
      assert.equal(forbidden.test(text), false, p);
    }
  };
  walk('public/brand-packs');
});

test('bundled pack is not stored under git-ignored user-assets', () => {
  assert.equal(existsSync('public/user-assets/brands/halcyon-jp/brand.json'), false);
  assert.ok(existsSync('public/brand-packs/halcyon-jp/brand.json'));
  const gitignore = readFileSync('.gitignore', 'utf8');
  assert.equal(/!public\/user-assets\/brands\/halcyon-jp/.test(gitignore), false);
});

test('bundled pack maps demo library names to Japanese aisle copy', () => {
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  assert.equal(raw.strings['sign-genre-MOVIES'], '映画');
  assert.equal(raw.strings['sign-genre-ANIMATED-MOVIES'], 'アニメ');
  assert.equal(raw.strings['sign-genre-VIDEO-GAMES'], 'ゲーム');
  assert.equal(raw.strings['sign-genre-PREVIOUSLY-VIEWED'], 'おすすめ');
  assert.equal(raw.strings['sign-new-releases'], '新作');
});

test('wrap files match USER_WRAP_SPECS when present', () => {
  const vhs = join(PACK_DIR, 'wraps/vhs.png');
  const dvd = join(PACK_DIR, 'wraps/dvd.png');
  assert.ok(existsSync(vhs), vhs);
  assert.ok(existsSync(dvd), dvd);
  assert.ok(readFileSync(vhs).length > 1000, 'vhs wrap should be real raster art');
  assert.ok(readFileSync(dvd).length > 1000, 'dvd wrap should be real raster art');
});
