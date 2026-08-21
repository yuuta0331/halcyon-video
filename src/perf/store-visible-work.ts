// Typed STORE_VISIBLE_BASE vs ON_DEMAND work ownership.
// Global pendingUploads is not a reveal gate: future ON_DEMAND work may exist.
// Reveal waits only for scoped STORE_VISIBLE_BASE fetch/decode/upload to drain
// to a terminal title state (REAL_READY or STABLE_FALLBACK).

export type UploadScope = 'STORE_VISIBLE_BASE' | 'ON_DEMAND' | 'OTHER';

export type TitleTerminalState = 'REAL_READY' | 'STABLE_FALLBACK';

export interface ScopedPending {
  decode: number;
  upload: number;
  work: number;
}

export interface StoreVisibleWorkSnapshot {
  generation: number;
  expected: number;
  realReady: number;
  stableFallback: number;
  missing: number;
  pendingDecode: number;
  pendingUpload: number;
  pendingWork: number;
  onDemandPendingWork: number;
  lateRealUploadRejected: number;
  staleGenerationDrops: number;
  fallbackReplacementCount: number;
}

const SCOPES: readonly UploadScope[] = ['STORE_VISIBLE_BASE', 'ON_DEMAND', 'OTHER'];

function emptyPending(): Record<UploadScope, { decode: number; upload: number }> {
  return {
    STORE_VISIBLE_BASE: { decode: 0, upload: 0 },
    ON_DEMAND: { decode: 0, upload: 0 },
    OTHER: { decode: 0, upload: 0 },
  };
}

let onGenerationChange: (() => void) | null = null;

export function setStoreVisibleGenerationListener(fn: (() => void) | null): void {
  onGenerationChange = fn;
}

function clamp0(n: number): number {
  return n < 0 ? 0 : n;
}

class StoreVisibleWork {
  generation = 0;
  private expected = new Set<string>();
  private terminal = new Map<string, TitleTerminalState>();
  private pending = emptyPending();
  lateRealUploadRejected = 0;
  staleGenerationDrops = 0;
  fallbackReplacementCount = 0;

  reset(): void {
    this.generation = 0;
    this.expected = new Set();
    this.terminal.clear();
    this.pending = emptyPending();
    this.lateRealUploadRejected = 0;
    this.staleGenerationDrops = 0;
    this.fallbackReplacementCount = 0;
  }

  beginScene(ids: Iterable<string>): number {
    this.generation++;
    this.expected = new Set(ids);
    this.terminal.clear();
    for (const scope of SCOPES) this.pending[scope].decode = 0;
    onGenerationChange?.();
    return this.generation;
  }

  invalidateGeneration(): number {
    this.generation++;
    onGenerationChange?.();
    return this.generation;
  }

  currentGeneration(): number {
    return this.generation;
  }

  expectedIds(): ReadonlySet<string> {
    return this.expected;
  }

  isExpected(movieId: string): boolean {
    return this.expected.has(movieId);
  }

  scopeFor(movieId: string): UploadScope {
    return this.expected.has(movieId) ? 'STORE_VISIBLE_BASE' : 'ON_DEMAND';
  }

  terminalState(movieId: string): TitleTerminalState | null {
    return this.terminal.get(movieId) ?? null;
  }

  isStableFallback(movieId: string): boolean {
    return this.terminal.get(movieId) === 'STABLE_FALLBACK';
  }

  allowsGpuMutation(movieId: string, workGeneration: number): boolean {
    if (workGeneration !== this.generation) return false;
    if (this.terminal.get(movieId) === 'STABLE_FALLBACK') return false;
    return true;
  }

  commitTerminal(movieId: string, state: TitleTerminalState): boolean {
    const prev = this.terminal.get(movieId);
    if (prev === 'STABLE_FALLBACK' && state === 'REAL_READY') {
      this.lateRealUploadRejected++;
      return false;
    }
    if (prev === 'REAL_READY' && state === 'STABLE_FALLBACK') return false;
    if (prev === state) return true;
    this.terminal.set(movieId, state);
    return true;
  }

  noteFallbackReplacedByReal(): void {
    this.fallbackReplacementCount++;
  }

  noteStaleGenerationDrop(): void {
    this.staleGenerationDrops++;
  }

  noteLateRealRejected(): void {
    this.lateRealUploadRejected++;
  }

  noteDecodeStart(scope: UploadScope): void {
    this.pending[scope].decode++;
  }

  noteDecodeEnd(scope: UploadScope): void {
    this.pending[scope].decode = clamp0(this.pending[scope].decode - 1);
  }

  noteUploadQueued(scope: UploadScope): void {
    this.pending[scope].upload++;
  }

  noteUploadFinished(scope: UploadScope): void {
    this.pending[scope].upload = clamp0(this.pending[scope].upload - 1);
  }

  resetUploadPendingForTests(): void {
    for (const scope of SCOPES) this.pending[scope].upload = 0;
  }

  scopedPending(scope: UploadScope = 'STORE_VISIBLE_BASE'): ScopedPending {
    const row = this.pending[scope];
    return { decode: row.decode, upload: row.upload, work: row.decode + row.upload };
  }

  snapshot(): StoreVisibleWorkSnapshot {
    const base = this.scopedPending('STORE_VISIBLE_BASE');
    let realReady = 0;
    let stableFallback = 0;
    for (const id of this.expected) {
      const t = this.terminal.get(id);
      if (t === 'REAL_READY') realReady++;
      else if (t === 'STABLE_FALLBACK') stableFallback++;
    }
    return {
      generation: this.generation,
      expected: this.expected.size,
      realReady,
      stableFallback,
      missing: Math.max(0, this.expected.size - realReady - stableFallback),
      pendingDecode: base.decode,
      pendingUpload: base.upload,
      pendingWork: base.work,
      onDemandPendingWork: this.scopedPending('ON_DEMAND').work,
      lateRealUploadRejected: this.lateRealUploadRejected,
      staleGenerationDrops: this.staleGenerationDrops,
      fallbackReplacementCount: this.fallbackReplacementCount,
    };
  }
}

export const storeVisibleWork = new StoreVisibleWork();
