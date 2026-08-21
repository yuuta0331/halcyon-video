// Secret-free XR content-class counts. Never log tokens, API keys, or URLs.
//
// Ready means ready. `pending` is never success for an active WORLD_REQUIRED
// class. On-demand classes may stay pending until their activation trigger.

import {
  activeResourceProfile,
  usesCheapResourceProfileName,
  type ResourceProfileName,
} from '../perf/resource-profile.ts';
import {
  contentClassPolicy,
  decorativeXrSafeContentClasses,
  onDemandRequiredContentClasses,
  worldRequiredContentClasses,
  xrSafeClassEnabled,
  type XrContentClass,
  type XrContentRequirement,
} from './content-classes.ts';

export type XrContentState = 'ready' | 'pending' | 'disabled' | 'missing';
export type XrContentActivation = 'idle' | 'requested';

export interface XrContentClassSnapshot {
  allocated: number;
  decoded: number;
  uploaded: number;
  visible: number;
  state: XrContentState;
  requirement: XrContentRequirement;
  activation: XrContentActivation;
  /** Non-empty when this row is an alias of another class's representation. */
  representedBy?: XrContentClass;
  role: 'required' | 'decorative';
}

export interface XrContentSnapshot {
  resourceProfile: ResourceProfileName;
  /** True only when every WORLD_REQUIRED class is actually `ready`. */
  worldReady: boolean;
  /** Alias of worldReady. Does not treat pending as success. */
  requiredReady: boolean;
  onDemandWrapsReady: boolean;
  decorativeDisabled: boolean;
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
  wrapsRequested?: boolean;
  wrapsTitleId?: string | null;
  wrapsRequestGeneration?: number;
  wrapsReadyGeneration?: number;
  signageVisible?: number;
  aisleFasciaVisible?: number;
  brandPackReady?: boolean;
  canvasTexturesAllocated?: number;
  fixtureTexturesVisible?: number;
  storeLogosVisible?: number;
  crtReady?: boolean;
  crtActivated?: boolean;
  floorWallReady?: boolean;
  mediaSurfacesReady?: number;
  mediaActivated?: boolean;
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

/** Test helper: record every WORLD_REQUIRED class as actually displayable. */
export function seedCanonicalWorldReadyForTests(
  over: XrContentLiveCounts = {},
): void {
  live = {
    posterAllocated: 1,
    posterDecoded: 1,
    posterUploaded: 1,
    posterVisible: 1,
    signageVisible: 1,
    aisleFasciaVisible: 1,
    brandPackReady: true,
    canvasTexturesAllocated: 1,
    fixtureTexturesVisible: 1,
    storeLogosVisible: 1,
    floorWallReady: true,
    ...over,
  };
}

export function noteOnDemandWrapRequest(titleId: string): void {
  live = {
    ...live,
    wrapsRequested: true,
    wrapsTitleId: titleId,
    wrapsRequestGeneration: (live.wrapsRequestGeneration ?? 0) + 1,
    wrapsReadyGeneration: 0,
    wrapsUploaded: 0,
    wrapsDecoded: 0,
    wrapsAllocated: 0,
  };
}

export function noteOnDemandWrapUploaded(counts: {
  allocated: number; decoded: number; uploaded: number; visible: number;
}): void {
  live = {
    ...live,
    wrapsAllocated: counts.allocated,
    wrapsDecoded: counts.decoded,
    wrapsUploaded: counts.uploaded,
    wrapsVisible: counts.visible,
    wrapsReadyGeneration: counts.uploaded > 0 ? (live.wrapsRequestGeneration ?? 0) : 0,
  };
}

function requirementOf(cls: XrContentClass): XrContentRequirement {
  return contentClassPolicy(cls)?.requirement ?? 'DECORATIVE';
}

function roleOf(requirement: XrContentRequirement): 'required' | 'decorative' {
  return requirement === 'DECORATIVE' ? 'decorative' : 'required';
}

function worldClassState(
  enabled: boolean,
  counts: { allocated: number; decoded: number; uploaded: number; visible: number },
  opts: { readyIfPresent?: boolean; usesVisible?: boolean } = {},
): XrContentState {
  if (!enabled) return 'disabled';
  const present = opts.readyIfPresent
    ? counts.allocated > 0 || counts.visible > 0 || counts.uploaded > 0
    : opts.usesVisible === false
      ? counts.uploaded > 0 || counts.decoded > 0 || counts.allocated > 0
      : counts.visible > 0 && (counts.uploaded > 0 || counts.allocated > 0);
  if (present) return 'ready';
  if (counts.allocated > 0 || counts.decoded > 0) return 'pending';
  return 'missing';
}

function onDemandState(
  enabled: boolean,
  activated: boolean,
  counts: { allocated: number; decoded: number; uploaded: number; visible: number },
  generation?: { request: number; ready: number },
): XrContentState {
  if (!enabled) return 'disabled';
  if (!activated) return 'pending';
  if (generation && generation.ready !== generation.request) return 'pending';
  if (counts.uploaded > 0) return 'ready';
  return 'pending';
}

function snapWorld(
  cls: XrContentClass,
  counts: { allocated: number; decoded: number; uploaded: number; visible: number },
  profile: ResourceProfileName,
  opts?: { readyIfPresent?: boolean; usesVisible?: boolean },
): XrContentClassSnapshot {
  const enabled = usesCheapResourceProfileName(profile) ? xrSafeClassEnabled(cls) : true;
  const requirement = requirementOf(cls);
  const representedBy = contentClassPolicy(cls)?.representedBy;
  return {
    ...counts,
    state: worldClassState(enabled, counts, opts),
    requirement,
    activation: 'idle',
    representedBy,
    role: roleOf(requirement),
  };
}

function snapOnDemand(
  cls: XrContentClass,
  counts: { allocated: number; decoded: number; uploaded: number; visible: number },
  profile: ResourceProfileName,
  activated: boolean,
  generation?: { request: number; ready: number },
): XrContentClassSnapshot {
  const enabled = usesCheapResourceProfileName(profile) ? xrSafeClassEnabled(cls) : true;
  const requirement = requirementOf(cls);
  return {
    ...counts,
    state: onDemandState(enabled, activated, counts, generation),
    requirement,
    activation: activated ? 'requested' : 'idle',
    role: roleOf(requirement),
  };
}

function snapDecorative(
  cls: XrContentClass,
  profile: ResourceProfileName,
): XrContentClassSnapshot {
  const enabled = usesCheapResourceProfileName(profile) ? xrSafeClassEnabled(cls) : true;
  const requirement = requirementOf(cls);
  return {
    allocated: 0,
    decoded: 0,
    uploaded: 0,
    visible: 0,
    state: enabled ? 'ready' : 'disabled',
    requirement,
    activation: 'idle',
    role: roleOf(requirement),
  };
}

function rowByClass(
  cls: Exclude<XrContentClass, 'decorativeFx'>,
  rows: Omit<XrContentSnapshot, 'resourceProfile' | 'worldReady' | 'requiredReady' | 'onDemandWrapsReady' | 'decorativeDisabled' | 'decorativeFx'>,
): XrContentClassSnapshot {
  return rows[cls];
}

export function xrContentSnapshot(
  profileName: ResourceProfileName = activeResourceProfile().name,
  counts: XrContentLiveCounts = live,
): XrContentSnapshot {
  const poster = snapWorld('poster', {
    allocated: counts.posterAllocated ?? 0,
    decoded: counts.posterDecoded ?? 0,
    uploaded: counts.posterUploaded ?? 0,
    visible: counts.posterVisible ?? 0,
  }, profileName);
  const wrapsActivated = !!counts.wrapsRequested;
  const wraps = snapOnDemand('wraps', {
    allocated: counts.wrapsAllocated ?? 0,
    decoded: counts.wrapsDecoded ?? 0,
    uploaded: counts.wrapsUploaded ?? 0,
    visible: counts.wrapsVisible ?? 0,
  }, profileName, wrapsActivated, {
    request: counts.wrapsRequestGeneration ?? 0,
    ready: counts.wrapsReadyGeneration ?? 0,
  });
  const signageN = counts.signageVisible ?? 0;
  const signage = snapWorld('signage', {
    allocated: signageN, decoded: signageN, uploaded: signageN, visible: signageN,
  }, profileName);
  // Fascia is the same isSign population. Copy signage; never invent ready
  // from a fascia name-prefix of 0 while signs exist.
  const aisleFascia: XrContentClassSnapshot = {
    ...signage,
    requirement: 'WORLD_REQUIRED',
    representedBy: 'signage',
    role: 'required',
  };
  const brandN = counts.brandPackReady ? 1 : 0;
  const brandPack = snapWorld('brandPack', {
    allocated: brandN, decoded: brandN, uploaded: brandN, visible: brandN,
  }, profileName, { readyIfPresent: true, usesVisible: false });
  const canvasN = counts.canvasTexturesAllocated ?? 0;
  const canvasTextures = snapWorld('canvasTextures', {
    allocated: canvasN, decoded: canvasN, uploaded: canvasN, visible: canvasN,
  }, profileName, { usesVisible: false });
  const fixN = counts.fixtureTexturesVisible ?? 0;
  const fixtureTextures = snapWorld('fixtureTextures', {
    allocated: fixN, decoded: fixN, uploaded: fixN, visible: fixN,
  }, profileName);
  const logoN = counts.storeLogosVisible ?? 0;
  const storeLogos = snapWorld('storeLogos', {
    allocated: logoN, decoded: logoN, uploaded: logoN, visible: logoN,
  }, profileName);
  const crtActivated = !!counts.crtActivated;
  const crtN = counts.crtReady ? 1 : 0;
  const crt = snapOnDemand('crt', {
    allocated: crtN, decoded: crtN, uploaded: crtN, visible: crtN,
  }, profileName, crtActivated);
  const floorN = counts.floorWallReady ? 1 : 0;
  const floorWallMaterials = snapWorld('floorWallMaterials', {
    allocated: floorN, decoded: floorN, uploaded: floorN, visible: floorN,
  }, profileName, { readyIfPresent: true });
  const mediaActivated = !!counts.mediaActivated || (counts.mediaSurfacesReady ?? 0) > 0;
  const mediaN = counts.mediaSurfacesReady ?? 0;
  const mediaSurfaces = snapOnDemand('mediaSurfaces', {
    allocated: mediaN, decoded: mediaN, uploaded: mediaN, visible: mediaN,
  }, profileName, mediaActivated);
  const decorativeFx = snapDecorative('decorativeFx', profileName);

  const rows = {
    poster, wraps, signage, aisleFascia, brandPack, canvasTextures,
    fixtureTextures, storeLogos, crt, floorWallMaterials, mediaSurfaces,
  };

  const worldReady = worldRequiredContentClasses().every((cls) => {
    const row = cls === 'aisleFascia' ? aisleFascia : rowByClass(cls as Exclude<XrContentClass, 'decorativeFx'>, rows);
    return row.state === 'ready';
  });

  return {
    resourceProfile: profileName,
    worldReady,
    requiredReady: worldReady,
    onDemandWrapsReady: wraps.activation === 'requested' && wraps.state === 'ready',
    decorativeDisabled: decorativeXrSafeContentClasses().every((cls) => {
      if (cls === 'decorativeFx') return decorativeFx.state === 'disabled' || !usesCheapResourceProfileName(profileName);
      return true;
    }) && (!usesCheapResourceProfileName(profileName) || decorativeFx.state === 'disabled'),
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

export function worldRequiredReady(snapshot: XrContentSnapshot): boolean {
  return snapshot.worldReady;
}

export function onDemandReady(
  snapshot: XrContentSnapshot,
  cls: XrContentClass,
): boolean {
  if (!onDemandRequiredContentClasses().includes(cls)) return false;
  const row = snapshot[cls as keyof XrContentSnapshot];
  if (!row || typeof row !== 'object' || !('state' in row)) return false;
  return row.activation === 'requested' && row.state === 'ready';
}

export function decorativeExpectedDisabled(snapshot: XrContentSnapshot): boolean {
  return snapshot.resourceProfile !== 'XR_SAFE' || snapshot.decorativeFx.state === 'disabled';
}

/** Visible world chrome used for navigation. Pending is not success. */
export function requiredContentVisible(snapshot: XrContentSnapshot): boolean {
  return snapshot.poster.state === 'ready' && snapshot.poster.visible > 0
    && snapshot.signage.state === 'ready' && snapshot.signage.visible > 0
    && snapshot.canvasTextures.state === 'ready'
    && snapshot.floorWallMaterials.state === 'ready';
}

/** World-usable XR_SAFE store: every WORLD_REQUIRED class is ready. */
export function requiredWorldContentParity(snapshot: XrContentSnapshot): boolean {
  if (!decorativeExpectedDisabled(snapshot)) return false;
  return snapshot.worldReady;
}
