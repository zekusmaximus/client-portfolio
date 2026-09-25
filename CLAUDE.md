# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current work plan

Active plan: `docs/plans/tier-0.md` (stabilisation). Read it before making
changes and update its status table when you finish a work package.
Background and evidence: `REVIEW-2026-09.md`. Product direction:
`PRODUCT_BRIEF.md` (one shared book for six equal partners; no per-user
data scoping by design).

## Development Commands

### Frontend Development
- `VITE_API_BASE_URL=http://localhost:5000 npm run dev` - Vite dev server on http://localhost:5173 (PowerShell: `$env:VITE_API_BASE_URL = 'http://localhost:5000'; npm run dev`). Without the variable the page calls relative `/api`, which Vite does not proxy
- `VITE_API_BASE_URL=https://gbacpod.com npm run build:prod` - the production build CI and Netlify run (`NODE_ENV=production vite build`, POSIX syntax; on Windows use `npx vite build`, production is Vite's default mode). A production build refuses a missing or non-`https://` `VITE_API_BASE_URL`
- `npm run build` - `vite build` without the `NODE_ENV` prefix; `npm run preview` serves `dist/`
- `npm run lint` - Run ESLint on JS/JSX/CJS files (errors fail the gate, warnings are informational; 7 `exhaustive-deps` warnings are expected, D3)
- `npm run security:audit` / `npm run security:audit-fix` - `npm audit` / non-breaking `npm audit fix`; never `--force` (the remaining advisories need majors, `deploy/README.md` section 12)

### Backend Development
- `npm start` or `node server.cjs` - Start Express.js backend server on port 5000
- Backend runs on http://localhost:5000 with CORS enabled for development
- `npm run create:admin -- <username> <password>` - add a partner (`create-admin.cjs`; refuses an existing username)
- `npm run reset:password -- <username> <newPassword>` - reset a forgotten password (`scripts/reset-password.cjs`); prints `Updated 1 user`, or `No such user` and exits 1. On Render, run it from the web service's Shell tab, which has the service's environment; locally, set `DATABASE_URL` to the Render database's External Database URL and `DATABASE_SSL=no-verify`. Both scripts validate with `utils/passwordPolicy.cjs` and connect through `db.cjs`

### Testing
- `npm test` - Run the test suite with Node's built-in runner (`node --test "tests/**/*.test.mjs"`); no test dependencies to install
- Tests live in `tests/*.test.mjs` and use `node:test` + `node:assert/strict`. Import CommonJS modules with a default import (`import strategic from '../utils/strategic.cjs'`)
- Current suites: `smoke` (scoring formula), `strategic` (score regression fixture, D6), `csv-import` (year rule, D5), `contract-status`, `reporting-year` (D4), `ai-service` (response parsing and SDK error mapping, WP2), `transition-plan` (per-client prompt and parser, D9), `ai-grep` (the WP2 grep assertions: no retired model ids or sampling parameters, one SDK call site), `password-policy` and `session-ttl` (WP3). Functions that depend on the clock take a `now` argument (`deriveContractStatus(period, now)`, `computeReportingYear(clients, now)`) so tests are deterministic
- Never import `db.cjs`, `data.cjs`, `models/*`, or `utils/jwt.cjs` from tests: they throw at load time without `DATABASE_URL` / `JWT_SECRET`
- `npm run deploy:check` runs lint, tests, and the production build; GitHub Actions (`.github/workflows/ci.yml`) runs the same three on every PR and push to `main`

## Architecture Overview

This is a **Client Portfolio Optimization Dashboard** for government relations attorneys, consisting of:

### Frontend (React + Vite)
- **Framework**: React 18 with Vite bundler
- **State Management**: Zustand (`src/portfolioStore.js`); clients come from the API, and only UI state is persisted to localStorage
- **UI Library**: Shadcn/UI components with Tailwind CSS
- **Charts**: Recharts for data visualizations
- **Main Entry**: `src/main.jsx` renders `src/App.jsx`

### Backend (Node.js + Express)
- **Server**: Express.js server in `server.cjs` (`PORT`, default 5000; Render sets its own). API only: the page is served by Netlify, and Express serves no static files
- **API Routes**:
  - `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password` (`routes/auth.cjs`)
  - `GET /api/data/clients`, `POST /api/data/clients`, `PUT /api/data/clients/:id`, `DELETE /api/data/clients/:id`, `POST /api/data/process-csv` (`data.cjs`). `data.cjs` also still defines `POST /update-client`, `/optimize-portfolio` and `/analytics`, which nothing calls and which use a second, retired scoring formula (review 4.5; deleting them is Tier 2)
  - `POST /api/claude/analyze-portfolio`, `/api/claude/strategic-advice`, `/api/claude/client-recommendations` - the AI Advisor tab (`claude.cjs`)
  - `POST /api/scenarios/transition-plan` - one succession transition plan for one client (`routes/scenarios.cjs`)
  - `GET /api/health` - no sign-in; fields under "Auth, sessions and rate limits" below and in `deploy/README.md` section 10
- **AI service**: every Anthropic call goes through `services/anthropic.cjs` (see "AI Integration" below)
- **Data Processing**: Client analysis engine in `clientAnalyzer.cjs`

### Key Application Components

#### Core Views (Tab-based Navigation)
Six tabs in `src/App.jsx`, switched by the store's `currentView` (a hand-rolled
tabs component, `src/components/ui/tabs.jsx`; no router, the URL never changes):
1. **Data Upload** (`DataUploadManager.jsx`, `data-upload`) - CSV import through a file picker, parsed in the browser by PapaParse and posted to `/api/data/process-csv`
2. **Dashboard** (`DashboardView.jsx`, `dashboard`) - Analytics and visualizations
3. **Client Details** (`ClientListView.jsx` + `ClientEnhancementForm.jsx`, `client-details`) - Client management
4. **Partnership** (`PartnershipAnalytics.jsx`, `partnership`) - per-partner metrics, marking partners as departing, redistribution modelling, and the Export Analysis menu (partnership report in a print window, transition plan and capacity CSVs)
5. **AI Advisor** (`AIAdvisor.jsx`, `ai`) - Claude API integration for strategic advice
6. **Scenarios** (`ScenarioModeler.jsx`, `scenarios`) - the three-stage succession workflow (`src/components/succession/SuccessionScenario.tsx`); the Growth and capacity scenarios were deleted in WP2 (D8)

