# Doodly Squat — session handoff

Paste this whole file into a new Claude Code session on the home PC. It is
everything needed to carry on without re-deriving anything.

> **Prompt to open with:** "Read HANDOFF.md in this repo. We're mid-migration
> from a self-hosted VPS to Vercel + Supabase, and adding invite-only
> registration with username/password support. Pick up at 'Next steps'."

---

## 1. What this is

A shared word list for **skribbl.io**. You and your friends pile up cursed words
in a "stash", then export the lot as one comma-separated line to paste into
skribbl.io's Custom Words box. On top of that sits an accounts layer —
progress, levels, a leaderboard — designed to eventually be fed real match
stats by a self-hosted game server (`scribble.rs`).

**Live at https://squat.mvhuysie.com** and working.

---

## 2. The repo

- **GitHub:** `https://github.com/mikail-vh/doodly-squat` (public)
- **Branch:** `main`
- **Local path was:** `C:\Users\mikail.vanhuyssteen\source\repos\FUN_PROJECTS\skribbl-stash`
  (folder name is the old project name; the repo is `doodly-squat`)

```bash
git clone https://github.com/mikail-vh/doodly-squat.git
cd doodly-squat
npm install
```

⚠️ **Your active `gh` account is `mikail-comp`, but this repo belongs to
`mikail-vh`.** Either `gh auth switch --user mikail-vh` or always name the owner
explicitly. This has bitten once already.

### Stack

Next.js **16.3.5** (App Router, Turbopack), React **19.2.8**, Tailwind **v4**,
TypeScript, Node **26**. No ORM, no auth library — the data layer and the whole
auth system are hand-rolled and dependency-free apart from `qrcode`.

`AGENTS.md`/`CLAUDE.md` in the repo warn that this Next.js version differs from
training data. **Read `node_modules/next/dist/docs/` before writing Next-specific
code.** Notably `cookies()` is async, and route handler `params` is a `Promise`.

### Layout

| Path | Purpose |
| --- | --- |
| `lib/db.ts` | SQLite connection + numbered migrations (`PRAGMA user_version`) |
| `lib/words.ts` | Stash and word queries |
| `lib/auth.ts` | Users, OAuth account linking, sessions, TOTP |
| `lib/oauth.ts` | Discord/Google provider definitions, PKCE flow |
| `lib/totp.ts` | RFC 6238 TOTP + recovery codes, on `node:crypto` |
| `lib/stats.ts` | Leaderboard aggregation, stats ingest |
| `lib/admin.ts` | Admin dashboard queries |
| `lib/shared.ts` | Types, limits, level curve |
| `lib/local.ts` | Client-side localStorage via `useSyncExternalStore` |
| `app/room/[code]/` | The word-list dashboard |
| `app/admin/` | Admin dashboard (owner only) |
| `app/auth/[provider]/` | OAuth start + callback |
| `deploy/migration.md` | **The Vercel + Supabase plan — start here** |
| `supabase/schema.sql` | Postgres schema, ready to paste into Supabase |

---

## 3. Where things stand

### Working and deployed (on the VPS)

Word lists, comma-separated export with skribbl's limits enforced (10 word
minimum, 32 chars each, 10 000 total), 5-second polling so friends' additions
appear live, Discord OAuth with PKCE, hashed sessions, optional TOTP 2FA with
recovery codes, XP/levels, leaderboard, and a stats ingest endpoint waiting for
a game server.

### Built but NOT deployed

`/admin` — totals, every account (providers, 2FA state, words contributed,
joined, last seen), stashes with contributor counts, latest words. Gated on
`is_admin`, returns 404 for everyone else. Verified working locally.

### Live data (trivial — nothing worth migrating)

```
users: 1   (miks · mikehuysie42@gmail.com · OWNER)
rooms: 2   (both empty test stashes)
words: 0
games: 0
```

---

## 4. Infrastructure inventory

### Domains — `mvhuysie.com`, DNS on Cloudflare

| Host | Points at | Serves |
| --- | --- | --- |
| `squat.mvhuysie.com` | Cloudflare proxy → `92.4.159.195` | the app (public) |
| `squat-local.mvhuysie.com` | `100.117.93.19` (grey) | the app over Tailscale |
| `squat-db.mvhuysie.com` | `100.117.93.19` (grey) | sqlite-web, read-only |
| `status.mvhuysie.com` | `100.117.93.19` (grey) | uptime-kuma |
| `stats.mvhuysie.com` | `100.117.93.19` (grey) | beszel |

### The VPS

