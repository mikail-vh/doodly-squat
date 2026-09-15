# Deployment runbook — Doodly Squat

Puts `squat.mvhuysie.com` on the existing VPS, alongside RustDesk, uptime-kuma
and beszel, behind the Caddy already running there. **No Coolify** — its proxy
would seize :80/:443 and break those three. (`deploy/coolify.md` is kept only
for if that ever changes.)

## The facts this assumes

| | |
| --- | --- |
| Local project | `C:\Users\mikail.vanhuyssteen\source\repos\FUN_PROJECTS\skribbl-stash` |
| VPS public IP | `92.4.159.195` |
| VPS tailnet IP | `100.117.93.19` |
| SSH | `ssh ubuntu@100.117.93.19` (over Tailscale) |
| Caddyfile | `/home/ubuntu/caddy/Caddyfile` (Caddy in Docker, `network_mode: host`) |
| App directory on VPS | `/home/ubuntu/doodly-squat` |
| DNS | Cloudflare, records **DNS-only / grey cloud** |
| GitHub | `mikail-vh/doodly-squat` |

`[LOCAL]` = your Windows machine. `[VPS]` = inside an SSH session.
`[BROWSER]` = a web UI, because no API exists for it.

**Order matters.** DNS before Caddy (certificates need it). App before Caddy
(otherwise the site 502s). Caddy before opening 443 (otherwise your dashboards
are briefly public).

---

## Step 0 — Sanity checks  `[LOCAL]`

```bash
cd /c/Users/mikail.vanhuyssteen/source/repos/FUN_PROJECTS/skribbl-stash

tailscale status                       # both machines listed?
ssh ubuntu@100.117.93.19 'echo ok'     # prints: ok
git log --oneline | head -1            # your commit is there
```

If `ssh` hangs, you are not on the tailnet — open the Tailscale tray icon and
make sure it says Connected.

---

## Step 1 — DNS record  `[BROWSER]`

Cloudflare → `mvhuysie.com` → **DNS → Records → Add record**

| Field | Value |
| --- | --- |
| Type | `A` |
| Name | `squat` |
| IPv4 address | `92.4.159.195` |
| Proxy status | **DNS only** (grey cloud, NOT orange) |
| TTL | Auto |

Save. **Grey cloud matters**: an orange cloud puts Cloudflare's IPs in front of
Caddy, which breaks the tailnet guard in step 5 and forces Cloudflare to reach
your origin on 443.

Verify `[LOCAL]` — do not continue until this returns the right IP:

```bash
nslookup squat.mvhuysie.com
# Address: 92.4.159.195
```

---

## Step 2 — Discord application  `[BROWSER]`

1. https://discord.com/developers/applications → **New Application**
2. Name it `Doodly Squat` → accept terms → **Create**
3. Left sidebar → **OAuth2**
4. Under **Redirects** → **Add Redirect**, paste exactly:
   ```
   https://squat.mvhuysie.com/auth/discord/callback
   ```
5. **Save Changes** (green bar at the bottom — easy to miss)
6. Still on OAuth2, copy **Client ID**
7. Copy **Client Secret**. If it is hidden, click **Reset Secret** — it is only
   ever shown once, so paste it somewhere immediately.

Do not tick any scopes in the portal; the app requests `identify email` itself.

Keep both values to hand for step 4.

---

## Step 3 — Push to GitHub  `[LOCAL]`

Your branch is `master`; everything here assumes `main`. Rename it, then push.
Note the explicit owner — your active `gh` account is `mikail-comp`, and this
belongs to `mikail-vh`.

```bash
cd /c/Users/mikail.vanhuyssteen/source/repos/FUN_PROJECTS/skribbl-stash

git branch -M main
git add -A
git commit -m "Deployment runbook"

gh repo create mikail-vh/doodly-squat --public --source=. --remote=origin --push
```

Confirm nothing secret went up:

```bash
git ls-files | grep -E '\.env|\.db'
# only *.env.example lines should appear
```

The repo must be **public**, or `git clone` on the VPS in the next step will
ask for credentials.

---

## Step 4 — Bring the app up  `[VPS]`

```bash
ssh ubuntu@100.117.93.19

cd /home/ubuntu
git clone https://github.com/mikail-vh/doodly-squat.git
cd doodly-squat

cp deploy/behind-caddy/.env.example deploy/behind-caddy/.env
openssl rand -base64 32          # copy this for STATS_INGEST_TOKEN
nano deploy/behind-caddy/.env
```

In nano, set these four:

```
APP_URL=https://squat.mvhuysie.com
DISCORD_CLIENT_ID=<from step 2>
DISCORD_CLIENT_SECRET=<from step 2>
STATS_INGEST_TOKEN=<the openssl output>
```

Save and exit nano: **Ctrl+O**, **Enter**, **Ctrl+X**.

`APP_URL` must be exactly that — scheme included, no trailing slash. It builds
the OAuth redirect URI and decides whether session cookies are marked `Secure`.
Getting it wrong breaks sign-in and nothing else, which makes it maddening to
debug.

Then build and start:

```bash
docker compose -f deploy/behind-caddy/docker-compose.yml up -d --build
```

First build takes a few minutes (Next is compiled inside the container). Check:

```bash
docker ps | grep doodly-squat            # should say "healthy" after ~30s
curl -s localhost:3000/api/health        # {"ok":true}
```

If it is not running, read the log: `docker logs doodly-squat`

---

## Step 5 — Caddy  `[VPS]`

Back up first, because this file is serving three live sites:

```bash
cp /home/ubuntu/caddy/Caddyfile /home/ubuntu/caddy/Caddyfile.bak
nano /home/ubuntu/caddy/Caddyfile
```

Make the whole file read:

