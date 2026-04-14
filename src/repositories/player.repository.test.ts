import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../db/client.js";
import { createPlayerRepository } from "./player.repository.js";

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

describe("createPlayerRepository", () => {
  it("keeps last_scan_date at the newest value regardless of arrival order", () => {
    // Regression: the upstream page has no ordering guarantee, so an earlier
    // scan can be applied after a later one. Writing the incoming value
    // unconditionally made a player's "last seen" time move backwards.
    const repo = createPlayerRepository(db);
    repo.incrementScanCount("badge-001", "2026-02-04T15:00:00");
    repo.incrementScanCount("badge-001", "2026-02-04T09:00:00");

    const player = repo.getPlayerById("badge-001");
    expect(player?.scanCount).toBe(2);
    expect(player?.lastScanDate).toBe("2026-02-04T15:00:00");
  });

  it("paginates the leaderboard and reports the full total", () => {
    const repo = createPlayerRepository(db);
    repo.incrementScanCount("badge-a", "2026-02-04T09:00:00");
    repo.incrementScanCount("badge-a", "2026-02-04T10:00:00");
    repo.incrementScanCount("badge-b", "2026-02-04T09:30:00");
    repo.incrementScanCount("badge-c", "2026-02-04T09:40:00");

    const firstPage = repo.getPlayerPage(2, 0);
    expect(firstPage.total).toBe(3);
    expect(firstPage.players).toHaveLength(2);
    expect(firstPage.players[0]?.badgeId).toBe("badge-a");

    const secondPage = repo.getPlayerPage(2, 2);
    expect(secondPage.players).toHaveLength(1);
  });

  it("orders ties deterministically so pagination cannot repeat or drop a row", () => {
    const repo = createPlayerRepository(db);
    for (const badge of ["badge-c", "badge-a", "badge-b"]) {
      repo.incrementScanCount(badge, "2026-02-04T09:00:00");
    }
    expect(repo.getLeaderboard(3).map((p) => p.badgeId)).toEqual(["badge-a", "badge-b", "badge-c"]);
  });

  it("reports top and bottom players, and nothing at all when empty", () => {
    const repo = createPlayerRepository(db);
    expect(repo.getTopPlayer()).toBeNull();
    expect(repo.getBottomPlayer()).toBeNull();

    repo.incrementScanCount("badge-a", "2026-02-04T09:00:00");
    repo.incrementScanCount("badge-a", "2026-02-04T10:00:00");
    repo.incrementScanCount("badge-b", "2026-02-04T09:30:00");

    expect(repo.getTopPlayer()?.badgeId).toBe("badge-a");
    expect(repo.getBottomPlayer()?.badgeId).toBe("badge-b");
  });
});
