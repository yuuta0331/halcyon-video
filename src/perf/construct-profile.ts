// Synchronous StoreScene construction sub-stages. No titles, no secrets.

export interface ConstructStage {
  name: string;
  ms: number;
}

export interface ConstructProfile {
  stages: ConstructStage[];
  top3: ConstructStage[];
  totalMs: number;
}

const stages: ConstructStage[] = [];

export function resetConstructProfile(): void {
  stages.length = 0;
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function constructStage<T>(name: string, fn: () => T): T {
  const t0 = now();
  try {
    return fn();
  } finally {
    constructRecord(name, Math.max(0, now() - t0));
  }
}

export function constructRecord(name: string, ms: number): void {
  stages.push({ name, ms: Math.max(0, ms) });
}

export function constructProfileSnapshot(): ConstructProfile {
  const top3 = [...stages].sort((a, b) => b.ms - a.ms).slice(0, 3);
  const totalMs = stages.reduce((sum, s) => sum + s.ms, 0);
  return { stages: [...stages], top3, totalMs };
}
