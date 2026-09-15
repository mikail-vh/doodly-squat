"use client";

import Link from "next/link";
import { useActionState } from "react";
import { confirmTwoFactorAction, type EnrollState } from "../actions";

export default function SetupForm({ secret, qr }: { secret: string; qr: string }) {
  const [state, submit, pending] = useActionState<EnrollState, FormData>(
    confirmTwoFactorAction,
    null,
  );

  if (state?.codes) {
    return (
      <div className="mt-6">
        <h2 className="font-display text-xl">Two-factor is on 🎉</h2>
        <p className="mt-2 text-sm text-muted">
          Save these recovery codes somewhere safe. Each one works once, and
          this is the only time they are shown.
        </p>
        <ul className="sticker-sm mt-4 grid grid-cols-2 gap-x-6 gap-y-1 rounded-xl bg-paper p-4 font-mono text-sm">
          {state.codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <Link
          href="/account"
          className="sticker press mt-5 inline-block rounded-xl bg-brand px-5 py-3 font-display text-brand-ink"
        >
          Done
        </Link>
      </div>
    );
  }

  return (
    <form action={submit} className="mt-6">
      <div className="flex justify-center">
        {/* A data URI, so there is nothing for an image optimizer to do. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qr}
          alt="QR code for your authenticator app"
          width={220}
          height={220}
          className="sticker-sm rounded-xl bg-white p-2"
        />
      </div>

      <p className="mt-4 text-center text-xs text-muted">
        Cannot scan? Enter this key by hand:
      </p>
      <p className="mt-1 text-center font-mono text-sm break-all">{secret}</p>

      <input
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        aria-label="Code from your authenticator app"
        className="field mt-5 text-center font-display text-2xl tracking-[0.3em]"
      />

      {state?.error ? (
        <p
          role="alert"
          className="sticker-sm pop-in mt-4 rounded-xl bg-brand px-4 py-2 font-display text-sm text-brand-ink"
        >
          {state.error}
        </p>
      ) : null}

      <div className="mt-4 flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="sticker press flex-1 rounded-xl bg-brand px-4 py-3 font-display text-brand-ink disabled:opacity-60"
        >
          {pending ? "Checking…" : "Confirm"}
        </button>
        <Link
          href="/account"
          className="sticker press rounded-xl bg-paper px-4 py-3 font-display"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
