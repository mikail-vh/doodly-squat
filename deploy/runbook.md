# Deployment runbook — Doodly Squat

Deploys `squat.mvhuysie.com` onto the existing VPS, alongside RustDesk,
uptime-kuma and beszel, behind the Caddy that is already there. **No Coolify** —
its proxy would seize :80/:443 and break the three services already using them.
`deploy/coolify.md` is kept for if that ever changes.

Facts this is written against:

| | |
| --- | --- |
| VPS public IP | `92.4.159.195` |
| VPS over Tailscale | `100.117.93.19` |
| SSH | `ssh ubuntu@100.117.93.19` — over the tailnet; port 22 closed publicly |
| Caddyfile | `/home/ubuntu/caddy/Caddyfile` (Caddy in Docker, `network_mode: host`) |
| App directory | `/home/ubuntu/doodly-squat` |
| DNS | Cloudflare, records kept **DNS-only / grey cloud** |

Three steps need a browser: the Cloudflare API token (only if you script the
DNS), the OCI security-list edit, and the Discord application. The rest is CLI.

**[local]** runs on your machine, **[vps]** over SSH.

---

## 1. DNS — point `squat` at the box  **[local]**

Cloudflare → `mvhuysie.com` → DNS → **Add record**: type `A`, name `squat`,
IPv4 `92.4.159.195`, **Proxy status: DNS only (grey cloud)**, TTL Auto.

Or by API. Create a token first (My Profile → API Tokens → Create Token → *Edit
zone DNS* template, scoped to `mvhuysie.com`), then:

```bash
export CF_TOKEN=...

ZONE=$(curl -s "https://api.cloudflare.com/client/v4/zones?name=mvhuysie.com" \
  -H "Authorization: Bearer $CF_TOKEN" \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).result[0].id")
echo "zone: $ZONE"

curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"A","name":"squat","content":"92.4.159.195","proxied":false,"ttl":1,"comment":"Doodly Squat"}' \
  | node -pe "const r=JSON.parse(require('fs').readFileSync(0,'utf8')); r.success ? 'created '+r.result.name : JSON.stringify(r.errors)"
```

**Leave it unproxied,** matching `status.` and `stats.`. An orange cloud puts
Cloudflare's IPs in front of Caddy, which breaks the `remote_ip` guard in step 3
and means Cloudflare has to reach your origin on 443.

Confirm before moving on:

```bash
nslookup squat.mvhuysie.com      # must return 92.4.159.195
```

---

## 2. Push the code  **[local]**

⚠️ Your active `gh` account is **mikail-comp**, but this belongs under
**mikail-vh** — name the owner explicitly so it does not land in the wrong one:

```bash
cd /c/Users/mikail.vanhuyssteen/source/repos/FUN_PROJECTS/skribbl-stash
git add -A
git commit -m "Doodly Squat: word list, accounts, leaderboard, deployment"
gh repo create mikail-vh/doodly-squat --public --source=. --remote=origin --push
```

Nothing secret is committed — verify:

```bash
git ls-files | grep -E '\.env|\.db'   # only *.env.example should appear
```

---

## 3. Caddy — add the site, and lock the dashboards down  **[vps]**

**Do this before step 4.** Opening 443 publicly while `status.` and `stats.`
are still unguarded would expose both dashboards to the internet in the gap.

```bash
ssh ubuntu@100.117.93.19
nano /home/ubuntu/caddy/Caddyfile
```

Make it:

