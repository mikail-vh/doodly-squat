# Doodly Squat

A shared word list for skribbl.io that exports as one comma-separated line,
plus the account, progress and leaderboard layer that the self-hosted game will
eventually feed with real match stats.

Everything lives in one SQLite file. There are no native modules to compile, so
the Docker image is a plain `node:alpine` and a backup is `cp stash.db`.

## The word list

Create a stash, send people the link, and everyone on it edits the same list —
no account needed. Paste or type words (split on commas and newlines, trimmed,
truncated at 32 characters, case-insensitively de-duplicated), filter and sort
them, then copy the export.

The export is `word one,word two` — commas, no spaces, no trailing comma, which
is what both targets accept:

- **skribbl.io** — Create Private Room → Custom Words. Needs at least 10 words,
  32 characters each, 10,000 characters total; the progress bar and character
  counter track exactly those limits.
- **scribble.rs** (the self-hostable clone) — the `custom_words` field on lobby
  creation, or the `CUSTOM_WORDS` environment variable for a server-wide
  default. It splits on commas, trims, lowercases, and **rejects empty
  entries**, so the no-trailing-comma format matters.

## Accounts

Signing in is optional and additive. Anonymous link-sharing keeps working
exactly as before; an account additionally claims the words you add, tracks
progress, and puts you on the leaderboard.

- **Discord and Google OAuth**, Authorization Code + PKCE. A provider switches
  on as soon as its client id and secret are both present, so you can run
  Discord-only and add Google later.
- Two accounts are linked into one when both providers report the **same
  verified email**. Unverified addresses never link.
- The first account to sign in is flagged as the instance owner.
- **Optional TOTP two-factor** on top of the provider. Discord and Google
  already enforce their own 2FA, so this is a second gate rather than the
  primary one — worth having, but know what it is. Enrollment shows a QR code
  and ten single-use recovery codes; turning it off costs a current code.
- Sessions are random 32-byte tokens stored **hashed**, so a leaked database
  file cannot be replayed as a live login.

## Stats ingest

`POST /api/stats/results` is where the game server will report finished
matches. It is disabled until `STATS_INGEST_TOKEN` is set.

```bash
curl -X POST https://your-domain/api/stats/results \
  -H "authorization: Bearer $STATS_INGEST_TOKEN" \
  -H "content-type: application/json" \
  -d '{
        "matchId": "abc123",
        "playedAt": 1757800000000,
        "players": [
          {"userId": "...", "score": 420, "rounds": 4,
           "wordsGuessed": 9, "wordsDrawn": 4, "won": true}
        ]
      }'
```

Writes are idempotent on `(matchId, userId)`, so a retry or a correction cannot
inflate anyone's totals. Unknown user ids are skipped, and the response says how
many rows were actually written.

XP is game score plus 5 per contributed word; levels are quadratic, so level
*n* starts at `100 × (n-1)²`.

## Running it locally

```bash
npm install
npm run dev        # http://localhost:3000
```

Sign-in needs at least one provider configured — copy `.env.example` to `.env`
and fill in a pair. Everything except sign-in works without any of it.

## Deploying

Three paths, all building the same `Dockerfile`.

### Behind an existing reverse proxy — what this actually runs on

The VPS already runs Caddy in front of RustDesk, uptime-kuma and beszel, so the
app publishes on `127.0.0.1:3000` and gets one Caddy site block. Nothing else
on the box moves.

```bash
cp deploy/behind-caddy/.env.example deploy/behind-caddy/.env
$EDITOR deploy/behind-caddy/.env
docker compose -f deploy/behind-caddy/docker-compose.yml up -d --build
```

Full step-by-step, including DNS, the OCI firewall and Discord:
**[`deploy/runbook.md`](deploy/runbook.md)**.

### Standalone — app plus its own Caddy

For a VPS with nothing else on ports 80/443. Caddy fetches and renews the
certificate itself.

```bash
cp .env.example .env
$EDITOR .env                 # DOMAIN and APP_URL
docker compose -f deploy/standalone/docker-compose.yml up -d --build
```

### Coolify — not used here

Kept for reference in [`deploy/coolify.md`](deploy/coolify.md). Coolify's proxy
wants :80 and :443, which the existing Caddy already owns, so adopting it would
mean migrating the other three services first.

### OAuth redirect URIs

Register these with each provider, character for character:

| Provider | Where                                                       | Redirect URI                                           |
| -------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| Discord  | discord.com/developers → your app → OAuth2                  | `https://squat.mvhuysie.com/auth/discord/callback`     |
| Google   | console.cloud.google.com → Credentials → OAuth client (Web) | `https://squat.mvhuysie.com/auth/google/callback`      |

`APP_URL` **must** match the origin people actually visit, scheme included and
no trailing slash. Session cookies are only marked `Secure` when it starts with
`https://`, and the redirect URI is built from it — a mismatch is behind
essentially every broken sign-in.

### Backups

The database is one file, so a backup is a copy of it:

```bash
docker cp doodly-squat:/data/stash.db ./squat-$(date +%F).db
```

Cron that on the VPS and push the copy off the machine.

### Upgrading an existing database

Schema changes are numbered migrations tracked in `PRAGMA user_version` and run
automatically when the app opens the file. A database from before accounts
existed upgrades in place, keeping its stashes and words (they simply have no
owner). There is no separate migrate command to remember.

## Layout

| Path                    | What it does                                        |
| ----------------------- | --------------------------------------------------- |
| `lib/db.ts`             | Connection and the numbered migrations              |
| `lib/words.ts`          | Stash and word queries                              |
| `lib/auth.ts`           | Users, account linking, sessions, two-factor        |
| `lib/oauth.ts`          | Provider definitions and the PKCE flow              |
| `lib/totp.ts`           | RFC 6238 TOTP and recovery codes, on `node:crypto`  |
| `lib/stats.ts`          | Leaderboard aggregation and stats ingest            |
| `lib/shared.ts`         | Types, limits and the level curve                   |
| `app/room/[code]/`      | The word-list dashboard                             |
| `app/account/`          | Profile, progress, two-factor setup                 |
| `app/auth/[provider]/`  | OAuth start and callback                            |

Open stashes poll every 5 seconds, so a friend adding words shows up without a
refresh.
