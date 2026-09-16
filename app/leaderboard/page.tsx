import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { currentUser } from "@/lib/auth";
import { levelFor } from "@/lib/shared";
import { leaderboard } from "@/lib/stats";

export const metadata: Metadata = { title: "Leaderboard · Doodly Squat" };
export const dynamic = "force-dynamic";

const MEDALS = ["🥇", "🥈", "🥉"];

export default async function LeaderboardPage() {
  const [rows, me] = await Promise.all([leaderboard(), currentUser()]);
  const anyGames = rows.some((row) => row.games > 0);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-12">
      <header>
        <h1 className="font-display text-4xl">Leaderboard</h1>
        <p className="mt-2 text-muted">
          {anyGames
            ? "Ranked by XP: game score plus everything you have added to a stash."
            : "No games have been reported yet, so this is ranked purely on words contributed. Game score joins in once we self-host the game."}
        </p>
      </header>

      <section className="sticker mt-8 overflow-hidden rounded-3xl bg-panel">
        {rows.length === 0 ? (
          <p className="px-6 py-16 text-center text-muted">
            Nobody has signed in yet.{" "}
            <Link href="/signin" className="underline">
              Be the first
            </Link>
            .
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-edge text-left font-display">
                  <th className="px-4 py-3 font-normal">#</th>
                  <th className="px-4 py-3 font-normal">Player</th>
                  <th className="px-4 py-3 text-right font-normal">Level</th>
                  <th className="px-4 py-3 text-right font-normal">Words</th>
                  <th className="px-4 py-3 text-right font-normal">Games</th>
                  <th className="px-4 py-3 text-right font-normal">Wins</th>
                  <th className="px-4 py-3 text-right font-normal">XP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const mine = row.user.id === me?.id;
                  return (
                    <tr
                      key={row.user.id}
                      className={`border-b-2 border-edge/20 last:border-b-0 ${
                        mine ? "bg-brand/10" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-display whitespace-nowrap">
                        {MEDALS[index] ?? index + 1}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2">
                          <Avatar user={row.user} size={28} />
                          <span className="font-display">
                            {row.user.displayName}
                          </span>
                          {mine ? (
                            <span className="text-xs text-muted">(you)</span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-display">
                        {levelFor(row.xp).level}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.wordsContributed}
                      </td>
                      <td className="px-4 py-3 text-right">{row.games}</td>
                      <td className="px-4 py-3 text-right">{row.wins}</td>
                      <td className="px-4 py-3 text-right font-display">
                        {row.xp}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {me ? null : (
        <p className="mt-6 text-center text-sm text-muted">
          <Link href="/signin" className="underline">
            Sign in
          </Link>{" "}
          to claim the words you add and appear here.
        </p>
      )}
    </main>
  );
}
