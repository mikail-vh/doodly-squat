"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { copyText, rememberRoom, saveNickname, useNickname } from "@/lib/local";
import {
  MAX_EXPORT_CHARS,
  MAX_WORD_LENGTH,
  SKRIBBL_MINIMUM,
  type Room,
  type Word,
} from "@/lib/shared";

/** Friends edit the same list, so pull in their changes on a slow loop. */
const POLL_INTERVAL = 5000;

const CRAYONS = [
  "bg-[#ffd6e7] text-[#8f1f52]",
  "bg-[#ffeaa7] text-[#7d5100]",
  "bg-[#c8f2dc] text-[#0d6544]",
  "bg-[#d3e8ff] text-[#11477c]",
  "bg-[#e7dcff] text-[#4a2896]",
  "bg-[#ffe0cb] text-[#963f10]",
  "bg-[#e6f5c2] text-[#4c6810]",
];

/** Same word, same colour, every session — it keeps the grid readable. */
function crayonFor(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return CRAYONS[hash % CRAYONS.length];
}

type Props = { room: Room; initialWords: Word[] };

export default function RoomDashboard({ room, initialWords }: Props) {
  const code = room.code;

  const [words, setWords] = useState(initialWords);
  const [draft, setDraft] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<"newest" | "alpha">("newest");
  const nickname = useNickname();
  const [nameDraft, setNameDraft] = useState(room.name);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);

  const savedName = useRef(room.name);
  const renaming = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ping = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }, []);

  useEffect(() => {
    rememberRoom(room);
  }, [room]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/rooms/${code}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        setWords(data.words as Word[]);
        // Never yank the title out from under someone mid-rename.
        if (!renaming.current && data.room.name !== savedName.current) {
          savedName.current = data.room.name;
          setNameDraft(data.room.name);
        }
      } catch {
        // A dropped poll just means we try again in a few seconds.
      }
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [code]);

  const ordered = useMemo(() => {
    // The server hands them back newest first, so only A-Z needs work.
    if (sort !== "alpha") return words;
    return [...words].sort((a, b) =>
      a.text.localeCompare(b.text, undefined, { sensitivity: "base" }),
    );
  }, [words, sort]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return ordered;
    return ordered.filter((word) => word.text.toLowerCase().includes(needle));
  }, [ordered, filter]);

  // No space after the comma: skribbl.io splits on "," and keeps what it finds.
  const exported = useMemo(
    () => ordered.map((word) => word.text).join(","),
    [ordered],
  );

  const ready = words.length >= SKRIBBL_MINIMUM;
  const progress = Math.min(100, (words.length / SKRIBBL_MINIMUM) * 100);
  const overBudget = exported.length > MAX_EXPORT_CHARS;

  async function submitWords(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/rooms/${code}/words`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: draft, addedBy: nickname }),
      });
      if (!res.ok) throw new Error("add failed");
      const data = await res.json();
      setWords(data.words as Word[]);
      setDraft("");
      ping(
        data.added === 0
          ? "already in the stash"
          : `+${data.added} word${data.added === 1 ? "" : "s"}`,
      );
    } catch {
      ping("could not save that");
    } finally {
      setBusy(false);
    }
  }

  async function removeWord(word: Word) {
    setWords((current) => current.filter((item) => item.id !== word.id));
    try {
      const res = await fetch(`/api/rooms/${code}/words/${word.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
    } catch {
      // The next poll puts it back, so just say something went wrong.
      ping("could not remove that");
    }
  }

  async function clearAll() {
    const confirmed = window.confirm(
      `Delete all ${words.length} words in ${savedName.current}? There is no undo.`,
    );
    if (!confirmed) return;
    const res = await fetch(`/api/rooms/${code}/words`, { method: "DELETE" });
    if (!res.ok) {
      ping("could not empty the stash");
      return;
    }
    setWords([]);
    ping("stash emptied");
  }

  async function commitName() {
    renaming.current = false;
    const next = nameDraft.replace(/\s+/g, " ").trim();
    if (!next) {
      setNameDraft(savedName.current);
      return;
    }
    if (next === savedName.current) return;
    savedName.current = next;
    setNameDraft(next);
    rememberRoom({ code, name: next });
    await fetch(`/api/rooms/${code}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    ping("stash renamed");
  }

  async function copyList() {
    const ok = await copyText(exported);
    ping(ok ? "word list copied ✂️" : "copy blocked — select the box by hand");
  }

  function downloadList() {
    const blob = new Blob([exported], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${code}-skribbl-words.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyInvite() {
    const ok = await copyText(`${window.location.origin}/room/${code}`);
    ping(ok ? "invite link copied 🔗" : "copy blocked — read out the code");
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="flex flex-wrap items-center gap-4">
        <Link
          href="/"
          aria-label="Back to all stashes"
          className="sticker-sm press-sm grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-panel text-lg"
        >
          ✏️
        </Link>

        <div className="min-w-0 flex-1">
          <input
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onFocus={() => {
              renaming.current = true;
            }}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            maxLength={40}
            aria-label="Stash name"
            className="w-full min-w-0 rounded-lg bg-transparent px-1 font-display text-2xl outline-none hover:bg-paper focus:bg-paper sm:text-3xl"
          />
          <p className="px-1 text-sm text-muted">
            {words.length} word{words.length === 1 ? "" : "s"} · click the title
            to rename
          </p>
        </div>

        <label className="sticker-sm flex items-center gap-2 rounded-xl bg-panel px-3 py-2">
          <span className="text-sm text-muted">you are</span>
          <input
            value={nickname}
            onChange={(event) => saveNickname(event.target.value)}
            placeholder="anonymous"
            maxLength={24}
            aria-label="Your name"
            className="w-24 bg-transparent font-display outline-none"
          />
        </label>
      </header>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-6">
          <div className="sticker rounded-3xl bg-panel p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl">Add words</h2>
              <button
                type="button"
                onClick={() => setPasteMode(!pasteMode)}
                className="sticker-sm press-sm rounded-lg bg-paper px-3 py-1.5 font-display text-sm"
              >
                {pasteMode ? "one at a time" : "paste a list"}
              </button>
            </div>

            {pasteMode ? (
              <form onSubmit={submitWords} className="mt-4">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={"soggy biscuit, tax return, Gandalf\ntraffic cone"}
                  aria-label="Words to add"
                  className="field min-h-28 resize-y"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted">
                    Split on commas and new lines. Duplicates are skipped.
                  </p>
                  <button
                    type="submit"
                    disabled={busy}
                    className="sticker press rounded-xl bg-brand px-5 py-2.5 font-display text-brand-ink disabled:opacity-60"
                  >
                    Add them all
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={submitWords} className="mt-4 flex gap-3">
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="a word or short phrase"
                  maxLength={MAX_WORD_LENGTH}
                  aria-label="Word to add"
                  className="field"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="sticker press shrink-0 rounded-xl bg-brand px-5 font-display text-brand-ink disabled:opacity-60"
                >
                  Add
                </button>
              </form>
            )}
          </div>

          <div className="sticker rounded-3xl bg-panel p-5">
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="filter the pile"
                aria-label="Filter words"
                className="field max-w-52 flex-1"
              />
              <div className="sticker-sm flex overflow-hidden rounded-xl bg-paper">
                {(["newest", "alpha"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSort(mode)}
                    className={`px-3 py-2 font-display text-sm ${
                      sort === mode ? "bg-brand text-brand-ink" : "text-muted"
                    }`}
                  >
                    {mode === "newest" ? "Newest" : "A–Z"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={clearAll}
                disabled={words.length === 0}
                className="sticker-sm press-sm ml-auto rounded-xl bg-paper px-3 py-2 font-display text-sm disabled:opacity-40"
              >
                Clear all
              </button>
            </div>

            {filter.trim() ? (
              <p className="mt-3 text-xs text-muted">
                Showing {visible.length} of {words.length}. Filtering never
                changes what gets exported.
              </p>
            ) : null}

            {visible.length === 0 ? (
              <p className="py-14 text-center text-muted">
                {words.length === 0
                  ? "Nothing here yet. Start with something unfair to draw."
                  : "No words match that filter."}
              </p>
            ) : (
              <ul className="mt-5 flex flex-wrap gap-2">
                {visible.map((word) => (
                  <li
                    key={word.id}
                    title={`added by ${word.addedBy}`}
                    className={`pop-in sticker-sm flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-3.5 ${crayonFor(word.text)}`}
                  >
                    <span className="font-display">{word.text}</span>
                    <button
                      type="button"
                      onClick={() => removeWord(word)}
                      aria-label={`Remove ${word.text}`}
                      className="grid h-6 w-6 place-items-center rounded-full text-xs hover:bg-black/15"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-12">
          <div className="sticker rounded-3xl bg-panel p-5">
            <h2 className="font-display text-xl">Invite the crew</h2>
            <p className="mt-1 text-sm text-muted">
              Anyone with the link can add and remove words.
            </p>
            <div className="mt-4 flex justify-center gap-1.5">
              {code.split("").map((character, index) => (
                <span
                  key={index}
                  className="sticker-sm grid h-11 w-9 place-items-center rounded-lg bg-paper font-display text-xl"
                >
                  {character}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={copyInvite}
              className="sticker press mt-5 w-full rounded-xl bg-brand px-4 py-3 font-display text-brand-ink"
            >
              Copy invite link
            </button>
          </div>

          <div className="sticker rounded-3xl bg-panel p-5">
            <h2 className="font-display text-xl">Export</h2>

            <div className="mt-3 flex items-baseline justify-between text-sm">
              <span className="font-display">
                {words.length} / {SKRIBBL_MINIMUM} minimum
              </span>
              <span className="text-muted">
                {ready
                  ? "ready for skribbl 🎉"
                  : `${SKRIBBL_MINIMUM - words.length} to go`}
              </span>
            </div>
            <div className="sticker-sm mt-2 h-3 overflow-hidden rounded-full bg-paper">
              <div
                className="h-full transition-all"
                style={{
                  width: `${progress}%`,
                  background: ready ? "var(--mint)" : "var(--brand)",
                }}
              />
            </div>

            <textarea
              readOnly
              value={exported}
              onFocus={(event) => event.currentTarget.select()}
              placeholder="Words show up here, comma-separated."
              aria-label="Comma-separated word list"
              className="field mt-4 h-32 resize-none font-mono text-xs"
            />
            <p
              className={`mt-2 text-xs ${overBudget ? "font-display text-brand" : "text-muted"}`}
            >
              {exported.length.toLocaleString()} /{" "}
              {MAX_EXPORT_CHARS.toLocaleString()} characters
              {overBudget ? " — skribbl will cut this off" : ""}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={copyList}
                disabled={words.length === 0}
                className="sticker press rounded-xl bg-brand px-4 py-3 font-display text-brand-ink disabled:opacity-50"
              >
                Copy list
              </button>
              <button
                type="button"
                onClick={downloadList}
                disabled={words.length === 0}
                className="sticker press rounded-xl bg-paper px-4 py-3 font-display disabled:opacity-50"
              >
                Download
              </button>
            </div>

            <p className="mt-3 text-xs text-muted">
              In skribbl.io: Create Private Room → Custom Words → paste.
            </p>
          </div>
        </aside>
      </div>

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div
            role="status"
            className="toast-in sticker rounded-full bg-panel px-5 py-3 font-display"
          >
            {toast}
          </div>
        </div>
      ) : null}
    </main>
  );
}
