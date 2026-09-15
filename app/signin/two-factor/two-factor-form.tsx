"use client";

import { useActionState } from "react";
import { verifyTwoFactorAction, type TwoFactorState } from "../actions";

export default function TwoFactorForm({ next }: { next: string }) {
  const [state, submit, pending] = useActionState<TwoFactorState, FormData>(
    verifyTwoFactorAction,
    null,
  );

  return (
    <form action={submit} className="mt-6">
      <input type="hidden" name="next" value={next} />
      <input
        name="code"
        inputMode="text"
        autoComplete="one-time-code"
        autoFocus
        placeholder="123456"
        aria-label="Authentication code"
        className="field text-center font-display text-2xl tracking-[0.3em]"
      />

      {state?.error ? (
        <p
          role="alert"
          className="sticker-sm pop-in mt-4 rounded-xl bg-brand px-4 py-2 font-display text-sm text-brand-ink"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="sticker press mt-4 w-full rounded-xl bg-brand px-4 py-3 font-display text-brand-ink disabled:opacity-60"
      >
        {pending ? "Checking…" : "Verify"}
      </button>
    </form>
  );
}
