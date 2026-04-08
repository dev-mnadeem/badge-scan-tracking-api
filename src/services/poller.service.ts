import type { RawScan } from "../types/api.js";
import { toUtcMs } from "../config/time.js";
import type { ScanProvider, ScanWindow } from "../providers/scan-provider.js";
import { retryWithBackoff, type RetryOptions } from "../utils/retry.js";
import { logger } from "../utils/logger.js";

export interface ScanFetcherOptions {
  provider: ScanProvider;
  retry: Omit<RetryOptions, "label">;
}

export interface ScanFetcher {
  /**
   * Yields every scan in the exclusive interval (`fromDate`, `toDate`) as
   * sub-batches, each strictly smaller than the provider's page size, in
   * ascending window order.
   */
  fetchRange(fromDate: string, toDate: string): AsyncGenerator<RawScan[]>;
}

/**
 * The upstream API caps a response at `pageSize` rows and gives no ordering or
 * cursor. Paging by "max scanDate seen so far" is unsafe, because many scans
 * share a scanDate and rows past the cap would be skipped. Instead an
 * overflowing window is bisected in the time domain until every response comes
 * back under the cap, which needs no ordering guarantee from the provider.
 */
export function createScanFetcher(options: ScanFetcherOptions): ScanFetcher {
  const { provider, retry } = options;

  async function fetchWindow(window: ScanWindow): Promise<RawScan[]> {
    return retryWithBackoff(() => provider.fetchScans(window), {
      ...retry,
      label: `scan-provider:${provider.name}`,
    });
  }

  async function* walk(fromMs: number, toMs: number): AsyncGenerator<RawScan[]> {
    if (fromMs >= toMs) {
      return;
    }

    const batch = await fetchWindow({ fromMs, toMs });
    logger.debug({ fromMs, toMs, rows: batch.length }, "Scan window fetched");

    if (batch.length === 0) {
      return;
    }

    if (batch.length < provider.pageSize) {
      yield batch;
      return;
    }

    // The window is exclusive at both ends, so its interior spans
    // (toMs - fromMs - 1) milliseconds. Fewer than two of those and there is no
    // interior point to bisect on.
    const width = toMs - fromMs;
    if (width < 3) {
      throw new Error(
        `Scan fetch: at least ${provider.pageSize} scans fall inside a ${width}ms window and it ` +
          "cannot be subdivided further. Raise SCAN_PAGE_SIZE or check the upstream clock precision.",
      );
    }

    // `split` lands in [fromMs + 1, toMs - 2]. The halves are (fromMs, split + 1)
    // and (split, toMs): the first ends after `split`, the second begins before
    // it, so `split` itself falls inside exactly one of them. Splitting into
    // (fromMs, split) and (split, toMs) instead would leave `split` outside both
    // windows — with exclusive bounds on each side, any scan at that exact
    // millisecond would never be fetched.
    const split = fromMs + Math.floor(width / 2);

    logger.info({ fromMs, toMs, split }, "Scan window overflowed page size, bisecting");

    yield* walk(fromMs, split + 1);
    yield* walk(split, toMs);
  }

  return {
    async *fetchRange(fromDate: string, toDate: string): AsyncGenerator<RawScan[]> {
      const fromMs = toUtcMs(fromDate);
      const toMs = toUtcMs(toDate);
      if (fromMs >= toMs) {
        logger.warn(
          { fromDate, toDate },
          "Empty fetch range (lower bound not before upper), skipping",
        );
        return;
      }
      yield* walk(fromMs, toMs);
    },
  };
}
