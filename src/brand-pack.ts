// Brand pack loader — the drop-in seam for a WHOLE store identity.
//
// THREE TIERS, one loader:
//
//   SIMPLE DROP (no setting, no manifest) — public/user-assets/brand/, the
//     singular well-known folder. Put logo.svg or logo.png in it and the store
//     wears it on the next boot; brand-drop.ts synthesizes the manifest from
//     the art. This is the "one step" tier, and it is ON by presence alone.
//   BRAND PACK (explicit, private) — one directory in public/user-assets/brands/:
//     `brands/<pack-id>/brand.json` plus whatever art it overrides (logo,
//     fonts, signs, surfaces, wraps). `localStorage.bb_brand_pack` names the
//     active one. Git-ignored: real-brand recreations and user scans live here.
//   BUNDLED PACK (explicit, shipped) — public/brand-packs/<id>/ for fictional
//     identities that ship with the app (see src/bundled-brand-packs.ts). Only
//     registered ids are probed; an unknown bb_brand_pack never searches this
//     tree. A local pack with the same id overrides its bundled counterpart.
//
// PRECEDENCE: brand/ (drop) < bb_brand_pack (explicit user, else bundled) <
// bb_logo (the user's own live edits in the brand editor). Naming a pack is
// an explicit choice, so it wins over a folder that just happens to exist —
// and the drop is never consulted when bb_brand_pack is set, so a typo'd pack
// id reports itself as a typo instead of silently landing on some other identity.
// `__original__` is a selector sentinel (not a pack id): lookup kind is `none`,
// the drop is skipped, and neither brands/ nor brand-packs/ is probed.
//
// No drop, no key, or a manifest that isn't installed means NO pack: every
// accessor below answers with the caller's own fallback, so a store with
// neither renders exactly as it did before this module existed. That is the
// contract — the committed default look must never depend on a pack existing.
//
// NO three.js imports here: this is consumed by the pure-canvas painters
// (logo-renderer, logo-wrap), by the identity resolvers (themes.ts,
// logo-spec.ts) and by the texture loader (user-assets.ts) alike, and by
// tools/list-slots.mjs under node. Module eval touches no browser global.
//
// ORDERING IS LOAD-BEARING (the same rule bundled-fonts.ts documents): the
// manifest and its fonts/images must be settled BEFORE the store builds. Most
// sign canvases are painted once into a texture cache and never repainted, so
// a pack landing a few ms late bakes the DEFAULT brand in permanently and
// nothing says so. Boot funnels await loadBrandPack() ahead of
// initializeStoreScene (main.ts waitForFontsAndInit, harness-boot.ts's
// watchdog race, asset-viewer.ts's).
import { assetUrl } from './asset-url';
import { registerRuntimeFace } from './bundled-fonts';
import { BRAND_DROP_DIR, detectBrandDrop } from './brand-drop';
import { brandPackLookupPlan } from './bundled-brand-packs';
import { containsCjk } from './i18n/text';
import { ensureCjkFont } from './i18n/cjk-font';
import {
  validateBrandManifest,
  type BrandPackManifest,
} from './brand-pack-manifest';

export type { BrandPackFontSpec, BrandPackManifest, BrandPackWrapSpec } from './brand-pack-manifest';
export { validateBrandManifest } from './brand-pack-manifest';

export type BrandPackStatus = 'none' | 'loading' | 'loaded' | 'failed';

/** Which tier supplied the active identity. */
export type BrandPackSource = 'none' | 'drop' | 'pack' | 'bundled';

// Legacy theme ids, canonicalized here rather than by importing resolveThemeId
// from themes.ts — that module imports US at runtime (getActiveTheme merges the
// pack palette), and this keeps the dependency one-directional. Same tiny
// duplication logo-spec.ts already carries; keep it in step with THEME_ALIASES.
const THEME_ID_ALIASES: Record<string, string> = { 'bb-90s': 'bb-1990', 'bb-2000s': 'bb-2010' };

