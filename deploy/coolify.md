# Deploying with Coolify

> **Not the path this project uses.** The VPS already runs its own Caddy in
> front of other services, so Coolify's proxy would collide on :80/:443. See
> [`runbook.md`](runbook.md) for the real deployment. Kept in case that changes.
> Note the setup script has never been run against a live Coolify instance.

Coolify already runs a reverse proxy and issues Let's Encrypt certificates, so
this app ships to it as a plain Dockerfile application — no compose file, no
Caddy of our own. (`deploy/standalone/` is the alternative for a VPS without
Coolify; ignore it here.)

## Before you start

1. Push this repository somewhere Coolify can read (GitHub, or a Gitea on the
   same box).
2. Point a DNS **A record** for your subdomain at the VPS IP, and let it
   propagate. Coolify cannot issue a certificate until the name resolves.

## Create the application

**Project → New Resource → Application → Private/Public Repository.**

| Setting        | Value                                                      |
| -------------- | ---------------------------------------------------------- |
| Branch         | `main`                                                     |
| Build Pack     | **Dockerfile**                                             |
| Dockerfile     | `Dockerfile` (repository root)                             |
| Port           | `3000`                                                     |
| Domain         | `https://<your-subdomain>` — with the scheme               |
| Health check   | path `/api/health`, expected status `200`                  |

## Persistent storage — do this before the first real use

The database is a file. Without a volume it lives inside the container and is
**destroyed on every redeploy**.

**Storages → Add → Volume Mount**

| Field            | Value        |
| ---------------- | ------------ |
| Name             | `stash-data` |
| Destination Path | `/data`      |

The image already sets `STASH_DB_PATH=/data/stash.db` and creates `/data` owned
by the non-root user it runs as, so nothing else is needed.

## Environment variables

**Environment Variables →** add these (mark the secrets as such):

| Variable                 | Notes                                                       |
| ------------------------ | ----------------------------------------------------------- |
| `APP_URL`                | **Must exactly match the domain above**, e.g. `https://squat.mvhuysie.com` — no trailing slash |
| `APP_NAME`               | Issuer shown in authenticator apps                           |
| `DISCORD_CLIENT_ID`      | Optional; the provider appears once both halves are set      |
| `DISCORD_CLIENT_SECRET`  | Secret                                                       |
| `GOOGLE_CLIENT_ID`       | Optional                                                     |
| `GOOGLE_CLIENT_SECRET`   | Secret                                                       |
| `STATS_INGEST_TOKEN`     | `openssl rand -base64 32`; leave unset to keep the ingest endpoint disabled |

`DOMAIN` from `.env.example` is **not** used here — that one is only for the
standalone Caddy stack. Coolify handles routing.

`APP_URL` is the single most common cause of a broken sign-in: it builds the
OAuth redirect URI and decides whether session cookies are marked `Secure`. If
it disagrees with the address people actually visit, sign-in fails.

## OAuth redirect URIs

Register these with each provider, character for character:

- Discord — discord.com/developers → your app → OAuth2 → Redirects:
  `https://<your-subdomain>/auth/discord/callback`
- Google — console.cloud.google.com → Credentials → OAuth client (Web
  application) → Authorised redirect URIs:
  `https://<your-subdomain>/auth/google/callback`

## Deploy

Hit **Deploy**. Afterwards:

- The first account to sign in is flagged as the instance owner.
- Schema migrations run automatically when the app opens the database, so
  redeploys need no migrate step.

## Backups

Coolify can back up the volume, but the simplest safety net is a copy of the
one file:

```bash
docker cp <container>:/data/stash.db ./stash-$(date +%F).db
```

Run it from a cron job on the VPS and push the copy off the machine.
