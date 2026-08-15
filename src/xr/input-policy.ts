// Pure XR input policy. Kept off Three.js so node tests can import it.

export function ignoreHandTrackingSource(source: { hand?: unknown; targetRayMode?: string } | null | undefined): boolean {
  if (!source) return true;
  if (source.hand) return true;
  return false;
}

export function readXrGamepadStick(gamepad: { axes?: ArrayLike<number> } | null | undefined): { x: number; y: number } {
  const axes = gamepad?.axes;
  if (!axes || axes.length < 2) return { x: 0, y: 0 };
  // Most Quest controllers expose thumbstick as axes[2], axes[3]; some as 0,1.
  if (axes.length >= 4) return { x: axes[2] || 0, y: axes[3] || 0 };
  return { x: axes[0] || 0, y: axes[1] || 0 };
}
