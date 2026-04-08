import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../db/client.js";
import { createScanRepository, type ScanRepository } from "./scan.repository.js";

let db: Database.Database;
let repo: ScanRepository;

beforeEach(() => {
  db = openDatabase(":memory:");
  repo = createScanRepository(db);
  repo.insertScan({ badgeId: "b1", boothName: "Lab_2", scanDate: "2026-02-04T09:00:00" });
  repo.insertScan({ badgeId: "b2", boothName: "Lab22", scanDate: "2026-02-04T10:00:00" });
  repo.insertScan({ badgeId: "b3", boothName: "100% Uptime", scanDate: "2026-02-05T11:00:00" });
  repo.insertScan({ badgeId: "b4", boothName: "1000 Nodes", scanDate: "2026-02-05T12:00:00" });
});

afterEach(() => {
  db.close();
});

const page = { limit: 50, offset: 0 };

function boothsMatching(boothName: string): string[] {
  return repo.searchScans({ boothName, ...page }).rows.map((r) => r.booth_name);
}

describe("searchScans", () => {
  it("treats an underscore in boothName as a literal character", () => {
    expect(boothsMatching("Lab_")).toEqual(["Lab_2"]);
  });

  it("treats a percent sign in boothName as a literal character", () => {
    expect(boothsMatching("100%")).toEqual(["100% Uptime"]);
  });

  it("still matches boothName as a case-insensitive substring", () => {
    expect(boothsMatching("lab")).toEqual(["Lab_2", "Lab22"]);
  });

  it("matches scanDate as a prefix and does not let a wildcard widen it", () => {
    expect(repo.searchScans({ scanDate: "2026-02-05", ...page }).total).toBe(2);
    expect(repo.searchScans({ scanDate: "2026-02-0_", ...page }).total).toBe(0);
  });

  it("is idempotent on (badge_id, scan_date)", () => {
    expect(
      repo.insertScan({ badgeId: "b1", boothName: "Lab_2", scanDate: "2026-02-04T09:00:00" }),
    ).toBe(false);
    expect(repo.countScans()).toBe(4);
  });
});
