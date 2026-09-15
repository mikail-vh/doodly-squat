"use client";

import { useActionState } from "react";
import { disableTwoFactorAction, type DisableState } from "./actions";

export default function DisableTwoFactorForm() {
  const [state, submit, pending] = useActionState<DisableState, FormData>(
    disableTwoFactorAction,
    null,
  );

  return (
    <form action={submit} className="mt-3 flex flex-wrap gap-2">
      <input
        name="code"
        placeholder="current code"
        aria-label="Current authentication code"
        autoComplete="one-time-code"
        className="field max-w-40 flex-1"
      />
      <button
        type="submit"
        disabled={pending}
        className="sticker-sm press-sm shrink-0 rounded-xl bg-paper px-4 py-2 font-display text-sm disabled:opacity-60"
      >
        {pending ? "Checking…" : "Turn off"}
      </button>
      {state?.error ? (
        <p role="alert" className="w-full font-display text-xs text-brand">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