- Oracle Cloud, **Johannesburg**, **arm64 (Ampere)**, 11 GiB RAM
- Public `92.4.159.195`, Tailscale `100.117.93.19`
- **SSH only over Tailscale:** `ssh ubuntu@100.117.93.19` — port 22 is closed
  to the internet
- Break-glass if Tailscale ever fails: OCI Console → instance → **Console
  Connection** (works with every port shut)

Running there: the app (`/home/ubuntu/doodly-squat`, volume
`behind-caddy_stash-data`), Caddy (host network, `/home/ubuntu/caddy/Caddyfile`,
**custom image** `caddy-cloudflare` built with the Cloudflare DNS module for
DNS-01), sqlite-web, RustDesk (`hbbs`/`hbbr`, ports 21115–21119), uptime-kuma,
beszel.

**Only the app and sqlite-web get decommissioned.** Everything else stays.

### OCI firewall — two layers, both matter

VCN **Default Security List** for `vcn-mikail-sa` (the public subnet's list —
the private-subnet one is a decoy), *and* host iptables. Currently open:
`80`, `443`, `21115–21119`, ICMP. Port 22 deliberately closed.

Leave `80` open forever — Let's Encrypt renewals for `status`/`stats` need it.

### Third parties

- **Discord OAuth app** — redirect `https://squat.mvhuysie.com/auth/discord/callback`
- **Google OAuth** — not configured; the button hides itself until both
  `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` exist
- **Tailscale** — account `mikail-vh`, node `instance20260819195412`.
  **Confirm key expiry is disabled on that node** or it drops off the tailnet in
  ~6 months and SSH is gone
- **Cloudflare API token** — lives in `/home/ubuntu/caddy/.env` as
  `CF_API_TOKEN`, used for DNS-01

### Secrets — not in this file

`DISCORD_CLIENT_SECRET` and `STATS_INGEST_TOKEN` are in
`/home/ubuntu/doodly-squat/deploy/behind-caddy/.env` on the VPS. Retrieve with:

```bash
ssh ubuntu@100.117.93.19 'cat doodly-squat/deploy/behind-caddy/.env'
```

---

## 5. Decisions already made — don't reopen these

| Decision | Why |
| --- | --- |
| **Vercel + Supabase**, leaving the VPS | Your call after living with the self-hosted setup |
| **Keep `squat.mvhuysie.com`** | Means the Discord redirect URI needs no change at all |
| **Keep the hand-rolled auth**; Supabase is *just Postgres* | OAuth, PKCE, sessions and 2FA already work; swapping auth systems mid-migration doubles the risk |
| **Invite-only registration**, accounts only | Anonymous stash editing by link stays — that's the core feature |
| **Add username + password** as a third method | For friends who want neither Discord nor Google |
| **`crypto.scrypt`** for password hashing | Argon2/bcrypt are native addons, painful on Vercel serverless. scrypt is memory-hard and built into Node |
| **No Coolify** | Its proxy wants :80/:443, which Caddy already owned. Moot now, but `deploy/coolify.md` explains it if it resurfaces |

### Things you were told and accepted

- Supabase has **no African region** — Frankfurt is closest, so DB round trips
  go ~10 ms → ~150–200 ms from Johannesburg, on an app that polls every 5 s
- Supabase free tier **pauses after 7 days idle** (10–30 s cold start). The plan
  includes a GitHub Action keep-alive
- Password accounts will have **no email**, so no self-service reset — you reset
  them from `/admin`. Flagged, not yet confirmed either way

---

## 6. Next steps

### Immediately, before anything else

The last session ended with **uncommitted work**. If it was not pushed, it is
still only on the work PC:

```
M  components/site-header.tsx     (Admin nav link)
M  deploy/runbook.md
?? app/admin/page.tsx             (the whole admin dashboard)
?? lib/admin.ts
?? deploy/migration.md            (the migration plan)
?? supabase/schema.sql            (the Postgres schema)
```

```bash
git status                    # confirm whether they arrived
```

If they did not, they must be re-created or copied over.

### Then, in order

1. **Provision Supabase** — `deploy/migration.md` step 1. Region **Central EU
   (Frankfurt)**. Paste `supabase/schema.sql`. Take the **transaction pooler**
   connection string on **port 6543**, not 5432.
2. **Migrate the data layer** — the large piece, all code:
   - `lib/db.ts`: `node:sqlite` → `postgres` (postgres.js), `prepare: false`
     (transaction-mode pooling forbids prepared statements)
   - Every query becomes `await`; that cascades through ~15 call sites
   - Dialect: `AUTOINCREMENT` → identity, `COLLATE NOCASE` → `citext`/`lower()`,
     `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`, `group_concat` → `string_agg`
   - Timestamps are `timestamptz` in Postgres but read back as **epoch
     milliseconds**, so existing date handling needs no change