#### Data Flow
1. CSV upload → `data.cjs` processes via `clientAnalyzer.cjs`; the pure helpers in `utils/csvImport.cjs` read the years from the header and plan the revenue writes
2. Clients live in Postgres; the store loads them with `fetchClients()` after sign-in and after every write. localStorage keeps only UI state (`optimizationParams`, `currentView`, `isModalOpen`, `selectedClient`)
3. Strategic value calculations use the single scorer in `utils/strategic.cjs` (re-exported by `clientAnalyzer.cjs`)
4. AI endpoints need `ANTHROPIC_API_KEY`; without it they answer 503 `AI is not configured on the server (missing API key).` and `/api/health` reports `anthropic: not configured`

**CSV year rule (D5).** No revenue year is hard-coded anywhere. A CSV's revenue
columns are its `YYYY Contracts` headers (case-insensitive), and the file is
authoritative for exactly those years: an amount > 0 upserts the
`(client, year)` row, a blank or `$0` cell deletes it, and years the file does
not mention are left untouched. A 2026-only sheet therefore updates 2026 and
keeps 2023–2025; a corrected sheet can still zero out a year. A file with no
year columns writes no revenue and returns the validation warning
``No `YYYY Contracts` columns found; revenue not changed.``
`processCSVData` attaches the file's years to every client as `revenueYears`,
and `POST /api/data/process-csv` returns them as `summary.revenueYears`.

**Reporting year (D4).** The frontend derives `reportingYear`, the latest year
in which any client has a revenue row with amount > 0, falling back to the
current calendar year (`src/utils/revenue.js`). The store sets it in the same
`set()` as `clients` (`setClients`, `fetchClients`) and clears it on logout.
`getReportingYear()`, `getClientRevenue(client, year = reportingYear)` and
`getTotalRevenue()` read it, and every "YYYY Revenue" label renders it. In
January, before the new sheet is imported, the book still shows last year
rather than $0; importing next year's sheet needs no code change.

## Strategic Value Calculation

Strategic-value scoring has a **single source of truth**: `utils/strategic.cjs`.
Every code path uses it — `data.cjs`/CSV import (via a re-export from
`clientAnalyzer.cjs`), `models/clientModel.cjs` (`listWithMetrics` /
`getWithMetrics`), `claude.cjs`, and `routes/scenarios.cjs`. Do NOT reimplement
scoring elsewhere; keep one formula so the dashboard and the AI advisor always
agree.

