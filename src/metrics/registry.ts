/**
 * Small in-process counter set backing GET /metrics. Deliberately not Prometheus:
 * a single-node poller with one writer does not need a scrape target, and a
 * reviewer can still see whether polling is actually working.
 */
export interface PollMetricsSnapshot {
  cyclesStarted: number;
  cyclesSucceeded: number;
  cyclesFailed: number;
  cyclesSkippedOverlapping: number;
  batchesProcessed: number;
  scansSeen: number;
  scansSkippedNoBooth: number;
  scansInserted: number;
  lastCycleStartedAt: string | null;
  lastCycleSucceededAt: string | null;
  lastCycleDurationMs: number | null;
  lastError: { message: string; at: string } | null;
}

export interface PollMetrics {
  cycleStarted(): void;
  cycleSucceeded(durationMs: number): void;
  cycleFailed(err: unknown): void;
  cycleSkipped(): void;
  batchProcessed(input: { seen: number; skippedNoBooth: number; inserted: number }): void;
  snapshot(): PollMetricsSnapshot;
}

export function createPollMetrics(now: () => Date = () => new Date()): PollMetrics {
  const state: PollMetricsSnapshot = {
    cyclesStarted: 0,
    cyclesSucceeded: 0,
    cyclesFailed: 0,
    cyclesSkippedOverlapping: 0,
    batchesProcessed: 0,
    scansSeen: 0,
    scansSkippedNoBooth: 0,
    scansInserted: 0,
    lastCycleStartedAt: null,
    lastCycleSucceededAt: null,
    lastCycleDurationMs: null,
    lastError: null,
  };

  return {
    cycleStarted() {
      state.cyclesStarted++;
      state.lastCycleStartedAt = now().toISOString();
    },
    cycleSucceeded(durationMs: number) {
      state.cyclesSucceeded++;
      state.lastCycleDurationMs = durationMs;
      state.lastCycleSucceededAt = now().toISOString();
    },
    cycleFailed(err: unknown) {
      state.cyclesFailed++;
      state.lastError = {
        message: err instanceof Error ? err.message : String(err),
        at: now().toISOString(),
      };
    },
    cycleSkipped() {
      state.cyclesSkippedOverlapping++;
    },
    batchProcessed({ seen, skippedNoBooth, inserted }) {
      state.batchesProcessed++;
      state.scansSeen += seen;
      state.scansSkippedNoBooth += skippedNoBooth;
      state.scansInserted += inserted;
    },
    snapshot() {
      return { ...state };
    },
  };
}
