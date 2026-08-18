// Observed production-path counters for the hardware poster diagnostic.
// Incremented from real compile/bind hooks. Never a hard-coded "productionPath": true.

let compileCount = 0;
let diagBankBindCount = 0;
let diagLutBindCount = 0;
let diagFocusBindCount = 0;
let suppressBind = false;

export function noteProductionPosterCompile(): void {
  compileCount++;
}

export function noteHwDiagBankBind(): void {
  if (suppressBind) return;
  diagBankBindCount++;
}

export function noteHwDiagLutBind(): void {
  diagLutBindCount++;
}

export function noteHwDiagFocusBind(): void {
  diagFocusBindCount++;
}

export function suppressHwDiagProductionBind(on: boolean): void {
  suppressBind = on;
}

export function hwDiagProductionBindSuppressed(): boolean {
  return suppressBind;
}

export function hwDiagObserveSnapshot() {
  return {
    compileCount,
    diagBankBindCount,
    diagLutBindCount,
    diagFocusBindCount,
    suppressBind,
  };
}

export function resetHwDiagObserveForTests(): void {
  compileCount = 0;
  diagBankBindCount = 0;
  diagLutBindCount = 0;
  diagFocusBindCount = 0;
  suppressBind = false;
}
