import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { ProviderIcon } from "@/components/provider-icon";
import { accounts, latestWords, stashes, totals } from "@/lib/admin";
import { currentUser } from "@/lib/auth";

/**
 * Resolved per-request rather than exported statically: a static title is
 * serialized into the payload even when the page 404s, which would advertise
 * that this route exists to anyone who looked at the source.
 */
export async function generateMetadata(): Promise<Metadata> {
  const user = await currentUser();
  return user?.isAdmin ? { title: "Admin · Doodly Squat" } : {};
}

export const dynamic = "force-dynamic";

function when(value: number | null) {
  if (!value) return "never";
  const days = Math.floor((Date.now() - value) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString();
}

export default async function AdminPage() {
  const user = await currentUser();
  // 404 rather than redirect: no reason to tell anyone this route exists.
  if (!user?.isAdmin) notFound();

  const stats = totals();
  const people = accounts();
  const rooms = stashes();
  const recent = latestWords();

  const tiles: Array<[string, number, string?]> = [
    ["Accounts", stats.users, `+${stats.newUsersThisWeek} this week`],
    ["Stashes", stats.stashes],
    ["Words", stats.words, `+${stats.newWordsThisWeek} this week`],
    ["Games logged", stats.games, stats.games === 0 ? "awaiting the game server" : undefined],
    ["Live sessions", stats.activeSessions],
  ];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Admin</h1>
          <p className="mt-1 text-sm text-muted">
            Everything on this instance. Visible only to the owner account.
          </p>
        </div>
        <Link
          href="/leaderboard"
          className="sticker-sm press-sm rounded-xl bg-panel px-3 py-2 font-display text-sm"
        >
          Leaderboard →
        </Link>
      </header>

      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([label, value, note]) => (
          <div key={label} className="sticker rounded-2xl bg-panel p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="font-display text-3xl">{value}</p>
            {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
          </div>
        ))}
      </section>

      <section className="sticker mt-6 overflow-hidden rounded-3xl bg-panel">
        <h2 className="border-b-2 border-edge px-5 py-3 font-display text-xl">
          Accounts
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-edge/30 text-left font-display">
                <th className="px-5 py-2 font-normal">Who</th>
                <th className="px-5 py-2 font-normal">Sign-in</th>
                <th className="px-5 py-2 text-right font-normal">2FA</th>
                <th className="px-5 py-2 text-right font-normal">Words</th>
                <th className="px-5 py-2 text-right font-normal">Joined</th>
                <th className="px-5 py-2 text-right font-normal">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr
                  key={person.id}
                  className="border-b-2 border-edge/15 last:border-b-0"
                >
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2">
                      <Avatar user={person} size={26} />
                      <span>
                        <span className="font-display">{person.displayName}</span>
                        {person.isAdmin ? (
                          <span className="ml-2 text-xs text-muted">owner</span>
                        ) : null}
                        <br />
                        <span className="text-xs text-muted">
                          {person.email ?? "no email"}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="flex gap-1.5">
                      {person.providers.map((provider) => (
                        <ProviderIcon key={provider} provider={provider} size={16} />
                      ))}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {person.twoFactor ? "on" : "—"}
                  </td>
                  <td className="px-5 py-3 text-right font-display">
                    {person.words}
                  </td>
                  <td className="px-5 py-3 text-right text-muted">
                    {when(person.createdAt)}
                  </td>
                  <td className="px-5 py-3 text-right text-muted">
                    {when(person.lastSignIn)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <section className="sticker overflow-hidden rounded-3xl bg-panel">
          <h2 className="border-b-2 border-edge px-5 py-3 font-display text-xl">
            Stashes
          </h2>
          {rooms.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              None yet.
            </p>
          ) : (
            <ul className="divide-y-2 divide-edge/15">
              {rooms.map((room) => (
                <li key={room.code} className="px-5 py-3 text-sm">
                  <span className="flex flex-wrap items-baseline gap-x-3">
                    <Link
                      href={`/room/${room.code}`}
                      className="font-display underline-offset-2 hover:underline"
                    >
                      {room.name}
                    </Link>
                    <span className="font-mono text-xs text-muted">
                      {room.code}
                    </span>
                    <span className="ml-auto font-display">
                      {room.words} word{room.words === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="text-xs text-muted">
                    {room.contributors} contributor
                    {room.contributors === 1 ? "" : "s"} · created{" "}
                    {when(room.createdAt)} · last word {when(room.lastWordAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="sticker overflow-hidden rounded-3xl bg-panel">
          <h2 className="border-b-2 border-edge px-5 py-3 font-display text-xl">
            Latest words
          </h2>
          {recent.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              Nothing added yet.
            </p>
          ) : (
            <ul className="divide-y-2 divide-edge/15">
              {recent.map((word) => (
                <li
                  key={word.id}
                  className="flex flex-wrap items-baseline gap-x-3 px-5 py-2.5 text-sm"
                >
                  <span className="font-display">{word.text}</span>
                  <span className="text-xs text-muted">
                    {word.addedBy} in {word.stash}
                  </span>
                  <span className="ml-auto text-xs text-muted">
                    {when(word.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="mt-8 text-center text-xs text-muted">
        Need real SQL? The read-only database browser lives at{" "}
        <span className="font-mono">squat-db.mvhuysie.com</span>, reachable over
        the tailnet only.
      </p>
    </main>
  );
}