3. **Build the invite system** — `lib/invites.ts`, `/join/[code]`, invite
   management in `/admin`. Registration refused without a valid invite; the
   first account (when the users table is empty) bypasses it.
4. **Username + password** — `lib/passwords.ts` using `crypto.scrypt`, a
   `/register` page behind an invite, and a password form on `/signin`.
   Store params with the hash (`scrypt$N$r$p$salt$hash`) so they can be raised later.
5. **Vercel** — `deploy/migration.md` steps 2–4.
6. **Decommission the VPS app** — `deploy/migration.md` step 5. Only after
   Vercel is confirmed.
7. **Keep-alive Action** — step 6.

---

## 7. Gotchas that already cost time

**Shells.** The work PC used PowerShell *and* Git Bash. `head`, `date +%F` and
`$(...)` are bash-only; PowerShell needs `Select-Object -First 1` and
`$(Get-Date -Format yyyy-MM-dd)`. Several commands failed on this.

**Windows `curl` uses schannel**, so it validates against the Windows
certificate store and ignores `--cacert` entirely.

**The Sophos interception.** On the *work* network a Sophos firewall performs
TLS inspection on `mvhuysie.com` and re-signs certificates with its own
untrusted CA — so the site appears broken there while being perfectly fine
everywhere else. It is keyed on the **domain**, not the host: moving to
Cloudflare changed nothing, and moving to Vercel won't either. Other domains
(`sprite-rancher.com`) pass because they are categorised; `mvhuysie.com` is new
and Uncategorized. **On the home PC this should simply not occur** — verify
early, and don't chase server-side ghosts if it does.

**The VPS is arm64.** `coleifer/sqlite-web` is amd64-only and dies with
`exec format error`. Check image architecture before pulling.

**Caddy:** always `caddy validate` before `caddy reload`, and reload rather than
restart — that file serves live sites. Back it up first.

**Cloudflare grey vs orange.** Grey (DNS-only) is required for the tailnet
hostnames, or Caddy sees Cloudflare IPs instead of real ones. For Vercel, grey
is also wanted so certificate validation completes.

**Next.js static `metadata` leaks into the RSC payload even on a 404** — a
static title on `/admin` advertised the route's existence to anonymous
visitors. It's now resolved per-request via `generateMetadata`. Same trap
applies to any other gated route.

**`node:sqlite` honours `{ readOnly: true }`** at the engine level — verified,
writes and DROPs both refused. Irrelevant after the Postgres move, but worth
knowing the equivalent must be re-established with a limited Postgres role if a
SQL console is ever built.

**Supabase RLS.** `supabase/schema.sql` enables RLS on every table with **no
policies**, deliberately. Supabase auto-generates a PostgREST API reachable with
the public anon key; without RLS the entire database would be readable through
it. The app connects as the table owner and bypasses RLS, so it is unaffected.
Do not "fix" the RLS warnings by adding permissive policies.

---

## 8. Home PC setup checklist

| Need | Why |
| --- | --- |
| Node 26+ | `node:sqlite` is used until the Postgres migration lands |
| `gh` authenticated as **mikail-vh** | Pushing to the repo |
| **Tailscale**, signed in as `mikail-vh` | The only route to the VPS — SSH is closed publicly |
| SSH key on the VPS | The old machine used `~/.ssh/id_rsa`. Either copy it, or add the new machine's public key via `ssh-copy-id` from a machine that still has access |
| Docker Desktop | Optional. Never successfully used on the work PC — the Dockerfile was **never built locally**, only on the VPS |
| Cloudflare dashboard access | DNS changes |
| Supabase + Vercel accounts | The migration |

Verify the VPS is reachable before relying on it:

```bash
tailscale status
ssh ubuntu@100.117.93.19 'echo ok && docker ps --format "{{.Names}}"'
```

---

## 9. Verifying the live site from the home PC

```bash
curl -s  https://squat.mvhuysie.com/api/health          # {"ok":true}
curl -sI https://squat.mvhuysie.com/ | head -1          # HTTP/2 200
curl -s  https://squat.mvhuysie.com/signin | grep -o "Continue with"
```

If `/signin` looks empty, note that React renders `Continue with <!-- -->Discord`
— an HTML comment sits between the static text and the interpolated value, so
naive greps for `Continue with [A-Za-z]*` match nothing. That is not a bug.

The tailnet hostnames (`status`, `stats`, `squat-local`, `squat-db`) only
resolve usefully **while Tailscale is connected**.