let pack: BrandPackManifest | null = null;
let status: BrandPackStatus = 'none';
let loadPromise: Promise<BrandPackManifest | null> | null = null;
// Which tier answered, and the public/-relative directory it lives in
// (`user-assets/brands/<id>`, `user-assets/brand`, or `brand-packs/<id>`).
let source: BrandPackSource = 'none';
let packPublicRoot: string | null = null;
// Declared family name -> the runtime family it was actually registered under.
const packFamilies = new Map<string, string>();
// Resolved emblem-image url -> the decoded element (null once it has failed).
const packImages = new Map<string, HTMLImageElement | null>();

function readSetting(key: string): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
}

/** The pack id the user asked for (localStorage bb_brand_pack), or null. */
export function activeBrandPackId(): string | null {
  const id = readSetting('bb_brand_pack');
  return id && id.trim() ? id.trim() : null;
}

/** The loaded manifest, or null — the sync accessor every consumer uses. */
export function getBrandPack(): BrandPackManifest | null {
  return pack && packApplies() ? pack : null;
}

/** Load state for the SERVICE MODE diagnostic line. */
export function brandPackStatus(): BrandPackStatus {
  return status;
}

/** Which tier the active identity came from — 'drop', 'pack', 'bundled' or 'none'. */
export function brandPackSource(): BrandPackSource {
  return getBrandPack() ? source : 'none';
}

/**
 * Does the loaded pack cover the ACTIVE theme? `appliesTo` lets a pack scope
 * itself to the eras it was authored for (a 1990 identity has nothing to say
 * about a 2010 store); absent/empty means every theme. One gate for the whole
 * pack — when it's shut, the store is exactly the no-pack store.
 */
function packApplies(): boolean {
  if (!pack) return false;
  const list = pack.appliesTo;
  if (!Array.isArray(list) || list.length === 0) return true;
  const saved = readSetting('bb_theme');
  const themeId = saved ? (THEME_ID_ALIASES[saved] ?? saved) : 'bb-1990';
  return list.includes(themeId);
}

/**
 * Public/-relative root of the active identity (`user-assets/brands/<id>`,
 * `user-assets/brand`, or `brand-packs/<id>`), or null. Prefer this over
 * teaching every consumer about both trees.
 */
export function brandPackPublicRoot(): string | null {
  return getBrandPack() ? packPublicRoot : null;
}

/**
 * The active identity's directory relative to user-assets/, or null. A simple
 * drop is `brand`; an explicit private pack is `brands/<id>`. Bundled packs
 * do not live under user-assets/, so this is null for those — use
 * brandPackPublicRoot() for a path that works for every tier.
 */
export function brandPackDir(): string | null {
  const root = brandPackPublicRoot();
  if (!root || !root.startsWith('user-assets/')) return null;
  return root.slice('user-assets/'.length);
}

/**
 * Resolve a pack-relative path ('logo/emblem.png') to a fetchable URL, or null
 * when no pack is active. Absolute/data/http sources pass through untouched so
 * a manifest can point at something outside its own directory.
 */
export function brandAssetUrl(rel: string): string | null {
  if (/^(?:https?:|data:|blob:|\/)/.test(rel)) return rel;
  const root = brandPackPublicRoot();
  return root ? assetUrl(`${root}/${rel.replace(/^\.?\//, '')}`) : null;
}

/**
 * A rendered brand string: the pack's override for `key`, else `fallback`.
 * Fallbacks are the CURRENT literals at every call site, so this is a no-op
 * until a pack declares the key.
 */
export function brandString(key: string, fallback: string): string {
  const s = getBrandPack()?.strings;
  const v = s && typeof s[key] === 'string' ? s[key] : null;
  return v !== null ? v : fallback;
}

/**
 * Manifest key suffix for an in-world category / library name.
 * `SCI-FI & FANTASY` → `SCI-FI-&-FANTASY` (spaces to hyphens, punctuation kept).
 */
export function brandGenreKey(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, '-');
}

/**
 * In-world genre / aisle label. Packs override via `strings['sign-genre-ACTION']`
 * etc. Unknown names keep the caller's fallback — no pack-id branches.
 */
export function brandGenreLabel(name: string): string {
  return brandString(`sign-genre-${brandGenreKey(name)}`, name);
}

