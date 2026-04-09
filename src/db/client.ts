import Database from "better-sqlite3";

/**
 * Opens a SQLite database and brings the schema up to date. `":memory:"` is a
 * valid path and is what the test suite uses, so no test touches the filesystem.
 */
export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  if (dbPath !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  runMigrations(db);
  return db;
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scans (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      badge_id    TEXT    NOT NULL,
      booth_name  TEXT    NOT NULL,
      scan_date   TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(badge_id, scan_date)
    );

    CREATE INDEX IF NOT EXISTS idx_scans_badge_id   ON scans(badge_id);
    CREATE INDEX IF NOT EXISTS idx_scans_scan_date  ON scans(scan_date);
    -- GET /booths groups by booth_name; without this it is a full table scan.
    CREATE INDEX IF NOT EXISTS idx_scans_booth_name ON scans(booth_name);

    CREATE TABLE IF NOT EXISTS player_scan_counts (
      badge_id       TEXT PRIMARY KEY,
      scan_count     INTEGER NOT NULL DEFAULT 0,
      last_scan_date TEXT,
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- The leaderboard and GET /players both order by scan_count DESC.
    CREATE INDEX IF NOT EXISTS idx_players_scan_count ON player_scan_counts(scan_count DESC);

    CREATE TABLE IF NOT EXISTS checkpoints (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
