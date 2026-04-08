import type Database from "better-sqlite3";
import type { RawScan } from "../types/api.js";
import type { Scan } from "../types/domain.js";
import { laterOf, toUtcIso, toUtcMs } from "../config/time.js";
import { createScanRepository } from "../repositories/scan.repository.js";
import { createPlayerRepository } from "../repositories/player.repository.js";
import { createCheckpointRepository } from "../repositories/checkpoint.repository.js";
import type { ScanFetcher } from "./poller.service.js";
import type { Broadcaster } from "../websocket/broadcaster.js";
import type { PollMetrics } from "../metrics/registry.js";
import { logger } from "../utils/logger.js";

export interface PollCycleOptions {
  db: Database.Database;
  fetcher: ScanFetcher;
  broadcaster: Broadcaster;
  metrics: PollMetrics;
  /** Cursor to use the first time the checkpoint table is empty. */
  eventStartDate: string;
  /** How many players a broadcast carries. */
  leaderboardLimit: number;
  /** Injectable clock so a test can pin the upper bound of the poll window. */
  now?: () => Date;
}

export interface PollCycleResult {
  batches: number;
  scansSeen: number;
  scansSkippedNoBooth: number;
  scansInserted: number;
  checkpoint: string;
}

/**
 * Keeps only scans that carry a usable booth name. The upstream feed contains
 * rows whose "Booth Name" custom field is absent or blank — they identify no
 * booth, so they cannot be attributed and are not counted.
 */
export function toValidScan(raw: RawScan): Scan | null {
  const boothName = raw.customFields?.[0]?.["Booth Name"]?.trim();
  if (!boothName) {
    return null;
  }
  return { badgeId: raw.badgeId, boothName, scanDate: raw.scanDate };
}

/** Latest scanDate in a batch, compared as instants rather than as raw strings. */
export function maxScanDate(batch: RawScan[], fallback: string): string {
  return batch.reduce<string>((max, raw) => laterOf(max, raw.scanDate), fallback);
}

/**
 * One polling pass: read the cursor, pull every scan between it and now,
 * persist each sub-batch atomically together with the cursor advance, and push
 * the refreshed leaderboard to WebSocket clients after each sub-batch.
 *
 * Re-running a cycle over an already-ingested window is a no-op: the scan
 * insert is `INSERT OR IGNORE` on `(badge_id, scan_date)` and the per-player
 * counter is only incremented when that insert actually created a row.
 */
export async function runPollCycle(options: PollCycleOptions): Promise<PollCycleResult> {
  const {
    db,
    fetcher,
    broadcaster,
    metrics,
    eventStartDate,
    leaderboardLimit,
    now = () => new Date(),
  } = options;

  const scanRepo = createScanRepository(db);
  const playerRepo = createPlayerRepository(db);
  const checkpointRepo = createCheckpointRepository(db);

  const fromDate = checkpointRepo.getLastScanDate() ?? eventStartDate;
  const toDate = now().toISOString();

  logger.info({ fromDate: toUtcIso(fromDate), toDate }, "Poll cycle started");

  const result: PollCycleResult = {
    batches: 0,
    scansSeen: 0,
    scansSkippedNoBooth: 0,
    scansInserted: 0,
    checkpoint: fromDate,
  };

  for await (const rawBatch of fetcher.fetchRange(fromDate, toDate)) {
    const validScans = rawBatch.map(toValidScan).filter((s): s is Scan => s !== null);

    // The cursor may only move forward. Windows arrive in ascending order, but a
    // provider that returns a stale row must not be able to rewind the cursor and
    // cause the whole event to be re-ingested.
    const batchMax = maxScanDate(rawBatch, result.checkpoint);
    const nextCheckpoint =
      toUtcMs(batchMax) > toUtcMs(result.checkpoint) ? batchMax : result.checkpoint;

    // Inserts and the cursor advance commit together, so a crash mid-batch
    // leaves the cursor where it was and the batch is simply re-fetched.
    const inserted = db.transaction(() => {
      let count = 0;
      for (const scan of validScans) {
        if (scanRepo.insertScan(scan)) {
          playerRepo.incrementScanCount(scan.badgeId, scan.scanDate);
          count++;
        }
      }
      checkpointRepo.setLastScanDate(nextCheckpoint);
      return count;
    })();

    const skipped = rawBatch.length - validScans.length;
    result.batches++;
    result.scansSeen += rawBatch.length;
    result.scansSkippedNoBooth += skipped;
    result.scansInserted += inserted;
    result.checkpoint = nextCheckpoint;

    metrics.batchProcessed({ seen: rawBatch.length, skippedNoBooth: skipped, inserted });

    logger.info(
      { rows: rawBatch.length, skippedNoBooth: skipped, inserted, checkpoint: nextCheckpoint },
      "Batch committed",
    );

    // Only broadcast when something changed, and only the bounded leaderboard —
    // a full player table would be re-read and re-serialised for every sub-batch
    // of a backfill.
    if (inserted > 0) {
      broadcaster.publish(playerRepo.getLeaderboard(leaderboardLimit));
    }
  }

  logger.info(result, "Poll cycle complete");
  return result;
}
