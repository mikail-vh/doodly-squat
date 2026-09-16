# Migration: VPS → Vercel + Supabase

Moves Doodly Squat off the Oracle VPS. Postgres on Supabase, Next.js on Vercel,
`squat.mvhuysie.com` kept as the address.

## What changes

| | Before | After |
| --- | --- | --- |
| Hosting | Docker on Oracle VPS, behind your Caddy | Vercel |
| Database | SQLite file on a Docker volume | Supabase Postgres |
| Database browser | sqlite-web at `squat-db.mvhuysie.com` | Supabase table editor |
| Auth | Discord + Google OAuth, TOTP 2FA | **unchanged** |
| Registration | open to anyone | **unchanged in v1** — invite-only is deferred |
| Address | `squat.mvhuysie.com` | unchanged |
| Discord redirect URI | `https://squat.mvhuysie.com/auth/discord/callback` | **unchanged** |

Nothing to migrate: the live database is 1 account, 2 empty stashes, 0 words.
We start clean.

**Two things to expect.** Supabase has no African region, so database round
trips go from ~10 ms to ~150–200 ms from Johannesburg. And free projects pause
after 7 days idle, with a 10–30 s cold start on the next request — step 6 sets
up a keep-alive so that never bites.

---

## Order of play

Sign-in is the one thing that cannot be tested on a Vercel preview URL while
`APP_URL` points at the real domain — `lib/oauth.ts` builds the OAuth redirect
URI from `APP_URL`, so Discord would send you back to `squat.mvhuysie.com`,
which is still the VPS. Step 2b works around that by giving Preview its own
`APP_URL`, so the whole app including sign-in is proven *before* DNS moves.

| | Step | Where |
| --- | --- | --- |
| 1 | Create the Supabase project, run the schema | browser |
| 2 | Create the Vercel project, set env vars, deploy | browser |
| 2b | Register the Vercel URL with Discord, test sign-in on it | browser |
| 3 | Point `squat.mvhuysie.com` at Vercel | browser |
| 4 | Confirm the same account works on the real domain | browser |
| 5 | Decommission the VPS app | VPS |

---

## 1. Supabase project  `[BROWSER]`

### 1.1 Create it

1. <https://supabase.com/dashboard> → **New project**
2. **Name:** `doodly-squat`
3. **Database Password:** click **Generate a password** and **save it now** —
   it is shown once, and you need it in step 1.3
4. **Region:** `Central EU (Frankfurt)` — there is no African region; this is
   the closest of what is offered
5. **Create new project**, then wait ~2 minutes for provisioning

### 1.2 Run the schema

1. Left sidebar → **SQL Editor** → **New query**
2. Open `supabase/schema.sql` from this repo, copy **the whole file**
3. Paste it in and hit **Run** (or Ctrl+Enter)

You should get `Success. No rows returned`. It is safe to run twice — every
statement is `if not exists`.

Now check **Table Editor**. All ten tables must be there:

```
users   oauth_accounts   sessions   totp_credentials   recovery_codes
invites   invite_redemptions   rooms   words   game_results
```

Each one shows an **RLS enabled** badge and **no policies**. That is
deliberate, not an oversight — it shuts off Supabase's auto-generated
PostgREST API, which anyone can reach with the public anon key. The app
connects as the table owner and bypasses RLS, so it is unaffected.
**Do not "fix" these warnings by adding policies.**

### 1.3 Get the connection string

1. Top of the dashboard → **Connect** (or Project Settings → Database)
2. Choose the **Transaction pooler** tab — **not** Session pooler, **not**
   Direct connection
3. Confirm the port in the string is **6543**

It looks like this:

```
postgresql://postgres.abcdefghijklm:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
```

Replace `[YOUR-PASSWORD]` — brackets and all — with the password from step 1.1.

> **If your password contains `@ : / ? # [ ] %` or a space, percent-encode it**
> or the URL will parse wrongly and you will get a confusing auth error.
> `@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`, `%` → `%25`.
> The simplest escape hatch is to reset the database password to something
> long and alphanumeric instead.

That finished string is `DATABASE_URL`. Keep it somewhere for step 2.

Why the transaction pooler: serverless functions open and close connections
constantly. Port 5432 is a direct connection and will exhaust the limit; 6543
is built for exactly this. It is also why `lib/db.ts` sets `prepare: false` —
transaction-mode pooling hands a different backend to each statement, so
prepared statements cannot be relied on.

---

## 2. Vercel project  `[BROWSER]`

### 2.1 Import the repo

1. <https://vercel.com/new>
2. **Import** `mikail-vh/doodly-squat` (authorise Vercel for the `mikail-vh`
   account if prompted — note this is *not* `mikail-comp`)
3. **Framework Preset:** Next.js, detected automatically
4. Leave Root Directory, Build Command and Output Directory **untouched**
5. **Do not deploy yet** — add the environment variables first, because the
   build imports every route

