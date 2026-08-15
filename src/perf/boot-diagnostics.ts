// Machine-readable boot timing. No credentials, tokens, or catalog titles.

export type BootStage =
  | 'appStart'
  | 'credentialStart'
  | 'credentialEnd'
  | 'catalogStart'
  | 'catalogEnd'
  | 'sidecarsStart'
  | 'sidecarsEnd'
  | 'brandPackStart'
  | 'brandPackEnd'
  | 'baseFontsStart'
  | 'baseFontsEnd'
  | 'cjkFontsStart'
  | 'cjkFontsEnd'
  | 'qualityCalibrationStart'
  | 'qualityCalibrationEnd'
  | 'threeSceneImportStart'
  | 'threeSceneImportEnd'
  | 'storeSceneConstructStart'
  | 'storeSceneConstructEnd'
  | 'criticalTextureReady'
  | 'storeInteractive'
  | 'allTexturesSettled';

export interface BootDiagnostics {
  marks: Partial<Record<BootStage, number>>;
  qualityCalibrationMs: number | null;
  storeSceneConstructMs: number | null;
  timeToInteractive: number | null;
  timeToFullTextures: number | null;
  criticalReadyBeforeAllTextures: boolean | null;
}

const marks: Partial<Record<BootStage, number>> = {};

export function bootMark(stage: BootStage, at: number = now()): void {
  if (marks[stage] == null) marks[stage] = at;
}

export function bootNow(): number {
  return now();
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function bootDiagnosticsSnapshot(): BootDiagnostics {
  const tti = delta(marks.appStart, marks.storeInteractive);
  const full = delta(marks.appStart, marks.allTexturesSettled);
  const crit = marks.criticalTextureReady;
  const settled = marks.allTexturesSettled;
  return {
    marks: { ...marks },
    qualityCalibrationMs: delta(marks.qualityCalibrationStart, marks.qualityCalibrationEnd),
    storeSceneConstructMs: delta(marks.storeSceneConstructStart, marks.storeSceneConstructEnd),
    timeToInteractive: tti,
    timeToFullTextures: full,
    criticalReadyBeforeAllTextures:
      crit == null || settled == null ? null : crit < settled || (crit === settled && tti != null),
  };
}

function delta(start?: number, end?: number): number | null {
  if (start == null || end == null) return null;
  return Math.max(0, end - start);
}

export function installBootDiagnostics(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __bootDiagnostics?: () => BootDiagnostics }).__bootDiagnostics =
    bootDiagnosticsSnapshot;
}

export function bootDiagnosticsOrderingOk(d: BootDiagnostics): boolean {
  const m = d.marks;
  if (m.appStart == null) return false;
  const pairs: Array<[BootStage, BootStage]> = [
    ['credentialStart', 'credentialEnd'],
    ['catalogStart', 'catalogEnd'],
    ['brandPackStart', 'brandPackEnd'],
    ['baseFontsStart', 'baseFontsEnd'],
    ['qualityCalibrationStart', 'qualityCalibrationEnd'],
    ['threeSceneImportStart', 'threeSceneImportEnd'],
    ['storeSceneConstructStart', 'storeSceneConstructEnd'],
  ];
  for (const [a, b] of pairs) {
    if (m[a] != null && m[b] != null && m[b]! < m[a]!) return false;
  }
  if (m.storeInteractive != null && m.appStart != null && m.storeInteractive < m.appStart) return false;
  if (
    m.criticalTextureReady != null &&
    m.allTexturesSettled != null &&
    m.criticalTextureReady > m.allTexturesSettled
  ) {
    return false;
  }
  return true;
}
