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

export type BrandPackLookupPlan =
  | { kind: 'drop' }
  | { kind: 'user-then-bundled'; id: string; userPath: string; bundledPath: string }
  | { kind: 'user-only'; id: string; userPath: string };

/**
 * Where to look for a pack id. `null`/blank is the simple drop (or no pack),
 * never a bundled identity — locale and identity stay independent.
 */
export function brandPackLookupPlan(id: string | null | undefined): BrandPackLookupPlan {
  const trimmed = id?.trim() ?? '';
  if (!trimmed) return { kind: 'drop' };
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
export type BuiltinIdentitySelection = 'original' | 'halcyon-jp' | 'custom';

export function builtinIdentitySelection(activePackId: string | null | undefined): BuiltinIdentitySelection {
  const id = activePackId?.trim() ?? '';
  if (!id) return 'original';
  if (id === HALCYON_JP_PACK_ID) return 'halcyon-jp';
  return 'custom';
}
