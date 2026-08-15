// Evidence classification for the JP-3 XR loop.
// IWER_EMULATED and QUEST_HARDWARE must never be conflated.

export type XrEvidenceClass =
  | 'UNIT'
  | 'DESKTOP_BROWSER'
  | 'IWER_EMULATED'
  | 'QUEST_HARDWARE';

export function classifyXrEnvironment(input: {
  hasWindow?: boolean;
  immersiveVrSupported: boolean;
  iwerActive: boolean;
  nativeXrAvailable: boolean;
  userAgent?: string;
}): XrEvidenceClass {
  if (input.hasWindow === false) return 'UNIT';
  if (input.iwerActive) return 'IWER_EMULATED';
  if (input.nativeXrAvailable && input.immersiveVrSupported) {
    const ua = input.userAgent ?? '';
    if (/Quest/i.test(ua) || /OculusBrowser/i.test(ua)) return 'QUEST_HARDWARE';
    // Native immersive-vr on a non-Quest UA (rare desktop runtime) is still
    // hardware-class, not IWER.
    return 'QUEST_HARDWARE';
  }
  return 'DESKTOP_BROWSER';
}
