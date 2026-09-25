# Client Portfolio Dashboard

One shared book of business for the six partners of a Connecticut government
relations firm: every client, its contracts and revenue by year, how sticky and
how much effort each relationship is, who covers it, and what happens to the
book if a partner leaves. Six tabs: Data Upload (CSV import), Dashboard, Client
Details, Partnership, AI Advisor (questions answered by Claude over the book)
and Scenarios (a succession workflow). It runs at <https://gbacpod.com> for the
partners only and is not sold or packaged. `PRODUCT_BRIEF.md` says what it is
for; `REVIEW-2026-09.md` says how well it does it.

- **Page:** React 18, Vite 4, Zustand, Tailwind, Recharts (`src/`).
- **API:** Express 5 (`server.cjs`), PostgreSQL through `pg`, a JWT in an
  httpOnly cookie, the Anthropic SDK behind one service (`services/anthropic.cjs`).
- **Database:** `users`, `clients`, `client_revenues` (`init-db.sql`, applied by
  the API at every start).

`CLAUDE.md` is the developer reference: commands, endpoints, the scoring
formula, conventions.

## Run it locally

Needs Node 22 (what CI uses), npm, and a PostgreSQL you can create a database
in.

```powershell
git clone https://github.com/zekusmaximus/client-portfolio.git
Set-Location client-portfolio
npm ci
Copy-Item .env.example .env
```

Edit `.env`: set `DATABASE_URL` to your local database
(`postgres://<user>:<password>@localhost:5432/<database>`), keep
`NODE_ENV=development` and `DATABASE_SSL=false`, and generate a `JWT_SECRET`:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Then, in one terminal, the API (it creates the tables on first start):

```powershell
npm start                                   # http://localhost:5000
node create-admin.cjs <username> <password> # once, in another terminal
```

and in a second terminal, the page:

```powershell
$env:VITE_API_BASE_URL = 'http://localhost:5000'
npm run dev                                 # http://localhost:5173
```

In bash, `VITE_API_BASE_URL=http://localhost:5000 npm run dev`. Without the
variable the page calls a relative `/api`, which Vite does not proxy, and every
request fails. The AI Advisor also needs `ANTHROPIC_API_KEY` in `.env`; without
it the AI buttons say the AI is not configured.

Checks, the same three CI runs on every pull request:

```powershell
npm run lint                                # errors fail; 7 exhaustive-deps warnings are expected
npm test                                    # node --test, no database needed
$env:VITE_API_BASE_URL = 'https://gbacpod.com'; npx vite build
```

`npm run build:prod` sets `NODE_ENV` with POSIX syntax, which works in bash
(CI, Netlify) but not under npm's `cmd.exe` on Windows; `npx vite build` is the
same production build there. A production build refuses a missing or
non-`https://` `VITE_API_BASE_URL`.

## How it is deployed

Merging to `main` deploys it: Netlify builds the page from `netlify.toml` and
serves it at gbacpod.com, and the Render web service `client-portfolio-backend`
runs the API against a Render PostgreSQL database. A private repository backs
the database up every night. [`deploy/README.md`](deploy/README.md) is the
runbook: hosting, rebuilding, checking and rolling back a deploy, partners and
passwords, secrets, logs, health, the uptime monitor. Backups:
[`deploy/backup/INSTALL.md`](deploy/backup/INSTALL.md) and
[`deploy/backup/RESTORE.md`](deploy/backup/RESTORE.md).

## Where the plan lives

[`docs/plans/tier-0.md`](docs/plans/tier-0.md) is the current plan
(stabilisation, work packages WP0 to WP5) and its status table says what is
merged, deployed and verified. Tier 1 (the AI rebuild) and Tier 2 (a shared
six-partner tool) are previewed at its end. Earlier status and fix notes are in
`docs/archive/`, kept for history only.
