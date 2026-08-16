// Device resource profile. Selected AFTER the WebGLRenderer exists and
// BEFORE poster arrays, composer targets, AO, probes, mirrors, or environment
// bakes are allocated. XR_SAFE is a resource graph, not a late XR boolean.

export type ResourceProfileName = 'DESKTOP_FULL' | 'XR_SAFE';

export interface GpuCapabilities {
  maxTextures: number;
  maxTextureSize: number;
  maxCubemapSize: number;
  maxArrayTextureLayers: number;
  maxRenderbufferSize: number;
  maxSamples: number;
  rendererName: string;
}

export interface ResourceFlags {
  bare: boolean;
  safe: boolean;
  desktopQuality: boolean;
  emu: boolean;
  catalog: number | null;
  posterProbe: boolean;
}

export interface PosterPolicy {
  mode: 'catalog-wide-progressive' | 'bounded-residency' | 'stable-store-visible';
  physicalSlots: number;
  shelfWidth: number;
  shelfHeight: number;
  dualArrays: boolean;
  heroCacheBytes: number;
  shelfCacheBytes: number;
}

export interface ResourceProfile {
  name: ResourceProfileName;
  composer: boolean;
  n8ao: boolean;
  gtao: boolean;
  bokeh: boolean;
  bloom: boolean;
  shadows: boolean;
  liveMirrors: boolean;
  reflectionProbes: boolean;
  environmentBake: 'full' | 'bootstrap';
  environmentBakeResolution: number;
  environmentBounceCount: number;
  xrCompositionLayers: boolean;
  xrMediaLayer: boolean;
  cheapMaterials: boolean;
  singleShelfPosterSampler: boolean;
  framebufferScale: number;
  foveation: number;
  poster: PosterPolicy;
  estimatedFragmentSamplers: number;
}

const DESKTOP_HERO_CACHE = 256 * 1024 * 1024;
const DESKTOP_SHELF_CACHE = 64 * 1024 * 1024;
const XR_HERO_CACHE = 48 * 1024 * 1024;
const XR_SHELF_CACHE = 24 * 1024 * 1024;

const XR_SAFE_FRAMEBUFFER_SCALE = 0.8;
const XR_SAFE_FOVEATION = 0.5;
const DESKTOP_XR_FRAMEBUFFER_SCALE = 0.7;

let active: ResourceProfile | null = null;
let activeCaps: GpuCapabilities | null = null;

export function readResourceFlags(
  search: string = typeof location !== 'undefined' ? location.search : '',
): ResourceFlags {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const catalogRaw = q.get('xrCatalog');
  const catalog = catalogRaw ? Number(catalogRaw) : NaN;
  return {
    bare: q.get('xrBare') === '1',
    safe: q.get('xrSafe') === '1',
    desktopQuality: q.get('xrDesktopQuality') === '1',
    emu: q.get('xrEmu') === '1',
    catalog: Number.isFinite(catalog) && catalog > 0 ? Math.floor(catalog) : null,
    posterProbe: q.get('xrPosterProbe') === '1',
  };
}

export function isQuestBrowserUa(ua: string): boolean {
  return /Quest/i.test(ua) || /OculusBrowser/i.test(ua);
}

export function blankGpuCapabilities(overrides: Partial<GpuCapabilities> = {}): GpuCapabilities {
  return {
    maxTextures: 16,
    maxTextureSize: 4096,
    maxCubemapSize: 4096,
    maxArrayTextureLayers: 256,
    maxRenderbufferSize: 4096,
    maxSamples: 4,
    rendererName: 'unknown',
    ...overrides,
  };
}

export function readGpuCapabilities(input: {
  maxTextures?: number;
  gl?: {
    getParameter(pname: number): unknown;
    getExtension?(name: string): { UNMASKED_RENDERER_WEBGL?: number } | null;
    RENDERER: number;
    MAX_TEXTURE_IMAGE_UNITS: number;
    MAX_TEXTURE_SIZE: number;
    MAX_CUBE_MAP_TEXTURE_SIZE: number;
    MAX_ARRAY_TEXTURE_LAYERS: number;
    MAX_RENDERBUFFER_SIZE: number;
    MAX_SAMPLES: number;
  } | null;
}): GpuCapabilities {
  const gl = input.gl;
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && v > 0 ? v : fallback;
  let rendererName = 'unknown';
  if (gl) {
    try {
      const ext = gl.getExtension?.('WEBGL_debug_renderer_info');
      const raw = ext?.UNMASKED_RENDERER_WEBGL != null
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      if (typeof raw === 'string' && raw) rendererName = raw;
    } catch { /* capability query must stay non-fatal */ }
  }
  return {
    maxTextures: input.maxTextures
      ?? num(gl?.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), 16),
    maxTextureSize: num(gl?.getParameter(gl.MAX_TEXTURE_SIZE), 4096),
    maxCubemapSize: num(gl?.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE), 4096),
    maxArrayTextureLayers: num(gl?.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS), 256),
    maxRenderbufferSize: num(gl?.getParameter(gl.MAX_RENDERBUFFER_SIZE), 4096),
    maxSamples: num(gl?.getParameter(gl.MAX_SAMPLES), 4),
    rendererName,
  };
}

