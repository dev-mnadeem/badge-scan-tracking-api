import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../db/client.js";
import { createPollMetrics } from "../metrics/registry.js";
import { createNullBroadcaster } from "../websocket/broadcaster.js";
import { createScanFetcher } from "../services/poller.service.js";
import type { ScanProvider } from "../providers/scan-provider.js";
import { startScheduler } from "./index.js";

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const retry = { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, sleep: async () => {} };

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

function schedulerWith(provider: ScanProvider, runOnStartup = false) {
  const metrics = createPollMetrics();
  const handle = startScheduler({
    cronExpression: "*/5 * * * *",
    runOnStartup,
    metrics,
    cycle: {
      db,
      fetcher: createScanFetcher({ provider, retry }),
      broadcaster: createNullBroadcaster(),
      eventStartDate: "2026-02-04T00:00:00.000Z",
      leaderboardLimit: 10,
    },
  });
  return { handle, metrics };
}

describe("startScheduler", () => {
  it("rejects an invalid cron expression instead of silently never polling", () => {
    expect(() =>
      startScheduler({
        cronExpression: "not a cron",
        runOnStartup: false,
        metrics: createPollMetrics(),
        cycle: {
          db,
          fetcher: createScanFetcher({
            provider: { name: "noop", pageSize: 10, fetchScans: async () => [] },
            retry,
          }),
          broadcaster: createNullBroadcaster(),
          eventStartDate: "2026-02-04T00:00:00.000Z",
          leaderboardLimit: 10,
        },
      }),
    ).toThrow(/not a valid cron expression/);
  });

  it("swallows a failing cycle and records it rather than crashing the process", async () => {
    const failing: ScanProvider = {
      name: "failing",
      pageSize: 10,
      fetchScans: async () => {
        throw new Error("upstream unavailable");
      },
    };
    const { handle, metrics } = schedulerWith(failing);

    await expect(handle.trigger()).resolves.toBeUndefined();

    const snapshot = metrics.snapshot();
    expect(snapshot.cyclesFailed).toBe(1);
    expect(snapshot.cyclesSucceeded).toBe(0);
    expect(snapshot.lastError?.message).toBe("upstream unavailable");
    handle.stop();
  });

  it("skips an overlapping tick instead of running two cycles at once", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;

    const slow: ScanProvider = {
      name: "slow",
      pageSize: 10,
      async fetchScans() {
        calls++;
        await gate;
        return [];
      },
    };

    const { handle, metrics } = schedulerWith(slow);

    const first = handle.trigger();
    const second = handle.trigger();
    release?.();
    await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(metrics.snapshot().cyclesSkippedOverlapping).toBe(1);
    expect(metrics.snapshot().cyclesSucceeded).toBe(1);
    handle.stop();
  });

  it("records a successful cycle with a duration", async () => {
    const { handle, metrics } = schedulerWith({
      name: "empty",
      pageSize: 10,
      fetchScans: async () => [],
    });

    await handle.trigger();

    const snapshot = metrics.snapshot();
    expect(snapshot.cyclesSucceeded).toBe(1);
    expect(snapshot.lastCycleDurationMs).not.toBeNull();
    expect(snapshot.lastCycleSucceededAt).not.toBeNull();
    handle.stop();
  });
});
