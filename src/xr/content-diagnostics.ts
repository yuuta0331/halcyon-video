// Secret-free XR content-class counts. Never log tokens, API keys, or URLs.

import {
  activeResourceProfile,
  type ResourceProfileName,
} from '../perf/resource-profile.ts';
import {
  decorativeXrSafeContentClasses,
  requiredXrSafeContentClasses,
  xrSafeClassEnabled,
  type XrContentClass,
} from './content-classes.ts';

export type XrContentState = 'ready' | 'pending' | 'disabled' | 'missing';

export interface XrContentClassSnapshot {
  allocated: number;
  decoded: number;
  uploaded: number;
  visible: number;
  state: XrContentState;
  role: 'required' | 'decorative';
}

export interface XrContentSnapshot {
  resourceProfile: ResourceProfileName;
  requiredReady: boolean;
  poster: XrContentClassSnapshot;
  wraps: XrContentClassSnapshot;
  signage: XrContentClassSnapshot;
  aisleFascia: XrContentClassSnapshot;
  brandPack: XrContentClassSnapshot;
  canvasTextures: XrContentClassSnapshot;
  fixtureTextures: XrContentClassSnapshot;
  storeLogos: XrContentClassSnapshot;
  crt: XrContentClassSnapshot;
  floorWallMaterials: XrContentClassSnapshot;
  mediaSurfaces: XrContentClassSnapshot;
  decorativeFx: XrContentClassSnapshot;
}

export interface XrContentLiveCounts {
  posterAllocated?: number;
  posterDecoded?: number;
  posterUploaded?: number;
  posterVisible?: number;
  wrapsAllocated?: number;
  wrapsDecoded?: number;
  wrapsUploaded?: number;
  wrapsVisible?: number;
  signageVisible?: number;
  aisleFasciaVisible?: number;
  brandPackReady?: boolean;
  canvasTexturesAllocated?: number;
  fixtureTexturesVisible?: number;
  storeLogosVisible?: number;
  crtReady?: boolean;
  floorWallReady?: boolean;
  mediaSurfacesReady?: number;
  environmentReady?: boolean;
}

let live: XrContentLiveCounts = {};

export function setXrContentLiveState(next: XrContentLiveCounts): void {
  live = { ...live, ...next };
}

export function xrContentLiveState(): XrContentLiveCounts {
  return live;
}

export function resetXrContentLiveStateForTests(): void {
  live = {};
}

function snap(
  cls: XrContentClass,
  counts: { allocated: number; decoded: number; uploaded: number; visible: number },
  profile: ResourceProfileName,
): XrContentClassSnapshot {
  const enabled = profile === 'XR_SAFE' ? xrSafeClassEnabled(cls) : true;
  const role = decorativeXrSafeContentClasses().includes(cls) ? 'decorative' : 'required';
  let state: XrContentState = 'ready';
  if (!enabled) state = 'disabled';
  else if (counts.allocated <= 0 && counts.visible <= 0) state = role === 'required' ? 'pending' : 'disabled';
  else if (counts.visible <= 0 || counts.uploaded < counts.decoded) state = 'pending';
  return { ...counts, state, role };
}