```caddyfile
# Admin dashboards: tailnet only. Certificates still issue, because ACME uses
# port 80, which stays public.
(tailnet-only) {
	@blocked not remote_ip 100.64.0.0/10
	respond @blocked 403
}

status.mvhuysie.com {
	import tailnet-only
	reverse_proxy localhost:3001
}

stats.mvhuysie.com {
	import tailnet-only
	reverse_proxy localhost:8090
}

squat.mvhuysie.com {
	reverse_proxy localhost:3000
}
```

Save: **Ctrl+O**, **Enter**, **Ctrl+X**. Then:

```bash
docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec caddy caddy reload   --config /etc/caddy/Caddyfile --adapter caddyfile
```

Validate before reloading. Reload, not restart, so the other sites never drop.

If validate fails, fix the file — or restore and try again:
```bash
cp /home/ubuntu/caddy/Caddyfile.bak /home/ubuntu/caddy/Caddyfile
```

Caddy now requests a certificate for `squat.mvhuysie.com` over port 80. Give it
~20 seconds, then confirm from the VPS:

```bash
curl -sI -H "Host: squat.mvhuysie.com" http://localhost/ | head -1
# HTTP/1.1 308 Permanent Redirect   (the redirect to HTTPS — correct)
docker logs caddy --tail 20 | grep -i "certificate obtained" 
```

`100.64.0.0/10` is Tailscale's range, so `status.` and `stats.` now answer only
over the tailnet and return 403 to everyone else.

---

## Step 6 — OCI firewall  `[BROWSER]`

Oracle Cloud → ☰ → **Networking → Virtual Cloud Networks** → `vcn-mikail-sa` →
**Security** tab → **Default Security List for vcn-mikail-sa** → **Ingress Rules**

### 6a. Add — makes the app publicly reachable

**Add Ingress Rules**:

| Field | Value |
| --- | --- |
| Stateless | unchecked |
| Source Type | CIDR |
| Source CIDR | `0.0.0.0/0` |
| IP Protocol | TCP |
| Source Port Range | **leave empty** |
| Destination Port Range | `443` |
| Description | `HTTPS - public` |

Leaving Source Port Range empty matters — filling in `443` there creates a rule
that matches nothing.

### 6b. Delete — now redundant

Tick each, then **Actions → Remove**:

- `SSH - Home` — `41.193.88.252/32` → 22
- `SSH - Work` — `102.135.146.62/32` → 22
- `SSH - Current` — → 22
- `HTTPS - Caddy reverse proxy (Home)` — `41.193.88.252/32` → 443
- `HTTPS - Caddy reverse proxy (Work)` — `102.135.146.62/32` → 443

SSH now happens only over Tailscale; the dashboards are guarded by Caddy.

### 6c. Do NOT touch

- The `0.0.0.0/0` → **80** rule — Let's Encrypt renewals need it forever
- The RustDesk rules (21115–21119)
- The two ICMP rules

**Break-glass** if SSH ever stops working: OCI Console → your instance →
**Console Connection**. It works with every port closed.

---

## Step 7 — Verify  `[LOCAL]`

```bash
curl -s  https://squat.mvhuysie.com/api/health        # {"ok":true}
curl -sI https://squat.mvhuysie.com/ | head -1        # HTTP/2 200
curl -s  https://squat.mvhuysie.com/signin | grep -o "Continue with [A-Za-z]*"
# Continue with Discord

# dashboards must 403 publicly, but still work in your browser over the tailnet
curl -s -o /dev/null -w "%{http_code}\n" https://status.mvhuysie.com/    # 403
```

Then in a browser at `https://squat.mvhuysie.com`:

1. **Create a stash** → add a few words → check the export box fills in
2. **Copy list** → paste somewhere → confirm `word,word,word`, no trailing comma
3. **Sign in** → Continue with Discord → you land back on `/account`
4. `/account` says **owner of this instance** (first account to sign in wins)
5. Optionally turn on two-factor and **save the recovery codes**

### Prove the database survives a redeploy

The single most important check, because getting it wrong loses everything:

```bash
# add a word in the browser first, then:
ssh ubuntu@100.117.93.19 'cd doodly-squat && \
  docker compose -f deploy/behind-caddy/docker-compose.yml up -d --force-recreate'
```

Reload the page. **The word must still be there.** If it vanished, the
`stash-data` volume is not attached and the database is living inside the
container.

---

## Step 8 — Afterwards

```bash
# deploy an update
ssh ubuntu@100.117.93.19 'cd doodly-squat && git pull && \
  docker compose -f deploy/behind-caddy/docker-compose.yml up -d --build'

# logs
ssh ubuntu@100.117.93.19 'docker logs -f doodly-squat'

# back up — the whole database is one file
ssh ubuntu@100.117.93.19 'docker cp doodly-squat:/data/stash.db -' > "squat-$(date +%F).tar"
```

Migrations run automatically when the app opens the database, so an update
never needs a migrate step. Cron the backup and push the copy off the box.

### Optional, later

- **Google sign-in**: Cloud Console → APIs & Services → Credentials → OAuth
  client ID → Web application, redirect URI
  `https://squat.mvhuysie.com/auth/google/callback`. Add `GOOGLE_CLIENT_ID` and
  `GOOGLE_CLIENT_SECRET` to `.env`, then `up -d`. The button appears only once
  both halves are set.
- **Harden the dashboards further**: `uptime-kuma` and `beszel` publish on
  `0.0.0.0:3001` / `0.0.0.0:8090`. They are unreachable today only because the
  OCI firewall drops those ports. Binding them to `127.0.0.1` in their own
  compose files would make that defence in depth rather than one rule deep.
- **Rename the local folder** from `skribbl-stash` to `doodly-squat` — cosmetic,
  the git remote is already correct.
