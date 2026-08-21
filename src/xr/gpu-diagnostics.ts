// Secret-free GPU / XR resource diagnostics. Snapshots persist across the
// Quest waiting-environment so a hung immersive session can still be read.

import {
  activeGpuCapabilities,
  activeResourceProfile,
  type GpuCapabilities,
} from '../perf/resource-profile.ts';
import { testPosterArrayLayerCeiling } from '../perf/test-array-layer-ceiling.ts';
import { estimatePosterArrayBytes } from '../poster-residency.ts';
import { xrContentSnapshot, type XrContentSnapshot } from './content-diagnostics.ts';

export type ResourceSnapshotStage =
  | 'renderer-created'
  | 'store-before-heavy-resources'
  | 'store-ready'
  | 'pre-requestSession'
  | 'requestSession-resolved'
  | 'pre-setSession'
  | 'setSession-resolved'
  | 'first-XR-callback'
  | 'first-bare-render'
  | 'first-store-XR-render'
  | '10-XR-frames'
  | 'XR-exit';

export interface ContextLossRecord {
  timestamp: number;
  stage: string;
  rendererPresenting: boolean;
  isContextLost: boolean;
  resourceProfile: string;
  posterArrayCpuBytesEstimated: number;
  posterArrayGpuBytesEstimated: number;
  capabilities: GpuCapabilities | null;
}

export interface GpuDiagnostics {
  classification: string;
  resourceProfile: string;
  rendererName: string | null;
  maxTextures: number | null;
  maxTextureSize: number | null;
  maxCubemapSize: number | null;
  maxArrayTextureLayers: number | null;
  effectiveTestMaxArrayTextureLayers: number | null;
  hardwareMaxArrayTextureLayers: number | null;
  maxRenderbufferSize: number | null;
  maxSamples: number | null;
  rendererTextures: number | null;
  rendererGeometries: number | null;
  rendererPrograms: number | null;
  posterCatalogTitles: number | null;
  posterExpectedTitles: number | null;
  posterLogicalMappedTitles: number | null;
  posterActuallyRenderableTitles: number | null;
  posterResidentTitles: number | null;
  posterBankCount: number | null;
  posterLayersPerBank: number | null;
  posterRenderBatchCount: number | null;
  posterSourceMeshCount: number | null;
  posterSamplersPerDraw: number | null;
  posterBaseWidth: number | null;
  posterBaseHeight: number | null;
  posterCpuBytesEstimated: number | null;
  posterCpuBytesActive: number | null;
  posterCpuBytesAllocated: number | null;
  posterGpuBytesEstimated: number | null;
  posterCapacityInvariantOk: boolean | null;
  posterPhysicalSlots: number | null;
  posterFreeSlots: number | null;
  posterResidencyInvariantOk: boolean | null;
  posterDuplicatePhysicalOwners: number | null;
  posterFreeOwnedCollisions: number | null;
  posterOrphanMovieMappings: number | null;
  posterOrphanSlotMappings: number | null;
  posterResidentHighWaterMark: number | null;
  posterEvictionCount: number | null;
  posterAcquisitionCount: number | null;
  posterReacquisitionCount: number | null;
  posterWorkingSetUpdates: number | null;
  posterWorkingSetVersion: number | null;
  posterDesiredCount: number | null;
  posterPinnedCount: number | null;
  bootPinsActive: boolean | null;
  bootPinsReleasedAt: number | null;
  posterInitialP0Count: number | null;
  posterInitialP1ResidentCount: number | null;
  posterEnteredWorkingSetCount: number | null;
  posterLeftWorkingSetCount: number | null;
  posterDecodeJobsStarted: number | null;
  posterStaleUploadDrops: number | null;
  p0UniqueTitles: number | null;
  p1UniqueTitles: number | null;
  p2UniqueTitles: number | null;
  p3UniqueTitles: number | null;
  p0PlusP1UniqueTitles: number | null;
  posterArrayCpuBytesEstimated: number | null;
  posterArrayGpuBytesEstimated: number | null;
  posterCpuCacheBytes: number | null;
  posterCpuCacheBudget: number | null;
  posterCpuCacheHits: number | null;
  posterCpuCacheMisses: number | null;
  composerAllocated: boolean;
  n8aoAllocated: boolean;
  gtaoAllocated: boolean;
  shadowEnabled: boolean;
  mirrorCount: number;
  reflectionProbeCount: number;
  environmentBakeResolution: number;
  environmentBounceCount: number;
  xrFramebufferScaleRequested: number;
  xrFoveationRequested: number;
  xrFoveationEffective: number | null;
  xrPhase: string | null;
  xrFrameCount: number;
  firstWorldRenderCompletedAt: number | null;
  firstStoreXrRenderAt: number | null;
  contextLost: boolean;
  lastContextLossAt: number | null;
  lastError: string | null;
  xrContent: XrContentSnapshot;
  snapshots: Record<string, unknown>;
}