### 2.2 Environment variables

Expand **Environment Variables** and add these. Unless a row says otherwise,
tick **all three** of Production, Preview and Development:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | the port-6543 string from step 1.3 |
| `APP_NAME` | `Doodly Squat` |
| `DISCORD_CLIENT_ID` | from the VPS `.env` — see below |
| `DISCORD_CLIENT_SECRET` | from the VPS `.env` |
| `STATS_INGEST_TOKEN` | from the VPS `.env` |
| `APP_URL` | **Production only:** `https://squat.mvhuysie.com` |

Leave `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` out entirely — the Google
button hides itself until both exist.

`APP_URL` is scoped to Production on purpose. Preview gets its own value in
step 2b, which is what makes sign-in testable before the domain moves.

To read the three secrets off the VPS (Tailscale must be connected):

```bash
ssh ubuntu@100.117.93.19 'cat doodly-squat/deploy/behind-caddy/.env'
```

### 2.3 Deploy

Hit **Deploy** and wait for the build. Then open the deployment and verify
everything that does not need sign-in:

```bash
# use the URL Vercel gives you, e.g. doodly-squat.vercel.app
V=https://doodly-squat.vercel.app

curl -s $V/api/health                                  # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' $V/           # 200
curl -s -o /dev/null -w '%{http_code}\n' $V/leaderboard # 200
curl -s -o /dev/null -w '%{http_code}\n' $V/admin      # 404 — correct, you are anonymous

# create a stash and add words, end to end
curl -s -X POST $V/api/rooms -H 'content-type: application/json' -d '{"name":"Smoke Test"}'
```

Take the `code` that comes back and:

```bash
curl -s -X POST $V/api/rooms/<CODE>/words \
  -H 'content-type: application/json' \
  -d '{"text":"goblin, wizard, swamp hag","addedBy":"miks"}'
```

`added` should be `3`. If `/api/health` returns `{"ok":false}`, the problem is
`DATABASE_URL` — check the port is 6543 and the password is encoded.

### 2b. Prove sign-in before touching DNS  `[BROWSER]`

1. In Vercel, find the **stable** project URL — `doodly-squat.vercel.app`,
   not the per-deployment hash URL
2. **Discord Developer Portal** → your app → **OAuth2** → **Redirects** →
   **Add another** →
   `https://doodly-squat.vercel.app/auth/discord/callback`
   Keep the existing `https://squat.mvhuysie.com/auth/discord/callback` —
   Discord allows several. **Save Changes.**
3. Back in Vercel → Settings → Environment Variables → add
   `APP_URL` = `https://doodly-squat.vercel.app`, ticked for **Preview only**
4. **Redeploy** (Deployments → ⋯ → Redeploy) so the new variable is picked up

Now open `https://doodly-squat.vercel.app` in a browser and sign in with
Discord. It should complete and land you on `/account`.

**You are now the owner** — the users table was empty, and the first account
to sign in gets `is_admin`. Confirm `/admin` loads and shows one account.

If it fails with `?error=state`, the redirect URI in Discord does not match
`APP_URL` character for character. If it fails with `?error=exchange`, the
client secret is wrong.

> Once step 3 is done you can delete the Preview `APP_URL` and the extra
> Discord redirect, though leaving them costs nothing and keeps previews
> working.

---

## 3. Point the domain at Vercel  `[BROWSER]`

Only once step 2b has actually signed you in.

### 3.1 Tell Vercel about the domain

**Vercel → project → Settings → Domains → Add** `squat.mvhuysie.com`.
Vercel shows you the DNS record it wants. It will sit in a failing state until
the next step — that is expected.

### 3.2 Change the record in Cloudflare

**Cloudflare → `mvhuysie.com` → DNS → Records**, edit the `squat` record:

| Field | From | To |
| --- | --- | --- |
| Type | `A` | **`CNAME`** |
| Name | `squat` | `squat` |
| Content | `92.4.159.195` | `cname.vercel-dns.com` (use whatever Vercel shows) |
| Proxy status | Proxied (orange) | **DNS only (grey)** |

**Grey cloud matters.** Vercel issues and renews its own certificate, and
Cloudflare's proxy sitting in front of that validation is the usual reason it
never completes.

### 3.3 Verify

Propagation is usually under a minute. Vercel's Domains page should go green.

```bash
nslookup squat.mvhuysie.com          # expect the vercel-dns CNAME
curl -s https://squat.mvhuysie.com/api/health     # {"ok":true}
curl -sI https://squat.mvhuysie.com/ | head -1    # HTTP/2 200
```

The old VPS app is still running and still reachable on the tailnet — nothing
has been destroyed yet, so if anything looks wrong you can flip the Cloudflare
record back to the `A` record above and be exactly where you started.

## 4. Check yourself over on the real domain  `[BROWSER]`

