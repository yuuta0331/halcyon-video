// XR resource policy that actually changes the allocated graph.
// Replaces the previous applyXrQualityOverride() no-op.

import {
  activeResourceProfile,
  type ResourceProfile,
} from '../perf/resource-profile.ts';
import { XR_TARGET_HZ } from './session-policy.ts';

export const XR_SAFE_FRAMEBUFFER_SCALE = 0.5;
export const XR_DESKTOP_FRAMEBUFFER_SCALE = 0.7;

export interface XrQualityPolicy {
  n8ao: boolean;
  postprocessing: 'none' | 'desktop';
  framebufferScale: number;
  foveation: number;
  targetHz: number;
  shadows: boolean;
  liveMirrors: boolean;
  reflectionProbes: boolean;
  compositionLayers: boolean;
  mediaLayer: boolean;
  resourceProfile: ResourceProfile['name'];
}

export function xrQualityPolicy(
  profile: ResourceProfile = activeResourceProfile(),
): XrQualityPolicy {
  return {
    n8ao: profile.n8ao,
    postprocessing: profile.composer ? 'desktop' : 'none',
    framebufferScale: profile.framebufferScale,
    foveation: profile.foveation,
    targetHz: XR_TARGET_HZ,
    shadows: profile.shadows,
    liveMirrors: profile.liveMirrors,
    reflectionProbes: profile.reflectionProbes,
    compositionLayers: profile.xrCompositionLayers,
    mediaLayer: profile.xrMediaLayer,
    resourceProfile: profile.name,
  };
}

export interface DesktopQualitySnapshot {
  n8aoEnabled: boolean;
  composerActive: boolean;
  bokehEnabled: boolean;
  bloomEnabled: boolean;
}

export function snapshotDesktopQuality(input: DesktopQualitySnapshot): DesktopQualitySnapshot {
  return { ...input };
}

export function restoreDesktopQuality(
  snapshot: DesktopQualitySnapshot,
): DesktopQualitySnapshot {
  return { ...snapshot };
}
