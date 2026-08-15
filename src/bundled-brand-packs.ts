// Registry of Brand Packs that SHIP with the app (committed under
// public/brand-packs/). Private/user packs still live in the git-ignored
// public/user-assets/brands/ tree — this file is only the distributable
// fictional identities, never a real-chain recreation.
//
// Resolution of an explicit bb_brand_pack id (see src/brand-pack.ts):
//   1. user-assets/brands/<id>/  if that local pack is installed
//   2. brand-packs/<id>/         if <id> is in this registry
//   3. no pack
// Unknown ids must NOT probe the bundled tree. A local pack with the same
// id as a bundled one wins (override, not merge).

export const BUNDLED_BRAND_PACK_IDS = ['halcyon-jp'] as const;

export type BundledBrandPackId = (typeof BUNDLED_BRAND_PACK_IDS)[number];

export const HALCYON_JP_PACK_ID: BundledBrandPackId = 'halcyon-jp';

export function isBundledBrandPackId(id: string): id is BundledBrandPackId {
  return (BUNDLED_BRAND_PACK_IDS as readonly string[]).includes(id);
}

/** Site-root-relative directory for a registered bundled pack, or null. */
export function bundledBrandPackPublicDir(id: string): string | null {
  return isBundledBrandPackId(id) ? `brand-packs/${id}` : null;
}

/**
 * Explicit Original Halcyon. Written by the Store Identity selector so a
 * simple drop in user-assets/brand/ can be ignored without deleting it.
 * Not a kebab-case pack id — lookup must never probe brands/ or brand-packs/
 * for this value.
 */
export const ORIGINAL_IDENTITY_SENTINEL = '__original__';

export function isOriginalIdentitySentinel(id: string | null | undefined): boolean {
  return (id?.trim() ?? '') === ORIGINAL_IDENTITY_SENTINEL;
}

export type BrandPackLookupPlan =
  | { kind: 'drop' }
  | { kind: 'none' }
  | { kind: 'user-then-bundled'; id: string; userPath: string; bundledPath: string }
  | { kind: 'user-only'; id: string; userPath: string };

/**
 * Where to look for a pack id. `null`/blank is the simple drop (or no pack),
 * never a bundled identity — locale and identity stay independent.
 */
export function brandPackLookupPlan(id: string | null | undefined): BrandPackLookupPlan {
  const trimmed = id?.trim() ?? '';
  if (!trimmed) return { kind: 'drop' };
  if (isOriginalIdentitySentinel(trimmed)) return { kind: 'none' };
  const userPath = `user-assets/brands/${trimmed}/brand.json`;
  if (isBundledBrandPackId(trimmed)) {
    return {
      kind: 'user-then-bundled',
      id: trimmed,
      userPath,
      bundledPath: `brand-packs/${trimmed}/brand.json`,
    };
  }
  return { kind: 'user-only', id: trimmed, userPath };
}

/** Couch-facing built-in identities. Unknown private ids are 'custom'. */
export type BuiltinIdentitySelection = 'original' | 'drop' | 'halcyon-jp' | 'custom';

/**
 * Which built-in identity the selector should highlight.
 * `dropActive` is the loaded simple-drop tier (blank bb_brand_pack + a
 * present user-assets/brand/ logo). Rendering must not write storage.
 */
export function builtinIdentitySelection(
  activePackId: string | null | undefined,
  dropActive = false,
): BuiltinIdentitySelection {
  const id = activePackId?.trim() ?? '';
  if (isOriginalIdentitySentinel(id)) return 'original';
  if (!id) return dropActive ? 'drop' : 'original';
  if (id === HALCYON_JP_PACK_ID) return 'halcyon-jp';
  return 'custom';
}
