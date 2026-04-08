import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../db/client.js";
import { createFakeScanProvider, loadScanFixture } from "../providers/fake-scan.provider.js";
import { createNullBroadcaster, type Broadcaster } from "../websocket/broadcaster.js";
import { createPollMetrics } from "../metrics/registry.js";
import { createPlayerRepository } from "../repositories/player.repository.js";
import { createScanRepository } from "../repositories/scan.repository.js";
import { createCheckpointRepository } from "../repositories/checkpoint.repository.js";
import { createScanFetcher } from "./poller.service.js";
import { maxScanDate, runPollCycle, toValidScan } from "./scan.service.js";
import type { RawScan } from "../types/api.js";

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const retry = { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2, sleep: async () => {} };
const EVENT_START = "2026-02-04T00:00:00.000Z";
const AFTER_EVENT = new Date("2026-02-05T00:00:00.000Z");

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

function cycleOptions(
  scans: RawScan[],
  pageSize: number,
  broadcaster: Broadcaster = createNullBroadcaster(),
) {
  return {
    db,
    fetcher: createScanFetcher({
      provider: createFakeScanProvider({ scans, pageSize }),
      retry,
    }),
    broadcaster,
    metrics: createPollMetrics(),
    eventStartDate: EVENT_START,
    leaderboardLimit: 100,
    now: () => AFTER_EVENT,
  };
}

describe("toValidScan", () => {
  it("keeps a scan that names a booth and trims it", () => {
    expect(
      toValidScan({
        badgeId: "b1",
        scanDate: "2026-02-04T09:00:00",
        customFields: [{ "Booth Name": "  Cisco Showcase  " }],
      }),
    ).toEqual({ badgeId: "b1", boothName: "Cisco Showcase", scanDate: "2026-02-04T09:00:00" });
  });

  it("drops a scan with a blank, whitespace-only or missing booth name", () => {
    const base = { badgeId: "b1", scanDate: "2026-02-04T09:00:00" };
    expect(toValidScan({ ...base, customFields: [{ "Booth Name": "" }] })).toBeNull();
    expect(toValidScan({ ...base, customFields: [{ "Booth Name": "   " }] })).toBeNull();
    expect(toValidScan({ ...base, customFields: [{}] })).toBeNull();
    expect(toValidScan(base)).toBeNull();
  });
});

describe("maxScanDate", () => {
  it("compares instants, not raw strings", () => {
    const batch: RawScan[] = [
      { badgeId: "a", scanDate: "2026-02-04T09:00:00" },
      { badgeId: "b", scanDate: "2026-02-04T11:00:00.000Z" },
      { badgeId: "c", scanDate: "2026-02-04T10:00:00" },
    ];
    expect(maxScanDate(batch, EVENT_START)).toBe("2026-02-04T11:00:00.000Z");
  });

  it("returns the fallback for an empty batch", () => {
    expect(maxScanDate([], EVENT_START)).toBe(EVENT_START);
  });
});

describe("runPollCycle over the checked-in fixture", () => {
  const fixture = loadScanFixture("./fixtures/sample-scans.json");
  const usable = fixture.filter((s) => toValidScan(s) !== null);

  it("ingests every usable scan and skips the ones with no booth name", async () => {
    const result = await runPollCycle(cycleOptions(fixture, 1000));

    expect(result.scansSeen).toBe(fixture.length);
    expect(result.scansInserted).toBe(usable.length);
    expect(result.scansSkippedNoBooth).toBe(fixture.length - usable.length);
    expect(createScanRepository(db).countScans()).toBe(usable.length);
  });

  it("is idempotent — a second cycle over the same window inserts nothing new", async () => {
    const first = await runPollCycle(cycleOptions(fixture, 1000));

    // Reset the cursor so the identical window is polled a second time.
    createCheckpointRepository(db).setLastScanDate(EVENT_START);
    const second = await runPollCycle(cycleOptions(fixture, 1000));

    expect(second.scansSeen).toBe(first.scansSeen);
    expect(second.scansInserted).toBe(0);
    expect(createScanRepository(db).countScans()).toBe(first.scansInserted);

    // Counters must not double either — they are only bumped on a real insert.
    const totalCounted = createPlayerRepository(db)
      .getLeaderboard(1000)
      .reduce((sum, p) => sum + p.scanCount, 0);
    expect(totalCounted).toBe(first.scansInserted);
  });

  it("produces the same result whether the provider pages or not", async () => {
    const whole = await runPollCycle(cycleOptions(fixture, 1000));
    const wholeRows = createScanRepository(db).countScans();

    db.close();
    db = openDatabase(":memory:");

    const paged = await runPollCycle(cycleOptions(fixture, 25));

    expect(paged.batches).toBeGreaterThan(whole.batches);
    expect(paged.scansInserted).toBe(whole.scansInserted);
    expect(createScanRepository(db).countScans()).toBe(wholeRows);
  });

  it("advances the checkpoint to the latest scan it actually saw", async () => {
    const result = await runPollCycle(cycleOptions(fixture, 1000));
    const latest = usable.reduce((max, s) => (s.scanDate > max ? s.scanDate : max), "");

    expect(createCheckpointRepository(db).getLastScanDate()).toBe(result.checkpoint);
    expect(result.checkpoint).toBe(latest);
  });

  it("never rewinds the checkpoint when the provider replays an old row", async () => {
    await runPollCycle(cycleOptions(fixture, 1000));
    const advanced = createCheckpointRepository(db).getLastScanDate();

    const stale: RawScan[] = [
      {
        badgeId: "badge-999",
        scanDate: "2026-02-04T09:00:01",
        customFields: [{ "Booth Name": "Late Arrival" }],
      },
    ];
    await runPollCycle(cycleOptions(stale, 1000));

    expect(createCheckpointRepository(db).getLastScanDate()).toBe(advanced);
  });

  it("broadcasts only when a batch actually inserted something", async () => {
    const publish = vi.fn().mockReturnValue(1);
    const broadcaster: Broadcaster = { publish, clientCount: () => 1 };

    await runPollCycle(cycleOptions(fixture, 1000, broadcaster));
    expect(publish).toHaveBeenCalledTimes(1);

    publish.mockClear();
    createCheckpointRepository(db).setLastScanDate(EVENT_START);
    await runPollCycle(cycleOptions(fixture, 1000, broadcaster));
    expect(publish).not.toHaveBeenCalled();
  });

  it("sends at most `leaderboardLimit` players in a broadcast", async () => {
    const publish = vi.fn().mockReturnValue(1);
    const options = {
      ...cycleOptions(fixture, 1000, { publish, clientCount: () => 1 }),
      leaderboardLimit: 5,
    };

    await runPollCycle(options);

    expect(publish).toHaveBeenCalled();
    for (const [players] of publish.mock.calls) {
      expect(players.length).toBeLessThanOrEqual(5);
    }
  });

  it("leaves the checkpoint untouched when the provider keeps failing", async () => {
    const failing = {
      name: "failing",
      pageSize: 1000,
      fetchScans: async () => {
        throw new Error("upstream unavailable");
      },
    };

    await expect(
      runPollCycle({
        ...cycleOptions([], 1000),
        fetcher: createScanFetcher({ provider: failing, retry }),
      }),
    ).rejects.toThrow("upstream unavailable");

    expect(createCheckpointRepository(db).getLastScanDate()).toBeNull();
    expect(createScanRepository(db).countScans()).toBe(0);
  });
});
