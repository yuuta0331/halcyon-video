// XR_SAFE may disable expensive visual EFFECTS. It must not drop CONTENT
// required to read and use the rental store. This module is the inventory.
//
// Requirement is a lifecycle, not a boolean "required vs decorative":
//   WORLD_REQUIRED      — must be ready before the store is world-usable
//   ON_DEMAND_REQUIRED  — must become ready after its activation trigger
//   DECORATIVE          — intentionally off under XR_SAFE

export type XrContentClass =
  | 'poster'
  | 'wraps'
  | 'signage'
  | 'aisleFascia'
  | 'brandPack'
  | 'canvasTextures'
  | 'fixtureTextures'
  | 'storeLogos'
  | 'crt'
  | 'floorWallMaterials'
  | 'mediaSurfaces'
  | 'decorativeFx';

export type XrContentRequirement = 'WORLD_REQUIRED' | 'ON_DEMAND_REQUIRED' | 'DECORATIVE';

/** @deprecated Use XrContentRequirement. Kept as a coarse filter. */
export type XrContentRole = 'required' | 'decorative';

export interface XrContentClassPolicy {
  cls: XrContentClass;
  requirement: XrContentRequirement;
  desktopFull: boolean;
  xrSafe: boolean;
  /**
   * When set, this class is not counted from its own name-prefix heuristic.
   * Aisle fascia lettering is the same `userData.isSign` meshes as signage.
   */
  representedBy?: XrContentClass;
  reason: string;
}

const CLASSES: XrContentClassPolicy[] = [
  {
    cls: 'poster',
    requirement: 'WORLD_REQUIRED',
    desktopFull: true,
    xrSafe: true,
    reason: 'Shelf face art working set. XR_SAFE uses a 128-slot unique-title window.',
  },
  {
    cls: 'wraps',
    requirement: 'ON_DEMAND_REQUIRED',
    desktopFull: true,
    xrSafe: true,
    reason: 'Selected-title sleeve / spine / back. Prefetched on select, not at boot.',
  },
  {
    cls: 'signage',
    requirement: 'WORLD_REQUIRED',
    desktopFull: true,
    xrSafe: true,
    reason: 'Overhead category signs (`userData.isSign`). Required to navigate the store.',
  },
  {
    cls: 'aisleFascia',
    requirement: 'WORLD_REQUIRED',
    desktopFull: true,
    xrSafe: true,
    representedBy: 'signage',
    reason: 'Genre / aisle fascia is the same isSign lettering as signage, not a separate name-prefix mesh class.',
  },
  {
    cls: 'brandPack',
    requirement: 'WORLD_REQUIRED',
    desktopFull: true,
    xrSafe: true,
    reason: 'Store identity images. Separate from locale chrome.',
  },
  {
    cls: 'canvasTextures',
    requirement: 'WORLD_REQUIRED',
    desktopFull: true,
    xrSafe: true,
    reason: 'Procedural store surfaces (carpet, walls, ceiling, labels).',
  },
  {
    cls: 'fixtureTextures',
    requirement: 'WORLD_REQUIRED',
    desktopFull: true,
    xrSafe: true,
    reason: 'Display fixtures, bins, letterboards, promo stands.',
  },
  {
    cls: 'storeLogos',
    requirement: 'WORLD_REQUIRED',
    desktopFull: true,
    xrSafe: true,
    reason: 'Storefront and in-store logo marks.',
  },
  {
    cls: 'crt',
    requirement: 'ON_DEMAND_REQUIRED',
    desktopFull: true,
    xrSafe: true,
    reason: 'Counter CRT terminal. Lazy / activation-driven; XR settings UI does not need it.',
  },
  {
    cls: 'floorWallMaterials',
    requirement: 'WORLD_REQUIRED',
    desktopFull: true,
    xrSafe: true,
    reason: 'Floor / wall / shell materials. Effects (AO, shadows) stay off.',
  },
  {
    cls: 'mediaSurfaces',
    requirement: 'ON_DEMAND_REQUIRED',
    desktopFull: true,
    xrSafe: true,
    reason: 'Ceiling TV / CRT picture as a mesh VideoTexture. Bound on activation; XRMediaBinding stays off.',
  },
  {
    cls: 'decorativeFx',
    requirement: 'DECORATIVE',
    desktopFull: true,
    xrSafe: false,
    reason: 'N8AO/GTAO, composer, live mirrors, reflection probes, full env bake, case clearcoat maps.',
  },
];

export function xrContentClassPolicies(): readonly XrContentClassPolicy[] {
  return CLASSES;
}

export function contentClassPolicy(cls: XrContentClass): XrContentClassPolicy | undefined {
  return CLASSES.find((c) => c.cls === cls);
}

export function worldRequiredContentClasses(): XrContentClass[] {
  return CLASSES.filter((c) => c.requirement === 'WORLD_REQUIRED').map((c) => c.cls);
}

export function onDemandRequiredContentClasses(): XrContentClass[] {
  return CLASSES.filter((c) => c.requirement === 'ON_DEMAND_REQUIRED').map((c) => c.cls);
}

export function decorativeXrSafeContentClasses(): XrContentClass[] {
  return CLASSES.filter((c) => c.requirement === 'DECORATIVE').map((c) => c.cls);
}

/** Classes that must be enabled in XR_SAFE (world + on-demand content). */
export function requiredXrSafeContentClasses(): XrContentClass[] {
  return CLASSES.filter((c) => c.requirement !== 'DECORATIVE').map((c) => c.cls);
}

export function xrSafeClassEnabled(cls: XrContentClass): boolean {
  return CLASSES.find((c) => c.cls === cls)?.xrSafe === true;
}

export function desktopClassEnabled(cls: XrContentClass): boolean {
  return CLASSES.find((c) => c.cls === cls)?.desktopFull === true;
}

/** Name-prefix classifier for optional scene-graph counts. Secret-free. */
export function classifyObjectName(name: string): XrContentClass | null {
  const n = name.toLowerCase();
  if (!n) return null;
  if (n.includes('wrap') || n.includes('spine') || n.includes('sleeve') || n.includes('hero')) {
    return 'wraps';
  }
  if (n.includes('poster')) return 'poster';
  if (n.includes('sign') || n.includes('letterboard') || n.includes('hanger')) return 'signage';
  if (n.includes('fascia') || n.includes('topper') || n.includes('genre')) return 'aisleFascia';
  if (n.includes('logo') || n.includes('storefront')) return 'storeLogos';
  if (n.includes('crt') || n.includes('terminal')) return 'crt';
  if (n.includes('tv') || n.includes('video') || n.includes('media')) return 'mediaSurfaces';
  if (n.includes('carpet') || n.includes('wall') || n.includes('ceiling') || n.includes('floor')) {
    return 'floorWallMaterials';
  }
  if (n.includes('fixture') || n.includes('prop') || n.includes('riser') || n.includes('bin')
    || n.includes('drape-table') || n.includes('endcap') || n.includes('display')) {
    return 'fixtureTextures';
  }
  if (n.includes('brand')) return 'brandPack';
  return null;
}
