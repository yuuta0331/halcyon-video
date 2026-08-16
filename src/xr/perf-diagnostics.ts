// Secret-free XR / store residency diagnostics.

import { fpsMeterReadout } from '../fps-meter.ts';
import { pendingTextureUploads, posterUploadJobsStarted } from '../perf/texture-upload-queue.ts';
import { storeVisibleProgress } from '../store-visual-ready.ts';
import { storeVisibleResidency } from '../store-visible-residency.ts';
import { textureArrayManager } from '../poster-textures.ts';
import { gpuDiagnosticsSnapshot } from './gpu-diagnostics.ts';

export function xrPerfDiagnostics(): Record<string, unknown> {
  const frame = fpsMeterReadout();
  const ready = storeVisibleProgress();
  const mem = textureArrayManager.memorySnapshot();
  const layout = textureArrayManager.lastLayout;
  const vis = storeVisibleResidency.validate();
  const gpu = gpuDiagnosticsSnapshot();
  return {
    FRAME: {
      rollingFps: frame.fps,
      meanFrameTime: frame.meanMs,
      p95: frame.p95Ms,
      p99: frame.p99Ms,
      worst: frame.worstMs,
      over1389ms: frame.over1389,
      longFrames: frame.over1389,
      uiMode: null,
      samples: frame.samples,
    },
    STORE_READINESS: {
      state: ready.state,
      visibleBaseTotal: ready.postersExpected,
      visibleBaseUploaded: ready.postersUploaded,
      visibleBaseFallback: ready.postersFallback,
      visualReady: ready.visualReady,
      timeToVisualReady: ready.timeToVisualReady,
    },
    UPLOAD: {
      pendingUploads: pendingTextureUploads(),
      totalUploads: posterUploadJobsStarted(),
      staleDrops: mem.staleUploadDrops,
    },
    GPU: {
    textures: gpu.rendererTextures,
    geometries: gpu.rendererGeometries,
    programs: gpu.rendererPrograms,
      textureHighWater: mem.residentHighWaterMark,
      creates: mem.acquisitionCount,
      disposes: mem.evictionCount,
      residentBaseTitleCount: mem.residentCount,
      textureBankCount: mem.bankCount ?? layout?.bankCount ?? 1,
      selectedBaseShelfResolution: { w: mem.shelfWidth, h: mem.shelfHeight },
      estimatedCpuPosterBytes: mem.cpuBytes,
      estimatedGpuPosterBytes: mem.gpuBytes,
    },
    RESIDENCY: {
      baseResidentCount: mem.residentCount,
      baseExpectedCount: vis.expectedCount || ready.postersExpected,
      evictionCount: mem.evictionCount,
      reacquisitionCount: mem.reacquisitionCount,
      duplicateMappingCount: vis.duplicateOwners,
      invalidFreeOwnedCollisionCount: mem.freeOwnedCollisions,
      mappingOk: vis.ok && mem.residencyInvariantOk !== false,
    },
  };
}

export function publishXrPerfDiagnostics(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __xrPerfDiagnostics?: () => unknown }).__xrPerfDiagnostics = xrPerfDiagnostics;
}
