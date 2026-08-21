export interface PosterBankInvariantRecord {
  globalIndex: number | null;
  expectedBank: number | null;
  expectedLayer: number | null;
  frontBank: number | null;
  backBank: number | null;
  frontIndex: number | null;
  backIndex: number | null;
  bankCount: number;
  arrayDepth: number;
  loadedFlag: number | null;
}

export type PosterBankInvariantVerdict = 'PASS' | 'FAIL' | 'NOT_EXERCISED';

export interface PosterBankInvariantSummary {
  checkedSlots: number;
  bankMismatchCount: number;
  layerOutOfRangeCount: number;
  missingIndexCount: number;
  invalidLoadedFlagCount: number;
  pass: boolean;
  verdict: PosterBankInvariantVerdict;
}

export function posterIndexNotifyBankSafe(
  index: number,
  bankSize: number,
  frontBank: number,
  backBank: number,
): boolean {
  const expected = Math.floor(index / Math.max(1, bankSize));
  return frontBank === expected && backBank === expected;
}

export function summarizePosterBankInvariant(
  records: readonly PosterBankInvariantRecord[],
): PosterBankInvariantSummary {
  let bankMismatchCount = 0;
  let layerOutOfRangeCount = 0;
  let missingIndexCount = 0;
  let invalidLoadedFlagCount = 0;
  for (const r of records) {
    if (r.globalIndex == null || r.expectedBank == null || r.expectedLayer == null) {
      missingIndexCount++;
      continue;
    }
    if (r.expectedBank >= r.bankCount || r.frontBank !== r.expectedBank || r.backBank !== r.expectedBank
        || r.frontIndex !== r.globalIndex || r.backIndex !== r.globalIndex) bankMismatchCount++;
    if (r.expectedLayer < 0 || r.expectedLayer >= r.arrayDepth) layerOutOfRangeCount++;
    // 200 is the stable-same-texture fallback state; 0/128/255 are
    // unloaded/BASE/FULL. Other byte values indicate a torn status write.
    if (r.loadedFlag == null
        || (r.loadedFlag !== 0 && r.loadedFlag !== 128 && r.loadedFlag !== 200 && r.loadedFlag !== 255)) {
      invalidLoadedFlagCount++;
    }
  }
  return classifyPosterBankInvariant({
    checkedSlots: records.length,
    bankMismatchCount,
    layerOutOfRangeCount,
    missingIndexCount,
    invalidLoadedFlagCount,
  });
}

export function classifyPosterBankInvariant(input: {
  checkedSlots: number;
  bankMismatchCount: number;
  layerOutOfRangeCount: number;
  missingIndexCount: number;
  invalidLoadedFlagCount: number;
}): PosterBankInvariantSummary {
  const pass = input.checkedSlots > 0
    && input.bankMismatchCount === 0
    && input.layerOutOfRangeCount === 0
    && input.missingIndexCount === 0
    && input.invalidLoadedFlagCount === 0;
  const verdict: PosterBankInvariantVerdict = input.checkedSlots <= 0
    ? 'NOT_EXERCISED'
    : pass ? 'PASS' : 'FAIL';
  return { ...input, pass, verdict };
}
