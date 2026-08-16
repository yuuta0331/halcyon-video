// Post-session runtime foveation. Never a requestSession dependency.

export function trySetRuntimeFoveation(
  xrMgr: { setFoveation?: (n: number) => void } | null | undefined,
  value: number,
): { attempted: boolean; ok: boolean } {
  if (!xrMgr || typeof xrMgr.setFoveation !== 'function' || !Number.isFinite(value) || value < 0) {
    return { attempted: false, ok: true };
  }
  try {
    xrMgr.setFoveation(value);
    return { attempted: true, ok: true };
  } catch {
    return { attempted: true, ok: false };
  }
}