const XR_FAIL_KEY = 'halcyon-last-xr-failure';

const snapshots = new Map<ResourceSnapshotStage, Record<string, unknown>>();
let lastContextLoss: ContextLossRecord | null = null;
let lastError: string | null = null;
let xrStage = 'idle';
let xrPhase: string | null = null;
let xrFrameCount = 0;
let firstWorldRenderCompletedAt: number | null = null;
let firstStoreXrRenderAt: number | null = null;
let foveationEffective: number | null = null;
let classification = 'DESKTOP_BROWSER';

export interface GpuLiveState {
  renderer?: {
    info?: { memory?: { textures?: number; geometries?: number }; programs?: { length: number } | null };
    shadowMap?: { enabled?: boolean };
    getContext?: () => { isContextLost?: () => boolean };
  } | null;
  composerAllocated?: boolean;
  n8aoAllocated?: boolean;
  gtaoAllocated?: boolean;
  mirrorCount?: number;
  reflectionProbeCount?: number;
  poster?: {
    catalogTitleCount: number;
    physicalSlots: number;
    residentCount: number;
    freeCount?: number;
    uniqueOwners?: number;
    residentHighWaterMark?: number;
    evictionCount?: number;
    acquisitionCount?: number;
    reacquisitionCount?: number;
    pinnedCount?: number;
    staleUploadDrops?: number;
    residencyInvariantOk?: boolean | null;
    duplicatePhysicalOwners?: number;
    freeOwnedCollisions?: number;
    orphanMovieMappings?: number;
    orphanSlotMappings?: number;
    cpuBytes: number;
    gpuBytes: number;
    cacheBytes: number;
    cacheBudget: number;
    cacheHits?: number;
    cacheMisses?: number;
    p0UniqueTitles?: number;
    p1UniqueTitles?: number;
    p2UniqueTitles?: number;
    p3UniqueTitles?: number;
    p0PlusP1UniqueTitles?: number;
    posterWorkingSetUpdates?: number;
    posterWorkingSetVersion?: number;
    posterDesiredCount?: number;
    posterPinnedCount?: number;
    bootPinsActive?: boolean;
    bootPinsReleasedAt?: number | null;
    posterInitialP0Count?: number;
    posterInitialP1ResidentCount?: number;
    posterEnteredWorkingSetCount?: number;
    posterLeftWorkingSetCount?: number;
    posterDecodeJobsStarted?: number;
    lastWorkingSetTransition?: unknown;
    cpuBytesActive?: number;
    cpuBytesAllocated?: number;
    expectedTitles?: number;
    logicalMappedTitles?: number;
    actuallyRenderableTitles?: number;
    bankCount?: number;
    layersPerBank?: number;
    renderBatchCount?: number;
    samplersPerDraw?: number;
    arrayLayerCeiling?: number;
    hardwareMaxArrayTextureLayers?: number;
    sourcePosterMeshCount?: number;
    capacityInvariantOk?: boolean;
    shelfWidth?: number;
    shelfHeight?: number;
  } | null;
}

let live: GpuLiveState = {};

export function setGpuLiveState(next: GpuLiveState): void {
  live = { ...live, ...next };
}

export function setGpuXrMeta(meta: {
  classification?: string;
  stage?: string;
  phase?: string | null;
  frameCount?: number;
  firstWorldRenderCompletedAt?: number | null;
  firstStoreXrRenderAt?: number | null;
  foveationEffective?: number | null;
  lastError?: string | null;
}): void {
  if (meta.classification) classification = meta.classification;
  if (meta.stage) xrStage = meta.stage;
  if (meta.phase !== undefined) xrPhase = meta.phase;
  if (meta.frameCount !== undefined) xrFrameCount = meta.frameCount;
  if (meta.firstWorldRenderCompletedAt !== undefined) {
    firstWorldRenderCompletedAt = meta.firstWorldRenderCompletedAt;
  }
  if (meta.firstStoreXrRenderAt !== undefined) firstStoreXrRenderAt = meta.firstStoreXrRenderAt;
  if (meta.foveationEffective !== undefined) foveationEffective = meta.foveationEffective;
  if (meta.lastError !== undefined) lastError = meta.lastError;
}

