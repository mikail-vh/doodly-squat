import { db } from "./db";

/**
 * Read-only queries behind /admin. Nothing here is exposed without the
 * is_admin flag, which the first account to sign in receives.
 */
const WEEK = 7 * 24 * 60 * 60 * 1000;

export type AdminTotals = {
  users: number;
  stashes: number;
  words: number;
  games: number;
  activeSessions: number;
  newUsersThisWeek: number;
  newWordsThisWeek: number;
};

export function totals(): AdminTotals {
  const since = Date.now() - WEEK;
  const row = db()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM users)                          AS users,
         (SELECT COUNT(*) FROM rooms)                          AS stashes,
         (SELECT COUNT(*) FROM words)                          AS words,
         (SELECT COUNT(*) FROM game_results)                   AS games,
         (SELECT COUNT(*) FROM sessions WHERE expires_at > ?)  AS active_sessions,
         (SELECT COUNT(*) FROM users WHERE created_at > ?)     AS new_users,
         (SELECT COUNT(*) FROM words WHERE created_at > ?)     AS new_words`,
    )
    .get(Date.now(), since, since) as Record<string, number>;

  return {
    users: row.users,
    stashes: row.stashes,
    words: row.words,
    games: row.games,
    activeSessions: row.active_sessions,
    newUsersThisWeek: row.new_users,
    newWordsThisWeek: row.new_words,
  };
}

export type AdminAccount = {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  createdAt: number;
  providers: string[];
  twoFactor: boolean;
  words: number;
  lastSignIn: number | null;
};

export function accounts(): AdminAccount[] {
  const rows = db()
    .prepare(
      `SELECT u.id, u.display_name, u.email, u.avatar_url, u.is_admin, u.created_at,
              (SELECT COUNT(*)        FROM words w  WHERE w.user_id = u.id)  AS words,
              (SELECT group_concat(o.provider) FROM oauth_accounts o WHERE o.user_id = u.id) AS providers,
              (SELECT t.confirmed_at  FROM totp_credentials t WHERE t.user_id = u.id) AS totp,
              (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_sign_in
         FROM users u
        ORDER BY u.created_at DESC`,
    )
    .all() as Array<Record<string, string | number | null>>;

  return rows.map((row) => ({
    id: String(row.id),
    displayName: String(row.display_name),
    email: row.email === null ? null : String(row.email),
    avatarUrl: row.avatar_url === null ? null : String(row.avatar_url),
    isAdmin: row.is_admin === 1,
    createdAt: Number(row.created_at),
    providers: row.providers ? String(row.providers).split(",") : [],
    twoFactor: row.totp !== null,
    words: Number(row.words),
    lastSignIn: row.last_sign_in === null ? null : Number(row.last_sign_in),
  }));
}

export type AdminStash = {
  code: string;
  name: string;
  createdAt: number;
  words: number;
  lastWordAt: number | null;
  contributors: number;
};

export function stashes(): AdminStash[] {
  const rows = db()
    .prepare(
      `SELECT r.code, r.name, r.created_at,
              COUNT(w.id)                                       AS words,
              MAX(w.created_at)                                 AS last_word,
              COUNT(DISTINCT COALESCE(w.user_id, w.added_by))   AS contributors
         FROM rooms r
         LEFT JOIN words w ON w.room_code = r.code
        GROUP BY r.code
        ORDER BY r.created_at DESC`,
    )
    .all() as Array<Record<string, string | number | null>>;

  return rows.map((row) => ({
    code: String(row.code),
    name: String(row.name),
    createdAt: Number(row.created_at),
    words: Number(row.words),
    lastWordAt: row.last_word === null ? null : Number(row.last_word),
    contributors: Number(row.contributors),
  }));
}

export type AdminWord = {
  id: number;
  text: string;
  addedBy: string;
  stash: string;
  createdAt: number;
};

/** A feel for what is actually happening, rather than just counts. */
export function latestWords(limit = 12): AdminWord[] {
  const rows = db()
    .prepare(
      `SELECT w.id, w.text, w.created_at, r.name AS stash,
              COALESCE(u.display_name, w.added_by) AS added_by
         FROM words w
         JOIN rooms r ON r.code = w.room_code
         LEFT JOIN users u ON u.id = w.user_id
        ORDER BY w.id DESC
        LIMIT ?`,
    )
    .all(limit) as Array<Record<string, string | number>>;

  return rows.map((row) => ({
    id: Number(row.id),
    text: String(row.text),
    addedBy: String(row.added_by),
    stash: String(row.stash),
    createdAt: Number(row.created_at),
  }));
}
