import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { currentUser } from "@/lib/auth";
import { enabledProviders } from "@/lib/oauth";

export default async function SiteHeader() {
  const user = await currentUser();
  const canSignIn = enabledProviders().length > 0;

  return (
    <header className="border-b-2 border-edge bg-panel">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        <Link href="/" className="font-display text-lg">
          <span aria-hidden>✏️</span> Doodly Squat
        </Link>

        <nav className="ml-auto flex items-center gap-2 text-sm">
          <Link
            href="/leaderboard"
            className="sticker-sm press-sm rounded-lg bg-paper px-3 py-1.5 font-display"
          >
            Leaderboard
          </Link>

          {user?.isAdmin ? (
            <Link
              href="/admin"
              className="sticker-sm press-sm rounded-lg bg-paper px-3 py-1.5 font-display"
            >
              Admin
            </Link>
          ) : null}

          {user ? (
            <Link
              href="/account"
              className="sticker-sm press-sm flex items-center gap-2 rounded-lg bg-paper py-1 pr-3 pl-1 font-display"
            >
              <Avatar user={user} size={24} />
              <span className="max-w-32 truncate">{user.displayName}</span>
            </Link>
          ) : canSignIn ? (
            <Link
              href="/signin"
              className="sticker-sm press-sm rounded-lg bg-brand px-3 py-1.5 font-display text-brand-ink"
            >
              Sign in
            </Link>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
