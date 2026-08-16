// Which existing settings the XR panel may control vs merely report.
// Desktop-only quality knobs must not be presented as live XR controls.

export type XrSettingExposure = 'control' | 'status' | 'hidden';

/** Keys the first JP-4A slice actually cycles/toggles. */
export const XR_CONTROL_KEYS = [
  'bb_locale',
  'bb_outside',
  'bb_fps_meter',
] as const;

/** Desktop quality / compositor knobs. XR_SAFE ignores them; show as status. */
export const XR_STATUS_KEYS = [
  'bb_quality',
  'bb_ao',
  'bb_render_mode',
  'bb_fps_cap',
] as const;

export function xrSettingExposure(key: string): XrSettingExposure {
  if ((XR_CONTROL_KEYS as readonly string[]).includes(key)) return 'control';
  if ((XR_STATUS_KEYS as readonly string[]).includes(key)) return 'status';
  return 'hidden';
}

export function xrControlKeys(): readonly string[] {
  return XR_CONTROL_KEYS;
}

export function xrStatusKeys(): readonly string[] {
  return XR_STATUS_KEYS;
}

export function xrQualityStatusLabel(resourceProfile: string): string {
  if (resourceProfile === 'XR_SAFE') return 'XR_SAFE';
  return resourceProfile;
}

export function xrDesktopQualityAffectsXr(key: string, resourceProfile: string): boolean {
  if (resourceProfile !== 'XR_SAFE') return true;
  return xrSettingExposure(key) === 'control';
}
