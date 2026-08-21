// JP-4A Quest XR_SAFE readability floor. Framebuffer is chosen before setSession.
// Foveation is post-session, best-effort, and follows UI ownership.

import type { XrUiMode } from './ui-mode.ts';

export const XR_SAFE_FRAMEBUFFER_SCALE = 0.8;
export const XR_SAFE_FRAMEBUFFER_SCALE_FLOOR = 0.8;
export const XR_SAFE_WORLD_FOVEATION = 0.5;
export const XR_SAFE_UI_FOVEATION = 0;

export function clampXrSafeFramebufferScale(value: number): number {
  if (!Number.isFinite(value)) return XR_SAFE_FRAMEBUFFER_SCALE;
  return Math.max(XR_SAFE_FRAMEBUFFER_SCALE_FLOOR, value);
}

export function foveationForUiMode(mode: XrUiMode): number {
  if (mode === 'MENU' || mode === 'SETTINGS') return XR_SAFE_UI_FOVEATION;
  return XR_SAFE_WORLD_FOVEATION;
}
