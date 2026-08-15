// Quest-safe XR quality policy. Applied for the immersive session only;
// desktop quality is snapshotted and restored on exit. JP-3 does not
// permanently lower desktop settings or retune individual store assets.

export const XR_FRAMEBUFFER_SCALE = 0.7;

export interface DesktopQualitySnapshot {
  n8aoEnabled: boolean;
  composerActive: boolean;
  bokehEnabled: boolean;
  bloomEnabled: boolean;
}

export interface XrQualityPolicy {
  n8ao: false;
  postprocessing: 'none';
  framebufferScale: number;
  targetHz: number;
  shadows: 'keep';
}

export function xrQualityPolicy(): XrQualityPolicy {
  return {
    n8ao: false,
    postprocessing: 'none',
    framebufferScale: XR_FRAMEBUFFER_SCALE,
    targetHz: 72,
    shadows: 'keep',
  };
}

export function snapshotDesktopQuality(input: DesktopQualitySnapshot): DesktopQualitySnapshot {
  return { ...input };
}

export function applyXrQualityOverride(): Pick<DesktopQualitySnapshot, 'n8aoEnabled' | 'composerActive' | 'bokehEnabled'> {
  return {
    n8aoEnabled: false,
    composerActive: false,
    bokehEnabled: false,
  };
}

export function restoreDesktopQuality(
  snapshot: DesktopQualitySnapshot,
): DesktopQualitySnapshot {
  return { ...snapshot };
}