You already became the owner in step 2b — the users table was empty, and
`linkOrCreateUser` in `lib/auth.ts` gives `is_admin` to the first account that
signs in. Nothing more to claim; this step is just confirming the same account
works now that the address has changed.

Open `https://squat.mvhuysie.com` and check:

- you are still signed in, or can sign in again with Discord
- `/account` shows your Discord name and avatar
- `/admin` loads and lists one account, with **owner** against it
- create a stash, add a few words, and export the comma-separated line

If sign-in worked on the Vercel URL but not here, `APP_URL` for **Production**
is wrong — it has to be exactly `https://squat.mvhuysie.com`, no trailing
slash — or DNS has not finished moving.

**Registration is still open to anyone in v1**, exactly as it is on the VPS
today. Invite-only is the next piece of work, not part of this migration, so
there is no new exposure here — but also nothing yet stopping a stranger who
finds the URL from making an account.

---

## 5. Decommission the VPS side  `[VPS]`

Only once the Vercel deployment is confirmed working.

```bash
ssh ubuntu@100.117.93.19

# keep a copy of the old database, just in case
docker exec doodly-squat cat /data/stash.db > ~/doodly-squat-final.db

# stop and remove the app and the sqlite browser
cd ~/doodly-squat && docker compose -f deploy/behind-caddy/docker-compose.yml down -v
cd ~/squat-db     && docker compose down --rmi local -v

# drop the three site blocks from Caddy: squat, squat-local, squat-db
cp ~/caddy/Caddyfile ~/caddy/Caddyfile.bak.premigration
nano ~/caddy/Caddyfile
docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec caddy caddy reload   --config /etc/caddy/Caddyfile --adapter caddyfile
```

The Caddyfile should be left with only `status.mvhuysie.com` and
`stats.mvhuysie.com`.

Then in **Cloudflare**, delete the now-dead records `squat-local` and
`squat-db`. Leave `squat` (it points at Vercel) and `status` / `stats` (still
your tailnet dashboards).

**Leave the OCI firewall alone** — port 443 is still serving `status`/`stats`
over the tailnet, and port 80 is still needed for their certificate renewals.

Untouched by any of this: RustDesk, uptime-kuma, beszel, Tailscale, Caddy.

---

## 6. Stop Supabase pausing  `[REPO]`

A scheduled GitHub Action pings the app twice a week, which touches the
database and resets the 7-day inactivity timer.

`.github/workflows/keepalive.yml`
```yaml
name: keep-alive
on:
  schedule:
    - cron: "17 6 * * 1,4"   # Mondays and Thursdays
  workflow_dispatch:

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: curl -sSf https://squat.mvhuysie.com/api/health
```

`/api/health` runs a query, so it counts as database activity. `workflow_dispatch`
lets you trigger it by hand if the project ever does pause.

---

## What changed in the code

Done, not steps to run:

| Area | Change |
| --- | --- |
| `lib/db.ts` | `node:sqlite` → `postgres` (postgres.js) on the pooler, `prepare: false` (transaction mode forbids prepared statements) |
| All queries | synchronous → `await`, cascading through 4 lib files and 12 routes, pages and actions |
| Dialect | `AUTOINCREMENT` → identity, `COLLATE NOCASE` → `citext`/`lower()`, `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`, `group_concat` → `array_agg` |
| Migrations | `PRAGMA user_version` → `supabase/schema.sql`, applied once |
| Timestamps | `timestamptz` in the database, parsed back to epoch milliseconds in `lib/db.ts` so existing date handling is untouched |
| int8 | also parsed back to `number` — left alone, postgres.js returns counts as strings and quietly breaks `count === 0` |
| Batching | `addWords` and `recordResults` became single multi-row statements; over a ~150 ms Frankfurt round trip a fifty-word paste was going to cost fifty of them |

Three things needed more than a literal translation, because Postgres types
are stricter than SQLite's:

- `won` is a real `boolean`, so the leaderboard counts wins with
  `COUNT(*) FILTER (WHERE won)` — there is no `sum(boolean)`.
- `COALESCE(w.user_id, w.added_by)` in the admin stash query mixes `uuid` and
  `text`, which Postgres refuses; it casts explicitly now.
- `game_results.user_id` is a `uuid`, and comparing it against a malformed
  string is an *error*, not a miss. `recordResults` screens ids against a uuid
  pattern first, so a bad ingest payload gets a rejection rather than a 500.

### Deferred — not in v1

Invite-only registration, username/password accounts and password reset are
the next piece of work. `supabase/schema.sql` already creates the `invites`
and `invite_redemptions` tables and the `users.username` / `password_hash`
columns, so landing them needs no further schema change.

One constraint is deliberately held back: `users` should carry a
`check (username is not null or email is not null)`, but until usernames exist
the only login route is OAuth, and `lib/oauth.ts` stores a null email whenever
the provider reports the address unverified. Adding it now would reject a
sign-in that works today. It goes in with passwords — see the note in
`supabase/schema.sql`.
