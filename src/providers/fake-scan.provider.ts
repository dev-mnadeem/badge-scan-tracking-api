import { readFileSync } from "node:fs";
import { ApiResponseSchema, type RawScan } from "../types/api.js";
import { toUtcMs } from "../config/time.js";
import type { ScanProvider, ScanWindow } from "./scan-provider.js";

export interface FakeScanProviderOptions {
  scans: RawScan[];
  /** Mirrors the upstream page cap so the poller's subdivision path is exercised offline. */
  pageSize: number;
}

/**
 * Replays a fixed set of scans with the same contract as the live API:
 * both bounds exclusive, at most `pageSize` rows per call, and **no ordering
 * guarantee** — rows come back in fixture order, so code that assumes the first
 * page is the earliest page will fail here exactly as it would in production.
 *
 * Deterministic: the same window always yields the same rows.
 */
export function createFakeScanProvider(options: FakeScanProviderOptions): ScanProvider {
  const { scans, pageSize } = options;

  return {
    name: "fake",
    pageSize,

    fetchScans({ fromMs, toMs }: ScanWindow): Promise<RawScan[]> {
      if (fromMs >= toMs) {
        return Promise.reject(new RangeError("scanDateGT must be strictly less than scanDateLT"));
      }
      const matches = scans.filter((scan) => {
        const ms = toUtcMs(scan.scanDate);
        return ms > fromMs && ms < toMs;
      });
      return Promise.resolve(matches.slice(0, pageSize));
    },
  };
}

/** Loads and validates a fixture file written in the upstream response shape. */
export function loadScanFixture(path: string): RawScan[] {
  const parsed = ApiResponseSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`Scan fixture at ${path} does not match the upstream response shape`);
  }
  return parsed.data;
}
