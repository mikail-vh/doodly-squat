import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * Storage is a single SQLite file (via Node's built-in driver, so there are no
 * native dependencies to build when self-hosting). Point STASH_DB_PATH at a
 * mounted volume in production; it defaults to ./data/stash.db.
 */
const DB_PATH =
  process.env.STASH_DB_PATH ?? path.join(process.cwd(), "data", "stash.db");

/**
 * Schema changes go at the end of this list and never get edited afterwards.
 * `PRAGMA user_version` tracks how many have run, so an existing database on
 * the VPS upgrades itself on the next boot.
 */
const MIGRATIONS: Array<(db: DatabaseSync) => void> = [
  // 1 — stashes and their words.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        code       TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS words (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        room_code  TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        text       TEXT NOT NULL,
        added_by   TEXT NOT NULL DEFAULT 'someone',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS words_room_idx ON words (room_code, id DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS words_unique_idx
        ON words (room_code, text COLLATE NOCASE);
    `);
  },

  // 2 — accounts, OAuth links, sessions and two-factor.
  (db) => {
    db.exec(`
      CREATE TABLE users (
        id           TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        email        TEXT,
        avatar_url   TEXT,
        is_admin     INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX users_email_idx
        ON users (email COLLATE NOCASE) WHERE email IS NOT NULL;

      CREATE TABLE oauth_accounts (
        provider    TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (provider, provider_id)
      );
      CREATE INDEX oauth_accounts_user_idx ON oauth_accounts (user_id);

      -- id is a SHA-256 of the cookie token, so a stolen database file does
      -- not hand out usable sessions.
      CREATE TABLE sessions (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        needs_totp INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_user_idx ON sessions (user_id);

      CREATE TABLE totp_credentials (
        user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        secret       TEXT NOT NULL,
        confirmed_at INTEGER,
        last_step    INTEGER,
        created_at   INTEGER NOT NULL
      );

      CREATE TABLE recovery_codes (
        user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        used_at   INTEGER,
        PRIMARY KEY (user_id, code_hash)
      );
    `);
  },

  // 3 — words can belong to an account, but anonymous ones stay valid.
  (db) => {
    const columns = db.prepare("PRAGMA table_info(words)").all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === "user_id")) {
      db.exec(
        "ALTER TABLE words ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL",
      );
    }
    db.exec("CREATE INDEX IF NOT EXISTS words_user_idx ON words (user_id)");
  },

  // 4 — one row per player per finished game; the game server fills this in.
  (db) => {
    db.exec(`
      CREATE TABLE game_results (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id      TEXT NOT NULL,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        played_at     INTEGER NOT NULL,
        score         INTEGER NOT NULL DEFAULT 0,
        rounds        INTEGER NOT NULL DEFAULT 0,
        words_guessed INTEGER NOT NULL DEFAULT 0,
        words_drawn   INTEGER NOT NULL DEFAULT 0,
        guessed_first INTEGER NOT NULL DEFAULT 0,
        won           INTEGER NOT NULL DEFAULT 0
      );
      -- A replayed ingest of the same match must not double-count anyone.
      CREATE UNIQUE INDEX game_results_match_idx
        ON game_results (match_id, user_id);
      CREATE INDEX game_results_user_idx ON game_results (user_id, played_at DESC);
    `);
  },
];

function openDatabase() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const database = new DatabaseSync(DB_PATH);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  // Two friends can hit save at the same instant; wait rather than throw.
  database.exec("PRAGMA busy_timeout = 5000");

  const { user_version: applied } = database
    .prepare("PRAGMA user_version")
    .get() as { user_version: number };

  for (let version = applied; version < MIGRATIONS.length; version++) {
    MIGRATIONS[version](database);
    database.exec(`PRAGMA user_version = ${version + 1}`);
  }

  return database;
}

// Dev hot-reload re-evaluates modules; keep one handle on globalThis. Opening
// is lazy so that merely importing a route (as `next build` does, in parallel
// workers) never touches the file.
const cache = globalThis as typeof globalThis & { __stashDb?: DatabaseSync };

export function db() {
  return (cache.__stashDb ??= openDatabase());
}
