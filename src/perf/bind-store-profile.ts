import type * as THREE from 'three';
import {
  readGpuCapabilities,
  readResourceFlags,
  selectResourceProfile,
  setActiveResourceProfile,
  type ResourceProfile,
} from './resource-profile';
import { applyPosterCacheBudgets } from '../video-case';
import {
  attachContextLossDiagnostics,
  installGpuDiagnostics,
  recordResourceSnapshot,
} from '../xr/gpu-diagnostics';

export function bindStoreResourceProfile(
  renderer: THREE.WebGLRenderer,
  presenting: () => boolean,
): ResourceProfile {
  const gl = renderer.getContext();
  const caps = readGpuCapabilities({
    gl: gl as never,
    maxTextures: renderer.capabilities.maxTextures,
  });
  const profile = setActiveResourceProfile(selectResourceProfile({
    caps,
    flags: readResourceFlags(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    isTauri: !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  }), caps);
  applyPosterCacheBudgets(profile.poster.heroCacheBytes, profile.poster.shelfCacheBytes);
  installGpuDiagnostics();
  recordResourceSnapshot('renderer-created');
  attachContextLossDiagnostics(renderer.domElement, presenting);
  return profile;
}
