// Cross-cutting GPU upload policy. poster-textures reads this each drain;
// XR runtime writes presenting/motion. No Three.js imports.

let xrPresenting = false;
let xrMoving = false;

export function setXrUploadPresenting(on: boolean): void {
  xrPresenting = on;
  if (!on) xrMoving = false;
}

export function setXrUploadMotion(moving: boolean): void {
  xrMoving = moving;
}

export function xrUploadPolicyState(): { presenting: boolean; moving: boolean } {
  return { presenting: xrPresenting, moving: xrMoving };
}

/**
 * Quest Browser often pauses window rAF while immersive. GPU upload drain
 * must ride the XR animation loop in that case, not requestAnimationFrame.
 */
export function textureUploadUsesWindowRaf(
  presenting: boolean = xrPresenting,
): boolean {
  return !presenting;
}