export function recordResourceSnapshot(
  stage: ResourceSnapshotStage,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const { snapshots: _nested, ...diag } = gpuDiagnosticsSnapshot();
  const snap = { at: nowMs(), ...diag, ...extra };
  snapshots.set(stage, snap);
  return snap;
}

export function recordContextLoss(input: {
  presenting: boolean;
  lost: boolean;
}): ContextLossRecord {
  const profile = activeResourceProfile();
  const poster = estimatePosterArrayBytes(profile.poster);
  const rec: ContextLossRecord = {
    timestamp: nowMs(),
    stage: xrStage,
    rendererPresenting: input.presenting,
    isContextLost: input.lost,
    resourceProfile: profile.name,
    posterArrayCpuBytesEstimated: poster.posterArrayCpuBytesEstimated,
    posterArrayGpuBytesEstimated: poster.posterArrayGpuBytesEstimated,
    capabilities: activeGpuCapabilities(),
  };
  lastContextLoss = rec;
  persistXrFailure(rec);
  return rec;
}

export function persistXrFailure(payload: object): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(XR_FAIL_KEY, JSON.stringify({
      ...payload,
      at: new Date().toISOString(),
    }));
  } catch { /* quota / private mode */ }
}

export function readLastXrFailure(): unknown {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(XR_FAIL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function attachContextLossDiagnostics(
  canvas: HTMLCanvasElement,
  presenting: () => boolean,
): () => void {
  const onLost = (ev: Event) => {
    ev.preventDefault();
    recordContextLoss({ presenting: presenting(), lost: true });
    lastError = 'webglcontextlost';
  };
  const onRestored = () => {
    persistXrFailure({
      event: 'webglcontextrestored',
      stage: xrStage,
      resourceProfile: activeResourceProfile().name,
    });
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);
  return () => {
    canvas.removeEventListener('webglcontextlost', onLost, false);
    canvas.removeEventListener('webglcontextrestored', onRestored, false);
  };
}

export function gpuDiagnosticsSnapshot(): GpuDiagnostics {
  const profile = activeResourceProfile();
  const caps = activeGpuCapabilities();
  const posterEst = estimatePosterArrayBytes(profile.poster);
  const poster = live.poster;
  const mem = live.renderer?.info?.memory;
  const programs = live.renderer?.info?.programs;
  const gl = live.renderer?.getContext?.();
  return {
    classification,
    resourceProfile: profile.name,
    rendererName: caps?.rendererName ?? null,
    maxTextures: caps?.maxTextures ?? null,
    maxTextureSize: caps?.maxTextureSize ?? null,
    maxCubemapSize: caps?.maxCubemapSize ?? null,
    maxArrayTextureLayers: caps?.maxArrayTextureLayers ?? null,
    hardwareMaxArrayTextureLayers: caps?.maxArrayTextureLayers ?? null,
    effectiveTestMaxArrayTextureLayers: testPosterArrayLayerCeiling(),
    maxRenderbufferSize: caps?.maxRenderbufferSize ?? null,
    maxSamples: caps?.maxSamples ?? null,
    rendererTextures: mem?.textures ?? null,
    rendererGeometries: mem?.geometries ?? null,
    rendererPrograms: programs?.length ?? null,
    posterCatalogTitles: poster?.catalogTitleCount ?? null,
    posterExpectedTitles: poster?.expectedTitles ?? poster?.catalogTitleCount ?? null,
    posterLogicalMappedTitles: poster?.logicalMappedTitles ?? null,
    posterActuallyRenderableTitles: poster?.actuallyRenderableTitles ?? null,
    posterResidentTitles: poster?.residentCount ?? null,
    posterBankCount: poster?.bankCount ?? null,
    posterLayersPerBank: poster?.layersPerBank ?? null,
    posterRenderBatchCount: poster?.renderBatchCount ?? null,
    posterSourceMeshCount: poster?.sourcePosterMeshCount ?? null,
    posterSamplersPerDraw: poster?.samplersPerDraw ?? 1,
    posterBaseWidth: poster?.shelfWidth ?? null,
    posterBaseHeight: poster?.shelfHeight ?? null,
    posterCpuBytesEstimated: poster?.cpuBytes ?? posterEst.posterArrayCpuBytesEstimated,
    posterCpuBytesActive: poster?.cpuBytesActive ?? null,
    posterCpuBytesAllocated: poster?.cpuBytesAllocated ?? poster?.cpuBytes ?? null,
    posterGpuBytesEstimated: poster?.gpuBytes ?? posterEst.posterArrayGpuBytesEstimated,
    posterCapacityInvariantOk: poster?.capacityInvariantOk ?? poster?.residencyInvariantOk ?? null,
    posterPhysicalSlots: poster?.physicalSlots ?? posterEst.physicalPosterSlots,
    posterFreeSlots: poster?.freeCount ?? null,
    posterResidencyInvariantOk: poster?.residencyInvariantOk ?? null,
    posterDuplicatePhysicalOwners: poster?.duplicatePhysicalOwners ?? null,
    posterFreeOwnedCollisions: poster?.freeOwnedCollisions ?? null,
    posterOrphanMovieMappings: poster?.orphanMovieMappings ?? null,
    posterOrphanSlotMappings: poster?.orphanSlotMappings ?? null,
    posterResidentHighWaterMark: poster?.residentHighWaterMark ?? null,
    posterEvictionCount: poster?.evictionCount ?? null,
    posterAcquisitionCount: poster?.acquisitionCount ?? null,
    posterReacquisitionCount: poster?.reacquisitionCount ?? null,
    posterWorkingSetUpdates: poster?.posterWorkingSetUpdates ?? null,
    posterWorkingSetVersion: poster?.posterWorkingSetVersion ?? null,
    posterDesiredCount: poster?.posterDesiredCount ?? null,
    posterPinnedCount: poster?.posterPinnedCount ?? poster?.pinnedCount ?? null,
    bootPinsActive: poster?.bootPinsActive ?? null,
    bootPinsReleasedAt: poster?.bootPinsReleasedAt ?? null,
    posterInitialP0Count: poster?.posterInitialP0Count ?? null,
    posterInitialP1ResidentCount: poster?.posterInitialP1ResidentCount ?? null,
    posterEnteredWorkingSetCount: poster?.posterEnteredWorkingSetCount ?? null,
    posterLeftWorkingSetCount: poster?.posterLeftWorkingSetCount ?? null,
    posterDecodeJobsStarted: poster?.posterDecodeJobsStarted ?? null,
    posterStaleUploadDrops: poster?.staleUploadDrops ?? null,
    p0UniqueTitles: poster?.p0UniqueTitles ?? null,
    p1UniqueTitles: poster?.p1UniqueTitles ?? null,
    p2UniqueTitles: poster?.p2UniqueTitles ?? null,
    p3UniqueTitles: poster?.p3UniqueTitles ?? null,
    p0PlusP1UniqueTitles: poster?.p0PlusP1UniqueTitles ?? null,
    posterArrayCpuBytesEstimated: poster?.cpuBytes ?? posterEst.posterArrayCpuBytesEstimated,
    posterArrayGpuBytesEstimated: poster?.gpuBytes ?? posterEst.posterArrayGpuBytesEstimated,
    posterCpuCacheBytes: poster?.cacheBytes ?? null,
    posterCpuCacheBudget: poster?.cacheBudget ?? null,
    posterCpuCacheHits: poster?.cacheHits ?? null,
    posterCpuCacheMisses: poster?.cacheMisses ?? null,
    composerAllocated: live.composerAllocated ?? profile.composer,
    n8aoAllocated: live.n8aoAllocated ?? false,
    gtaoAllocated: live.gtaoAllocated ?? false,
    shadowEnabled: live.renderer?.shadowMap?.enabled ?? profile.shadows,
    mirrorCount: live.mirrorCount ?? 0,
    reflectionProbeCount: live.reflectionProbeCount ?? 0,
    environmentBakeResolution: profile.environmentBakeResolution,
    environmentBounceCount: profile.environmentBounceCount,
    xrFramebufferScaleRequested: profile.framebufferScale,
    xrFoveationRequested: profile.foveation,
    xrFoveationEffective: foveationEffective,
    xrPhase,
    xrFrameCount,
    firstWorldRenderCompletedAt,
    firstStoreXrRenderAt,
    contextLost: !!gl?.isContextLost?.() || lastContextLoss?.isContextLost === true,
    lastContextLossAt: lastContextLoss?.timestamp ?? null,
    lastError,
    xrContent: xrContentSnapshot(),
    snapshots: Object.fromEntries(snapshots),
  };
}

export function installGpuDiagnostics(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __gpuDiagnostics?: () => GpuDiagnostics }).__gpuDiagnostics =
    gpuDiagnosticsSnapshot;
  (window as unknown as { __lastXrFailure?: () => unknown }).__lastXrFailure = readLastXrFailure;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
