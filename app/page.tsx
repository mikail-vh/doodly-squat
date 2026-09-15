"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { rememberRoom, useRecentRooms } from "@/lib/local";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState("");
  const recent = useRecentRooms();

  async function createStash(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError("");
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("create failed");
      const { room } = await res.json();
      rememberRoom(room);
      router.push(`/room/${room.code}`);
    } catch {
      setError("Could not make that stash. Give it another go?");
      setBusy(null);
    }
  }

  async function joinStash(event: React.FormEvent) {
    event.preventDefault();
    const clean = code.trim().toUpperCase();
    setError("");
    if (clean.length < 4) {
      setError("Codes are six characters long.");
      return;
    }
    setBusy("join");
    try {
      const res = await fetch(`/api/rooms/${clean}`);
      if (!res.ok) throw new Error("not found");
      const { room } = await res.json();
      rememberRoom(room);
      router.push(`/room/${room.code}`);
    } catch {
      setError(`No stash goes by ${clean}.`);
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:py-20">
      <header className="text-center">
        <span className="sticker press inline-block -rotate-3 rounded-2xl bg-panel px-4 py-2 font-display text-sm tracking-wide">
          ✏️ for skribbl.io nights
        </span>
        <h1 className="mt-6 font-display text-5xl leading-tight sm:text-6xl">
          Doodly{" "}
          <span className="inline-block rotate-2 rounded-xl bg-brand px-3 text-brand-ink">
            Squat
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-lg text-muted">
          Nobody here knows doodly squat about drawing. Hoard a pile of cursed
          words with your friends, export it as one comma-separated line, and
          paste it into skribbl.io.
        </p>
      </header>

      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        <form
          onSubmit={createStash}
          className="sticker flex flex-col rounded-3xl bg-panel p-6"
        >
          <h2 className="font-display text-2xl">Start a stash</h2>
          <p className="mt-1 text-sm text-muted">
            Name it, share the link, add words together.
          </p>
          <input
            className="field mt-5"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Thursday Night Chaos"
            maxLength={40}
            aria-label="Stash name"
          />
          <button
            type="submit"
            disabled={busy !== null}
            className="sticker press mt-4 rounded-xl bg-brand px-5 py-3 font-display text-brand-ink disabled:opacity-60"
          >
            {busy === "create" ? "Making it…" : "Create stash →"}
          </button>
        </form>

        <form
          onSubmit={joinStash}
          className="sticker flex flex-col rounded-3xl bg-panel p-6"
        >
          <h2 className="font-display text-2xl">Join a stash</h2>
          <p className="mt-1 text-sm text-muted">
            Someone sent you a six-character code.
          </p>
          <input
            className="field mt-5 text-center font-display text-2xl tracking-[0.35em] uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-label="Stash code"
          />
          <button
            type="submit"
            disabled={busy !== null}
            className="sticker press mt-4 rounded-xl bg-panel px-5 py-3 font-display disabled:opacity-60"
          >
            {busy === "join" ? "Knocking…" : "Let me in"}
          </button>
        </form>
      </div>

      {error ? (
        <p
          role="alert"
          className="sticker-sm pop-in mx-auto mt-6 w-fit rounded-xl bg-brand px-4 py-2 font-display text-sm text-brand-ink"
        >
          {error}
        </p>
      ) : null}

      {recent.length > 0 ? (
        <section className="mt-14">
          <h2 className="font-display text-lg text-muted">Your stashes</h2>
          <ul className="mt-3 flex flex-wrap gap-3">
            {recent.map((room) => (
              <li key={room.code}>
                <Link
                  href={`/room/${room.code}`}
                  className="sticker-sm press-sm flex items-center gap-2 rounded-xl bg-panel px-4 py-2 transition"
                >
                  <span className="font-display">{room.name}</span>
                  <span className="font-mono text-xs text-muted">
                    {room.code}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="mt-16 text-center text-sm text-muted">
        No accounts, no sign-ups. Anyone with the link can edit the list.
      </footer>
    </main>
  );
}
