// Test-only injectable MAX_ARRAY_TEXTURE_LAYERS ceiling.
// Production diagnostics keep the real hardware value separate from the
// effective layout limit used by a controlled DESKTOP_BROWSER integration.

let testCeiling: number | null = null;

export function setTestPosterArrayLayerCeiling(n: number | null): void {
  if (n == null || !Number.isFinite(n) || n <= 0) {
    testCeiling = null;
    return;
  }
  testCeiling = Math.max(1, Math.floor(n));
}

export function testPosterArrayLayerCeiling(): number | null {
  return testCeiling;
}

export function effectivePosterArrayLayerCeiling(hardwareMaxArrayTextureLayers: number): number {
  const hardware = Math.max(1, Math.floor(hardwareMaxArrayTextureLayers) || 1);
  if (testCeiling == null) return hardware;
  return Math.max(1, Math.min(hardware, testCeiling));
}

export function resetTestPosterArrayLayerCeiling(): void {
  testCeiling = null;
}
