import express from "express";
import request from "supertest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createApp } from "../app.js";
import { openDatabase } from "../db/client.js";
import { createPollMetrics } from "../metrics/registry.js";
import { createNullBroadcaster } from "../websocket/broadcaster.js";
import { createInsightService, createLocalInsightProvider } from "../services/insight.service.js";
import { createScanRepository } from "../repositories/scan.repository.js";
import { createPlayerRepository } from "../repositories/player.repository.js";
import { syncHandler } from "./middleware/async-handler.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { UnauthorizedError } from "./errors/index.js";

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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
    ["badge-a", "Splunk Cafe", "2026-02-04T13:00:00"],
    ["badge-b", "Cisco Showcase", "2026-02-04T11:00:00"],
    ["badge-c", "Splunk Cafe", "2026-02-04T12:00:00"],
  ] as const;
  for (const [badgeId, boothName, scanDate] of rows) {
    scans.insertScan({ badgeId, boothName, scanDate });
    players.incrementScanCount(badgeId, scanDate);
  }
}

function app() {
  const local = createLocalInsightProvider();
  return createApp({
    db,
    metrics: createPollMetrics(),
    broadcaster: createNullBroadcaster(),
    insights: createInsightService({ db, primary: local, fallback: local }),
    scanProviderName: "fake",
  });
}

describe("GET /health", () => {
  it("returns a success envelope after probing the database", async () => {
    const res = await request(app()).get("/health").expect(200);
    expect(res.body).toMatchObject({ success: true, error: null });
    expect(res.body.data).toMatchObject({ ok: true, database: "ok" });
    expect(typeof res.body.data.ts).toBe("string");
  });

  it("reports 503 when the database can no longer be queried", async () => {
    const doomed = openDatabase(":memory:");
    const local = createLocalInsightProvider();
    const instance = createApp({
      db: doomed,
      metrics: createPollMetrics(),
      broadcaster: createNullBroadcaster(),
      insights: createInsightService({ db: doomed, primary: local, fallback: local }),
      scanProviderName: "fake",
    });

    doomed.close();

    const res = await request(instance).get("/health").expect(503);
    expect(res.body).toMatchObject({
      success: false,
      data: null,
      error: { code: "DB_UNAVAILABLE" },
    });
  });
});

describe("GET /players", () => {
  it("returns a paginated leaderboard", async () => {
    seed();
    const res = await request(app()).get("/players?limit=2").expect(200);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.players).toHaveLength(2);
    expect(res.body.data.players[0].badgeId).toBe("badge-a");
    expect(res.body.data.limit).toBe(2);
  });

  it("rejects a limit above the documented maximum", async () => {
    const res = await request(app()).get("/players?limit=5000").expect(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for top/bottom while no players exist", async () => {
    const res = await request(app()).get("/players/top").expect(404);
    expect(res.body.error.code).toBe("PLAYERS_EMPTY");
  });

  it("resolves /players/top ahead of the :badgeId route", async () => {
    seed();
    const res = await request(app()).get("/players/top").expect(200);
    expect(res.body.data.player.badgeId).toBe("badge-a");
  });

  it("returns a player with a paginated visit history", async () => {
    seed();
    const res = await request(app()).get("/players/badge-a?limit=2").expect(200);
    expect(res.body.data.badgeId).toBe("badge-a");
    expect(res.body.data.scanCount).toBe(3);
    expect(res.body.data.scansTotal).toBe(3);
    expect(res.body.data.scans).toHaveLength(2);
  });

  it("returns 404 for an unknown badge", async () => {
    const res = await request(app()).get("/players/nobody").expect(404);
    expect(res.body.error).toMatchObject({ code: "PLAYER_NOT_FOUND" });
  });
});

