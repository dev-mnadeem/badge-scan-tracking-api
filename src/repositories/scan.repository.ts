import type Database from "better-sqlite3";
import type { Scan } from "../types/domain.js";

export interface ScanRow {
  badge_id: string;
  booth_name: string;
  scan_date: string;
}

export interface ScanSearchParams {
  badgeId?: string | undefined;
  boothName?: string | undefined;
  scanDate?: string | undefined;
  limit: number;
  offset: number;
}

export interface ScanPage {
  rows: ScanRow[];
  total: number;
}

export interface BoothStats {
  boothName: string;
  scanCount: number;
  uniquePlayers: number;
  lastScanDate: string | null;
}

const SCAN_COLUMNS = "badge_id, booth_name, scan_date";

export function createScanRepository(db: Database.Database) {
  const insertStmt = db.prepare<[string, string, string]>(`
    INSERT OR IGNORE INTO scans (badge_id, booth_name, scan_date)
    VALUES (?, ?, ?)
  `);

  /**
   * `searchScans` builds its WHERE clause from whichever filters were supplied,
   * so there is a small fixed set of possible statements. They are prepared once
   * and reused rather than re-prepared per request.
   */
  const statementCache = new Map<string, Database.Statement>();
  function cached(sql: string): Database.Statement {
    let stmt = statementCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      statementCache.set(sql, stmt);
    }
    return stmt;
  }

  const boothStatsStmt = db.prepare<[number, number], BoothStats>(`
    SELECT booth_name       AS boothName,
           COUNT(*)         AS scanCount,
           COUNT(DISTINCT badge_id) AS uniquePlayers,
           MAX(scan_date)   AS lastScanDate
    FROM scans
    GROUP BY booth_name
    ORDER BY scanCount DESC, boothName ASC
    LIMIT ? OFFSET ?
  `);

  const boothCountStmt = db.prepare<[], { count: number }>(
    "SELECT COUNT(DISTINCT booth_name) AS count FROM scans",
  );

  const totalScansStmt = db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM scans");

  return {
    /** Returns true when the row was new. Re-polling the same window is a no-op. */
    insertScan(scan: Scan): boolean {
      return insertStmt.run(scan.badgeId, scan.boothName, scan.scanDate).changes > 0;
    },

    /**
     * Filter by exact badgeId, a substring of boothName, and/or a scanDate
     * prefix (e.g. "2026-02-04"). Always paginated.
     */
    searchScans(params: ScanSearchParams): ScanPage {
      const { badgeId, boothName, scanDate, limit, offset } = params;

      const conditions: string[] = [];
      const args: string[] = [];

      if (badgeId) {
        conditions.push("badge_id = ?");
        args.push(badgeId);
      }
      if (boothName) {
        conditions.push("booth_name LIKE ?");
        args.push(`%${boothName}%`);
      }
      if (scanDate) {
        conditions.push("scan_date LIKE ?");
        args.push(`${scanDate}%`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const countRow = cached(`SELECT COUNT(*) AS count FROM scans ${where}`).get(...args) as
        { count: number } | undefined;

      const rows = cached(
        `SELECT ${SCAN_COLUMNS} FROM scans ${where} ORDER BY scan_date ASC, badge_id ASC LIMIT ? OFFSET ?`,
      ).all(...args, limit, offset) as ScanRow[];

      return { rows, total: countRow?.count ?? 0 };
    },

    /** Per-booth totals. Backed by idx_scans_booth_name. */
    getBoothStats(limit: number, offset: number): { booths: BoothStats[]; total: number } {
      return {
        booths: boothStatsStmt.all(limit, offset),
        total: boothCountStmt.get()?.count ?? 0,
      };
    },

    countScans(): number {
      return totalScansStmt.get()?.count ?? 0;
    },
  };
}

export type ScanRepository = ReturnType<typeof createScanRepository>;
