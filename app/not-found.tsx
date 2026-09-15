import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="sticker -rotate-3 rounded-3xl bg-panel px-10 py-6 font-display text-6xl">
        404
      </div>
      <h1 className="font-display text-2xl">That stash is not here</h1>
      <p className="text-muted">
        The code was either mistyped or entirely made up. Both happen a lot.
      </p>
      <Link
        href="/"
        className="sticker press rounded-xl bg-brand px-5 py-3 font-display text-brand-ink"
      >
        Back to the start
      </Link>
    </main>
  );
}
