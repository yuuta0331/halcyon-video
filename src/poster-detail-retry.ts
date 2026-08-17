// Bounded DETAIL load retry. Not a catalog-sized map: only titles that
// recently failed while they were DETAIL candidates. Scene rebuild resets.

export const DETAIL_MAX_ATTEMPTS = 3;
export const DETAIL_RETRY_DELAYS_MS = [250, 1500] as const;

export interface DetailRetryRow {
  attempts: number;
  nextAt: number;
  gen: number;
  exhausted: boolean;
}

export interface DetailRetrySnapshot {
  tracked: number;
  exhausted: number;
}

const TRACK_CAP = 128;

export class DetailRetryBook {
  private readonly rows = new Map<string, DetailRetryRow>();

  canAttempt(movieId: string, gen: number, now: number): boolean {
    const row = this.live(movieId, gen);
    if (!row) return true;
    if (row.exhausted || row.attempts >= DETAIL_MAX_ATTEMPTS) return false;
    return now >= row.nextAt;
  }

  suppressed(movieId: string, gen: number, now: number): boolean {
    return !this.canAttempt(movieId, gen, now);
  }

  noteFailure(movieId: string, gen: number, now: number): DetailRetryRow {
    this.prune(gen);
    const prev = this.live(movieId, gen);
    const attempts = (prev?.attempts ?? 0) + 1;
    const exhausted = attempts >= DETAIL_MAX_ATTEMPTS;
    const delay = exhausted ? 0 : (DETAIL_RETRY_DELAYS_MS[attempts - 1] ?? DETAIL_RETRY_DELAYS_MS[DETAIL_RETRY_DELAYS_MS.length - 1]!);
    const row: DetailRetryRow = {
      attempts,
      nextAt: exhausted ? Number.POSITIVE_INFINITY : now + delay,
      gen,
      exhausted,
    };
    this.rows.delete(movieId);
    this.rows.set(movieId, row);
    return row;
  }

  exhaust(movieId: string, gen: number): void {
    this.rows.delete(movieId);
    this.rows.set(movieId, {
      attempts: DETAIL_MAX_ATTEMPTS,
      nextAt: Number.POSITIVE_INFINITY,
      gen,
      exhausted: true,
    });
  }

  noteSuccess(movieId: string): void {
    this.rows.delete(movieId);
  }

  attempts(movieId: string): number {
    return this.rows.get(movieId)?.attempts ?? 0;
  }

  reset(): void {
    this.rows.clear();
  }

  snapshot(): DetailRetrySnapshot {
    let exhausted = 0;
    for (const row of this.rows.values()) if (row.exhausted) exhausted++;
    return { tracked: this.rows.size, exhausted };
  }

  private live(movieId: string, gen: number): DetailRetryRow | undefined {
    const row = this.rows.get(movieId);
    if (!row) return undefined;
    if (row.gen !== gen) {
      this.rows.delete(movieId);
      return undefined;
    }
    return row;
  }

  private prune(gen: number): void {
    for (const [id, row] of this.rows) {
      if (row.gen !== gen) this.rows.delete(id);
    }
    while (this.rows.size > TRACK_CAP) {
      const first = this.rows.keys().next().value;
      if (first == null) break;
      this.rows.delete(first);
    }
  }
}

export const posterDetailRetry = new DetailRetryBook();
