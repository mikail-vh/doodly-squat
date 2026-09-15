import Link from "next/link";
import { redirect } from "next/navigation";
import { ProviderIcon } from "@/components/provider-icon";
import { currentUser } from "@/lib/auth";
import { enabledProviders, safeReturnPath } from "@/lib/oauth";

const ERRORS: Record<string, string> = {
  provider: "That sign-in method is not configured on this server.",
  denied: "Sign-in was cancelled.",
  state: "That sign-in link went stale. Give it another go.",
  exchange: "The provider would not confirm who you are. Try again?",
};

type Props = { searchParams: Promise<{ error?: string; next?: string }> };

export default async function SignInPage({ searchParams }: Props) {
  const { error, next } = await searchParams;
  const destination = safeReturnPath(next);

  if (await currentUser()) redirect(destination);

  const providers = enabledProviders();

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <div className="sticker rounded-3xl bg-panel p-7 text-center">
        <h1 className="font-display text-3xl">Sign in</h1>
        <p className="mt-2 text-sm text-muted">
          Optional. It claims the words you add, tracks your progress, and puts
          you on the leaderboard.
        </p>

        {error ? (
          <p
            role="alert"
            className="sticker-sm mt-5 rounded-xl bg-brand px-4 py-2 font-display text-sm text-brand-ink"
          >
            {ERRORS[error] ?? "Something went wrong."}
          </p>
        ) : null}

        {providers.length === 0 ? (
          <div className="mt-6 text-left text-sm text-muted">
            <p className="font-display text-ink">No providers are configured.</p>
            <p className="mt-2">
              Set <code>DISCORD_CLIENT_ID</code> and{" "}
              <code>DISCORD_CLIENT_SECRET</code> (and/or the <code>GOOGLE_</code>{" "}
              pair) in the environment, then restart the container.
            </p>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            {providers.map((provider) => (
              <Link
                key={provider.id}
                href={`/auth/${provider.id}?next=${encodeURIComponent(destination)}`}
                className="sticker press flex items-center justify-center gap-3 rounded-xl bg-paper px-4 py-3 font-display"
              >
                <ProviderIcon provider={provider.id} />
                Continue with {provider.label}
              </Link>
            ))}
          </div>
        )}

        <p className="mt-6 text-xs text-muted">
          <Link href="/" className="underline">
            Back to the stashes
          </Link>
        </p>
      </div>
    </main>
  );
}
