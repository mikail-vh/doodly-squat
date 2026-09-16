import type { Metadata } from "next";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { beginTotpEnrollment, currentUser, twoFactorEnabled } from "@/lib/auth";
import { otpauthUri } from "@/lib/totp";
import SetupForm from "./setup-form";

export const metadata: Metadata = { title: "Two-factor · Doodly Squat" };
export const dynamic = "force-dynamic";

export default async function TwoFactorSetupPage() {
  const user = await currentUser();
  if (!user) redirect("/signin?next=%2Faccount%2Ftwo-factor");
  if (await twoFactorEnabled(user.id)) redirect("/account");

  const secret = await beginTotpEnrollment(user.id);
  const issuer = process.env.APP_NAME?.trim() || "Doodly Squat";
  const uri = otpauthUri(secret, user.email ?? user.displayName, issuer);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-12">
      <div className="sticker rounded-3xl bg-panel p-7">
        <h1 className="font-display text-2xl">Turn on two-factor</h1>
        <p className="mt-2 text-sm text-muted">
          Scan this with any authenticator app, then type the code it shows to
          confirm the two clocks agree.
        </p>
        <SetupForm secret={secret} qr={qr} />
      </div>
    </main>
  );
}
