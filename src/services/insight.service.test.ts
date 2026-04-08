import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../db/client.js";
import { createScanRepository } from "../repositories/scan.repository.js";
import { createPlayerRepository } from "../repositories/player.repository.js";
import {
  computeEventStats,
  createAnthropicInsightProvider,
  createInsightService,
  createLocalInsightProvider,
  type InsightProvider,
} from "./insight.service.js";

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

function seed(): void {
  const scans = createScanRepository(db);
  const players = createPlayerRepository(db);
  const rows = [
    ["badge-a", "Cisco Showcase", "2026-02-04T09:00:00"],
    ["badge-a", "Cisco Showcase", "2026-02-04T10:00:00"],
    ["badge-b", "Cisco Showcase", "2026-02-04T11:00:00"],
    ["badge-b", "Splunk Cafe", "2026-02-04T12:00:00"],
  ] as const;
  for (const [badgeId, boothName, scanDate] of rows) {
    scans.insertScan({ badgeId, boothName, scanDate });
    players.incrementScanCount(badgeId, scanDate);
  }
}

describe("computeEventStats", () => {
  it("reports zeroes for an empty database", () => {
    const stats = computeEventStats(db);
    expect(stats).toMatchObject({
      totalScans: 0,
      totalPlayers: 0,
      totalBooths: 0,
      averageScansPerPlayer: 0,
      busiestBooth: null,
      quietestBooth: null,
    });
  });

  it("derives every figure from the stored scans", () => {
    seed();
    const stats = computeEventStats(db);

    expect(stats.totalScans).toBe(4);
    expect(stats.totalPlayers).toBe(2);
    expect(stats.totalBooths).toBe(2);
    expect(stats.averageScansPerPlayer).toBe(2);
    expect(stats.busiestBooth).toEqual({
      boothName: "Cisco Showcase",
      scanCount: 3,
      uniquePlayers: 2,
    });
    expect(stats.quietestBooth?.boothName).toBe("Splunk Cafe");
    expect(stats.topPlayerScanCount).toBe(2);
    expect(stats.bottomPlayerScanCount).toBe(2);
  });
});

describe("createLocalInsightProvider", () => {
  it("needs no API key and is deterministic", async () => {
    seed();
    const stats = computeEventStats(db);
    const provider = createLocalInsightProvider();

    const first = await provider.summarize(stats);
    const second = await provider.summarize(stats);

    expect(first).toBe(second);
    expect(first).toContain("4 booth scans");
    expect(first).toContain("Cisco Showcase is the busiest booth with 3 scans");
  });

  it("says so plainly when nothing has been ingested", async () => {
    const text = await createLocalInsightProvider().summarize(computeEventStats(db));
    expect(text).toBe("No booth scans have been ingested yet, so there is nothing to report.");
  });
});

describe("createAnthropicInsightProvider", () => {
  it("passes the computed stats to the model and returns its text", async () => {
    seed();
    const complete = vi.fn().mockResolvedValue("Traffic is concentrated at one booth.");
    const provider = createAnthropicInsightProvider({
      apiKey: "test-key",
      model: "claude-opus-5",
      complete,
    });

    await expect(provider.summarize(computeEventStats(db))).resolves.toBe(
      "Traffic is concentrated at one booth.",
    );
    const [prompt, model] = complete.mock.calls[0]!;
    expect(model).toBe("claude-opus-5");
    expect(JSON.parse(prompt as string).totalScans).toBe(4);
  });

  it("treats a declined or empty completion as no answer", async () => {
    const provider = createAnthropicInsightProvider({
      apiKey: "test-key",
      model: "claude-opus-5",
      complete: async () => null,
    });
    await expect(provider.summarizeOrNull(computeEventStats(db))).resolves.toBeNull();
    await expect(provider.summarize(computeEventStats(db))).rejects.toThrow(/no usable text/);
  });
});

describe("createInsightService", () => {
  it("uses the primary provider when it answers", async () => {
    seed();
    const primary: InsightProvider = { name: "anthropic", summarize: async () => "model prose" };
    const service = createInsightService({ db, primary, fallback: createLocalInsightProvider() });

    const briefing = await service.briefing();
    expect(briefing.provider).toBe("anthropic");
    expect(briefing.text).toBe("model prose");
    expect(briefing.stats.totalScans).toBe(4);
  });

  it("falls back to the local briefing when the primary provider fails", async () => {
    seed();
    const onPrimaryError = vi.fn();
    const primary: InsightProvider = {
      name: "anthropic",
      summarize: async () => {
        throw new Error("401 authentication_error");
      },
    };

    const briefing = await createInsightService({
      db,
      primary,
      fallback: createLocalInsightProvider(),
      onPrimaryError,
    }).briefing();

    expect(briefing.provider).toBe("local");
    expect(briefing.text).toContain("4 booth scans");
    expect(onPrimaryError).toHaveBeenCalledOnce();
  });

  it("does not call the fallback twice when it is also the primary", async () => {
    const summarize = vi.fn().mockResolvedValue("local prose");
    const local: InsightProvider = { name: "local", summarize };

    const briefing = await createInsightService({ db, primary: local, fallback: local }).briefing();

    expect(briefing.provider).toBe("local");
    expect(summarize).toHaveBeenCalledOnce();
  });
});
