"use server";

import { redirect } from "next/navigation";
import {
  completeTwoFactor,
  consumeRecoveryCode,
  consumeTotp,
  pendingTwoFactorUser,
} from "@/lib/auth";
import { safeReturnPath } from "@/lib/oauth";

export type TwoFactorState = { error: string } | null;

export async function verifyTwoFactorAction(
  _previous: TwoFactorState,
  formData: FormData,
): Promise<TwoFactorState> {
  const user = await pendingTwoFactorUser();
  if (!user) {
    return { error: "That sign-in attempt expired. Start again from the top." };
  }

  const entry = String(formData.get("code") ?? "").trim();
  if (!entry) return { error: "Enter the six-digit code from your app." };

  // A recovery code is the hyphenated one; anything else is treated as TOTP.
  const accepted = entry.includes("-")
    ? consumeRecoveryCode(user.id, entry)
    : consumeTotp(user.id, entry);

  if (!accepted) {
    return { error: "That code did not work. They change every 30 seconds." };
  }

  await completeTwoFactor();
  redirect(safeReturnPath(String(formData.get("next") ?? "")));
}
