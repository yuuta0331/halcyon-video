// Pure poster-bank draw-batch helpers. No Three.js — unit-testable.

import type { MovieSlot } from '../store-layout.ts';

export function posterBankBatchUpperBound(
  sourcePosterMeshCount: number,
  catalogBankCount: number,
): number {
  return Math.max(0, sourcePosterMeshCount) * Math.max(1, catalogBankCount);
}

export function groupSlotsByPosterBank(
  slots: MovieSlot[],
  peekIndex: (id: string) => number | null,
  bankSize: number,
  bankCount: number,
): Map<number, MovieSlot[]> {
  const groups = new Map<number, MovieSlot[]>();
  const size = Math.max(1, bankSize);
  const banks = Math.max(1, bankCount);
  for (const slot of slots) {
    const idx = peekIndex(slot.movie.id) ?? 0;
    const bank = Math.min(banks - 1, Math.max(0, Math.floor(idx / size)));
    const list = groups.get(bank) ?? [];
    list.push(slot);
    groups.set(bank, list);
  }
  return groups;
}
