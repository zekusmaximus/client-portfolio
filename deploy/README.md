# Runbook: gbacpod.com

How the Client Portfolio Dashboard is hosted, rebuilt, deployed, checked,
rolled back and looked after. Tier 0 WP5 (`docs/plans/tier-0.md` section 8,
decision D13).

Conventions:

- Everything you run is PowerShell 7 on your machine unless a step says it runs
  in the Render Shell (bash). In Windows PowerShell 5.1, drop `-MaskInput` from
  `Read-Host`.
- `<angle brackets>` are placeholders. Never paste a real secret or connection
  string into this repository: it is public.
- Netlify and Render facts are cited by URL to their documentation. The session
  that wrote this could not open netlify.com or render.com (network policy) and
  read those pages through search-engine excerpts on 2026-09-25. Where the docs
  and your dashboard disagree, the dashboard wins. Steps the docs did not settle
  read **confirm in the dashboard**.

Contents: [1 Hosting](#1-how-it-is-hosted) ·
[2 Environment](#2-environment-variables) ·
[3 Rebuild](#3-setting-it-up-from-scratch) ·
[4 Deploy](#4-deploying-and-checking-a-deploy) ·
[5 Roll back](#5-rolling-back) ·
[6 Backups](#6-backups-and-restore) ·
[7 Partners](#7-partners-and-passwords) ·
[8 Rotation](#8-rotating-secrets) ·
[9 Logs](#9-reading-the-logs) ·
[10 Health](#10-what-apihealth-means) ·
[11 Uptime](#11-the-uptime-monitor) ·
[12 Advisories](#12-dependency-advisories-that-remain) ·
[13 Triage](#13-when-something-is-wrong)

---

## 1. How it is hosted

| Part | Where | Built from | Address |
|---|---|---|---|
| The page (React, Vite) | Netlify project `client-portfolio2` | `main` of this repository, settings in `netlify.toml` | <https://gbacpod.com> |
| The API (Express, `server.cjs`) | Render web service `client-portfolio-backend` | `main` of this repository | <https://client-portfolio-backend.onrender.com> |
| The database | Render PostgreSQL, Basic-256mb, PostgreSQL 18 | `init-db.sql`, applied by the API at every start (idempotent) | internal to Render |
| Nightly backups | GitHub Actions in the private repository `zekusmaximus/client-portfolio-backups` | copies of `deploy/backup/pg-backup.sh` and `deploy/backup/backup.yml` | workflow artifacts, 90 days |

How they talk: the browser loads the page from gbacpod.com. The page's script
calls the API on onrender.com, a different site, with the `authToken` cookie
(`HttpOnly; Secure; SameSite=None` in production). The API allows exactly one
browser origin (`FRONTEND_URL`) and refuses state-changing requests from any
other (`origin_refused`). The API reaches Postgres through `DATABASE_URL` with
TLS (`DATABASE_SSL=no-verify`). The backup job reaches Postgres from GitHub's
runners through the External Database URL.

Deploying is merging to `main` (section 4). There is no server of your own, no
nginx, no systemd and no deploy script.

### 1.1 Netlify project `client-portfolio2`

Read through the Netlify connector on 2026-09-25 unless marked otherwise.

| Setting | Value |
|---|---|
| Production branch | `main` (the live deploy is a `main` production deploy) |
| Primary URL | https://gbacpod.com |
| Framework detected | Vite |
| Base directory | repository root (`netlify.toml` sets none; Netlify's default is the root) |
| Build command | `npm run build:prod` (`netlify.toml`) |
| Publish directory | `dist` (`netlify.toml`) |
| Node version | `22` (`NODE_VERSION` in `netlify.toml`) |
| Build variables | `VITE_API_BASE_URL` = `https://client-portfolio-backend.onrender.com`; any others: confirm in the dashboard |
| Headers and redirects | from `netlify.toml` only. The deploy of `0507a49`, before this file existed, processed no header rules and no redirect rules, so none are configured elsewhere |
| Password protection, forms | off, not enabled |
| `www.gbacpod.com`, where the DNS is hosted, certificate status | confirm in the dashboard (Domain management) |

`netlify.toml` overrides the same settings in the UI
(<https://docs.netlify.com/build/configure-builds/file-based-configuration/>),
and `NODE_VERSION` overrides the UI's Node setting
(<https://docs.netlify.com/build/configure-builds/manage-dependencies/>). If
the UI also has a `NODE_VERSION` variable, delete it so there is one source;
the build log names the Node version it used.

### 1.2 Render web service `client-portfolio-backend`

| Setting | Value |
|---|---|
| Instance type (Free or paid) | confirm in the dashboard; it decides sections 7, 11 and the Shell |
| Region | confirm in the dashboard; the database should be in the same one |
| Node version | confirm in the dashboard and in a deploy log. Without `NODE_VERSION`, `.node-version` or `engines`, a service keeps the default it was created with (<https://render.com/docs/node-version>); CI tests Node 22 |
| Root directory | confirm in the dashboard (the repository root is what the code needs) |
| Build command | confirm in the dashboard (`npm ci` is what the code needs) |
| Start command | confirm in the dashboard (`node server.cjs` or `npm start`) |
| Pre-deploy command | confirm in the dashboard (none is needed; pre-deploy commands exist on paid instances only: <https://render.com/docs/deploys>) |
| Auto-deploy and branch | confirm in the dashboard (Settings: On Commit, After CI Checks Pass, or Off: <https://render.com/docs/deploys>) |
| Health check path | confirm in the dashboard (`/api/health` if you set one; section 10) |
| Environment variable names | section 2; confirmed set on 2026-09-24: `FRONTEND_URL`, `TRUST_PROXY_HOPS`, `SESSION_TTL`, `DATABASE_SSL`. `NODE_ENV=production` and an Anthropic key are implied by `/api/health` that day |
| Port | `server.cjs` listens on `PORT` at `0.0.0.0`; Render's default `PORT` is 10000 (<https://render.com/docs/web-services>). Do not set `PORT` yourself |

Once you have looked these up, write the values into this table in a small PR.

### 1.3 Render PostgreSQL

Basic-256mb, PostgreSQL 18, created about a year before 2026-09-24; the
dashboard showed no point-in-time recovery, so the nightly backup is the only
backup (tier-0 section 2, WP4). Region: confirm in the dashboard.

---

## 2. Environment variables

`.env.example` is the template and explains each one. Production values live in
the dashboards and, for the secrets, in the password manager.

**Render web service, Environment page:**

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the database's connection URL (Internal Database URL when service and database share a region). Secret |
| `DATABASE_SSL` | `no-verify` |
| `JWT_SECRET` | 48 random bytes, base64 (section 8.1). Secret |
| `SESSION_TTL` | `7d` |
| `FRONTEND_URL` | `https://gbacpod.com` |
| `TRUST_PROXY_HOPS` | `1` (Render's proxy) |
| `ANTHROPIC_API_KEY` | secret (section 8.2) |
| `AI_MODEL` | optional; unset means `claude-opus-5` |
| `BCRYPT_SALT_ROUNDS` | optional; unset means 12 |

Changing a variable offers three saves: **Save, rebuild, and deploy**, **Save
and deploy** (the existing build with the new values) and **Save only** (used
at the next deploy) (<https://render.com/docs/configure-environment-variables>).
For a value change, **Save and deploy** is enough.

**Netlify, Project configuration > Environment variables:** one build variable,
`VITE_API_BASE_URL` = `https://client-portfolio-backend.onrender.com`. It must
apply to the Production and the Deploy Previews contexts: `vite.config.js` stops
a production build without an `https://` value, so a preview built without it
fails. Netlify lets a variable have one value for all contexts or one per
context (<https://docs.netlify.com/build/environment-variables/overview/>).
Leave it in the UI; `netlify.toml` deliberately does not set it.

**If the API's address ever changes** (a new Render service has a new
onrender.com name), change it in three places in one go: `VITE_API_BASE_URL` in
Netlify, `connect-src` in `netlify.toml`, and the uptime monitor's URL. If the
page's address changes, change `FRONTEND_URL` on Render.

---

## 3. Setting it up from scratch

For rebuilding after losing a service, or moving accounts. Order: database,
API, page, domain, monitor, backups. Keep section 1's tables open and match
them.

### 3.1 Database

1. Render Dashboard > New > PostgreSQL. PostgreSQL 18 (it must equal `PG_MAJOR`
   in the backup repository), a paid instance type, the region the web service
   will use.
2. If you are restoring data, do it now, before any web service points at the
   database: `deploy/backup/RESTORE.md` (e2), steps 1 to 4. The API runs
   `init-db.sql` at start, which would create empty tables for the restore to
   collide with.

### 3.2 API

1. Render Dashboard > New > Web Service, connect `zekusmaximus/client-portfolio`,
   branch `main`, runtime Node, the database's region.
2. Root directory: blank (the repository root). Build command: `npm ci`. Start
   command: `node server.cjs`.
3. Instance type: a paid type. A Free instance spins down, has no Shell, and
   shares 750 free hours a month with every Free service in the workspace
   (section 11.3).
4. Environment: every row of section 2's Render table. Generate a new
   `JWT_SECRET` (section 8.1); the old one is not needed, partners sign in again.
5. Auto-deploy: **After CI Checks Pass** is the safer choice here, because
   `.github/workflows/ci.yml` runs on every push to `main`; Render then deploys
   only a commit whose checks passed, and never deploys when it sees no checks
   (<https://render.com/docs/deploys>). **On Commit** is the alternative.
6. Health check path: `/api/health` (section 10 explains what it proves).
7. Create the service. When the deploy is live, check section 4.3. If the
   database is new and empty, add the partners (section 7).

### 3.3 Page

1. Netlify > Add new project > import `zekusmaximus/client-portfolio` from
   GitHub, production branch `main`. `netlify.toml` supplies the build command,
   publish directory, Node version and headers.
2. Add `VITE_API_BASE_URL` (section 2) before the first build.
3. Deploy, then open the `*.netlify.app` address and check section 4.4 there.
   If the address differs from gbacpod.com, logging in fails until the domain
   is attached, because the API allows only `FRONTEND_URL`.

### 3.4 Domain

In the Netlify project, Domain management: add `gbacpod.com`, point its DNS as
Netlify instructs, and wait for the certificate. Netlify provisions a Let's
Encrypt certificate itself and retries for up to three days; one not issued
within 24 hours usually means a DNS mistake. The status is under Domain
management > HTTPS
(<https://docs.netlify.com/manage/domains/secure-domains-with-https/https-ssl/>).

`netlify.toml` sends `Strict-Transport-Security` with `includeSubDomains`: once
a browser has seen it, every subdomain of gbacpod.com must serve HTTPS for a
year. Do not create an HTTP-only subdomain.

### 3.5 Monitor and backups

Section 11 for the uptime monitor. `deploy/backup/INSTALL.md` for the backups:
a rebuilt database means a new `BACKUP_DATABASE_URL` in the private repository
(RESTORE.md (e2) step 8).

---

## 4. Deploying and checking a deploy

### 4.1 What happens when a pull request merges

Deploying is merging to `main`.

- **Netlify** builds `main` and publishes it to gbacpod.com.
- **Render** deploys `main` if its auto-deploy is on (section 1.2). If it is
  Off, deploy by hand: the service page > Manual Deploy > the latest commit
  (confirm the label in the dashboard).
- Pull requests get a Netlify Deploy Preview. Render does not preview; the API
  changes only on `main`.
- **A Deploy Preview cannot sign in.** It is served from its own origin
  (`https://deploy-preview-<n>--client-portfolio2.netlify.app`), and the
  production API allows exactly one browser origin, `FRONTEND_URL`
  (gbacpod.com): the preflight gets no CORS header and the sign-in POST gets
  403 with an `origin_refused` log line. On a preview, check the build, the
  headers and the sign-in page. Check signing in and the tabs on gbacpod.com
  after the merge, with section 5.1 ready. To test a preview signed in, you
  would have to set `FRONTEND_URL` to the preview's origin (Save and deploy),
  which locks gbacpod.com out until you set it back. Do that only in a quiet
  window.

The page and the API deploy independently and are not atomic: for a few
minutes one can be new and the other old. If a change alters an API response
the page reads, check both have finished before testing.

### 4.2 Watch the builds

- **Netlify:** Deploys > the newest production deploy. Its page has the deploy
  log and a summary. The summary should report header rules processed from
  `netlify.toml`; "No header rules processed" means the file was not read.
- **Render:** the service's Events show the deploy starting and going live;
  Logs show the start-up lines (section 9.2). A deploy that fails its health
  checks for 15 minutes is cancelled and the old instance keeps serving
  (<https://render.com/docs/health-checks>).

### 4.3 The API

```powershell
Invoke-RestMethod https://client-portfolio-backend.onrender.com/api/health | ConvertTo-Json
```

Expect `status: OK`, `database: connected`, `anthropic: configured`, and a small
`uptimeSeconds` (the process restarted with the deploy). Section 10 explains
each field.

### 4.4 The page

Headers:

```powershell
$h = (Invoke-WebRequest -Uri https://gbacpod.com/ -Method Head).Headers
'Strict-Transport-Security','Content-Security-Policy','X-Frame-Options','X-Content-Type-Options','Referrer-Policy' |
  ForEach-Object { '{0}: {1}' -f $_, ($h[$_] -join ', ') }
```

All five must print the values in `netlify.toml`. (`curl.exe -sI https://gbacpod.com/`
shows the same.)

Browser: open <https://gbacpod.com> in a fresh window, press F12, Console tab,
sign in, and click every tab: Data Upload, Dashboard, Client Details,
Partnership, AI Advisor, Scenarios. There must be no line beginning "Refused
to" that names the Content Security Policy. A 401 for `/api/auth/me` before
signing in is normal.

On a Deploy Preview, only the sign-in page can be checked (4.1). Its console
shows a CORS error when you try to sign in, which is expected and is not a CSP
error. Netlify also injects its feedback Drawer there, which loads a script
from app.netlify.com. The page's CSP blocks it, so the preview can show a CSP
error naming app.netlify.com and no Drawer
(<https://docs.netlify.com/deploy/review-deploys/netlify-drawer-for-feedback/troubleshoot-the-netlify-drawer/>).
That is expected and does not happen on gbacpod.com. Do not relax the CSP for
it: headers in `netlify.toml` apply to every context
(<https://docs.netlify.com/manage/routing/headers/>). Turn the Drawer off for
the project instead (its Deploy Preview settings; confirm in the dashboard) if
you want a clean preview console.

### 4.5 The work package

Run the merged work package's acceptance list in `docs/plans/tier-0.md` and
update its row in section 2.

---

## 5. Rolling back

Decide which half is broken. The page and the API roll back separately, and
neither touches the database: data problems are section 6.

### 5.1 The page (Netlify)

Deploys > the last good deploy > **Publish deploy**. It publishes that earlier
build at once; nothing is rebuilt. While auto publishing is on, the next
production deploy from `main` replaces it, so **Lock** the deploys list (stop
auto publishing) until the fix is merged, then unlock it
(<https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/>).

### 5.2 The API (Render)

The service's deploy history > the last good deploy > **Rollback** (confirm the
label in the dashboard). Render reuses that deploy's build, so it is faster
than a rebuild, but only deploys whose build artifacts Render still keeps are
offered; how many it keeps depends on the workspace plan. A rollback from the
dashboard **turns auto-deploy off** so the next push cannot bring the bad code
back; turn it on again in Settings after the fix is merged. The rollback does
not overwrite the service's current configuration: it uses the target deploy's
settings for that deploy only, and the next normal deploy uses the current
ones (<https://render.com/docs/rollbacks>). Confirm on the rollback screen
which settings it reuses.

### 5.3 Then fix forward

Revert the pull request on GitHub (its Revert button) and merge the revert, or
merge a fix. Then unlock Netlify and turn Render's auto-deploy back on, and
check section 4.

### 5.4 Rehearse once

Rehearse both rollbacks once on a quiet day after WP5 merges, while the
previous deploy is known to be compatible (WP5 does not change the API's
behaviour):

1. Netlify: publish the previous production deploy, check that gbacpod.com
   still signs in, then publish the newest one again. Leave the list unlocked.
2. Render: roll back to the previous deploy, run section 4.3, then deploy the
   latest commit again and turn auto-deploy back on.

| Date | Netlify rollback and return | Render rollback and return | Auto-deploy back on | By | Notes |
|---|---|---|---|---|---|
| | | | | | |

---

## 6. Backups and restore

Covered in full elsewhere; nothing here repeats it.

- Installing and running the nightly backup, rotating its key:
  [`backup/INSTALL.md`](backup/INSTALL.md).
- Downloading, decrypting, a scratch restore, restoring production, and the
  quarterly drill table: [`backup/RESTORE.md`](backup/RESTORE.md).

In brief: every night at 07:17 UTC the private repository
`zekusmaximus/client-portfolio-backups` dumps the database, proves the dump
restores with matching row counts, encrypts it with `age` and keeps it 90 days.
A failed run emails you. The drill runs in the first week of each quarter.
After changing `pg-backup.sh` or `backup.yml` here, copy them into the private
repository (INSTALL.md step 5).

---

## 7. Partners and passwords

Rules (`utils/passwordPolicy.cjs`): usernames 3 to 50 characters of letters,
digits, `_` and `-`; passwords at least 8 characters with an upper-case letter,
a lower-case letter, a digit and a special character. Avoid `"` in passwords
typed on a command line.

An account is a sign-in, not a place in the book. Who can lead or
second-chair a client (the six partners, the emeritus, the associates) is the
app's People list, changed from the header's **People** button; adding an
account adds nobody to it, and associates get no account
(`docs/plans/people-and-second-chair.md`, P1 and P2).

A partner changes their own password from the header's **Change password**
button. The scripts below are for adding a partner, for a forgotten password
and for removing an account (7.3). Neither a reset nor a deletion ends sessions
already issued; section 8.1 does.

### 7.1 From the Render Shell (paid instances only)

The web service's **Shell** tab runs in the service with its environment
already set. Only paid instance types have it (<https://render.com/docs/ssh>).
It is bash. Check `ls server.cjs` finds the file first.

```bash
read -r -p 'Username: ' U; read -r -s -p 'Password: ' P; echo
node create-admin.cjs "$U" "$P"             # add a partner; refuses an existing username
node scripts/reset-password.cjs "$U" "$P"   # or: reset; prints "Updated 1 user" or "No such user"
unset P
```

### 7.2 From your machine (any instance type)

Needs a clone of this repository, `npm ci` run in it, and the database's
**External** Database URL. Render may restrict which addresses can use it
(confirm in the database's access settings that yours is allowed).

```powershell
Set-Location <path to your clone of client-portfolio>
git pull; npm ci
$env:DATABASE_URL = Read-Host 'External Database URL' -MaskInput
$env:DATABASE_SSL = 'no-verify'
$user = Read-Host 'Username'
$pw   = Read-Host 'Password' -MaskInput
node create-admin.cjs $user $pw               # add a partner
node scripts/reset-password.cjs $user $pw     # or: reset a password
Remove-Item Env:DATABASE_URL, Env:DATABASE_SSL; Remove-Variable pw
```

Calling `node` directly, rather than `npm run create:admin`, keeps `cmd.exe`
from reinterpreting special characters in the password.

### 7.3 Removing a partner's account

Deleting a user leaves the book alone. `clients.user_id`, the account that
created a client as recorded before the book became shared in July 2025,
references `users` with `ON DELETE SET NULL` (`init-db.sql`): the clients that
account created stay, with every field and revenue row, and their `user_id`
becomes empty. No current code reads or writes it. Until the API first started with
that `init-db.sql`, the key was `ON DELETE CASCADE` and deleting a user deleted
those clients and their revenue rows, so check the live database before any
delete. Both scripts run where those in 7.1 and 7.2 do; from your machine:

```powershell
Set-Location <path to your clone of client-portfolio>
git pull; npm ci
$env:DATABASE_URL = Read-Host 'External Database URL' -MaskInput
$env:DATABASE_SSL = 'no-verify'
node scripts/check-schema.cjs          # must end with "OK: ..."
$user = Read-Host 'Username to delete'
node scripts/delete-user.cjs $user     # only after OK
Remove-Item Env:DATABASE_URL, Env:DATABASE_SSL
```

In the Render Shell (bash): `node scripts/check-schema.cjs`, then
`read -r -p 'Username: ' U; node scripts/delete-user.cjs "$U"`.

`check-schema` is read-only. It prints each foreign key to `users` with its
`ON DELETE` action, then the number of clients each account created, then
`OK: no foreign key to users cascades; deleting a user keeps every client.` If
it prints `FAIL` instead, do not delete anyone: the API has not started with
the current `init-db.sql` (section 4, and the start-up lines in 9.2), or the
database was restored from a backup taken before the change, which carries the
cascade again until the API next starts (Manual Deploy, then check again).

`delete-user` runs the same check in its transaction and refuses while any key
cascades. It matches the username exactly, refuses the last account, and
commits only if the numbers of clients and revenue rows are unchanged. It
prints `Deleted user <name>. Clients: <n>, of which <k> had been created by
this account and now have no user_id. Revenue rows: <r>. Accounts left: <a>.`
and exits 0, or says why not, changes nothing and exits 1.

A deleted account's session stays valid until it expires (`SESSION_TTL`, 7
days), because the session token is not checked against `users`. To end it now,
rotate `JWT_SECRET` (8.1), which signs everyone out.

To revoke access and keep the account (and with it the record of which clients
it created), reset its password to a random value nobody keeps, then run the
reset in 7.1 or 7.2:

```powershell
$pw = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)) + 'aA1!'
```

---

## 8. Rotating secrets

### 8.1 `JWT_SECRET` (signs everyone out)

1. Generate a value. Either line works in PowerShell 7:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
   [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
   ```

2. Save it in the password manager first.
3. Render > web service > Environment > `JWT_SECRET` > paste > **Save and
   deploy**.
4. When the deploy is live every existing session fails with 401 and the page
   shows the sign-in form. Partners sign in again; passwords are unchanged.

### 8.2 The Anthropic key

1. In the Anthropic Console, create a new API key (confirm the steps in the
   Console).
2. Render > Environment > `ANTHROPIC_API_KEY` > **Save and deploy**.
3. `/api/health` must show `anthropic: configured` (section 4.3). That only
   proves a key is set, so also ask one AI Advisor question and look for an
   `ai_call` line in the logs (section 9).
4. Then revoke the old key in the Console, and update the password manager.

The `age` backup key: `backup/INSTALL.md`, "Rotating the age key".

---

## 9. Reading the logs

### 9.1 Where

Render > web service > **Logs**. You can search for any string, filter by
level, pick a time range within the workspace's retention, use `*` wildcards
and `/regular expressions/`, and open a line in context. Render processes up
to 6,000 application log lines per minute per instance
(<https://render.com/docs/logging>). How far back logs go depends on the
workspace plan: confirm in the dashboard.

### 9.2 Start-up

A healthy start prints, in order: `Testing database connection...`,
`PostgreSQL connection OK`, `Initializing database tables...`,
`Database tables initialized`, `Server running on port <n>`,
`Environment: production`. Warnings to act on:
`FRONTEND_URL is not set: no browser origin is allowed to call the API.`
(section 2) and a `SESSION_TTL` fallback warning. In production a database
failure at start prints `Cannot start server without database in production`
and the process exits.

### 9.3 The structured lines

Each is one JSON object on one line; search for the quoted event name, for
example `"event":"ai_error"`.

| Event | Level | Fields | Meaning and what to do |
|---|---|---|---|
| `ai_call` | info | `label`, `userId`, `model`, `stop`, `inputTokens`, `outputTokens`, `ms` | One Anthropic call. The token counts are the cost. `stop` of `max_tokens` means the answer was cut off (the page says so) |
| `ai_error` | error | `label`, `userId`, `model`, `status`, `message`, `ms` | A failed Anthropic call. `status` 401 or 403: the key is wrong or revoked (8.2). 429: Anthropic's rate limit. 5xx or overloaded: Anthropic's side, retry later. `null`: network or timeout |
| `rate_limited` | warn | `limiter`, `key`, `limit`, `path` | Our own limiter refused a request (D11). `login_ip`: 20 logins per 15 min from one address. `login_user`: 5 failed logins per 15 min for one username; the account is locked for the rest of the window, including for its owner. `ai_user`: 30 AI calls per hour per partner. `ai_global`: 300 per day for the firm. Counters are in memory, so a redeploy clears them |
| `origin_refused` | warn | `origin`, `method`, `path` | A state-changing request from a browser origin other than `FRONTEND_URL` was refused. From an unknown site: someone else's page tried, and was stopped. With `origin` `https://gbacpod.com`: `FRONTEND_URL` is wrong on Render |
| `pg_pool_error` | error | `code`, `message` | An idle database connection dropped. The pool reconnects on the next query and the process keeps running. Many in a row: check `/api/health` and the database's page on Render |

---

## 10. What `/api/health` means

`GET /api/health` needs no sign-in and always answers HTTP 200:

```json
{ "status": "OK", "timestamp": "<ISO time>", "uptimeSeconds": 8509, "environment": "production",
  "services": { "database": "connected", "anthropic": "configured", "model": "claude-opus-5" } }
```

| Field | Meaning |
|---|---|
| `status` | `OK`, or `DEGRADED` when the database query fails or no Anthropic key is set |
| `timestamp` | the server's clock when it answered |
| `uptimeSeconds` | seconds since the process started. It resets on every deploy, restart and, on a Free instance, every spin-up |
| `environment` | `NODE_ENV`; must be `production` on Render |
| `services.database` | `connected` if `SELECT 1` succeeded just now, else `disconnected` |
| `services.anthropic` | `configured` if a key is set. It does not prove the key works (8.2) |
| `services.model` | the model every AI call uses (`AI_MODEL`, default `claude-opus-5`) |

Because the answer is 200 even when `DEGRADED`, a check that looks only at the
status code proves only that the process is up. Render's own health check
counts any 2xx or 3xx within five seconds as passing
(<https://render.com/docs/health-checks>), so it cannot see `DEGRADED`; the
uptime monitor (section 11) looks for `"status":"OK"` in the body.

---

## 11. The uptime monitor

### 11.1 Set it up (UptimeRobot)

UptimeRobot's free plan checks every 5 minutes and supports keyword monitors
with email alerts (<https://uptimerobot.com/keyword-monitoring/>,
<https://help.uptimerobot.com/en/articles/11360876-what-is-a-monitoring-interval-in-uptimerobot>).

1. Create an account at <https://uptimerobot.com> with the firm's alert
   address.
2. New monitor. Type: **Keyword**. URL:
   `https://client-portfolio-backend.onrender.com/api/health`.
3. Keyword: `"status":"OK"` (with the quotes). Alert when the keyword is **not
   found** (UptimeRobot calls this "keyword not exists"; confirm the wording in
   its form).
4. Interval: 5 minutes. Alert contact: the email address.
5. Save, and confirm the monitor shows Up.

It watches the API, not the page: Netlify would keep serving the page while the
API or the database is down. A `DEGRADED` answer alerts too, because the
keyword requires `OK`; the most likely causes are the database and a missing
Anthropic key.

### 11.2 Test the alert once

Edit the monitor's keyword to `"status":"NEVER"` and save. Within one interval
the monitor goes Down and the email arrives. Put the keyword back to
`"status":"OK"` and confirm it goes Up (a second email). Record it:

| Date | Down email received | Up email received | By |
|---|---|---|---|
| | | | |

### 11.3 If the web service is a Free instance

Render spins a Free web service down after 15 minutes without inbound traffic
and takes about a minute to spin it up on the next request, showing a loading
page to browsers meanwhile. Each workspace gets 750 Free instance hours per
calendar month; a running Free service uses them, a spun-down one does not,
and when they run out Render suspends every Free web service in the workspace
until the next month (<https://render.com/docs/free>).

What that means here:

- **For the monitor:** a check every 5 minutes is inbound traffic, so the
  service never idles long enough to spin down. That is good for partners, but
  it keeps the service running about 720 to 744 hours a month, nearly the whole
  750-hour allowance. Any other Free service in the same workspace would run the
  allowance out and suspend this API until the month ends. The first check
  after a deploy can also hit a spin-up and report a brief Down.
- **For partners:** without the monitor, the first visit after 15 quiet
  minutes waits about a minute. The page's calls to the API are background
  requests, not page loads, so they cannot show Render's loading page: expect
  a failed sign-in or an error message until the API is up, then retry.
- **The fix is a paid instance type**, which also brings the Shell (7.1) and
  pre-deploy commands.

---

## 12. Dependency advisories that remain

After WP5's non-breaking `npm audit fix` (never `--force`), on 2026-09-25,
`npm audit` reports 5 (1 critical, 3 high, 1 moderate) and
`npm audit --omit=dev` reports 3. Every one needs a major version to fix.

| Package | Severity | Comes from | Where it runs | Fix | When |
|---|---|---|---|---|---|
| `tar` 6.2.1 | critical (path traversal, hardlink and symlink escapes, parser DoS) | `bcrypt` 5.1.1 > `@mapbox/node-pre-gyp` 1.0.11 > `tar` | `npm ci` on Render: node-pre-gyp downloads bcrypt's prebuilt binary and unpacks it with `tar`. At run time bcrypt only uses node-pre-gyp to find the binary | `bcrypt` 6 (semver major; it drops node-pre-gyp) | its own PR, verified with a Render deploy, because it replaces a native module |
| `@mapbox/node-pre-gyp` 1.0.11 | high | `bcrypt` 5.1.1 | as above | as above | as above |
| `bcrypt` 5.1.1 | high | direct dependency | as above | as above | as above |
| `vite` 4.5.14 | high (dev-server file serving, `server.fs.deny` bypasses on Windows, optimized-deps path traversal) | direct dev dependency | `npm run dev` only. Production is static files Vite built; the dev server never runs on Netlify | Vite 8 | not in Tier 0 (plan 0.2 bars a Vite major). Until then do not run `npm run dev -- --host` on an untrusted network |
| `esbuild` 0.18.20 | moderate (dev server answers any website) | `vite` 4 | `npm run dev` only | Vite 8 | with Vite |

Re-check with `npm audit` and `npm audit --omit=dev`. Do not run
`npm audit fix --force`: it installs these majors unreviewed.

---

## 13. When something is wrong

| Symptom | Look at |
|---|---|
| Nobody can sign in; the console shows CORS errors | `FRONTEND_URL` on Render (section 2); `origin_refused` lines; `/api/health` |
| The page loads but no request reaches the API; the console says `connect-src` | `VITE_API_BASE_URL` in Netlify and `connect-src` in `netlify.toml` must name the same API |
| Any other "Refused to ... Content Security Policy" line on gbacpod.com | what the new code loads; relax only the directive it needs, never `script-src` with `'unsafe-inline'` or `'unsafe-eval'` |
| Every AI button says "not configured" | `ANTHROPIC_API_KEY` on Render; `/api/health` |
| AI buttons fail with a message; others work | `ai_error` lines (section 9.3) |
| "Too many requests" at sign-in | `rate_limited` with `login_user`: wait 15 minutes, or redeploy to clear the counters |
| `/api/health` says `database: disconnected` | the database's page on Render; `pg_pool_error` lines |
| The API is slow for a minute, then fine | a Free instance spinning up (section 11.3) |
| The Netlify build fails with "VITE_API_BASE_URL must be set" | the variable is missing for that deploy context (section 2) |