describe("GET /scans", () => {
  it("filters by booth name, case-insensitively and partially", async () => {
    seed();
    const res = await request(app()).get("/scans?boothName=cisco").expect(200);
    expect(res.body.data.total).toBe(3);
    expect(
      res.body.data.scans.every((s: { boothName: string }) => s.boothName === "Cisco Showcase"),
    ).toBe(true);
  });

  it("filters by badge and by scan-date prefix together", async () => {
    seed();
    const res = await request(app())
      .get("/scans?badgeId=badge-a&scanDate=2026-02-04T1")
      .expect(200);
    expect(res.body.data.total).toBe(2);
  });

  it("paginates and reports the unfiltered total for the query", async () => {
    seed();
    const res = await request(app()).get("/scans?limit=2&offset=2").expect(200);
    expect(res.body.data.total).toBe(5);
    expect(res.body.data.scans).toHaveLength(2);
    expect(res.body.data.offset).toBe(2);
  });
});

describe("GET /booths", () => {
  it("aggregates scans per booth", async () => {
    seed();
    const res = await request(app()).get("/booths").expect(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.booths[0]).toMatchObject({
      boothName: "Cisco Showcase",
      scanCount: 3,
      uniquePlayers: 2,
    });
  });
});

describe("GET /metrics", () => {
  it("reports poll state, storage and WebSocket client count", async () => {
    seed();
    const res = await request(app()).get("/metrics").expect(200);
    expect(res.body.data.scanProvider).toBe("fake");
    expect(res.body.data.storage.scansStored).toBe(5);
    expect(res.body.data.websocket.connectedClients).toBe(0);
    expect(res.body.data.poll).toMatchObject({ cyclesStarted: 0, cyclesFailed: 0 });
  });
});

describe("GET /insights/summary", () => {
  it("returns a briefing and its underlying stats with no API key configured", async () => {
    seed();
    const res = await request(app()).get("/insights/summary").expect(200);
    expect(res.body.data.provider).toBe("local");
    expect(res.body.data.stats.totalScans).toBe(5);
    expect(res.body.data.text).toContain("5 booth scans");
  });
});

describe("error envelope", () => {
  it("returns a 404 envelope for an unknown route", async () => {
    const res = await request(app()).get("/nope").expect(404);
    expect(res.body).toMatchObject({ success: false, data: null, error: { code: "NOT_FOUND" } });
  });

  function errorApp(): express.Express {
    const instance = express();
    instance.get(
      "/__test/unauthorized",
      syncHandler(() => {
        throw new UnauthorizedError("Invalid token");
      }),
    );
    instance.get(
      "/__test/boom",
      syncHandler(() => {
        throw new Error("boom");
      }),
    );
    instance.use(notFoundHandler);
    instance.use(errorHandler);
    return instance;
  }

  it("maps an AppError to its status and code", async () => {
    const res = await request(errorApp()).get("/__test/unauthorized").expect(401);
    expect(res.body.error).toMatchObject({ code: "UNAUTHORIZED", message: "Invalid token" });
  });

  it("hides internals of an unexpected error unless API_DEBUG_ERRORS=true", async () => {
    const previous = process.env["API_DEBUG_ERRORS"];
    delete process.env["API_DEBUG_ERRORS"];
    try {
      const res = await request(errorApp()).get("/__test/boom").expect(500);
      expect(res.body.error).toMatchObject({
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        details: null,
      });
    } finally {
      if (previous !== undefined) {
        process.env["API_DEBUG_ERRORS"] = previous;
      }
    }
  });

  it("exposes the message and stack when API_DEBUG_ERRORS=true", async () => {
    const previous = process.env["API_DEBUG_ERRORS"];
    process.env["API_DEBUG_ERRORS"] = "true";
    try {
      const res = await request(errorApp()).get("/__test/boom").expect(500);
      expect(res.body.error.message).toContain("boom");
      expect(res.body.error.details.stack).toBeTypeOf("string");
    } finally {
      if (previous === undefined) {
        delete process.env["API_DEBUG_ERRORS"];
      } else {
        process.env["API_DEBUG_ERRORS"] = previous;
      }
    }
  });
});