```caddyfile
# Admin dashboards: reachable only from the tailnet. Certificates still issue,
# because ACME uses port 80, which stays public.
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

```bash
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload  --config /etc/caddy/Caddyfile
```

Validate first; reload rather than restart so the other sites stay up.

`100.64.0.0/10` is Tailscale's range. Afterwards `status.` and `stats.` answer
only over the tailnet and 403 everyone else — stricter than the `/32` rules you
had, and it stops breaking when your IP moves.

---

## 4. OCI security list  **[browser]**

Networking → Virtual Cloud Networks → `vcn-mikail-sa` → Security → **Default
Security List for vcn-mikail-sa** → Ingress Rules.

**Add** — the app has to be publicly reachable:

| Stateless | Source | Protocol | Dest Port | Description |
| --- | --- | --- | --- | --- |
| No | `0.0.0.0/0` | TCP | `443` | HTTPS - public |

**Delete**, now that Tailscale is proven and step 3 guards the dashboards:

- `SSH - Home` (`41.193.88.252/32` → 22)
- `SSH - Work` (`102.135.146.62/32` → 22)
- `SSH - Current` (→ 22)
- `HTTPS - Caddy reverse proxy (Home)` (`41.193.88.252/32` → 443)
- `HTTPS - Caddy reverse proxy (Work)` (`102.135.146.62/32` → 443)

**Keep** the port 80 rule (`0.0.0.0/0`) — Let's Encrypt's HTTP-01 challenge
needs it, and Caddy redirects 80 → 443 anyway.

Break-glass if SSH ever fails after this: OCI Console → instance → **Console
Connection**, which works with every port closed.

---

## 5. Discord application  **[browser]**

https://discord.com/developers/applications → **New Application**, name it
`Doodly Squat`.

- **OAuth2 → Redirects → Add Redirect:**
  `https://squat.mvhuysie.com/auth/discord/callback`
- Copy the **Client ID** and **Client Secret** from that page.

No scopes to pick in the portal — the app requests `identify email` itself.

Google is optional and can be added any time: Cloud Console → APIs & Services →
Credentials → OAuth client ID → Web application, redirect URI
`https://squat.mvhuysie.com/auth/google/callback`. Its button does not render
until both halves are set, so leaving it blank is harmless.

---

## 6. Bring the app up  **[vps]**

```bash
ssh ubuntu@100.117.93.19
cd /home/ubuntu
git clone https://github.com/mikail-vh/doodly-squat.git
cd doodly-squat

cp deploy/behind-caddy/.env.example deploy/behind-caddy/.env
openssl rand -base64 32                      # paste as STATS_INGEST_TOKEN
nano deploy/behind-caddy/.env                # + the Discord client id/secret

docker compose -f deploy/behind-caddy/docker-compose.yml up -d --build
```

The first build takes a few minutes — Next is built inside the container. Then:

```bash
curl -s localhost:3000/api/health            # {"ok":true}
docker logs -f doodly-squat
```

`APP_URL` must be exactly `https://squat.mvhuysie.com`. It builds the OAuth
redirect URI and decides whether session cookies are marked `Secure`, so a
mismatch breaks sign-in and nothing else — which makes it confusing to debug.

---

## 7. Verify  **[local]**

```bash
curl -s  https://squat.mvhuysie.com/api/health        # {"ok":true}
curl -sI https://squat.mvhuysie.com/ | head -1        # 200
curl -s  https://squat.mvhuysie.com/signin | grep -o "Continue with [A-Za-z]*"

# dashboards should now 403 from the public internet, but work over the tailnet
curl -s -o /dev/null -w "%{http_code}\n" https://status.mvhuysie.com/
```

Then in a browser: create a stash, add words, copy the export, sign in with
Discord, and check `/account` shows you as the instance owner (first account in
wins).

**Prove persistence deliberately.** Add a word, then:

```bash
ssh ubuntu@100.117.93.19 'cd doodly-squat && \
  docker compose -f deploy/behind-caddy/docker-compose.yml up -d --force-recreate'
```

The word must still be there. If it vanished, the `stash-data` volume is not
attached and the database is living inside the container.

---

## Afterwards

```bash
# deploy an update
ssh ubuntu@100.117.93.19 'cd doodly-squat && git pull && \
  docker compose -f deploy/behind-caddy/docker-compose.yml up -d --build'

# back up — the whole database is one file
ssh ubuntu@100.117.93.19 'docker cp doodly-squat:/data/stash.db -' > "squat-$(date +%F).tar"
```

Migrations run automatically when the app opens the database, so updates never
need a migrate step. Cron the backup and push the copy off the box.

### Optional hardening

`uptime-kuma` and `beszel` publish on `0.0.0.0:3001` and `0.0.0.0:8090`. They
are unreachable from outside today only because the OCI firewall drops those
ports — one rule away from exposure. Binding them to `127.0.0.1` in their own
compose files would make that defence in depth rather than a single point of
failure.