/**
 * Layers per DataArrayTexture bank. Catalog-visible titles that exceed one
 * bank use additional stable banks — never a runtime LRU window.
 */
export function choosePhysicalPosterSlots(caps: GpuCapabilities): number {
  return Math.max(1, Math.min(2048, caps.maxArrayTextureLayers));
}

export function estimateXrSafeFragmentSamplers(): number {
  // MeshStandardMaterial: map + envMap + loaded-flag LUT + one shelf bank.
  // Catalog banks are swapped per draw; they do not consume extra samplers.
  // Shadows off. No clearcoat / transmission / AO / dual-resolution preview.
  return 4;
}

export function desktopFullProfile(): ResourceProfile {
  return {
    name: 'DESKTOP_FULL',
    composer: true,
    n8ao: true,
    gtao: true,
    bokeh: true,
    bloom: true,
    shadows: true,
    liveMirrors: true,
    reflectionProbes: true,
    environmentBake: 'full',
    environmentBakeResolution: 512,
    environmentBounceCount: 3,
    xrCompositionLayers: true,
    xrMediaLayer: true,
    cheapMaterials: false,
    singleShelfPosterSampler: false,
    framebufferScale: DESKTOP_XR_FRAMEBUFFER_SCALE,
    foveation: 0,
    poster: {
      mode: 'catalog-wide-progressive',
      physicalSlots: 0,
      shelfWidth: 160,
      shelfHeight: 240,
      dualArrays: true,
      heroCacheBytes: DESKTOP_HERO_CACHE,
      shelfCacheBytes: DESKTOP_SHELF_CACHE,
    },
    estimatedFragmentSamplers: 32,
  };
}

export function xrSafeProfile(caps: GpuCapabilities): ResourceProfile {
  const slots = choosePhysicalPosterSlots(caps);
  return {
    name: 'XR_SAFE',
    composer: false,
    n8ao: false,
    gtao: false,
    bokeh: false,
    bloom: false,
    shadows: false,
    liveMirrors: false,
    reflectionProbes: false,
    environmentBake: 'bootstrap',
    environmentBakeResolution: 0,
    environmentBounceCount: 0,
    xrCompositionLayers: false,
    xrMediaLayer: false,
    cheapMaterials: true,
    singleShelfPosterSampler: true,
    framebufferScale: XR_SAFE_FRAMEBUFFER_SCALE,
    foveation: XR_SAFE_FOVEATION,
    poster: {
      mode: 'stable-store-visible',
      physicalSlots: slots,
      shelfWidth: 96,
      shelfHeight: 144,
      dualArrays: false,
      heroCacheBytes: XR_HERO_CACHE,
      shelfCacheBytes: XR_SHELF_CACHE,
    },
    estimatedFragmentSamplers: estimateXrSafeFragmentSamplers(),
  };
}

export function selectResourceProfile(input: {
  caps: GpuCapabilities;
  flags?: ResourceFlags;
  userAgent?: string;
  isTauri?: boolean;
}): ResourceProfile {
  const flags = input.flags ?? readResourceFlags('');
  if (input.isTauri || flags.desktopQuality) return desktopFullProfile();
  const ua = input.userAgent ?? '';
  const questLike = isQuestBrowserUa(ua);
  const questEmu = flags.emu;
  if (flags.safe || flags.bare || flags.posterProbe || questLike || questEmu) {
    return xrSafeProfile(input.caps);
  }
  return desktopFullProfile();
}

export function setActiveResourceProfile(
  profile: ResourceProfile,
  caps: GpuCapabilities | null = null,
): ResourceProfile {
  active = profile;
  if (caps) activeCaps = caps;
  return profile;
}

export function activeResourceProfile(): ResourceProfile {
  return active ?? desktopFullProfile();
}

export function activeGpuCapabilities(): GpuCapabilities | null {
  return activeCaps;
}

export function isXrSafeProfile(profile: ResourceProfile = activeResourceProfile()): boolean {
  return profile.name === 'XR_SAFE';
}

export function resetResourceProfileForTests(): void {
  active = null;
  activeCaps = null;
}
