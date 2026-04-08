import type Database from "better-sqlite3";
import type { PlayerScanCount } from "../types/domain.js";

interface PlayerRow {
  badge_id: string;
  scan_count: number;
  last_scan_date: string | null;
}

export interface PlayerPage {
  players: PlayerScanCount[];
  total: number;
}

function rowToDomain(row: PlayerRow): PlayerScanCount {
  return {
    badgeId: row.badge_id,
    scanCount: row.scan_count,
    lastScanDate: row.last_scan_date,
  };
}

const PLAYER_COLUMNS = "badge_id, scan_count, last_scan_date";

export function createPlayerRepository(db: Database.Database) {
  /**
   * `last_scan_date` is written with MAX(), not with the incoming value. The
   * upstream API returns a page in no particular order, so applying rows in
   * arrival order would let a player's "last seen" time move backwards within
   * a single batch.
   */
  const upsertStmt = db.prepare<[string, string]>(`
    INSERT INTO player_scan_counts (badge_id, scan_count, last_scan_date, updated_at)
    VALUES (?, 1, ?, datetime('now'))
    ON CONFLICT(badge_id) DO UPDATE SET
      scan_count     = scan_count + 1,
      last_scan_date = MAX(COALESCE(player_scan_counts.last_scan_date, ''), excluded.last_scan_date),
      updated_at     = datetime('now')
  `);

  const selectPageStmt = db.prepare<[number, number], PlayerRow>(`
    SELECT ${PLAYER_COLUMNS} FROM player_scan_counts
    ORDER BY scan_count DESC, badge_id ASC
    LIMIT ? OFFSET ?
  `);

  const countStmt = db.prepare<[], { count: number }>(
    "SELECT COUNT(*) AS count FROM player_scan_counts",
  );

  const selectOneStmt = db.prepare<[string], PlayerRow>(
    `SELECT ${PLAYER_COLUMNS} FROM player_scan_counts WHERE badge_id = ?`,
  );

  const selectTopStmt = db.prepare<[], PlayerRow>(`
    SELECT ${PLAYER_COLUMNS} FROM player_scan_counts
    ORDER BY scan_count DESC, badge_id ASC LIMIT 1
  `);

  const selectBottomStmt = db.prepare<[], PlayerRow>(`
    SELECT ${PLAYER_COLUMNS} FROM player_scan_counts
    ORDER BY scan_count ASC, badge_id ASC LIMIT 1
  `);

  const selectLeaderboardStmt = db.prepare<[number], PlayerRow>(`
    SELECT ${PLAYER_COLUMNS} FROM player_scan_counts
    ORDER BY scan_count DESC, badge_id ASC LIMIT ?
  `);

  return {
    /** Records one new scan for a player. Call only when the scan row was actually new. */
    incrementScanCount(badgeId: string, scanDate: string): void {
      upsertStmt.run(badgeId, scanDate);
    },

    /** Paginated leaderboard. There is no unbounded "give me every player" read. */
    getPlayerPage(limit: number, offset: number): PlayerPage {
      return {
        players: selectPageStmt.all(limit, offset).map(rowToDomain),
        total: countStmt.get()?.count ?? 0,
      };
    },

    /** Top `limit` players — what a WebSocket broadcast and the snapshot carry. */
    getLeaderboard(limit: number): PlayerScanCount[] {
      return selectLeaderboardStmt.all(limit).map(rowToDomain);
    },

    getPlayerById(badgeId: string): PlayerScanCount | null {
      const row = selectOneStmt.get(badgeId);
      return row ? rowToDomain(row) : null;
    },

    getTopPlayer(): PlayerScanCount | null {
      const row = selectTopStmt.get();
      return row ? rowToDomain(row) : null;
    },

    getBottomPlayer(): PlayerScanCount | null {
      const row = selectBottomStmt.get();
      return row ? rowToDomain(row) : null;
    },
  };
}

export type PlayerRepository = ReturnType<typeof createPlayerRepository>;
