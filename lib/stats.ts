import { db } from "./db";
import { XP_PER_WORD, type PublicUser } from "./shared";

/**
 * Nothing writes game_results yet — the self-hosted game server will, through
 * POST /api/stats/results. Until then every query below simply reports zeros
 * for the game columns, and the leaderboard ranks on contributed words.
 */
export type PlayerTotals = {
  user: PublicUser;
  xp: number;
  score: number;
  games: number;
  wins: number;
  wordsGuessed: number;
  wordsDrawn: number;
  wordsContributed: number;
};

type TotalsRow = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  is_admin: boolean;
  score: number;
  games: number;
  wins: number;
  words_guessed: number;
  words_drawn: number;
  words_contributed: number;
  xp: number;
};

type Sql = ReturnType<typeof db>;

/**
 * Built per call rather than held as a string constant, because postgres.js
 * composes fragments as tagged templates — that keeps XP_PER_WORD a bound
 * parameter instead of string-interpolated SQL.
 *
 * `wins` counts rather than sums: `won` is a boolean in Postgres, and there is
 * no sum(boolean).
 */
function totalsSelect(sql: Sql) {
  return sql`
    SELECT u.id, u.display_name, u.avatar_url, u.is_admin,
           COALESCE(g.score, 0)          AS score,
           COALESCE(g.games, 0)          AS games,
           COALESCE(g.wins, 0)           AS wins,
           COALESCE(g.words_guessed, 0)  AS words_guessed,
           COALESCE(g.words_drawn, 0)    AS words_drawn,
           COALESCE(w.words, 0)          AS words_contributed,
           COALESCE(g.score, 0) + COALESCE(w.words, 0) * ${XP_PER_WORD} AS xp
      FROM users u
      LEFT JOIN (
        SELECT user_id,
               SUM(score)                  AS score,
               COUNT(*)                    AS games,
               COUNT(*) FILTER (WHERE won) AS wins,
               SUM(words_guessed)          AS words_guessed,
               SUM(words_drawn)            AS words_drawn
          FROM game_results
         GROUP BY user_id
      ) g ON g.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS words
          FROM words
         WHERE user_id IS NOT NULL
         GROUP BY user_id
      ) w ON w.user_id = u.id
  `;
}

function toTotals(row: TotalsRow): PlayerTotals {
  return {
    user: {
      id: row.id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      isAdmin: row.is_admin,
    },
    xp: row.xp,
    score: row.score,
    games: row.games,
    wins: row.wins,
    wordsGuessed: row.words_guessed,
    wordsDrawn: row.words_drawn,
    wordsContributed: row.words_contributed,
  };
}

export async function leaderboard(limit = 50): Promise<PlayerTotals[]> {
  const sql = db();
  const rows = await sql<TotalsRow[]>`
    ${totalsSelect(sql)}
    ORDER BY xp DESC, lower(u.display_name)
    LIMIT ${limit}
  `;
  return rows.map(toTotals);
}

export async function totalsFor(userId: string): Promise<PlayerTotals | null> {
  const sql = db();
  const [row] = await sql<TotalsRow[]>`
    ${totalsSelect(sql)} WHERE u.id = ${userId}
  `;
  return row ? toTotals(row) : null;
}

export type RecentGame = {
  matchId: string;
  playedAt: number;
  score: number;
  rounds: number;
  wordsGuessed: number;
  wordsDrawn: number;
  won: boolean;
};

export async function recentGames(
  userId: string,
  limit = 10,
): Promise<RecentGame[]> {
  const rows = await db()<
    Array<{
      match_id: string;
      played_at: number;
      score: number;
      rounds: number;
      words_guessed: number;
      words_drawn: number;
      won: boolean;
    }>
  >`
    SELECT match_id, played_at, score, rounds, words_guessed, words_drawn, won
      FROM game_results
     WHERE user_id = ${userId}
     ORDER BY played_at DESC
     LIMIT ${limit}
  `;

  return rows.map((row) => ({
    matchId: row.match_id,
    playedAt: row.played_at,
    score: row.score,
    rounds: row.rounds,
    wordsGuessed: row.words_guessed,
    wordsDrawn: row.words_drawn,
    won: row.won,
  }));
}

export type ResultInput = {
  userId: string;
  score?: number;
  rounds?: number;
  wordsGuessed?: number;
  wordsDrawn?: number;
  guessedFirst?: number;
  won?: boolean;
};

function whole(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

/**
 * user_id is a uuid column now, and comparing it against a malformed string
 * is a database error rather than a miss — so anything that is not a uuid is
 * dropped before it reaches Postgres. The ingest endpoint takes input from
 * the game server, so that has to be a rejection, not a 500.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Idempotent by (match_id, user_id), so the game server can retry an ingest or
 * send a correction without inflating anyone's totals.
 */
export async function recordResults(
  matchId: string,
  playedAt: number,
  players: ResultInput[],
): Promise<number> {
  const sql = db();
  const candidates = players.filter((player) => UUID.test(player?.userId ?? ""));
  if (candidates.length === 0) return 0;

  // One lookup for the whole batch instead of one per player.
  const known = await sql<Array<{ id: string }>>`
    SELECT id FROM users
     WHERE id = ANY(${candidates.map((player) => player.userId)}::uuid[])
  `;
  const exists = new Set(known.map((row) => row.id));

  const rows = candidates
    .filter((player) => exists.has(player.userId))
    .map((player) => ({
      match_id: matchId,
      user_id: player.userId,
      played_at: new Date(playedAt),
      score: whole(player.score),
      rounds: whole(player.rounds),
      words_guessed: whole(player.wordsGuessed),
      words_drawn: whole(player.wordsDrawn),
      guessed_first: whole(player.guessedFirst),
      won: player.won === true,
    }));

  if (rows.length === 0) return 0;

  await sql`
    INSERT INTO game_results ${sql(
      rows,
      "match_id",
      "user_id",
      "played_at",
      "score",
      "rounds",
      "words_guessed",
      "words_drawn",
      "guessed_first",
      "won",
    )}
    ON CONFLICT (match_id, user_id) DO UPDATE SET
      played_at     = excluded.played_at,
      score         = excluded.score,
      rounds        = excluded.rounds,
      words_guessed = excluded.words_guessed,
      words_drawn   = excluded.words_drawn,
      guessed_first = excluded.guessed_first,
      won           = excluded.won
  `;

  return rows.length;
}