Current formula (clamped to 0–10):

```
strategicValue = revenueScore*0.50 + stickiness(0–10)*0.50  −  conflictPenalty
revenueScore   = min(10, mostRecentRevenue / 50000)   // $500k → 10
stickiness     = (raw 1–5 pick − 1) / 4 × 10; legacy fallbacks in getStickiness()
conflictPenalty: High = 3, Medium = 1, Low = 0
effort         = cadence weight (Daily 5 … As-Needed 0.5) × 1.5 if "handful"
```

`mostRecentRevenue` is the latest year's revenue **for that client**, resolved
from either a `revenues` array (DB shape) or a `revenue` object (frontend
shape); `revenueObjectFromRows(revenues)` builds the object form for every year
on file, and the API responses use it instead of a fixed list of years. The
helpers tolerate both snake_case and camelCase field names so all paths produce
identical numbers. `calculateStrategicValue(client)` with one argument reads
`client.revenues`; passing the rows explicitly is equivalent.

**Reporting year vs. score year (D6).** The score uses each client's own
latest revenue year. The dashboard total, cards and charts use the book-wide
reporting year (D4). They differ for a client with no row in the reporting
year: its card shows $0 for that year while its strategic value still reflects
its last year with revenue. Changing that is a scoring-semantics decision, not
Tier 0 work.

> The specific weights are under review. Adjust them in ONE place
> (`utils/strategic.cjs`) and the change propagates everywhere.

## File Structure Context

### Backend Files
- `server.cjs` - Main Express server with route registration
- `services/anthropic.cjs` - the one Anthropic client: `AI_MODEL`, `complete()`, `parseResponse()`, `describeError()`
- `claude.cjs` - the three AI Advisor routes and their prompt builders
- `routes/scenarios.cjs` - `POST /transition-plan`; its prompt and parser are the pure helpers in `utils/transitionPlan.cjs`
- `data.cjs` - Data processing API endpoints
- `clientAnalyzer.cjs` - Core business logic and calculations
- `routes/auth.cjs` - login, logout, me, change-password; the auth cookie attributes
- `config/session.cjs` - `SESSION_TTL` / `SESSION_TTL_MS`, one lifetime for the JWT and the cookie
- `middleware/rateLimit.cjs` - the four limiters (D11)
- `utils/passwordPolicy.cjs` - `validatePassword`, `validateUsername` (pure, importable from tests)
- `db.cjs` - the one `pg` pool (`DATABASE_URL`, `DATABASE_SSL`); pool errors are logged, never fatal
- `init-db.sql` - the schema, applied idempotently by `server.cjs` at every start. `clients.user_id` is `ON DELETE CASCADE`: deleting a user deletes the clients that user imported
- `create-admin.cjs`, `scripts/reset-password.cjs` - add a partner, reset a password

### Frontend Structure
- `src/App.jsx` - Main application with tab navigation
- `src/portfolioStore.js` - Zustand state management
- `src/api.js` - every API call; prefixes `VITE_API_BASE_URL`, sends the cookie (`credentials: 'include'`)
- `src/components/ui/` - Reusable UI components (button, card, etc.)
- Core feature components at `src/` root level

### Deployment, operations and docs
- `netlify.toml` - the page's Netlify build (command, publish directory, Node version) and its security headers (D13)
- `deploy/README.md` - the runbook: hosting, rebuild, deploy, rollback, partners, secrets, logs, health, uptime, remaining advisories
- `deploy/backup/` - the nightly backup (WP4) and its install and restore guides
- `.env.example` - the one environment template
- `.github/workflows/ci.yml` (lint, test, build on every PR and push to `main`), `.github/workflows/backup-selftest.yml`
- `docs/plans/tier-0.md` - the plan and its status table; `docs/archive/` - superseded status documents, history only

## Environment Configuration

