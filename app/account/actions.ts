"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  confirmTotpEnrollment,
  consumeRecoveryCode,
  consumeTotp,
  currentUser,
  disableTwoFactor,
  revokeOtherSessions,
  signOut,
  updateDisplayName,
} from "@/lib/auth";

export async function signOutAction() {
  await signOut();
  redirect("/");
}

export async function renameAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/signin");
  updateDisplayName(user.id, String(formData.get("displayName") ?? ""));
  revalidatePath("/account");
}

export type EnrollState = { error?: string; codes?: string[] } | null;

export async function confirmTwoFactorAction(
  _previous: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const user = await currentUser();
  if (!user) return { error: "You are not signed in any more." };

  const codes = confirmTotpEnrollment(
    user.id,
    String(formData.get("code") ?? "").trim(),
  );
  if (!codes) {
    return { error: "That code did not match. Wait for the next one and retry." };
  }

  // Anything signed in elsewhere predates two-factor, so make it prove itself.
  await revokeOtherSessions();
  revalidatePath("/account");
  return { codes };
}

export type DisableState = { error: string } | null;

export async function disableTwoFactorAction(
  _previous: DisableState,
  formData: FormData,
): Promise<DisableState> {
  const user = await currentUser();
  if (!user) redirect("/signin");

  // Turning it off is exactly what an attacker on a stolen session would do,
  // so it costs a current code.
  const entry = String(formData.get("code") ?? "").trim();
  const accepted = entry.includes("-")
    ? consumeRecoveryCode(user.id, entry)
    : consumeTotp(user.id, entry);

  if (!accepted) return { error: "Enter a current code to turn two-factor off." };

  disableTwoFactor(user.id);
  redirect("/account");
}
