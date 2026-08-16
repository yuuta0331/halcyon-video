// XR_SAFE may disable expensive visual EFFECTS. It must not drop CONTENT
// required to read and use the rental store. This module is the inventory.

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

export type XrContentRole = 'required' | 'decorative';

export interface XrContentClassPolicy {
  cls: XrContentClass;
  role: XrContentRole;
  desktopFull: boolean;
  xrSafe: boolean;
  reason: string;
}

const CLASSES: XrContentClassPolicy[] = [
  {
    cls: 'poster',
    role: 'required',
    desktopFull: true,
    xrSafe: true,
    reason: 'Shelf face art. XR_SAFE uses a 128-slot unique-title window.',
  },
  {
    cls: 'wraps',
    role: 'required',
    desktopFull: true,
    xrSafe: true,
    reason: 'Case sleeve / spine / back print. Required to identify a title in hand.',
  },
  {
    cls: 'signage',
    role: 'required',
    desktopFull: true,
    xrSafe: true,
    reason: 'Overhead category signs. Required to navigate the store.',
  },
  {
    cls: 'aisleFascia',
    role: 'required',
    desktopFull: true,
    xrSafe: true,
    reason: 'Aisle / genre fascia lettering.',
  },
  {
    cls: 'brandPack',
    role: 'required',
    desktopFull: true,
    xrSafe: true,
    reason: 'Store identity images. Separate from locale chrome.',
  },
  {
    cls: 'canvasTextures',
    role: 'required',
    desktopFull: true,
    xrSafe: true,
    reason: 'Procedural store surfaces (carpet, walls, ceiling, labels).',
  },
  {
    cls: 'fixtureTextures',
    role: 'required',
    desktopFull: true,
    xrSafe: true,
    reason: 'Display fixtures, bins, letterboards, promo stands.',
  },
  {
    cls: 'storeLogos',
    role: 'required',
    desktopFull: true,
    xrSafe: true,
    reason: 'Storefront and in-store logo marks.',
  },
  {
    cls: 'crt',
    role: 'required',
    desktopFull: true,
    xrSafe: true,
    reason: 'Counter CRT terminal surface. Settings are also reachable from XR UI.',
  },
  {
    cls: 'floorWallMaterials',
    role: 'required',
    desktopFull: true,
    xrSafe: true,
    reason: 'Floor / wall / shell materials. Effects (AO, shadows) stay off.',
  },
  {
    cls: 'mediaSurfaces',
    role: 'required',
    desktopFull: true,
    xrSafe: true,
    reason: 'Ceiling TV / CRT picture as a mesh VideoTexture. XRMediaBinding stays off.',
  },
  {
    cls: 'decorativeFx',
    role: 'decorative',
    desktopFull: true,
    xrSafe: false,
    reason: 'N8AO/GTAO, composer, live mirrors, reflection probes, full env bake, case clearcoat maps.',
  },
];

export function xrContentClassPolicies(): readonly XrContentClassPolicy[] {
  return CLASSES;
}

export function requiredXrSafeContentClasses(): XrContentClass[] {
  return CLASSES.filter((c) => c.role === 'required').map((c) => c.cls);
}

export function decorativeXrSafeContentClasses(): XrContentClass[] {
  return CLASSES.filter((c) => c.role === 'decorative').map((c) => c.cls);
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
  if (n.includes('fixture') || n.includes('prop') || n.includes('riser') || n.includes('bin')) {
    return 'fixtureTextures';
  }
  if (n.includes('brand')) return 'brandPack';
  return null;
}
