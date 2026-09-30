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
| Node version | `22` (`NODE_VERSION` in `netlify.toml`), Netlify's latest 22 release. Since Tier 3 WP9 the build needs 22.12 or later (Vite 8, `@vitejs/plugin-react` 6 and Rolldown declare `^20.19.0 \|\| >=22.12.0`); never pin a 22 release below it. The deploy log names the release used |
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
| Node version | 22.16.0, Render's default for the service, not pinned (confirmed by Jeff on 2026-09-26, and in the deploy log of `3b5a246` on 2026-09-27). Without `NODE_VERSION`, `.node-version` or `engines`, a service keeps the default it was created with (<https://render.com/docs/node-version>); CI tests Node 22, `@anthropic-ai/sdk` 0.128.0 supports Node 20 or later, and `bcrypt` 6 Node 18 or later. The API does not use Vite, whose 8 needs 22.12 or later (Tier 3 WP9); 22.16.0 meets it anyway. Do not add `engines` to `package.json` for the page's tooling: Render would read it to choose the API's Node |
| Root directory | confirm in the dashboard (the repository root is what the code needs) |
| Build command | `npm install` (the deploy log of `3b5a246`, 2026-09-27). The code needs `npm ci`, which CI already runs: with `npm install`, a lockfile that does not match `package.json` installs other versions instead of failing the build. Jeff may switch it (the service's Settings, Build Command). Each build restores a cache of `node_modules` from the one before and installs the dev dependencies too, so the log counts them ("audited 609 packages" on 2026-09-27, when `npm ci` installed 608). `npm ci` installs 566 since Tier 3 WP3 and 544 since Tier 3 WP9, so expect about 545 audited after WP9's deploy; the build then also installs Vite 8's Linux packages (`@rolldown/binding-linux-x64-gnu`, `lightningcss-linux-x64-gnu`), which the API never loads |
| Start command | `npm start`, which runs `node server.cjs` (the deploy log of `3b5a246`, 2026-09-27) |
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

### 4.6 The AI tab's streamed answers

From Tier 1 WP5 the AI tab's Ask and Brief show the answer as it is written
(`docs/plans/tier-1.md`, section 10). The page posts with
`Accept: text/event-stream` and reads the response as it arrives; the API
sends `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`
and `X-Accel-Buffering: no`, a `: ping` line every 15 seconds while the model
thinks, and uses no compression. The stream passes through Render's proxy,
and whether that proxy hands it on unbuffered can only be seen on
gbacpod.com; nothing in the repository or the container can show it.

To check after a deploy: ask a question. The answer card says "Thinking… n s",
counting, then the words appear a few at a time and the answer grows until it
is done. **Buffering looks like this:** "Thinking… n s" counts all the way
through, and then the whole answer appears at once, at the end. The answer is
still right and still saved, so nothing is lost, but report it: something
between Render and the browser is holding the stream. In the browser's
developer tools (Network tab, the `ask` request, Timing), a streamed answer's
"Content Download" lasts as long as the answer took to write; a buffered one
is a few milliseconds at the end.

A partner who closes the tab or loses the connection mid-answer loses nothing:
the API finishes the answer, saves it, and it appears under Recent answers
(the page says so when its connection drops). The log shows one
`ai_stream_closed` line (9.3) for each such answer.

---

## 5. Rolling back

Decide which half is broken. The page and the API roll back separately, and
neither touches the database: data problems are section 6.

**From Tier 1 WP3 on (the AI tab's Ask the book), roll back both halves
together, to deploys of the same merge** (`docs/plans/tier-1.md`, section 3
item 5). WP3 deleted the AI Advisor's three routes (`/api/claude/...`) and the
page that called them. A page from before WP3 on an API from after it shows a
404 as the error on every AI Advisor button; that is what rolling back Netlify
alone past WP3 does, and what a partner sees in a tab left open across the
deploy until it is refreshed. The newer page on an older API is safe: it asks
`/api/health` for `ask-the-book` and, without it, shows "The API has not been
updated yet; try again in a few minutes." instead of the Ask box. So roll back
Render and Netlify together (5.1 and 5.2), and check both with section 4.

**Tier 2 WP5's first pull request** (text stored as typed) is safe to roll
back on either side: the page from before it works on the API after it, and
the reverse, each storing text the page reads correctly (checked end to end
in its pull request). An API rolled back past it escapes every save again, as
before, so do not run 7.5's repair on it; once WP5's second pull request
(which removes the page's one-level decoders) has merged, a rollback must take
both of WP5's pull requests together.

**Tier 2 WP6** (who changed what, and edit conflicts) is safe to roll back on
either side, but an API rolled back past it changes what is recorded. The
older API writes clients without logging them in `client_changes` and without
setting `clients.updated_by`, so `updated_by` goes stale; it ignores the page's
`expected_updated_at`, so two partners editing one client can again lose the
first save; and it has no history route, so the page (which asks `/api/health`
for `client-edit-conflict`) shows no History. The older `init-db.sql` leaves
the new table, its rows and `clients.updated_by` in place, and nothing needs
undoing. After fixing forward, the saves made while the older API ran have no
history rows: "Last changed by" is read from the newest row, so for a client
saved in that window it names the change before it, and a 409 on such a client
names nobody or that earlier change.

**Tier 2 WP8** (saved scenarios) is safe to roll back on either side; roll
back both together as usual. The newer page on an older API asks
`/api/health` for `saved-scenarios` and, without it, shows no scenario list:
Scenarios works in the browser only, as before (checked end to end in its
pull request). An older page on the newer API never asks for the list and
works as before. The older `init-db.sql` leaves the `scenarios` table and its
rows in place, and nothing needs undoing: once the newer API is back, the
saved scenarios are listed again as they were.

**Tier 2 WP9** (an associate in Scenarios) is safe to roll back on either
side; roll back both together as usual. It adds no table and no column: a
hire scenario is a row of `scenarios` whose `state` has `kind` `hire`. The
newer page on an API from before it (which lists `saved-scenarios` but not
`hire-scenarios`) keeps "Add an associate" in the browser only: Save and Save
as are off for a hire scenario and say why, and departure scenarios save and
open as before (checked end to end in its pull request). An older page on the
newer API lists a hire scenario with "nobody yet" under Leaving and, on Open,
says "This scenario is of a kind this page cannot show"; departure scenarios
work as before. An API rolled back past WP9 refuses to save a hire scenario
(400) but still lists and returns the ones saved, which the newer page opens
again once the API is back. No seat is ever written by a hire scenario except
a pick a partner accepts, one client at a time, through the second-chair
route every version since Phase 6 has.

**Tier 2 WP10** (follow-up questions, the earlier-book mark and hiding
answers) is safe to roll back on either side; roll back both together as
usual. The newer page on an older API asks `/api/health` for `ai-threads`
and, without it, offers no "Ask a follow-up", no Hide and no "Show hidden":
the AI tab is as before (checked end to end in its pull request). An older
page on the newer API works as before: it never sends a follow-up, and its
Recent answers leaves out the answers a partner has hidden (the list route
decides that), with follow-ups listed as ordinary questions. The older
`init-db.sql` leaves the five new columns of `ai_answers` and their values in
place, and nothing needs undoing; but an API rolled back past WP10 lists the
hidden answers again (it does not read `hidden_at`) and saves new answers
without the turn a follow-up replays, so an answer given while the older API
ran cannot be followed up once the newer one is back.

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

`ai_answers`, the saved AI answers (`docs/plans/tier-1.md`, WP4), is dumped,
restored and counted like every other table in the public schema:
`pg-backup.sh` lists the tables at run time, so the backup needs no change for
it, and its log's counts include it from the first night after the deploy.
The backup role reads a table created after the role only through
`pg_read_all_data` or the default privileges in INSTALL.md step 2. `people`
(the people plan's Phase 1) was the first such table, so a nightly run that
fails with `permission denied for table people`, `... ai_answers`,
`... client_changes` (who changed what, Tier 2 WP6) or `... scenarios` (saved
scenarios, Tier 2 WP8) means that grant is missing: make it as step 2 says, then run the backup by hand
(INSTALL.md step 7). A job that uses the database's own URL, because step 2
was skipped, reads every table and needs nothing.

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
button. The scripts below are for adding a partner, for a forgotten password,
for removing an account (7.3), for starting the book over (7.4), for
repairing text stored escaped (7.5) and for comparing AI models and effort
on the firm's own questions (7.6). Neither a reset nor a deletion ends
sessions already issued; section 8.1 does.

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
and exits 0, or says why not, changes nothing and exits 1. The account's
history rows (`client_changes`, Tier 2 WP6) stay, with `changed_by` empty and
the username kept, and `clients.updated_by` becomes empty on the clients it
saved last; `check-schema` lists both keys as `SET NULL`.

A deleted account's session stays valid until it expires (`SESSION_TTL`, 7
days), because the session token is not checked against `users`. To end it now,
rotate `JWT_SECRET` (8.1), which signs everyone out.

To revoke access and keep the account (and with it the record of which clients
it created), reset its password to a random value nobody keeps, then run the
reset in 7.1 or 7.2:

```powershell
$pw = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)) + 'aA1!'
```

### 7.4 Starting the book over (`reset-book`)

Once, for the people plan's fresh book
(`docs/plans/people-and-second-chair.md`, P7 and Phase 3): every client and
revenue row is deleted and the new sheet is imported into the empty book.
Accounts and the People list are untouched, and partners stay signed in. It
needs the deploy that contains `scripts/reset-book.cjs` and the upload page's
**Check file** button, on Render and on Netlify (section 4).

Before step 2, open
<https://client-portfolio-backend.onrender.com/api/health> and confirm the
answer contains `"features":["check-file"]`. Without it Render is still
running an older API; deploy it first (section 4.1, Manual Deploy when
auto-deploy is off, then 4.3). The page will not send a check to such an API,
but **Upload and Process CSV** still imports.

Tell the partners not to change clients from step 3 until step 6 is done: a
change made after the backup is lost with the old book and is not in the
backup, and a client added between the reset and the import stays in the new
book.

1. **Assemble the sheet** in the plan's section 3 format (the Data Upload
   page's **Download template** has the header). After the reset the sheet's
   `YYYY Contracts` columns are the only revenue history, so include every year
   the dashboard should show. Every name in `Lead`, `Second Chair` and
   `Originator` must be on the People list (header, **People**): add each
   associate the sheet names (**Add a person**, role Associate), and add a
   former colleague the sheet names as an originator, such as Steve or Fritz,
   then **Edit**, clear **Active** and **Save**. `Firm` in `Originator` needs
   nobody. A lead must be an active partner. Save the sheet as CSV UTF-8.

2. **Check the file until it passes.** On <https://gbacpod.com>, **Data
   Upload**, choose the file, **Check file**. The server runs every check and
   every write of the import and then rolls them back: nothing is written.
   Fix each row the table lists (numbered as in the spreadsheet: the header is
   row 1) and check again, until it answers `The file is ready to import: <n>
   clients; years 2024 ($...), 2025 ($...), 2026 ($...); columns ... Nothing
   was written.` Confirm the client count, each year's total against the
   sheet's column sum (`=SUM(C2:C500)` under each `YYYY Contracts` column),
   and the columns. Do not press **Upload and Process CSV** yet: before the
   reset it merges the sheet into the old book, and the backup in step 3 would
   then hold the merge instead of the old book.

3. **Back up by hand** (`backup/INSTALL.md` step 7) and keep the file:

   ```powershell
   $repo = 'zekusmaximus/client-portfolio-backups'
   gh workflow run backup.yml --repo $repo
   Start-Sleep 10
   $run = gh run list --repo $repo --workflow backup.yml --limit 1 --json databaseId --jq '.[0].databaseId'
   gh run watch $run --repo $repo --exit-status
   gh run view $run --repo $repo --log | Select-String 'pg-backup:'
   gh run download $run --repo $repo --name client-portfolio-backup --dir "$HOME\cp-before-reset-$run"
   Get-ChildItem "$HOME\cp-before-reset-$run"
   ```

   `gh run watch --exit-status` must end without an error, and the log must
   show `row counts match for N tables`; write down its `clients` and
   `client_revenues` counts and the run id. GitHub deletes the artifact after
   90 days; if the old book should outlive that, copy the `.dump.age` file
   somewhere you keep records (it is encrypted; the key is in the password
   manager). If this quarter's restore drill has not been done, run
   `backup/RESTORE.md` (b) to (d) on this file now, in the same window after
   `$work = "$HOME\cp-before-reset-$run"` and `$major` from RESTORE.md's
   opening block: it proves the key opens the file before production depends
   on it.

4. **Reset.** First without an argument, which only counts; then with
   `--confirm`. From your machine (the environment in 7.2). Paste the first
   block, read the counts (below), and only then paste the second: pasted
   together, both run without a pause.

   ```powershell
   Set-Location <path to your clone of client-portfolio>
   git pull; npm ci
   $env:DATABASE_URL = Read-Host 'External Database URL' -MaskInput
   $env:DATABASE_SSL = 'no-verify'
   node scripts/reset-book.cjs              # counts only; deletes nothing
   ```

   ```powershell
   node scripts/reset-book.cjs --confirm    # after reading the counts
   Remove-Item Env:DATABASE_URL, Env:DATABASE_SSL
   ```

   In the Render Shell (bash; it runs the deployed commit, so check that
   `ls scripts/reset-book.cjs` finds the file): `node scripts/reset-book.cjs`,
   then `node scripts/reset-book.cjs --confirm`.

   The first run prints a line per foreign key to `clients`, then `Accounts`,
   `People`, `Clients`, `Revenue rows` and, if production still has the
   legacy `revenues` table from `V2__update_clients_schema.sql`,
   `Rows of revenues`; it ends `Nothing was deleted. Run again with --confirm
   to delete every client.` and exits 1 by design. Check that `Clients` and
   `Revenue rows` equal the backup log's `clients` and `client_revenues`, and
   that every key line starts with `ok`. A line starting `DOES NOT CASCADE`
   names a table this app does not create: stop, `--confirm` will refuse, and
   find out what it holds before going on.

   `--confirm` runs one transaction: it locks `clients` against writes (the
   page can still read), deletes every client (revenue rows, and any legacy
   `revenues` rows, go with them) and commits only if the book is then empty
   and the numbers of accounts and people are unchanged. It prints
   `Removed <n> clients and <r> revenue rows. Accounts: <a> and people: <p>,
   unchanged.` (with `(and <k> rows of revenues)` when that table exists) and
   exits 0. Anything else starts `Refused:`, changes nothing and exits 1; if a
   save was in progress it waits 10 seconds and refuses, and running it again
   is safe. The history of who changed what (`client_changes`, Tier 2 WP6) has
   no key to `clients`, so the reset leaves it as it is, logs nothing, and the
   deleted clients' history stays readable by their ids.

5. **Import** on gbacpod.com: **Data Upload**, the same file, **Check file**
   once more (now against the empty book), then **Upload and Process CSV**.
   The success card lists each year with its total and the columns it read;
   the header shows `<n> clients loaded`.

6. **Spot-check.** The header's total and the Dashboard's **Total Revenue**
   show the latest year only: compare them with that year's column sum (the
   earlier years' totals were compared in steps 2 and 5). On **Client
   Details**, open a few clients with their **Edit Client** button and check
   the lead, the second chair and the revenue by year against the sheet (the
   card itself shows only the lead until Phase 4). On **People**, each
   person's `leads N clients · second chair on N · originated N` should match
   the sheet (`=COUNTIF(F:F,"Kevin")` on the `Lead` column, and so on).

7. **Remove Steve's and Fritz's accounts** if they have them (the backup of
   2026-09-24 counted seven accounts against six partners): 7.3,
   `check-schema` and then `delete-user`. Deleting an account does not touch
   the People list, so they stay on it as inactive originators. Do this last:
   a restore in step 8 would bring the accounts back.

8. **Rollback**, if the new book is wrong. If only the sheet is wrong, fix it
   and repeat steps 2, 4 and 5: the reset can run again. To get the old book
   back, restore the dump from step 3 into production with `backup/RESTORE.md`
   (e2). In its section (a), set `$run` to the run id from step 3 (or use the
   file you kept) instead of the latest run: every nightly backup after the
   reset holds the new book. The restore brings back the database as it was at
   step 3: the old book, and the People list and the accounts as they were
   then.

The next nightly backup dumps the new book. It needs only the `users`,
`clients` and `client_revenues` tables to exist and `users` to be non-empty
(`backup/pg-backup.sh`, check 2), so a small or empty book backs up normally.

### 7.5 Repairing text stored escaped (`unescape-book`)

**Done on 2026-09-28:** the preview in Render's Shell found 84 clients and
nothing to repair in any column, no shared names and no entity-like text in
any table, so `--confirm` was not needed. Since WP5's second pull request the
page shows text as stored and decodes nothing, so if a backup restored from
before 2026-09-28 ever brings escaped text back, it shows raw (`&amp;`): run
the preview and, if it lists anything, `--confirm` (steps 2 to 4 below).

Written for the one run between Tier 2 WP5's two pull requests
(`docs/plans/tier-2.md`, section 10, S8). Until WP5 the API HTML-escaped every string a client save
sent, so a client saved on Client Details was stored as `Barnes &amp; Noble`,
its note with a `<` two levels deep (`R&amp;amp;D &amp;lt; 5%`), and a client
from before the People list may hold escaped people text. WP5's first PR
stores what partners type; this repair rewrites what was stored before, in
`clients.name`, `notes`, `primary_lobbyist`, `client_originator` and
`lobbyist_team`, with the text as typed (`unescapeStored`,
`utils/escaping.cjs`). Nothing else changes: not `updated_at`, the revenue,
the People list, the accounts or the saved AI answers. Between WP5's two
pull requests the page read the text correctly before and after the repair,
but for the places that showed it raw (the Partnership tab's associate split
and person sheets, Scenarios, the Partnership report); since the second, it
shows all text as stored, so escaped text reads `&amp;` everywhere until
repaired.

It cannot tell a literal `&amp;` a partner typed from an escape, and turns
both into `&`.

**Before step 1**, open
<https://client-portfolio-backend.onrender.com/api/health> and confirm
`features` ends with `"plain-text"`. Without it Render is still running an API
that escapes every save: deploy it first (section 4.1, Manual Deploy when
auto-deploy is off, then 4.3), and never run the repair on that API, or on
one rolled back to it (section 5), because each later save escapes its text
again. Then on Client Details open one client with an `&` or `'` in its name
and a note, **Save** it unchanged, and check its name and note read the same.

Tell the partners not to save clients or import a sheet from step 2 until
step 3 is done: the preview's count would change, and `--confirm` would then
refuse (safely) until the preview runs again.

1. **Back up by hand** (7.4 step 3's block, or `backup/INSTALL.md` step 7),
   and wait for it to pass: `gh run watch --exit-status` ends without an
   error and the log shows `row counts match for N tables`. Write down the run
   id.

2. **Preview.** In the Render Shell (bash; it runs the deployed commit, so
   `ls scripts/unescape-book.cjs` finding the file proves Render runs WP5):

   ```bash
   ls scripts/unescape-book.cjs && node scripts/unescape-book.cjs
   ```

   Or from your machine (the environment in 7.2, after the `/api/health`
   check above; `git pull; npm ci` first, so your clone has the script):
   `node scripts/unescape-book.cjs`.

   It changes nothing and exits 1 by design. It prints `Clients: <n>`; then,
   for each of the five columns, how many clients hold escaped text and up to
   five of them as stored and as repaired (a note's text is never printed,
   only its length before and after, since notes stay out of logs and out of
   the AI); `Clients to repair: <n>`; the names two or more clients share
   regardless of case once repaired (the import's rule); entity-like text the
   repair leaves as it is (such as `&nbsp;`, which the old form wrote for a
   non-breaking space in a note with `<`, or a `&#169;` someone typed); any
   other text column of any table holding entity-like text, which nothing
   changes; and last the exact command for step 3:
   `Nothing was changed. To repair the <n> clients above, run: npm run unescape:book -- --confirm <n>`.
   **Bring the whole output to the session.** If `Names two or more clients
   share` lists anything, stop there and bring it: `--confirm` refuses while
   any name is shared, and one of each pair is deleted on Client Details
   first.

3. **Repair**, with the count the preview printed. In the Render Shell:

   ```bash
   node scripts/unescape-book.cjs --confirm <n>
   ```

   (from your machine the same, or `npm run unescape:book -- --confirm <n>`).
   One transaction: it locks `clients` against writes (the page can still
   read), counts again, and refuses unless exactly `<n>` clients hold escaped
   text; writes the repaired text; reads it back; and commits only if nothing
   is left to repair and no name is shared. It prints
   `Repaired <n> clients (name <a>, notes <b>, primary_lobbyist <c>, client_originator <d>, lobbyist_team <e>); updated_at left as it was.`
   and a line per client with what changed, and exits 0. Anything else starts
   `Refused:`, changes nothing and exits 1: a count that changed since the
   preview (a save or an import in between: run step 2 again), a shared name,
   or a save in progress (it waits 10 seconds; run it again). **Bring its
   output to the session.**

4. **Check.** Run the preview again: `Clients to repair: 0` and
   `Nothing was changed, and nothing is left to repair.` Running `--confirm`
   again is safe: with the old count it refuses, and `--confirm 0` changes
   nothing. On <https://gbacpod.com>: a client whose name had `&` or `'` and
   a note that had `&` read correctly on Client Details (the list and the
   **Edit Client** form), in Scenarios (choose someone who leads it as
   leaving: its name in Stages 1 to 3, Stage 3's client picker included) and
   in the Partnership report (**Export**, **Report**), with `&` shown once.

5. **Rollback.** The repair changes only those five columns. The API from
   before WP5 reads repaired text correctly, since its displays decode one
   level and plain text has none, but escapes each later save again; after a
   rollback, run the repair again once WP5 is back (a second run repairs only
   what was escaped since). To put the text back as it was, restore step 1's
   backup (`backup/RESTORE.md` (e2)), which also undoes every other change
   since step 1.

### 7.6 Choosing the AI model and effort (`eval-ai`)

Tier 2 WP11 (`docs/plans/tier-2.md`, section 16, S16). `scripts/eval-ai.cjs`
asks 10 to 20 questions partners have already asked again, on today's book,
under each configuration, and writes each saved answer beside each
configuration's answer, with the tokens, the estimated cost and the time.
You choose the questions, approve the spend and run it; the model (D7) and
the effort are your choice, made from what it writes.

The configurations, in the order they run:

1. `claude-opus-5` at the API's default effort (`high`): what production
   sends while `AI_EFFORT` is not set on Render.
2. `claude-opus-5` at effort `medium`.
3. Only if you add `--opus-5-5 medium` (or several efforts,
   `--opus-5-5 medium,high`): `claude-opus-5-5` at that effort. Its default
   effort is `medium`, one level below `claude-opus-5`'s, so it always runs
   with its effort set. In this comparison it runs without the server-side
   refusal fallback (`FALLBACK_MODELS` lists only `claude-opus-5` until you
   choose), so a question it declines shows as declined.

What it does not do. It writes nothing to the database: every read is in one
read-only transaction, closed before the first call, and no answer is saved,
so nothing appears under Recent answers, and **its cost shows in the
Anthropic Console, not in the AI tab's month total**. The app's AI rate
limits (30 an hour per partner, 300 a day) do not apply to a script, so it
takes at most 20 questions: 40 calls with the first two configurations, 20
more for each `claude-opus-5-5` effort. Nothing is spent without
`--confirm` and the dollar figure the estimate printed for exactly those
questions and configurations, on today's book.

**Where.** Your machine, which keeps the side-by-side as a file (the Render
Shell's disk is temporary and has no download, and the side-by-side is long):
7.2's set-up plus the Anthropic key (the one on Render, from the password
manager, or a new one from the Console, 8.2). `NODE_ENV=production` makes
the calls go only to `https://api.anthropic.com` (T17), whatever else is set;
the estimate prints where they go.

```powershell
Set-Location <path to your clone of client-portfolio>
git pull; npm ci
$env:DATABASE_URL = Read-Host 'External Database URL' -MaskInput
$env:DATABASE_SSL = 'no-verify'
$env:ANTHROPIC_API_KEY = Read-Host 'Anthropic API key' -MaskInput
$env:NODE_ENV = 'production'
node scripts/eval-ai.cjs                                                   # 1. the saved Asks
node scripts/eval-ai.cjs --ids 12,15,18 --out "$HOME\eval-ai.md"          # 2. the estimate; sends nothing
node scripts/eval-ai.cjs --ids 12,15,18 --out "$HOME\eval-ai.md" --confirm <figure>   # 3. the run
Remove-Item Env:DATABASE_URL, Env:DATABASE_SSL, Env:ANTHROPIC_API_KEY, Env:NODE_ENV
```

The list (step 1) and the transition-plan check (below) are quick from the
Render Shell too (7.1), where the key and the database are already set:
`node scripts/eval-ai.cjs` and `node scripts/eval-ai.cjs --plans`. A run
there needs `--stdout`, which prints the side-by-side to the terminal (the
progress goes to the error stream), or a file under `eval-ai-output/` that
you then print with `cat` and delete. Call `node` directly, not `npm run`,
which prints its own lines on standard output.

1. **Choose the questions.** Without arguments it lists every saved Ask,
   newest first: its id, the date, who asked, the saved answer's tokens and
   cost, and marks: `follow-up of #n, asked alone` (the evaluation asks each
   question as a new one, without its thread, so prefer first questions),
   `hidden by <who>`, `declined`, `cut off`, `earlier book` (asked on a book
   that has changed since). Pick 10 to 20 that cover what partners really
   ask: loads, exposure, coverage, a client by name, a question whose answer
   you can check by hand.
2. **Read the estimate.** With `--ids` (and `--opus-5-5` and `--out` if you
   want them) it prints the questions, each configuration's range, the total
   and the most the run could cost, where the calls go, where the file goes,
   and the command that spends it. The range takes each saved answer's
   output from half to twice as long (output, thinking included, changes
   with effort and model) and the book written to the cache once per
   configuration and read after; the Console is the bill. Nothing is sent.
3. **Run it** with the printed command, `--confirm <figure>` at the end. It
   refuses a figure that is not this estimate's (other questions, another
   configuration, a changed book): run the estimate again. It asks one
   question at a time, every question under one configuration before the
   next, as the Ask route asks it (the same system blocks, today's date, the
   question as saved, 32,000 tokens), and prints a line per call. It stops
   before a call once the calls so far have cost the figure (the last call
   can take it past by one answer), after an answer whose cost it cannot
   price, after a key Anthropic refuses and after three errors in a row;
   Ctrl-C stops it after the call in flight. The side-by-side is rewritten
   after every call, so a stop keeps what was paid for. Expect it to take
   about as long as the questions took in the AI tab, once per
   configuration.
4. **Read the side-by-side.** At the top, a table per configuration: answers,
   declined, cut off, fell back, errors, output tokens, estimated cost and
   mean time. Then each question with its saved answer, labelled "given on
   today's book" or "given on an earlier book" (an answer on an earlier book
   can differ because the book did), and each configuration's answer as the
   AI tab would show it (a decline's notice and category, the cut-off
   notice, "after a decline (a fallback)"). The questions to settle: does
   `medium` answer as well as the default for less output, cost and time;
   and, if you compared it, does `claude-opus-5-5` answer better or as well
   for less, and does it decline anything.
5. **Check the bill** in the Anthropic Console (usage for the day). The AI
   tab's month line does not include the run.
6. **Delete the file** (`Remove-Item "$HOME\eval-ai.md"`; in the Render Shell
   `rm -r eval-ai-output`). It holds the firm's questions, answers and client
   names. Never commit it: inside this repository the script writes only
   under `eval-ai-output/`, which git ignores, and refuses any other path in
   it.
7. **Tell the next session your choice**: the model and the effort. The
   change is then `PRICES` and `FALLBACK_MODELS` in code (a pull request) and
   `AI_EFFORT` on Render (section 2); a switch to `claude-opus-5-5` sets
   `AI_EFFORT` explicitly.

**The transition-plan check** (`--plans`, read-only, free). S16 asks whether
the saved transition plans recommend people the parser cannot resolve. A
saved plan does not store the roster it was given, so the check resolves each
plan's `RECOMMENDED LEAD` and `RECOMMENDED SECOND CHAIR` as the parser does,
against everyone on today's People list, and prints the counts and each plan
not resolved with its first line. Plans with a seat no roster could resolve
(no recommendation, or a name on nobody's list) are a lower bound; a seat
naming several people, or a lead who is not a partner today, may have
resolved on the plan's own roster, which left the people leaving out.
Structured output for transition plans is proposed only if these show
recommendations the parser could not resolve, and it is yours to approve.

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
`Environment: production`. The API opens its port only after
`Database tables initialized` (since Tier 3 WP3), so a deploy takes requests
only once `init-db.sql` has run; until then `Server running on port` came
second, right after `Testing database connection...`. Warnings to act on come before
`Testing database connection...`:
`FRONTEND_URL is not set: no browser origin is allowed to call the API.`
(section 2), a `SESSION_TTL` fallback warning
(`SESSION_TTL="<value>" is not <number><d|h|m>; using 7d.`) and
`anthropic_base_url_ignored` (9.3). In production a database failure at start
prints `Database initialization failed:` with the error's code and message,
then `Cannot start server without database in production`, and the process
exits without opening its port (no `Server running on port` line). Until
Tier 3 WP3 a start also began with a
`[dotenv@17.2.0] injecting env (0) from .env` line; it no longer does, and
neither do the scripts in section 7.

### 9.3 The structured lines

Each is one JSON object on one line; search for the quoted event name, for
example `"event":"ai_error"`.

| Event | Level | Fields | Meaning and what to do |
|---|---|---|---|
| `ai_call` | info | `label`, `userId`, `model`, `servedBy`, `fellBack`, `stop`, `refusalCategory`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `costUsd`, `ms` | One Anthropic call. `label` is `ask`, `brief`, `follow-up` (Tier 2 WP10: a question asked under an earlier answer, which sends the thread's earlier questions and answers with it) or `transition-plan`; `eval` is `scripts/eval-ai.cjs` (7.6), whose lines appear in the terminal that runs it, not in the web service's logs. `model` is the model requested and `servedBy` the one that answered. `fellBack` true: Anthropic's server-side fallback served it (the requested model declined, or Anthropic sent the turn straight to the fallback), and `servedBy` names the fallback model. `stop` of `max_tokens`: the answer was cut off (the page says so). `stop` of `refusal`: the AI declined, and `refusalCategory` says why. `cacheWriteTokens` above 0: this call wrote the book to Anthropic's prompt cache (the first AI call on this book in five minutes). `cacheReadTokens` above 0: it read the book from the cache, which is cheaper. A `follow-up` within five minutes of the answer before it also reads that thread's earlier turns from the cache, so its `cacheReadTokens` exceed the book's alone, and it writes only what the last turn added. `costUsd` is an estimate from list prices in `utils/aiCost.cjs`, `null` for a model without a price (`ai_cost_unknown_model`); the Anthropic Console is the bill. `ms` is how long the call took |
| `ai_error` | error | `label`, `userId`, `model`, `status`, `type`, `message`, `ms` | A failed Anthropic call; the partner saw an error and nothing was saved. `status` 401 or 403: the key is wrong or revoked (8.2). 429: Anthropic's rate limit. 5xx, or `type` `overloaded_error`: Anthropic's side, retry later. 400: Anthropic refused the request as we built it; report it with the line. `status` `null` with a `type`: Anthropic's stream failed in the middle of an answer, and `type` says how. Both `null`: network or timeout. A missing key writes no line: `/api/health` shows `anthropic` `not configured` |
| `ai_stream_closed` | warn | `label`, `userId`, `opened` | `label` as in `ai_call`. The page's connection closed before a streamed answer was done (the tab was closed, the network dropped, or the partner signed out). The call carries on and the answer is saved (its `ai_call` line follows). `opened` false: it closed before the stream had started. Many of them for answers partners were watching: something between Render and the browser is cutting long connections (4.6) |
| `ai_answer_save_failed` | error | `label`, `userId`, `kind`, `code`, `message` | An answer could not be saved. The partner still got it, marked `saved: false`, but it is not under Recent answers and not in the month's cost. `code` is PostgreSQL's error code. Check the database with `/api/health` (section 10). Many in a row: the database or the `ai_answers` table has a problem; send the `code` and `message` |
| `ai_cost_unknown_model` | warn | `label`, `models`, `pricesReadOn` | A call ran on a model with no price in `utils/aiCost.cjs`'s `PRICES` (`models` lists them), so its `costUsd` is `null`: Recent answers shows its cost as "no price" and the month's line leaves it out of the total. Happens when `AI_MODEL` changes or a fallback serves from an unpriced model. Add the model's price to `PRICES` in a PR |
| `ai_on_start_error` | error | `label`, `userId`, `message` | A bug in our code that opens a streamed answer to the page: it threw when Anthropic's stream started. The call carries on and the answer is saved, so it is under Recent answers even if the page did not show it. Report it with the line |
| `ai_on_text_error` | error | `label`, `userId`, `message` | A bug in our code that streams an answer's words to the page: it threw on a piece of text and sends no more pieces. The call carries on and the answer is saved, so it is under Recent answers even if the page did not show it. Report it with the line |
| `ai_book_error` | error | `message` | `GET /api/ai/book`, which the AI tab's "What the AI is given" panel calls, could not build the book and answered 500 "Failed to build the book." Usually the database: check `/api/health` (section 10). Ask and the brief do not write this line; a failure there shows as `ai_ask failed:`, `ai_brief failed:` or `ai_follow-up failed:` with its code and message (section 13; a stack trace until Tier 3 WP2) |
| `ai_answers_error` | error | `message` | Reading the saved answers (Recent answers, an opened answer or the month's line), or hiding one or showing it again (Tier 2 WP10), failed, and the API answered 500 "Failed to read the saved answers." Usually the database: check `/api/health` (section 10) |
| `anthropic_base_url_ignored` | warn | `message` | At start: `ANTHROPIC_BASE_URL` is set on Render. It is a test-only setting that production ignores, so AI calls still go to `https://api.anthropic.com`. Delete it on the web service's Environment page (section 2) |
| `rate_limited` | warn | `limiter`, `key`, `limit`, `path` | Our own limiter refused a request (D11). `login_ip`: 20 logins per 15 min from one address. `login_user`: 5 failed logins per 15 min for one username; the account is locked for the rest of the window, including for its owner. `ai_user`: 30 AI calls per hour per partner. `ai_global`: 300 per day for the firm. Counters are in memory, so a redeploy clears them |
| `origin_refused` | warn | `origin`, `method`, `path` | A state-changing request from a browser origin other than `FRONTEND_URL` was refused. From an unknown site: someone else's page tried, and was stopped. With `origin` `https://gbacpod.com`: `FRONTEND_URL` is wrong on Render |
| `pg_pool_error` | error | `code`, `message` | An idle database connection dropped. The pool reconnects on the next query and the process keeps running. Many in a row: check `/api/health` and the database's page on Render |

---

## 10. What `/api/health` means

`GET /api/health` needs no sign-in and always answers HTTP 200:

```json
{ "status": "OK", "timestamp": "<ISO time>", "uptimeSeconds": 8509, "environment": "production",
  "features": ["check-file", "transition-plan-roster", "second-chair-assign", "ai-book", "ask-the-book", "ai-answers", "ai-stream", "plain-text", "client-edit-conflict", "saved-scenarios", "hire-scenarios", "ai-threads"],
  "services": { "database": "connected", "anthropic": "configured", "model": "claude-opus-5" } }
```

| Field | Meaning |
|---|---|
| `status` | `OK`, or `DEGRADED` when the database query fails or no Anthropic key is set |
| `timestamp` | the server's clock when it answered |
| `uptimeSeconds` | seconds since the process started. It resets on every deploy, restart and, on a Free instance, every spin-up |
| `environment` | `NODE_ENV`; must be `production` on Render |
| `features` | what this API can do that older deploys cannot, one name per change the page depends on (`CLAUDE.md`, "Health"). `check-file` (the upload page's Check file): the page sends nothing to an API without it, which would import the file instead; missing means Render is still running a deploy from before 2026-09-25's Phase 3. `ai-stream` (Tier 1 WP5): without it the AI tab asks for its answers as JSON, all at once, as before (4.6). `plain-text` (Tier 2 WP5), which the page does not read, says this API stores text as typed, and 7.5's repair runs only on an API that lists it. `client-edit-conflict` (Tier 2 WP6): the client form shows "Last changed by" and History only with it, and without it saves as before. `saved-scenarios` (Tier 2 WP8): Scenarios shows its list of saved scenarios (New, Open, Save, Save as, Delete) only with it, and without it works in the browser only, as before. `hire-scenarios` (Tier 2 WP9): Scenarios saves an "Add an associate" scenario only with it; without it (an API from before WP9, which refuses the kind) that kind works in the browser only, with Save and Save as off, and departure scenarios save as before. The last one added is `ai-threads` (Tier 2 WP10): the AI tab offers "Ask a follow-up", Hide and "Show hidden" only with it; without it (an API from before WP10, which would answer a follow-up as a new question) the tab is as before. A name missing after a merge means Render has not deployed that merge yet |
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

None remain. Since Tier 3 WP9 (`vite` 8.3.1 and `@vitejs/plugin-react`
6.1.1; `docs/plans/tier-3.md` section 12), `npm audit` and
`npm audit --omit=dev` both report 0.

Until WP9, `npm audit` reported 2 and `npm audit --omit=dev` 0. Both were
dev dependencies, reachable only through `npm run dev`; production is static
files Vite built, and the dev server never runs on Netlify.

| Package | Severity | Comes from | Fixed by |
|---|---|---|---|
| `vite` 4.5.14 | high (seven advisories in the dev server's file serving: `server.fs.deny` bypasses on Windows, optimized-deps path traversal, `server.fs` not applied to HTML files, files whose names start with the public directory's served; and, on Windows, its open-in-editor endpoint, `launch-editor`: command injection from a crafted request and NTLMv2 hash disclosure through a UNC path) | direct dev dependency | Vite 8 (Tier 3 WP9) |
| `esbuild` 0.18.20 | moderate (dev server answers any website) | `vite` 4 | Vite 8, which no longer uses esbuild (Tier 3 WP9) |

The habits the table asked for stay good practice: run `npm run dev` only
while working on the page and stop it afterwards, and never
`npm run dev -- --host` on an untrusted network. Vite 8 needs Node 20.19, or
22.12 and later, on the machine that runs it.

Until Tier 2 WP3 the table also listed `tar` 6.2.1 (critical), `@mapbox/node-pre-gyp`
1.0.11 and `bcrypt` 5.1.1 (high): bcrypt 5's install script, run by Render's
build (`npm install`, section 1.2), downloaded its binary from GitHub and
unpacked it with `tar`. bcrypt 6 ships its binaries inside the npm package
(`prebuilds/`, loaded by `node-gyp-build`), so the install fetches nothing
outside the npm registry and
the lockfile's integrity hash covers the binary. On Render (Linux x64, glibc) it loads
`prebuilds/linux-x64/bcrypt.glibc.node`; only where no prebuild matches does
the install compile bcrypt from source, which needs Python, `make` and a C++
compiler and downloads Node's headers from nodejs.org.

Re-check with `npm audit` and `npm audit --omit=dev`. Do not run
`npm audit fix --force`: it installs majors unreviewed, and moves a package
without the ones that must move with it (for Vite 8 it wrote `vite` `^8.3.1`
and left `@vitejs/plugin-react` on 4.x, which cannot run on Vite 8).

---

## 13. When something is wrong

| Symptom | Look at |
|---|---|
| Nobody can sign in; the console shows CORS errors | `FRONTEND_URL` on Render (section 2); `origin_refused` lines; `/api/health` |
| The page loads but no request reaches the API; the console says `connect-src` | `VITE_API_BASE_URL` in Netlify and `connect-src` in `netlify.toml` must name the same API |
| Any other "Refused to ... Content Security Policy" line on gbacpod.com | what the new code loads; relax only the directive it needs, never `script-src` with `'unsafe-inline'` or `'unsafe-eval'` |
| Every AI button says "not configured" | `ANTHROPIC_API_KEY` on Render; `/api/health` |
| AI buttons fail with a message; others work | `ai_error` lines (section 9.3) |
| An AI answer counts "Thinking… n s" and then appears all at once at the end | something between Render and the browser is buffering the stream (4.6). The answer is right and saved; report it |
| "Too many requests" at sign-in | `rate_limited` with `login_user`: wait 15 minutes, or redeploy to clear the counters |
| `/api/health` says `database: disconnected` | the database's page on Render; `pg_pool_error` lines |
| The API is slow for a minute, then fine | a Free instance spinning up (section 11.3) |
| The Netlify build fails with "VITE_API_BASE_URL must be set" | the variable is missing for that deploy context (section 2) |
| The Netlify build fails with `[lightningcss minify]` | invalid CSS in the change (since Tier 3 WP9, Vite 8's CSS minifier refuses what Vite 4 only warned about); the line named after the message is the one to fix. It is a code fix, not a setting |
| The Netlify build fails naming Node or `engines` | the Node release in the deploy log is below 22.12 (section 1.1): check `NODE_VERSION` in `netlify.toml` and that the UI has no second one |
| A partner sees "Failed to ..." or "Server error" (a 500) | the line Render logged at that moment, which starts with what failed (`Error updating client:`, `Error updating person:`, `Error assigning a second chair:`, `ai_ask failed:`, ...) and carries the failure as JSON: `code` (PostgreSQL's error code, or Node's), `message` and, for a row the database refused, the `constraint`, `table` and `column` it names. Since Tier 3 WP2 the line never holds the row itself (PostgreSQL's `detail`, a client's note included) or a stack trace; send the line as it is. `40P01` (`deadlock detected`): two writes at the same moment each waited for the other, and PostgreSQL stopped this one (the other saved); try it again, and report the line if it recurs (WP2 removed the two known cases, an Accept or a rename during a rename) |
| A partner cannot save a client under a name, "Another client is already named ..." beside the name | another client has that name in some case (Tier 3 WP2). Rename or delete one of them on Client Details; two clients stored with one name before WP2 stay editable, and each still refuses its row in an import until one is renamed or deleted |
