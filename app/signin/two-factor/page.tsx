import { redirect } from "next/navigation";
import { pendingTwoFactorUser } from "@/lib/auth";
import { safeReturnPath } from "@/lib/oauth";
import TwoFactorForm from "./two-factor-form";

type Props = { searchParams: Promise<{ next?: string }> };

export default async function TwoFactorChallengePage({ searchParams }: Props) {
  const user = await pendingTwoFactorUser();
  if (!user) redirect("/signin");

  const { next } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <div className="sticker rounded-3xl bg-panel p-7">
        <h1 className="font-display text-2xl">One more step</h1>
        <p className="mt-2 text-sm text-muted">
          Hello {user.displayName}. Enter the code from your authenticator app,
          or one of your recovery codes.
        </p>
        <TwoFactorForm next={safeReturnPath(next)} />
      </div>
    </main>
  );
}