/**
 * The runtime family a pack-declared font name was registered under, or null.
 * Pack faces get a BBPack-prefixed family (the rule bundled-fonts.ts sets out)
 * so a manifest naming 'Helvetica' can never resolve to the host's copy —
 * canvas painters must measure the face we actually loaded.
 */
export function brandPackFontFamily(declared: string): string | null {
  return packFamilies.get(declared) ?? null;
}

/** Declared family names, for the brand editor's font picker. */
export function brandPackFontFamilies(): string[] {
  return getBrandPack() ? [...packFamilies.keys()] : [];
}

/**
 * A pack image preloaded by loadBrandPack, or null. Sync on purpose: the
 * emblem painters run inside a once-only texture paint and cannot await.
 */
export function brandImage(src: string): HTMLImageElement | null {
  const url = brandAssetUrl(src);
  return url ? (packImages.get(url) ?? null) : null;
}

function packNeedsCjk(manifest: BrandPackManifest): boolean {
  const bits: unknown[] = [
    manifest.name, manifest.displayName,
    manifest.logo?.mainText, manifest.logo?.subText,
    manifest.logo?.bandText, manifest.logo?.taglineText,
    ...Object.values(manifest.strings ?? {}),
  ];
  return bits.some((s) => typeof s === 'string' && containsCjk(s));
}

// ─── Boot load ───────────────────────────────────────────────────────────────

/** Sanitize a declared family into the BBPack-prefixed runtime family name. */
function runtimeFamilyFor(declared: string): string {
  return 'BBPack' + (declared.replace(/[^A-Za-z0-9]/g, '') || 'Face');
}

/** Preload one emblem image; resolves either way (a miss must never hang boot). */
function preloadImage(url: string): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => { packImages.set(url, img); resolve(); };
    img.onerror = () => { packImages.set(url, null); resolve(); };
    img.src = url;
  });
}

/**
 * Adopt a manifest: register its fonts, preload its emblem art. Shared by every
 * tier — a synthesized drop manifest is a manifest like any other.
 * `publicRoot` is site-root-relative (`user-assets/brand`, `user-assets/brands/<id>`,
 * or `brand-packs/<id>`).
 */
function adopt(manifest: BrandPackManifest, publicRoot: string, from: BrandPackSource): Promise<BrandPackManifest> {
  pack = manifest;
  packPublicRoot = publicRoot;
  source = from;
  status = 'loaded';
  // A Japanese wordmark/sign string must wait on BBCjk the same way pack
  // display faces wait on bundledFontsReady() — once-only canvases cannot
  // bake a host fallback and never recover.
  if (packNeedsCjk(manifest)) ensureCjkFont();
  // Fonts first: registerRuntimeFace kicks each fetch and re-arms
  // bundledFontsReady(), which the boot funnel awaits right after us.
  for (const face of manifest.fonts ?? []) {
    const src = brandAssetUrl(face.file);
    if (!src) continue;
    const family = runtimeFamilyFor(face.family);
    registerRuntimeFace(family, src, face.descriptors);
    packFamilies.set(face.family, family);
  }
  // Emblem art is awaited here (not registered) because the painters that
  // draw it are synchronous and run once.
  const imgSrc = manifest.logo?.imageSrc;
  const imgUrl = imgSrc ? brandAssetUrl(imgSrc) : null;
  return imgUrl ? preloadImage(imgUrl).then(() => manifest) : Promise.resolve(manifest);
}

/**
 * The simple-drop probe: public/user-assets/brand/. Runs only when no pack id
 * is set. Never rejects — a store with no drop folder pays one 404.
 */
function loadBrandDrop(): Promise<BrandPackManifest | null> {
  status = 'loading';
  return detectBrandDrop((p) => assetUrl(`user-assets/${p}`))
    .then((found) => {
      if (!found) { status = 'none'; return null; }
      const problems = validateBrandManifest(found.manifest);
      if (problems.length) {
        console.warn(`[brand-drop] ${BRAND_DROP_DIR}/ produced an invalid manifest — ignoring:\n  ` + problems.join('\n  '));
        status = 'failed';
        return null;
      }
      return adopt(found.manifest, `user-assets/${BRAND_DROP_DIR}`, 'drop');
    })
    .catch((e) => {
      console.warn('[brand-drop] could not read user-assets/brand/ — using the built-in brand:', e);
      status = 'failed';
      return null;
    });
}

