// Device identity is not presentation mode.
// Quest Browser inline must not inherit immersive XR_SAFE poster policy.

export type PresentationMode = 'INLINE' | 'IMMERSIVE_XR';
export type DeviceClass = 'desktop' | 'quest';

let presentation: PresentationMode = 'INLINE';

export function activePresentationMode(): PresentationMode {
  return presentation;
}

export function setPresentationMode(mode: PresentationMode): PresentationMode {
  presentation = mode;
  return presentation;
}

export function resetPresentationModeForTests(): void {
  presentation = 'INLINE';
}

export function deviceClassFromUa(ua: string): DeviceClass {
  return /Quest/i.test(ua) || /OculusBrowser/i.test(ua) ? 'quest' : 'desktop';
}