export function xrContentSnapshot(
  profileName: ResourceProfileName = activeResourceProfile().name,
  counts: XrContentLiveCounts = live,
): XrContentSnapshot {
  const poster = snap('poster', {
    allocated: counts.posterAllocated ?? 0,
    decoded: counts.posterDecoded ?? 0,
    uploaded: counts.posterUploaded ?? 0,
    visible: counts.posterVisible ?? 0,
  }, profileName);
  const wraps = snap('wraps', {
    allocated: counts.wrapsAllocated ?? 0,
    decoded: counts.wrapsDecoded ?? 0,
    uploaded: counts.wrapsUploaded ?? 0,
    visible: counts.wrapsVisible ?? 0,
  }, profileName);
  const signageN = counts.signageVisible ?? 0;
  const signage = snap('signage', {
    allocated: signageN, decoded: signageN, uploaded: signageN, visible: signageN,
  }, profileName);
  const fasciaN = counts.aisleFasciaVisible ?? 0;
  const aisleFascia = snap('aisleFascia', {
    allocated: fasciaN, decoded: fasciaN, uploaded: fasciaN, visible: fasciaN,
  }, profileName);
  const brandN = counts.brandPackReady ? 1 : 0;
  const brandPack = snap('brandPack', {
    allocated: brandN, decoded: brandN, uploaded: brandN, visible: brandN,
  }, profileName);
  const canvasN = counts.canvasTexturesAllocated ?? 0;
  const canvasTextures = snap('canvasTextures', {
    allocated: canvasN, decoded: canvasN, uploaded: canvasN, visible: canvasN,
  }, profileName);
  const fixN = counts.fixtureTexturesVisible ?? 0;
  const fixtureTextures = snap('fixtureTextures', {
    allocated: fixN, decoded: fixN, uploaded: fixN, visible: fixN,
  }, profileName);
  const logoN = counts.storeLogosVisible ?? 0;
  const storeLogos = snap('storeLogos', {
    allocated: logoN, decoded: logoN, uploaded: logoN, visible: logoN,
  }, profileName);
  const crtN = counts.crtReady ? 1 : 0;
  const crt = snap('crt', {
    allocated: crtN, decoded: crtN, uploaded: crtN, visible: crtN,
  }, profileName);
  const floorN = counts.floorWallReady ? 1 : 0;
  const floorWallMaterials = snap('floorWallMaterials', {
    allocated: floorN, decoded: floorN, uploaded: floorN, visible: floorN,
  }, profileName);
  const mediaN = counts.mediaSurfacesReady ?? 0;
  const mediaSurfaces = snap('mediaSurfaces', {
    allocated: mediaN, decoded: mediaN, uploaded: mediaN, visible: mediaN,
  }, profileName);
  const decorativeFx = snap('decorativeFx', {
    allocated: 0, decoded: 0, uploaded: 0, visible: 0,
  }, profileName);

  const requiredReady = requiredXrSafeContentClasses().every((cls) => {
    if (cls === 'decorativeFx') return true;
    const row = {
      poster, wraps, signage, aisleFascia, brandPack, canvasTextures,
      fixtureTextures, storeLogos, crt, floorWallMaterials, mediaSurfaces,
    }[cls as Exclude<XrContentClass, 'decorativeFx'>];
    return row.state === 'ready' || row.state === 'pending';
  });

  return {
    resourceProfile: profileName,
    requiredReady,
    poster,
    wraps,
    signage,
    aisleFascia,
    brandPack,
    canvasTextures,
    fixtureTextures,
    storeLogos,
    crt,
    floorWallMaterials,
    mediaSurfaces,
    decorativeFx,
  };
}

export function requiredContentVisible(snapshot: XrContentSnapshot): boolean {
  const mustSee: Array<keyof XrContentSnapshot> = [
    'poster', 'signage', 'canvasTextures', 'floorWallMaterials',
  ];
  return mustSee.every((cls) => {
    const row = snapshot[cls];
    return typeof row === 'object' && 'visible' in row && row.visible > 0 && row.state !== 'disabled';
  });
}

/** World-usable XR_SAFE store. Wraps may stay pending until select (not JP-4B inspect). */
export function requiredWorldContentParity(snapshot: XrContentSnapshot): boolean {
  if (snapshot.resourceProfile === 'XR_SAFE' && snapshot.decorativeFx.state !== 'disabled') {
    return false;
  }
  if (snapshot.poster.state === 'disabled' || snapshot.poster.visible <= 0) return false;
  if (snapshot.canvasTextures.state === 'disabled') return false;
  if (snapshot.canvasTextures.visible <= 0 && snapshot.floorWallMaterials.visible <= 0) return false;
  if (snapshot.signage.state === 'disabled') return false;
  return snapshot.signage.visible > 0 || snapshot.aisleFascia.visible > 0 || snapshot.storeLogos.visible > 0;
}
