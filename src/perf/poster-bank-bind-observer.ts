// Test/evidence-only observation of production bindDrawBank calls.
// Does not choose banks. Disabled unless a recording session is active.

export interface BindDrawBankCall {
  bank: number;
  at: number;
}

let recording: BindDrawBankCall[] | null = null;

export function noteBindDrawBank(bank: number): void {
  if (!recording) return;
  recording.push({
    bank: Math.max(0, Math.floor(bank) || 0),
    at: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  });
}

export function beginBindDrawBankRecording(): void {
  recording = [];
}

export function takeBindDrawBankRecording(): BindDrawBankCall[] {
  const out = recording ?? [];
  recording = null;
  return out;
}

export function isBindDrawBankRecording(): boolean {
  return recording != null;
}

export function resetBindDrawBankObserverForTests(): void {
  recording = null;
}

export function observedBanks(calls: readonly BindDrawBankCall[]): number[] {
  return [...new Set(calls.map((c) => c.bank))].sort((a, b) => a - b);
}

/** Probe-side wrong/neutral bank. Never returns the target when bankCount > 1. */
export function adversarialWrongBank(targetBank: number, bankCount: number): number {
  const n = Math.max(1, bankCount);
  const target = Math.max(0, Math.floor(targetBank) || 0);
  if (n <= 1) return 0;
  return target === 0 ? 1 : 0;
}
