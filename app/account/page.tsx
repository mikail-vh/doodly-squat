import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { ProviderIcon } from "@/components/provider-icon";
import {
  countRecoveryCodes,
  currentUser,
  listLinkedProviders,
  twoFactorEnabled,
} from "@/lib/auth";
import { levelFor, XP_PER_WORD } from "@/lib/shared";
import { recentGames, totalsFor } from "@/lib/stats";
import DisableTwoFactorForm from "./disable-two-factor-form";
import { renameAction, signOutAction } from "./actions";

export const metadata: Metadata = { title: "Your account · Doodly Squat" };
export const dynamic = "force-dynamic";

const PROVIDER_LABELS: Record<string, string> = {
  discord: "Discord",
  google: "Google",
};

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/signin?next=%2Faccount");

  const totals = totalsFor(user.id);
  const games = recentGames(user.id);
  const providers = listLinkedProviders(user.id);
  const twoFactor = twoFactorEnabled(user.id);
  const recoveryLeft = twoFactor ? countRecoveryCodes(user.id) : 0;
  const progress = levelFor(totals?.xp ?? 0);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-12">
      <section className="sticker flex flex-wrap items-center gap-4 rounded-3xl bg-panel p-6">
        <Avatar user={user} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl">{user.displayName}</h1>
          <p className="text-sm text-muted">
            {user.email ?? "no email from your provider"}
            {user.isAdmin ? " · owner of this instance" : ""}
          </p>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="sticker-sm press-sm rounded-xl bg-paper px-4 py-2 font-display text-sm"
          >
            Sign out
          </button>
        </form>
      </section>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <section className="sticker rounded-3xl bg-panel p-6">
          <h2 className="font-display text-xl">Progress</h2>

          <div className="mt-4 flex items-baseline justify-between">
            <span className="font-display text-3xl">Level {progress.level}</span>
            <span className="text-sm text-muted">
              {progress.into} / {progress.needed} XP
            </span>
          </div>
          <div className="sticker-sm mt-2 h-3 overflow-hidden rounded-full bg-paper">
            <div
              className="h-full bg-brand transition-all"
              style={{ width: `${Math.round(progress.progress * 100)}%` }}
            />
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            {[
              ["Words contributed", totals?.wordsContributed ?? 0],
              ["Games played", totals?.games ?? 0],
              ["Games won", totals?.wins ?? 0],
              ["Words guessed", totals?.wordsGuessed ?? 0],
            ].map(([label, value]) => (
              <div
                key={label}
                className="sticker-sm rounded-xl bg-paper px-3 py-2"
              >
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="font-display text-xl">{value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-xs text-muted">
            Every word you add is worth {XP_PER_WORD} XP. Game score lands here
            once the game server starts reporting results.
          </p>
        </section>

        <section className="sticker rounded-3xl bg-panel p-6">
          <h2 className="font-display text-xl">Sign-in and security</h2>

          <p className="mt-4 text-xs text-muted">Linked accounts</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {providers.map((provider) => (
              <li
                key={provider}
                className="sticker-sm flex items-center gap-2 rounded-lg bg-paper px-3 py-1.5 font-display text-sm"
              >
                <ProviderIcon provider={provider} size={16} />
                {PROVIDER_LABELS[provider] ?? provider}
              </li>
            ))}
          </ul>

          <div className="mt-5 border-t-2 border-edge pt-5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-display">Two-factor</p>
              <span
                className={`sticker-sm rounded-lg px-2.5 py-1 font-display text-xs ${
                  twoFactor ? "bg-paper" : "bg-brand text-brand-ink"
                }`}
              >
                {twoFactor ? "on" : "off"}
              </span>
            </div>

            {twoFactor ? (
              <>
                <p className="mt-2 text-sm text-muted">
                  {recoveryLeft} recovery code{recoveryLeft === 1 ? "" : "s"}{" "}
                  left. Turning two-factor off and on again issues a fresh set.
                </p>
                <DisableTwoFactorForm />
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted">
                  Adds an authenticator-app code on top of{" "}
                  {providers.map((p) => PROVIDER_LABELS[p] ?? p).join(" and ")}.
                </p>
                <Link
                  href="/account/two-factor"
                  className="sticker press mt-3 inline-block rounded-xl bg-brand px-4 py-2.5 font-display text-sm text-brand-ink"
                >
                  Turn it on
                </Link>
              </>
            )}
          </div>

          <form action={renameAction} className="mt-5 border-t-2 border-edge pt-5">
            <label
              htmlFor="displayName"
              className="font-display text-sm"
            >
              Display name
            </label>
            <p className="text-xs text-muted">
              Your provider resets this every time you sign in.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                id="displayName"
                name="displayName"
                defaultValue={user.displayName}
                maxLength={32}
                className="field"
              />
              <button
                type="submit"
                className="sticker press-sm shrink-0 rounded-xl bg-paper px-4 font-display text-sm"
              >
                Save
              </button>
            </div>
          </form>
        </section>
      </div>

      <section className="sticker mt-6 rounded-3xl bg-panel p-6">
        <h2 className="font-display text-xl">Recent games</h2>
        {games.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            Nothing here yet. Once we self-host the game and point it at this
            server, every finished match shows up in this list.
          </p>
        ) : (
          <ul className="mt-4 divide-y-2 divide-edge">
            {games.map((game) => (
              <li
                key={game.matchId}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm"
              >
                <span className="font-display">
                  {game.won ? "🏆 won" : "played"}
                </span>
                <span className="text-muted">
                  {new Date(game.playedAt).toLocaleDateString()}
                </span>
                <span className="ml-auto font-display">{game.score} pts</span>
                <span className="text-muted">
                  {game.wordsGuessed} guessed · {game.wordsDrawn} drawn
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
