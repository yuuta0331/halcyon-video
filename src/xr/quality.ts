// Quest-safe XR quality policy. Desktop quality is a different resource
// profile, chosen before StoreScene allocation — not a late runtime toggle.

export {
  restoreDesktopQuality,
  snapshotDesktopQuality,
  xrQualityPolicy,
  type DesktopQualitySnapshot,
  type XrQualityPolicy,
} from './resource-policy.ts';
export { XR_SAFE_FRAMEBUFFER_SCALE as XR_FRAMEBUFFER_SCALE } from './resource-policy.ts';
