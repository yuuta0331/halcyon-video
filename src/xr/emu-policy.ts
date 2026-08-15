// Whether development IWER may replace navigator.xr.
// Native immersive-vr (Quest Browser) must never be clobbered.
// Desktop Chrome often exposes navigator.xr without immersive-vr.

export function shouldInstallIwer(input: {
  emuRequested: boolean;
  nativeImmersiveVrSupported: boolean;
}): { install: boolean; forceInstall: boolean } {
  if (!input.emuRequested) return { install: false, forceInstall: false };
  if (input.nativeImmersiveVrSupported) return { install: false, forceInstall: false };
  return { install: true, forceInstall: true };
}
