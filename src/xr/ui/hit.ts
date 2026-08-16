export const XR_UI_PIXEL_WIDTH = 1024;
export const XR_UI_PIXEL_HEIGHT = 768;
export const XR_UI_HEADER_FRAC = 0.16;
export const XR_UI_FOOTER_FRAC = 0.08;

export function uvToRowIndex(
  v: number,
  rowCount: number,
  headerFrac = XR_UI_HEADER_FRAC,
  footerFrac = XR_UI_FOOTER_FRAC,
): number | null {
  if (v < 0 || v > 1 || rowCount <= 0) return null;
  const body0 = headerFrac;
  const body1 = 1 - footerFrac;
  if (v < body0 || v > body1) return null;
  const t = (v - body0) / (body1 - body0);
  const idx = Math.floor(t * rowCount);
  if (idx < 0 || idx >= rowCount) return null;
  return idx;
}

export function rayHitsPanelUv(input: {
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  panelOrigin: { x: number; y: number; z: number };
  panelNormal: { x: number; y: number; z: number };
  right: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
  width: number;
  height: number;
}): { u: number; v: number } | null {
  const denom =
    input.direction.x * input.panelNormal.x
    + input.direction.y * input.panelNormal.y
    + input.direction.z * input.panelNormal.z;
  if (Math.abs(denom) < 1e-5) return null;
  const to =
    (input.panelOrigin.x - input.origin.x) * input.panelNormal.x
    + (input.panelOrigin.y - input.origin.y) * input.panelNormal.y
    + (input.panelOrigin.z - input.origin.z) * input.panelNormal.z;
  const t = to / denom;
  if (t < 0 || t > 4) return null;
  const hx = input.origin.x + input.direction.x * t;
  const hy = input.origin.y + input.direction.y * t;
  const hz = input.origin.z + input.direction.z * t;
  const dx = hx - input.panelOrigin.x;
  const dy = hy - input.panelOrigin.y;
  const dz = hz - input.panelOrigin.z;
  const x = dx * input.right.x + dy * input.right.y + dz * input.right.z;
  const y = dx * input.up.x + dy * input.up.y + dz * input.up.z;
  const u = x / input.width + 0.5;
  const v = 0.5 - y / input.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v };
}
