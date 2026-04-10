import type { RawScan } from "../types/api.js";

/**
 * Half-open time window, exclusive at both ends, expressed in epoch milliseconds.
 * Matches the upstream `scanDateGT` / `scanDateLT` semantics.
 */
export interface ScanWindow {
  fromMs: number;
  toMs: number;
}

/**
 * The seam between the poller and whatever is producing scans. The HTTP
 * implementation talks to EventsCloud; the fake replays a fixture. Both honour
 * the same page cap, so the window-subdivision logic in the poller is exercised
 * identically against either.
 */
export interface ScanProvider {
  /** Identifies the bound implementation in logs and on GET /metrics. */
  readonly name: string;
  /** Largest number of rows a single call can return. */
  readonly pageSize: number;
  fetchScans(window: ScanWindow): Promise<RawScan[]>;
}
