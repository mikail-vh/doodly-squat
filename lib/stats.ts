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
  is_admin: number;
  score: number;
  games: number;
  wins: number;
  words_guessed: number;
  words_drawn: number;
  words_contributed: number;
  xp: number;
};

const TOTALS_SELECT = `
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
             SUM(score)         AS score,
             COUNT(*)           AS games,
             SUM(won)           AS wins,
             SUM(words_guessed) AS words_guessed,
             SUM(words_drawn)   AS words_drawn
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

function toTotals(row: TotalsRow): PlayerTotals {
  return {
    user: {
      id: row.id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      isAdmin: row.is_admin === 1,
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

export function leaderboard(limit = 50): PlayerTotals[] {
  const rows = db()
    .prepare(`${TOTALS_SELECT} ORDER BY xp DESC, u.display_name COLLATE NOCASE LIMIT ?`)
    .all(limit) as TotalsRow[];
  return rows.map(toTotals);
}

export function totalsFor(userId: string): PlayerTotals | null {
  const row = db()
    .prepare(`${TOTALS_SELECT} WHERE u.id = ?`)
    .get(userId) as TotalsRow | undefined;
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

export function recentGames(userId: string, limit = 10): RecentGame[] {
  const rows = db()
    .prepare(
      `SELECT match_id, played_at, score, rounds, words_guessed, words_drawn, won
         FROM game_results
        WHERE user_id = ?
        ORDER BY played_at DESC
        LIMIT ?`,
    )
    .all(userId, limit) as Array<{
    match_id: string;
    played_at: number;
    score: number;
    rounds: number;
    words_guessed: number;
    words_drawn: number;
    won: number;
  }>;

  return rows.map((row) => ({
    matchId: row.match_id,
    playedAt: row.played_at,
    score: row.score,
    rounds: row.rounds,
    wordsGuessed: row.words_guessed,
    wordsDrawn: row.words_drawn,
    won: row.won === 1,
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
 * Idempotent by (match_id, user_id), so the game server can retry an ingest or
 * send a correction without inflating anyone's totals.
 */
export function recordResults(
  matchId: string,
  playedAt: number,
  players: ResultInput[],
): number {
  const statement = db().prepare(
    `INSERT INTO game_results
       (match_id, user_id, played_at, score, rounds, words_guessed, words_drawn, guessed_first, won)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (match_id, user_id) DO UPDATE SET
       played_at     = excluded.played_at,
       score         = excluded.score,
       rounds        = excluded.rounds,
       words_guessed = excluded.words_guessed,
       words_drawn   = excluded.words_drawn,
       guessed_first = excluded.guessed_first,
       won           = excluded.won`,
  );

  const exists = db().prepare("SELECT 1 FROM users WHERE id = ?");
  let written = 0;

  for (const player of players) {
    if (!player?.userId || !exists.get(player.userId)) continue;
    statement.run(
      matchId,
      player.userId,
      playedAt,
      whole(player.score),
      whole(player.rounds),
      whole(player.wordsGuessed),
      whole(player.wordsDrawn),
      whole(player.guessedFirst),
      player.won ? 1 : 0,
    );
    written++;
  }

  return written;
}
