# Migration: VPS → Vercel + Supabase

Moves Doodly Squat off the Oracle VPS. Postgres on Supabase, Next.js on Vercel,
`squat.mvhuysie.com` kept as the address.

## What changes

| | Before | After |
| --- | --- | --- |
| Hosting | Docker on Oracle VPS, behind your Caddy | Vercel |
| Database | SQLite file on a Docker volume | Supabase Postgres |
| Database browser | sqlite-web at `squat-db.mvhuysie.com` | Supabase table editor |
| Auth | Discord + Google OAuth, TOTP 2FA | **unchanged**, plus username/password |
| Registration | open to anyone | **invite only** |
| Address | `squat.mvhuysie.com` | unchanged |
| Discord redirect URI | `https://squat.mvhuysie.com/auth/discord/callback` | **unchanged** |

Nothing to migrate: the live database is 1 account, 2 empty stashes, 0 words.
We start clean.

**Two things to expect.** Supabase has no African region, so database round
trips go from ~10 ms to ~150–200 ms from Johannesburg. And free projects pause
after 7 days idle, with a 10–30 s cold start on the next request — step 6 sets
up a keep-alive so that never bites.

---

## 1. Supabase project  `[BROWSER]`

1. supabase.com → **New project**
2. Name `doodly-squat`, generate a strong database password, **save it**
3. **Region: Central EU (Frankfurt)** — lowest latency of the available options
   from South Africa
4. Wait for provisioning (~2 min)
5. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**

Confirm under **Table Editor** that you see: `users`, `oauth_accounts`,
`sessions`, `totp_credentials`, `recovery_codes`, `invites`,
`invite_redemptions`, `rooms`, `words`, `game_results`.

Every table will show an **RLS enabled** badge with no policies. That is
deliberate — it blocks Supabase's public PostgREST API entirely, while the app
connects as the table owner and is unaffected. Without it, anyone holding the
anon key (which is public by design) could read your whole database.

### The connection string

**Project Settings → Database → Connection string → Transaction pooler.**

Take the **port 6543** one, not 5432. Serverless functions open and close
connections constantly; the transaction pooler is built for that, a direct
connection is not and will exhaust the limit.

```
postgresql://postgres.<project-ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
```

Substitute your real password. That whole string becomes `DATABASE_URL`.

---

## 2. Vercel project  `[BROWSER]`

1. vercel.com → **Add New → Project** → import `mikail-vh/doodly-squat`
2. Framework preset: **Next.js** (auto-detected). Leave build settings alone.
3. **Before the first deploy**, add the environment variables below
4. Deploy

### Environment variables

Set each for **Production, Preview and Development**:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | the port-6543 pooler string from step 1 |
| `APP_URL` | `https://squat.mvhuysie.com` |
| `APP_NAME` | `Doodly Squat` |
| `DISCORD_CLIENT_ID` | unchanged from your VPS `.env` |
| `DISCORD_CLIENT_SECRET` | unchanged |
| `STATS_INGEST_TOKEN` | unchanged |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional, still |

`APP_URL` must stay exactly `https://squat.mvhuysie.com`. It builds the OAuth
redirect URI and decides whether session cookies are marked `Secure` — which is
also why keeping the domain means **no Discord reconfiguration at all**.

---

## 3. Point the domain at Vercel  `[BROWSER]`

**Vercel → your project → Settings → Domains → Add** `squat.mvhuysie.com`.
Vercel will show you the record it wants.

Then in **Cloudflare → DNS**, edit the `squat` record:

| Field | Value |
| --- | --- |
| Type | change `A` → **`CNAME`** |
| Name | `squat` |
| Target | `cname.vercel-dns.com` (use whatever Vercel shows) |
| Proxy status | **DNS only — grey cloud** |

Grey cloud matters here: Vercel issues and renews its own certificate, and
Cloudflare's proxy in front of that validation is a common reason it never
completes. You can turn the proxy back on once Vercel reports the domain as
valid, though there is little reason to.

Verify:
```bash
nslookup squat.mvhuysie.com
curl -s https://squat.mvhuysie.com/api/health      # {"ok":true}
```

---

## 4. First sign-in and your invite  `[BROWSER]`

The database is empty, so **the first account to sign in becomes the owner** —
and registration is invite-only for everyone *except* that first account.
Sign in with Discord immediately after the first successful deploy, before
sharing the address with anyone.

Then **`/admin` → Invites → Create invite** to mint links for your friends:
`https://squat.mvhuysie.com/join/<code>`

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

## What changes in the code

Done for you, not steps to run:

| Area | Change |
| --- | --- |
| `lib/db.ts` | `node:sqlite` → `postgres` (postgres.js) on the pooler, `prepare: false` (transaction mode forbids prepared statements) |
| All queries | synchronous → `await`, cascading through every route, page and action |
| Dialect | `AUTOINCREMENT` → identity, `COLLATE NOCASE` → `citext`/`lower()`, `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`, `group_concat` → `string_agg` |
| Migrations | `PRAGMA user_version` → `supabase/schema.sql`, applied once |
| Timestamps | `timestamptz` in the database, read back as epoch milliseconds so existing date handling is untouched |
| **New** `lib/passwords.ts` | username + password accounts, hashed with `crypto.scrypt` — no native module, so it works on Vercel |
| **New** `lib/invites.ts` | mint, redeem, revoke; registration refused without a valid invite |
| **New** `/join/[code]` | invite landing page → sign in or register |
| **New** `/register` | username + password form, invite required |
| `/admin` | invite management: create, copy link, revoke, see who redeemed what |
| `Dockerfile`, `deploy/` | removed — Vercel builds from source |

Password hashing uses `crypto.scrypt` rather than Argon2id or bcrypt on
purpose: both of those are native addons, which are painful on Vercel's
serverless runtime. scrypt is memory-hard, built into Node, and needs no
dependency. Parameters are stored alongside each hash so they can be raised
later without invalidating existing passwords.
