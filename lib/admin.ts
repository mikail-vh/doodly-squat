import { db } from "./db";

/**
 * Read-only queries behind /admin. Nothing here is exposed without the
 * is_admin flag, which the first account to sign in receives.
 */

export type AdminTotals = {
  users: number;
  stashes: number;
  words: number;
  games: number;
  activeSessions: number;
  newUsersThisWeek: number;
  newWordsThisWeek: number;
};

export async function totals(): Promise<AdminTotals> {
  const [row] = await db()<
    Array<{
      users: number;
      stashes: number;
      words: number;
      games: number;
      active_sessions: number;
      new_users: number;
      new_words: number;
    }>
  >`
    SELECT
      (SELECT COUNT(*) FROM users)        AS users,
      (SELECT COUNT(*) FROM rooms)        AS stashes,
      (SELECT COUNT(*) FROM words)        AS words,
      (SELECT COUNT(*) FROM game_results) AS games,
      (SELECT COUNT(*) FROM sessions
        WHERE expires_at > now())         AS active_sessions,
      (SELECT COUNT(*) FROM users
        WHERE created_at > now() - interval '7 days') AS new_users,
      (SELECT COUNT(*) FROM words
        WHERE created_at > now() - interval '7 days') AS new_words
  `;

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

export async function accounts(): Promise<AdminAccount[]> {
  // providers comes back as a real text[] via array_agg, rather than SQLite's
  // group_concat string that had to be split back apart.
  const rows = await db()<
    Array<{
      id: string;
      display_name: string;
      email: string | null;
      avatar_url: string | null;
      is_admin: boolean;
      created_at: number;
      words: number;
      providers: string[] | null;
      totp: number | null;
      last_sign_in: number | null;
    }>
  >`
    SELECT u.id, u.display_name, u.email, u.avatar_url, u.is_admin, u.created_at,
           (SELECT COUNT(*) FROM words w WHERE w.user_id = u.id) AS words,
           (SELECT array_agg(o.provider ORDER BY o.created_at)
              FROM oauth_accounts o WHERE o.user_id = u.id)      AS providers,
           (SELECT t.confirmed_at
              FROM totp_credentials t WHERE t.user_id = u.id)    AS totp,
           (SELECT MAX(s.created_at)
              FROM sessions s WHERE s.user_id = u.id)            AS last_sign_in
      FROM users u
     ORDER BY u.created_at DESC
  `;

  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    avatarUrl: row.avatar_url,
    isAdmin: row.is_admin,
    createdAt: row.created_at,
    providers: row.providers ?? [],
    twoFactor: row.totp !== null,
    words: row.words,
    lastSignIn: row.last_sign_in,
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

export async function stashes(): Promise<AdminStash[]> {
  // user_id is a uuid and added_by is text, so the COALESCE that identifies a
  // contributor needs an explicit cast — Postgres will not mix the two.
  // Grouping by r.code alone is fine: it is the primary key, so r.name and
  // r.created_at are functionally dependent on it.
  const rows = await db()<
    Array<{
      code: string;
      name: string;
      created_at: number;
      words: number;
      last_word: number | null;
      contributors: number;
    }>
  >`
    SELECT r.code, r.name, r.created_at,
           COUNT(w.id)        AS words,
           MAX(w.created_at)  AS last_word,
           COUNT(DISTINCT COALESCE(w.user_id::text, w.added_by)) AS contributors
      FROM rooms r
      LEFT JOIN words w ON w.room_code = r.code
     GROUP BY r.code
     ORDER BY r.created_at DESC
  `;

  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    createdAt: row.created_at,
    words: row.words,
    lastWordAt: row.last_word,
    contributors: row.contributors,
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
export async function latestWords(limit = 12): Promise<AdminWord[]> {
  const rows = await db()<
    Array<{
      id: number;
      text: string;
      created_at: number;
      stash: string;
      added_by: string;
    }>
  >`
    SELECT w.id, w.text, w.created_at, r.name AS stash,
           COALESCE(u.display_name, w.added_by) AS added_by
      FROM words w
      JOIN rooms r ON r.code = w.room_code
      LEFT JOIN users u ON u.id = w.user_id
     ORDER BY w.id DESC
     LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    addedBy: row.added_by,
    stash: row.stash,
    createdAt: row.created_at,
  }));
}