/** Fetch a brand.json body, or null if the file is missing / SPA-fallback HTML. */
function fetchManifestText(url: string): Promise<string | null> {
  return fetch(url).then((res) => (res.ok ? res.text() : null)).then((text) => {
    if (text === null || /^\s*</.test(text)) return null;
    return text;
  });
}

function parseManifest(id: string, text: string): BrandPackManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    console.warn(`[brand-pack] ${id}/brand.json is not valid JSON — ignoring pack:`, e);
    status = 'failed';
    return null;
  }
  const problems = validateBrandManifest(parsed);
  if (problems.length) {
    console.warn(`[brand-pack] ${id}/brand.json is invalid — ignoring pack:\n  ` + problems.join('\n  '));
    status = 'failed';
    return null;
  }
  const manifest = parsed as BrandPackManifest;
  if (manifest.id !== id) {
    console.warn(`[brand-pack] ${id}/brand.json declares id "${manifest.id}" — using the directory name.`);
    manifest.id = id;
  }
  return manifest;
}

function adoptParsed(
  id: string,
  text: string,
  publicRoot: string,
  from: BrandPackSource,
): Promise<BrandPackManifest | null> {
  const manifest = parseManifest(id, text);
  return manifest ? adopt(manifest, publicRoot, from) : Promise.resolve(null);
}

/**
 * Resolve the active identity: the explicit pack `bb_brand_pack` names (local
 * user pack first, then a registered bundled pack of that id), else the simple
 * drop in user-assets/brand/. Registers its fonts and preloads its emblem art.
 * Idempotent (one resolution per page load) and never rejects:
 *   - nothing installed                   → null, silently (the normal case)
 *   - unreadable/invalid manifest         → null, one console.warn
 * The returned promise settling is the boot funnels' signal that the pack's
 * fonts have JOINED bundledFontsReady() — await that next, not this alone.
 */
export function loadBrandPack(): Promise<BrandPackManifest | null> {
  if (loadPromise) return loadPromise;
  if (typeof fetch === 'undefined') {
    status = 'none';
    loadPromise = Promise.resolve(null);
    return loadPromise;
  }
  const id = activeBrandPackId();
  const plan = brandPackLookupPlan(id);
  if (plan.kind === 'none') {
    status = 'none';
    source = 'none';
    loadPromise = Promise.resolve(null);
    return loadPromise;
  }
  if (plan.kind === 'drop') {
    loadPromise = loadBrandDrop();
    return loadPromise;
  }
  status = 'loading';
  loadPromise = (async () => {
    try {
      const packId = plan.id;
      const userPath = plan.userPath;
      const userText = userPath ? await fetchManifestText(assetUrl(userPath)) : null;
      if (userText) return adoptParsed(packId, userText, `user-assets/brands/${packId}`, 'pack');
      if (plan.kind === 'user-then-bundled') {
        const bundledText = await fetchManifestText(assetUrl(plan.bundledPath));
        if (bundledText) {
          return adoptParsed(packId, bundledText, `brand-packs/${packId}`, 'bundled');
        }
        console.warn(`[brand-pack] bundled pack ${packId} is registered but brand.json was not found — using the built-in brand.`);
        status = 'failed';
        return null;
      }
      // Unknown id, not installed. Identical to "no pack" — the committed look stands.
      status = 'none';
      return null;
    } catch (e) {
      console.warn(`[brand-pack] could not load ${id}/brand.json — using the built-in brand:`, e);
      status = 'failed';
      return null;
    }
  })();
  return loadPromise;
}

/** Test seam: clear the singleton so a second loadBrandPack() can run. */
export function resetBrandPackForTests(): void {
  pack = null;
  status = 'none';
  loadPromise = null;
  source = 'none';
  packPublicRoot = null;
  packFamilies.clear();
  packImages.clear();
}
