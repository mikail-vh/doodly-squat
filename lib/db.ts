import postgres from "postgres";

/**
 * Storage is Supabase Postgres, reached through the *transaction* pooler on
 * port 6543. The schema lives in `supabase/schema.sql` and is applied once by
 * hand in the Supabase SQL editor — there is no migration runner here any
 * more, because the old `PRAGMA user_version` ladder only made sense when the
 * app owned a SQLite file it booted next to.
 */
function connect() {
  // Checked here rather than at module scope: `next build` imports every route
  // in parallel workers, and a throw up there would fail the build on any
  // machine without the variable instead of at the first actual query.
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Use the Supabase transaction pooler string (port 6543).",
    );
  }

  return postgres(connectionString, {
    // Transaction-mode pooling hands a different backend to every statement,
    // so prepared statements cannot be relied on and must be switched off.
    prepare: false,

    // Each warm Vercel instance keeps its own pool, and they add up against
    // the pooler's limit, so keep them small and let idle ones go.
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,

    types: {
      // The app has always handled dates as epoch milliseconds. Postgres
      // stores timestamptz (so the Supabase table editor stays readable) and
      // this hands them back in the shape the existing code expects.
      timestamp: {
        to: 1184,
        from: [1082, 1114, 1184],
        serialize: (value: number | string | Date) =>
          new Date(value).toISOString(),
        parse: (value: string) => Date.parse(value),
      },

      // int8 arrives as a string by default, to protect precision that row
      // counts, word ids and TOTP steps are nowhere near needing. Left alone
      // it silently breaks things like `count === 0`.
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number | bigint) => String(value),
        parse: (value: string) => Number(value),
      },
    },

    onnotice: () => {},
  });
}

// Dev hot-reload re-evaluates modules; keep one pool on globalThis so reloads
// do not leak connections. Connecting is lazy, so merely importing a route (as
// `next build` does, in parallel workers) never opens a socket.
const cache = globalThis as typeof globalThis & {
  __stashSql?: ReturnType<typeof connect>;
};

export function db() {
  return (cache.__stashSql ??= connect());
}