### Hosting and deploying (runbook: `deploy/README.md`)
- **Frontend:** built and served by Netlify (project `client-portfolio2`, auto-deployed from `main`) at https://gbacpod.com. `netlify.toml` pins the build (`npm run build:prod`, publish `dist`, `NODE_VERSION` 22, repository root as base) and sets the page's headers: HSTS without preload, nosniff, `strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, and a CSP of `'self'` plus `connect-src https://client-portfolio-backend.onrender.com`. `VITE_API_BASE_URL` is a Netlify UI build variable, deliberately not in `netlify.toml`. No SPA redirect: there are no client-side routes.
- **CSP rules for new code:** the page may load only its own scripts, styles, images (`data:` allowed) and fonts, and may call only itself and the API. Never add `'unsafe-inline'` or `'unsafe-eval'` to `script-src`; an external font, script or API needs a deliberate `netlify.toml` change. If the API's address changes, change `VITE_API_BASE_URL`, `connect-src` and the uptime monitor together.
- **Backend:** a Render web service (`client-portfolio-backend`) running `node server.cjs` behind Render's proxy, with a Render PostgreSQL database; the browser reaches it at https://client-portfolio-backend.onrender.com. The page and the API are therefore different sites (this shapes the cookie, below). No `render.yaml` or Blueprint in Tier 0: linking one can change the live services.
- **Deploying is merging to `main`:** Netlify builds the page, and Render deploys the API if its auto-deploy is on. Then check `/api/health` and the work package's acceptance list. Pull requests get a Netlify Deploy Preview; the API has none. Rollback is per provider (runbook section 5).
- Server environment variables live in the Render dashboard, not in a `.env` file; changing one means a redeploy. Render has `FRONTEND_URL=https://gbacpod.com`, `TRUST_PROXY_HOPS=1`, `SESSION_TTL=7d` and `DATABASE_SSL=no-verify` set (confirmed 2026-09-24).
- An external uptime monitor (UptimeRobot, keyword `"status":"OK"`, every 5 minutes) watches `/api/health` once Jeff sets it up (runbook section 11).

### Server Environment Variables (`.env.example` locally, the Render dashboard in production)
- `NODE_ENV` - `production` on Render: Secure SameSite=None cookie, HTTPS redirect, `FRONTEND_URL` as the CORS allowlist
- `PORT` - Server port (defaults to 5000; Render sets its own, and the server binds `0.0.0.0`)
- `DATABASE_URL` - Postgres connection string. Do not put `?sslmode=` in it: `pg` reads it after the `ssl` option, so it overrides `DATABASE_SSL`
- `DATABASE_SSL` - `false` (default, local Postgres), `no-verify` (TLS without certificate checks; Render), or `verify` (with `DATABASE_SSL_CA=<path>` for a private CA). Any other value stops the server at startup
- `JWT_SECRET` - signs the session JWT; rotating it signs every partner out
- `SESSION_TTL` - one lifetime for the JWT and the cookie, `<number><d|h|m>`, default `7d` (D10); an invalid value falls back to `7d` with a startup warning
- `FRONTEND_URL` - the one browser origin allowed in production (`https://gbacpod.com`); unset means no browser origin is allowed, with a startup warning
- `TRUST_PROXY_HOPS` - proxies in front of the app (Render: `1`; default `0`). `req.ip`, and so every IP-keyed rate limit, depends on it: too low and all partners share the proxy's address, too high and a client can choose its own IP with `X-Forwarded-For`
- `BCRYPT_SALT_ROUNDS` - default 12
- `ANTHROPIC_API_KEY` - For AI functionality (Claude API); unset means every AI button reports "not configured"
- `AI_MODEL` - model id for every AI call (default `claude-opus-5`; `claude-sonnet-5` is the cheaper alternative, D7)

### Vite Configuration
- `src/api.js` prefixes every call with `import.meta.env.VITE_API_BASE_URL`. Production builds require an `https://` value (`vite.config.js` enforces it). For `npm run dev`, start Vite with `VITE_API_BASE_URL=http://localhost:5000`: without it the frontend calls relative `/api`, which Vite does not proxy (the `http://localhost:5000` fallback in `vite.config.js` only defines `process.env.VITE_API_BASE_URL`, which `api.js` does not read)
- Path alias `@` points to `./src`

### Auth, sessions and rate limits (WP3)
- **Cookie:** `authToken`, `HttpOnly`, `Path=/`, `Max-Age` = `SESSION_TTL` (604800 s for `7d`), the same span as the JWT's `exp`. In production `SameSite=None; Secure`, because the API (onrender.com) and the page (gbacpod.com) are different sites and a `Lax` cookie would never reach the API; in development `SameSite=Lax` (page and API are both on localhost, one site). This deviates from D10, which assumed a same-origin API. `res.clearCookie` gets the same attributes.
- **Cross-site requests:** no form-body parser (`express.json` only, 5 MB; a larger body answers 413), CORS allows only the allowlist (`FRONTEND_URL` in production, `localhost:3000`/`5173` in development) and answers other origins without CORS headers rather than with an error, and `server.cjs` refuses POST/PUT/PATCH/DELETE whose `Origin` is neither allowlisted nor the server's own with 403 (`origin_refused` log line). The origin check is what stops a cross-site form from triggering the body-less AI Advisor POSTs; do not remove it while the cookie is `SameSite=None`.
- **Rate limits (D11, `middleware/rateLimit.cjs`, express-rate-limit 8):** login 20 per 15 min per IP (`/login` and `/change-password` share it) and 5 failed per 15 min per username (case-folded; successful logins do not count); AI 30 per hour per partner and 300 per day for the firm, one budget across `/api/claude/*` and `/api/scenarios/*`, mounted after `authenticateToken`. Over the limit: 429 `{ success: false, error: 'Too many requests. Try again later.' }`, which the login page shows verbatim, and a `rate_limited` log line with the limiter and key. Counters are in memory: a redeploy resets them. A custom `keyGenerator` that falls back to the IP must wrap it in `ipKeyGenerator` (the library logs `ERR_ERL_KEY_GEN_IPV6` otherwise). Five wrong passwords lock that username for 15 minutes, including for its owner.
- **Passwords:** `POST /api/auth/change-password` `{ currentPassword, newPassword }` (the header's "Change password" dialog): 200, 400 with the policy's errors, 401 for a wrong current password. `npm run reset:password` for a forgotten one. Neither ends sessions already issued (the JWT is stateless); rotate `JWT_SECRET` to sign everyone out.
- **Database:** a dropped connection logs `{"event":"pg_pool_error",...}`; the pool reconnects on the next query and the process keeps running.
- **Health:** `GET /api/health` needs no sign-in, always answers HTTP 200, and returns `status` (`OK`, or `DEGRADED` when the database query fails or no Anthropic key is set), `timestamp`, `uptimeSeconds`, `environment` and `services` (`database`, `anthropic`, `model`). A monitor must check the body for `"status":"OK"`, not the status code.
- **Security headers:** `server.cjs` sets its own on API responses (HSTS in production, `X-Frame-Options`, nosniff, a CSP); the page's come from `netlify.toml`.

### Backups (WP4, D12)
- **Layer 1** is whatever Render provides for the database's instance type (backups, point-in-time recovery); `deploy/backup/INSTALL.md` step 1 confirms it in the dashboard. As installed on 2026-09-24 the database is Basic-256mb on PostgreSQL 18 (`PG_MAJOR=18`) and the dashboard shows no point-in-time recovery, so Layer 2 is the only backup.
- **Layer 2** runs nightly at 07:17 UTC (cron `17 7 * * *`, off the top of the hour, where GitHub delays and can drop scheduled runs; plus `workflow_dispatch`) in GitHub Actions in the **private** repository `zekusmaximus/client-portfolio-backups`, never in this public one, whose logs and artifacts anyone can read. It runs copies of `deploy/backup/pg-backup.sh` and `deploy/backup/backup.yml`; after changing either here, the copies in the private repository must be updated by hand (INSTALL.md step 5).
- **What it checks:** the row counts and the dump come from one snapshot; `users`, `clients` and `client_revenues` must exist and `users` must not be empty; `pg_dump`, production and the restore-check server must share a major version (`PG_MAJOR`); the plaintext dump is restored into a throwaway `postgres:$PG_MAJOR` container and every public table's count must match. Only then is it `age`-encrypted. Any failure fails the run, leaves no plaintext and uploads nothing, and GitHub emails the failure.
- **Retention:** each night's `client_portfolio_<UTC stamp>.dump.age` is a workflow artifact kept 90 days. The `age` private key exists only in the password manager.
- **Restore:** `deploy/backup/RESTORE.md` (download, decrypt, scratch restore, count check, production restore on Render, quarterly drill).
- **Self-test:** `.github/workflows/backup-selftest.yml` runs `deploy/backup/selftest.sh` on PostgreSQL 16, 17 and 18 with synthetic data, the happy path and every failure path. Run it locally against a throwaway server only (it creates and drops `pgb_selftest_*` databases): `SELFTEST_SERVER_URL=postgresql://postgres@127.0.0.1:5432 bash deploy/backup/selftest.sh`. A new table in `public` is counted automatically; renaming `users`, `clients` or `client_revenues` means updating the required list in `pg-backup.sh`.

## Development Notes

### State Management
- Clients come from the API (`fetchClients()` after sign-in, a CSV import, and every add, update or delete); the store holds them in memory and persists only UI state to localStorage (`partialize` in `portfolioStore.js`)
- Succession plans, partner "departing" flags and reassignments are in-memory only (review section 7; server-side persistence is Tier 2)
- AI Advisor answers live in the store (`aiResults`, `aiError`, not persisted, cleared on logout) so switching tabs, which unmounts the tab content, does not discard a paid answer
- Use `usePortfolioStore()` hook to access state in components

### API Integration
- Frontend calls backend APIs via `src/api.js`
- Backend serves both data processing and AI endpoints
- Error handling implemented throughout the stack

### Contract Status Logic
Contract periods are automatically parsed to derive status
(`deriveContractStatus(contractPeriod, now = new Date())`):
- 'IF' - In Force (current date within contract period)
- 'D' - Done (contract expired) 
- 'P' - Proposal (contract starts in future)
- 'H' - Hold (invalid/unparseable data)

## Common Development Patterns

### Adding New Client Fields
1. Update CSV processing in `clientAnalyzer.cjs:processCSVData`
2. Add field to strategic value calculation if relevant
3. Update UI forms in `ClientEnhancementForm.jsx`
4. Update state management in `portfolioStore.js`

### Adding New Visualizations
- Use Recharts library (already included)
- Add to `DashboardView.jsx` or create new component
- Follow existing chart patterns for data formatting

### AI Integration
- **Every Anthropic call goes through `services/anthropic.cjs`.** It owns the one
  client and the one model constant `AI_MODEL` (env `AI_MODEL`, default
  `claude-opus-5`, D7). Routes call
  `complete({ system, prompt, maxTokens, userId, label })` and never construct a
  client or call `messages.create` themselves; `tests/ai-grep.test.mjs` fails if
  a second call site appears.
- The request carries only `model`, `max_tokens`, `system` and `messages`. No
  sampling parameters (current models reject them), no `thinking`, no
  `output_config`. The SDK stays at 0.56.0 until Tier 1 (streaming, caching,
  refusal fallbacks).
- `parseResponse()` collects text by content-block type (current models return
  `thinking` blocks first) and flags `truncated` (`stop_reason: max_tokens`) and
  `refused`. Every AI answer is
  `{ success: true, <analysis|advice|recommendations|plan>, truncated, refused, model, usage, timestamp }`;
  the UI shows "The response was cut off; ask a narrower question." when
  `truncated` is true.
- Errors: `describeError(err)` maps SDK errors to a status and a message a
  partner can act on (503 not configured, 429 rate limited, 504 unreachable,
  503 upstream 5xx, 502 bad key or rejected request). Routes answer
  `{ success: false, error }`; `apiErrorMessage()` in `src/api.js` extracts that
  text on the frontend.
- One structured log line per call:
  `{"event":"ai_call",label,userId,model,stop,inputTokens,outputTokens,ms}`
  (`ai_error` with `status` and `message` on failure), so cost is visible in the
  server log.
- Live endpoints: `/api/claude/analyze-portfolio`, `/api/claude/strategic-advice`
  and `/api/claude/client-recommendations` (prompt builders in `claude.cjs`,
  each returning `{ system, prompt }` with the persona paragraph as `system`),
  and `POST /api/scenarios/transition-plan` (`utils/transitionPlan.cjs`; one
  client per request, the succession workflow calls it with concurrency 2 and
  shows progress, D9).
- Deleted in WP2 (D8), do not resurrect: the succession, capacity, growth and
  bulk-transition-plans scenario endpoints, the nonexistent Partnership
  "analyze" endpoint and its AI Optimize button, the Growth tab, the legacy
  succession form, `PROMPT_SETTINGS` and the three unused prompt builders.
- The AI Advisor renders answers with `react-markdown` (default settings, no raw
  HTML plugin) and keeps them in the store (`aiResults`).
- The three surviving prompts still describe fields that do not exist; the
  prompt rewrite is the first Tier 1 item (plan section 5.5).