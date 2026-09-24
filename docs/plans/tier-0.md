# Tier 0 Plan: Stabilise the Client Portfolio Dashboard

**Status:** approved plan, not started. Written 2026-09-23 against commit `3c745a6`.
**Background:** `REVIEW-2026-09.md` (read sections 1, 3, 4, 5 first). This plan turns that review's Tier 0 into work packages a future Claude Code session can execute without re-deriving anything.
**Audience:** future Claude Code sessions and Jeff. Sessions run in a cloud container with the repo but no access to the gbacpod.com server, so every work package separates "changes a session makes in the repo" from "steps Jeff runs on the server".

---

## 0. How a session uses this document

### 0.1 Read order

1. `CLAUDE.md` (architecture, commands).
2. `REVIEW-2026-09.md` sections 1, 3, 4, 5.
3. This file: section 1 (decisions), section 2 (status table), then the one work package you are executing.

### 0.2 Working agreement

- One work package (WP) per branch and per pull request, in the order WP0 → WP1 → WP2 → WP3 → WP5. WP4 (backups) is independent and its artifacts can be produced in any session; Jeff installs them (section 7: a private repository and the Render dashboard, not a server).
- Branch from `origin/main` after the previous WP has merged. Do not stack WPs on one branch.
- Before starting: `npm ci`, then `npm run lint`, `npm test`, and `VITE_API_BASE_URL=https://gbacpod.com npm run build:prod` must all pass (after WP0 they will; before WP0, lint fails and there is no test script, which is expected).
- Every WP ends with: gates green, `CLAUDE.md` updated where behaviour it documents changed, the status table in section 2 updated in the same PR, and a PR description that lists the expected outcomes from the WP and the evidence that each one holds.
- No schema migrations are needed anywhere in Tier 0. If you find yourself writing `ALTER TABLE`, stop and re-read the WP.
- Do not change the scoring weights in `utils/strategic.cjs`, do not rename database columns, do not upgrade React, Vite, or the Anthropic SDK across a major version, and do not start Tier 1 work (prompt rewrite, saving AI answers, sending the whole book) inside a Tier 0 PR.
- If a WP's instructions conflict with what you find in the code, the code wins; note the discrepancy in the PR and in section 2.

### 0.3 Session start checklist

```bash
git fetch origin
git checkout -b claude/tier0-wpN-short-name origin/main
npm ci
npm run lint            # expected: exit 0 after WP0
npm test                # expected: exit 0 after WP0
VITE_API_BASE_URL=https://gbacpod.com npm run build:prod
```

### 0.4 Optional end-to-end smoke test in the session container

The container has `psql` but no Postgres server. If `apt-get install -y postgresql` succeeds under the session's network policy, you can run the app end to end:

```bash
service postgresql start
sudo -u postgres createuser -s "$(whoami)" 2>/dev/null || true
createdb client_portfolio_dev
export DATABASE_URL=postgres://localhost/client_portfolio_dev JWT_SECRET=dev-secret NODE_ENV=development
node create-admin.cjs dev 'DevPassword1!'
node server.cjs &            # boot applies init-db.sql
curl -s localhost:5000/api/health
```

If that is not possible, rely on the unit tests plus the manual verification steps listed in each WP, and say so in the PR.

---

## 1. Decisions this plan makes

Jeff can veto any of these before a session executes them. Sessions treat them as settled.

| # | Decision | Rationale |
|---|---|---|
| D1 | Test runner is Node's built-in `node --test` (`node:test` + `node:assert/strict`), tests in `tests/*.test.mjs`. | Zero new dependencies, no Vite-version tangle (Vitest 4+ wants Vite 6+, the app is on Vite 4), works on Node 20+. Vitest can replace it later if component tests are wanted. |
| D2 | ESLint stays on the installed 8.57.1 with a classic `.eslintrc.cjs`. | No major upgrade in Tier 0; the installed plugins are for the 8.x line. |
| D3 | The lint script drops `--max-warnings 0`; errors fail the gate, warnings are informational. `react-hooks/exhaustive-deps` is a warning, `react/no-unescaped-entities` is off, `no-unused-vars` is an error with `^_` ignore patterns. | Fixing all 7 exhaustive-deps warnings can change effect behaviour; that is not Tier 0 work. |
| D4 | "Reporting year" = the latest year in which any client has a revenue row with amount > 0. Fallback: the current calendar year. All totals, charts, cards, and labels use it. | In January, before the new sheet is imported, the book must still show last year, not $0. |
| D5 | CSV import rule: the file is authoritative for the years its header contains, and only those years. Present year + amount > 0 → upsert; present year + blank/0 → delete that (client, year) row; year absent from the file → untouched. | Preserves history when a single-year sheet is imported; still lets a corrected sheet zero out a year. |
| D6 | Strategic value keeps using each client's own latest revenue year (`getMostRecentRevenue`, unchanged). The dashboard total uses the reporting year. These can differ for a client with no current-year row. | Changing score semantics is out of Tier 0 scope. Documented in `CLAUDE.md`. |
| D7 | One Anthropic model constant, `AI_MODEL`, default `claude-opus-5`, overridable by env var. | Current generation, answer quality matters more than the cents-per-question difference at this book size. `claude-sonnet-5` is the documented cheaper alternative; switching is a one-line env change. |
| D8 | Delete, do not fix: the Growth tab and `/api/scenarios/growth`, the unreachable legacy succession form and `/api/scenarios/succession`, the uncalled `/api/scenarios/capacity`, the "AI Optimize Redistribution" button and its nonexistent `/api/claude/analyze`, the three unused prompt builders and `PROMPT_SETTINGS` in `claude.cjs`. | Growth and capacity are leftovers from the original spec and not in the product brief; the brief explicitly rejects an automated swap optimiser; the legacy form is unreachable (see WP2). Code stays in git history. |
| D9 | Per-client transition plans are generated one request per client from the UI (concurrency 2) instead of one bulk request. | With a current model a plan takes 20 to 60 seconds; twenty clients in one HTTP request would exceed any sane proxy timeout. Also gives progress. |
| D10 | Auth cookie `SameSite=Lax` in all environments; session length 7 days for both JWT and cookie. | Lax closes the cross-site POST vector and works for same-origin and same-site (subdomain) API placement. Seven days suits a "log on to glance" tool with six trusted users. |
| D11 | Rate limits: login 20 per 15 min per IP and 5 failed per 15 min per username; AI endpoints 30 per hour per user and 300 per day globally. | The per-username limiter is what protects a password; the per-IP limit is loose because six partners may share one office IP. |
| D12 | Backups, in two layers. Layer 1: whatever Render provides for the database's instance type (backups, point-in-time recovery). Layer 2: a nightly `pg_dump --format=custom --no-owner --no-privileges` of the Render External Database URL (a read-only role preferred, `PGSSLMODE=require`), run by GitHub Actions in the private repository `zekusmaximus/client-portfolio-backups` and never in this one, with `postgresql-client-$PG_MAJOR` from apt.postgresql.org. Before anything is encrypted, the dump is restored into a throwaway `postgres:$PG_MAJOR` service container and the row count of every public table must equal production's; `users`, `clients` and `client_revenues` must exist and `users` must not be empty. Then `age` to one recipient, plaintext deleted, artifact kept 90 days. Schedule `0 7 * * *` plus `workflow_dispatch`. Replaces the VPS design (systemd timer, Hetzner Storage Box, 30-day local retention), 2026-09-24. | Production is a Render web service and Render PostgreSQL, so there is no server to run a timer on. This repository is public, so no job that touches production data or credentials may run in it. Client data leaves Render only encrypted, and a restore needs one private key kept in the password manager. A dump that has not restored with matching counts is never kept, so a bad backup fails loudly instead of being discovered during a restore. |
| D13 | nginx serves `dist/` and proxies `/api/` to the Node process; Express does not serve static files. Page-level security headers live in nginx. | Matches what the code implies today (`express.static` points at a nonexistent path). Confirm with the server facts in WP5 before writing the config. |
| D14 | The root-level status markdown files move to `docs/archive/` in WP5. | They mislead sessions; `CODE_REVIEW.md` in particular leads with an overruled finding. |

---

## 2. Status table (sessions update this)

| WP | Title | Status | Branch / PR | Notes |
|---|---|---|---|---|
| WP0 | Quality gates and the crash fix | merged | `claude/tier0-wp0-quality-gates`, [PR #10](https://github.com/zekusmaximus/client-portfolio/pull/10) | baseline lint was 104 problems in 32 files (97 errors, `.cjs` included), not the 100 in 3.1; all errors fixed, the 7 `exhaustive-deps` warnings remain by design (D3) |
| WP1 | Year-agnostic revenue | merged | `claude/tier0-wp1-year-agnostic-revenue`, [PR #11](https://github.com/zekusmaximus/client-portfolio/pull/11) | no Postgres in the session container, so the database half of 4.4 is Jeff's on the server and `tests/strategic.test.mjs` stands in for the score regression; `calculateStrategicValue(client)` now honours `client.revenues` (argument resolution, the D6 formula is unchanged); `benchmark-csv.cjs` and one export footnote were hard-coded years that 4.1 missed |
| WP2 | AI: stop the bleeding | deployed | `claude/tier0-wp2-ai-stop-the-bleeding`, [PR #12](https://github.com/zekusmaximus/client-portfolio/pull/12) | 5.1 line numbers were taken at `3c745a6` and had moved; where the plan and the code differed, the code won: (1) `createTransitionPlanPrompt`/`parseTransitionPlanResponse` live in the pure module `utils/transitionPlan.cjs`, because `routes/scenarios.cjs` loads `utils/jwt.cjs` through the auth middleware and cannot be imported from tests; (2) SDK 0.56.0 error constructors need a `Headers` instance, so the plan's `new Anthropic.RateLimitError(429, {}, 'x', {})` throws and the tests pass `new Headers()`; (3) `succession-scenario.tsx` moved to `src/components/succession/SuccessionScenario.tsx` because the 5.4 grep pattern `scenarios/succession` matched its own import path; (4) `.env.example` had no `ANTHROPIC_API_KEY` line to keep, so one was added with `AI_MODEL`; (5) Stage 1 holds partner ids, so the UI sends `stage1Data` as `{ selectedPartners: <names>, impactData }` rather than the whole Stage 1 object; (6) `apiErrorMessage()` was added to `src/api.js` (the plan said no change needed) for both AI callers; (7) `client-recommendations` keeps `client` (the name) in its response because the AI Advisor now remounts with store-held answers; `p-limit` is now unused and left for WP5's dependency sweep. No Postgres and no key in the container, so the live half of 5.4 is Jeff's after deploy |
| WP3 | Server hardening | merged | `claude/tier0-wp3-server-hardening`, [PR #13](https://github.com/zekusmaximus/client-portfolio/pull/13) | Hosting confirmed 2026-09-24: page on Netlify (gbacpod.com), API on Render (client-portfolio-backend.onrender.com) behind Render's proxy, Render PostgreSQL, env vars in the Render dashboard. **D10 deviation:** page and API are different sites, so a `Lax` cookie would never reach the API; the cookie is `SameSite=None; Secure` in production and `Lax` in development, 7 days for both JWT and cookie as D10 says, and the first 6.4 item reads `SameSite=None; Secure` in production. Where the plan and the code differed, the code won: (1) 6.1 line numbers were taken at `3c745a6`; `server.cjs` had moved down one line (WP2's import), the rest matched; (2) `callback(null, false)` and dropping the form parser do not stop a cross-site form POST from reaching a route, and the AI Advisor's analyze-portfolio and strategic-advice routes need no body (reproduced: a form POST from a foreign origin with a partner's cookie reached the Anthropic call), so `server.cjs` also answers POST/PUT/PATCH/DELETE from a foreign `Origin` with 403, in its own commit; (3) express-rate-limit 8.7.0 logs `ERR_ERL_KEY_GEN_IPV6` for a `keyGenerator` that falls back to `req.ip` without `ipKeyGenerator`, so the fallbacks use it, keys carry `user:`/`ip:` prefixes, and `loginIpLimiter` keeps the library's default key; with `X-Forwarded-For` present and `trust proxy` unset it logs `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` and keeps running, it does not refuse as 6.2.6 says; (4) `pg` applies an `sslmode` in `DATABASE_URL` over the `ssl` option, so `.env.example` drops `?sslmode=require`; an unrecognised `DATABASE_SSL` stops startup; (5) the error handler keeps body-parser 4xx statuses (413 over 5 MB, 400 for malformed JSON) instead of answering 500; (6) the password policy returns errors for non-string input instead of throwing, and `create-admin.cjs` also hashes through `utils/hash.cjs`; (7) `.env.example` also gains `NODE_ENV` and `FRONTEND_URL`; the variables 6.2.9 removes lived only in the two deleted files; (8) express-rate-limit brings `ip-address` and moves `debug` 4.4.1 → 4.4.3; (9) section 9's manual deploy assumes a VPS: on Render the variables WP3 needs are already set and deploying is a redeploy. D11 consequence: a succession run over more than 30 clients in an hour lists the rest as failed with the 429 text. Verified end to end in the container on Postgres 16 (PR); the production `Secure` flag and `TRUST_PROXY_HOPS=1` behind Render's real proxy are Jeff's after deploy. Status is `merged`, not `deployed`: the WP4 session (2026-09-24) could not run the `uptimeSeconds` check, because the session container's proxy refuses CONNECT to client-portfolio-backend.onrender.com (403) |
| WP4 | Backups | PR open | `claude/tier0-wp4-backups` | **Re-scoped 2026-09-24 (D12 rewritten, section 7 rewritten):** the plan's design assumed a VPS (systemd timer, Hetzner Storage Box, local retention). Production is a Render web service with Render PostgreSQL, so no host exists to run a timer, and this repository is public, so its Actions logs and artifacts cannot hold production data or credentials. Layer 1 is Render's own backups; Layer 2 runs in the private repository `zekusmaximus/client-portfolio-backups` from copied files. Where the plan and the code differed, the code won: (1) the counts and the dump share one exported snapshot (psql holds a REPEATABLE READ transaction, `pg_dump --snapshot`), so a write during the run cannot cause a false mismatch; the self-test proves it and fails when `--snapshot` is removed; (2) on PostgreSQL 16 a non-superuser table owner cannot `GRANT pg_read_all_data` ("Only roles with the ADMIN option"), so `INSTALL.md` falls back to table-level `SELECT` grants, verified to back up and to refuse writes; (3) beyond the brief, the script refuses a non-empty restore target (which also keeps a misconfigured `RESTORE_CHECK_URL` from writing into production), requires `pg_dump`, production and the restore-check server to share a major version, and refuses an `age` private key in `AGE_RECIPIENT` without printing it; (4) render.com and docs.github.com were unreachable from the session (proxy 403), so every Render-specific step reads "confirm in the Render dashboard" with the documentation URL, and no Render plan or retention numbers are stated; (5) `deploy/backup/.gitattributes` forces LF, so a copy made on Windows still runs under bash. Verified in the container on PostgreSQL 16; CI runs the self-test on 16, 17 and 18. Jeff's: instance type, key pair, private repository, secret and variables, first run, restore drill |
| WP5 | Deployment as code, docs, cleanup | not started | | needs server facts (5.1) |

Status values: `not started`, `in progress (session date)`, `PR open`, `merged`, `deployed`, `verified on gbacpod.com`.

---

## 3. WP0: Quality gates and the crash fix

**Effort:** one session.
**Expected outcomes:**

- `npm run lint` exits 0 (warnings allowed, errors not) and catches undefined identifiers, unused variables, and hook misuse from now on.
- `npm test` exists, runs in under five seconds, and every later WP adds to it.
- GitHub Actions runs lint, test, and the production build on every PR and push to `main`.
- The one runtime crash the linter found is fixed: `src/components/succession/ClientReviewInterface.jsx:327` renders `<Save>` without importing it, so clicking "Edit" on a transition plan throws a `ReferenceError` and, with no error boundary above it, blanks the page.

### 3.1 Current state

- No ESLint config anywhere; `npm run lint` fails with "couldn't find a configuration file", so `npm run deploy:check` can never pass.
- No test runner, no `test` script, no `tests/` directory, no `.github/`.
- A dry run of ESLint with a classic config (recommended + react + react-hooks) on 2026-09-23 found 100 problems in 24 files: 62 `no-unused-vars`, 16 `react/no-unescaped-entities`, 10 `no-case-declarations` (the `switch` in `portfolioStore.js:385-493`), 7 `react-hooks/exhaustive-deps`, 4 `no-useless-escape`, 1 `react/jsx-no-undef` (the `Save` bug).

### 3.2 Changes

1. **`.eslintrc.cjs`** (new, at repo root; it must be `.cjs` because `package.json` has `"type": "module"`):

   ```js
   module.exports = {
     root: true,
     env: { browser: true, es2022: true, node: true },
     extends: [
       'eslint:recommended',
       'plugin:react/recommended',
       'plugin:react/jsx-runtime',
       'plugin:react-hooks/recommended',
     ],
     ignorePatterns: ['dist', 'node_modules', 'docs'],
     parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
     settings: { react: { version: '18.3' } },
     plugins: ['react-refresh'],
     rules: {
       'react/prop-types': 'off',
       'react/no-unescaped-entities': 'off',
       'react-refresh/only-export-components': 'warn',
       'react-hooks/exhaustive-deps': 'warn',
       'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
     },
     overrides: [
       { files: ['**/*.cjs'], parserOptions: { sourceType: 'script' }, env: { node: true, browser: false } },
       { files: ['tests/**'], env: { node: true } },
     ],
   };
   ```

2. **`package.json` scripts:** `"lint": "eslint . --ext js,jsx,cjs"`, `"test": "node --test tests/"`, and `"deploy:check": "npm run lint && npm test && npm run build:prod"`. Remove the `security:check-ssl` one-liner (it duplicates what `vite.config.js` enforces).

3. **Fix the lint errors.** Expected work: remove roughly 62 unused imports and variables (mostly icon imports in `src/`), wrap the `case` bodies in `portfolioStore.js` in braces, fix or escape the four `no-useless-escape` regex cases, and import `Save` from `lucide-react` in `ClientReviewInterface.jsx`. Do not "fix" `exhaustive-deps` warnings in this WP.

4. **`tests/smoke.test.mjs`:** one test that imports `utils/strategic.cjs` and asserts `calculateStrategicValue({ revenues: [{ year: 2025, revenue_amount: 250000 }], stickiness: 4, conflict_risk: 'Low' })` equals `6.25` (revenue 5.0 × 0.5 + stickiness 7.5 × 0.5 − 0). This proves the runner works and freezes the current formula. Importing `.cjs` from `.mjs` works via default import (`import strategic from '../utils/strategic.cjs'`). Never import `db.cjs`, `data.cjs`, `models/*`, or `utils/jwt.cjs` from tests: they throw at load time without `DATABASE_URL` / `JWT_SECRET`.

5. **`.github/workflows/ci.yml`:**

   ```yaml
   name: ci
   on:
     pull_request:
     push:
       branches: [main]
   jobs:
     check:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: 22, cache: npm }
         - run: npm ci
         - run: npm run lint
         - run: npm test
         - run: VITE_API_BASE_URL=https://gbacpod.com npm run build:prod
   ```

6. **`CLAUDE.md`:** replace "No specific test framework is configured" with the `npm test` / `tests/*.test.mjs` convention and the rule about not importing DB-backed modules in tests.

### 3.3 Acceptance

- [ ] `npm run lint` exits 0; `npx eslint . --ext js,jsx,cjs -f unix | grep -c Error` prints 0.
- [ ] `npm test` exits 0 with at least one passing test.
- [ ] `VITE_API_BASE_URL=https://gbacpod.com npm run build:prod` exits 0.
- [ ] CI workflow is green on the PR.
- [ ] `grep -n "Save" src/components/succession/ClientReviewInterface.jsx | head -1` shows it in the `lucide-react` import.

### 3.4 Risks

Removing "unused" variables can remove something referenced only inside JSX that ESLint failed to see; run the build after the cleanup and open each modified component's tab in the dev server if a database is available. Do not delete exports from `src/utils/*` even if unused inside the repo.

---

## 4. WP1: Year-agnostic revenue

**Effort:** one session.
**Expected outcomes:**

- Importing the firm's 2026 sheet (columns `CLIENT, Contract Period, 2024 Contracts, 2025 Contracts, 2026 Contracts`) shows 2026 figures in the header total, the dashboard cards and charts, the client cards, and the AI tab, and the 2023-2025 rows are still in the database.
- Importing a sheet that contains only a `2026 Contracts` column updates 2026 and touches nothing else.
- Every label that says "2025 Revenue" today says "2026 Revenue" automatically, and in January 2027 still says 2026 until 2027 data exists.
- Strategic values for every client are byte-identical before and after the change for unchanged data (D6).
- The upload screen explains the column rule instead of listing three fixed years.

### 4.1 Current state (evidence)

| Where | What is hard-coded |
|---|---|
| `clientAnalyzer.cjs:147-151` | parses only `2023 Contracts`, `2024 Contracts`, `2025 Contracts` |
| `clientAnalyzer.cjs:187-189` | zero-revenue warning sums only those three keys |
| `data.cjs:357-394` | CSV revenue write: `DELETE` all of a client's rows, then `INSERT` the file's years |
| `data.cjs:601-608, 720-727, 856-863` | API responses build `revenue = { '2023': 0, '2024': 0, '2025': 0 }` and drop other years |
| `models/clientModel.cjs:54-61, 91-94` | same, for the AI and scenario paths |
| `src/portfolioStore.js:643-650` | `getClientRevenue` returns the row whose year is the string `'2025'` |
| `src/ClientListView.jsx:338`, `src/AIAdvisor.jsx:414`, `src/DashboardView.jsx:386` | literal "2025 Revenue" labels |
| `src/DataUploadManager.jsx:95-101, 207` | expected-columns help text |
| `utils/strategic.cjs:56-79` | already year-agnostic (max year present); leave alone |

No frontend code reads the `revenue` object by year (verified by grep on 2026-09-23); the frontend reads the `revenues` array.

### 4.2 Changes

**Backend**

1. **`utils/csvImport.cjs`** (new, pure, no `db.cjs` import):
   - `extractRevenueYears(headers)`: returns sorted integer years for headers matching `/^\s*((?:19|20)\d{2})\s+contracts?\s*$/i`.
   - `parseAmount(cell)`: strips `$`, `,`, whitespace; parentheses mean negative; blank → 0; non-numeric → 0.
   - `planRevenueWrites(clients, years)`: input `[{ id, revenue: { [year]: amount } }]` and the years the file covered; output `{ upserts: [[id, year, amount]], deletes: [[id, year]] }` following D5.
2. **`clientAnalyzer.cjs`:** `processCSVData(csvData)` derives years from the header keys of the first row via `extractRevenueYears(Object.keys(row))`, builds `revenue` for exactly those years, and returns them as `revenueYears` on each client (or attach to the array; pick one and document it). `validateClientData` sums all keys of `revenue`. Add an optional `now` parameter to `deriveContractStatus(contractPeriod, now = new Date())` so tests are deterministic; behaviour unchanged.
3. **`data.cjs` `/process-csv`:** replace the delete-then-insert block with `planRevenueWrites`, then:
   - one `INSERT INTO client_revenues (client_id, year, revenue_amount) VALUES ... ON CONFLICT (client_id, year) DO UPDATE SET revenue_amount = EXCLUDED.revenue_amount, updated_at = CURRENT_TIMESTAMP` for all upserts (the `UNIQUE(client_id, year)` constraint already exists in `init-db.sql`);
   - one `DELETE FROM client_revenues r USING unnest($1::uuid[], $2::int[]) AS d(client_id, year) WHERE r.client_id = d.client_id AND r.year = d.year` for all deletes.
   - If the file has no year columns, skip revenue writes and add a validation warning "No `YYYY Contracts` columns found; revenue not changed."
   - Add `revenueYears` to the response `summary`.
4. **`utils/strategic.cjs`:** add and export `revenueObjectFromRows(revenues)` → `{ [year]: amount }` for every row. Use it in `data.cjs` (three places) and `models/clientModel.cjs` (two places) instead of the fixed three-year object.

**Frontend**

5. **`src/utils/revenue.js`** (new, pure): `computeReportingYear(clients)` per D4; `revenueForYear(client, year)` reads `client.revenues`.
6. **`src/portfolioStore.js`:** add `reportingYear` state, set it whenever `clients` is set (`fetchClients`, `setClients`, `logout` resets to null); `getReportingYear()`; `getClientRevenue(client, year = get().reportingYear)`; `getTotalRevenue()` unchanged in shape. Existing one-argument call sites keep working.
7. **Labels:** `ClientListView.jsx`, `AIAdvisor.jsx`, `DashboardView.jsx` read `reportingYear` from the store and render `{reportingYear} Revenue`. `DataUploadManager.jsx`: expected columns become `CLIENT`, `Contract Period`, and "one `YYYY Contracts` column per year (for example `2025 Contracts`, `2026 Contracts`)"; the example row shows two years; add one sentence stating D5 in plain words. Show `summary.revenueYears` in the success message ("Imported years: 2025, 2026").

**Docs**

8. **`CLAUDE.md`:** document the reporting-year rule (D4), the CSV year rule (D5), and the D6 caveat under "Strategic Value Calculation" and "Data Flow".

### 4.3 Tests (`tests/`)

- `csv-import.test.mjs`: `extractRevenueYears` on `['CLIENT','Contract Period','2024 Contracts','2026 contracts ','Notes']` → `[2024, 2026]`; `parseAmount` on `'$72,000.00'`, `''`, `'(1,000)'`, `'n/a'`; `planRevenueWrites` for present-positive, present-zero, and absent years; `processCSVData` with a 2026-only header yields a one-key `revenue`.
- `contract-status.test.mjs`: `deriveContractStatus('1/1/26-12/31/26', new Date('2026-09-23'))` → `IF`; `'1/1/25-12/31/25'` → `D`; `'1/1/27-12/31/27'` → `P`; `'expires 12/31/26'` → `IF`; `'garbage'` → `H`.
- `reporting-year.test.mjs`: mixed years → max with amount > 0; a lone zero-amount 2027 row is ignored; no data → current calendar year.
- `strategic.test.mjs`: extend the WP0 fixture with a client whose `revenues` has 2025 and 2026 rows and assert the 2026 amount drives the score; assert `revenueObjectFromRows` round-trips.

### 4.4 Acceptance

- [ ] All tests above pass; lint and build green.
- [ ] `grep -rn "'2025'\|\"2025\"\|2025 Contracts\|2023 Contracts" --include=*.cjs --include=*.js --include=*.jsx src *.cjs models utils | grep -v tests` returns nothing except the `DataUploadManager` example text.
- [ ] With a database: import a fixture CSV with 2024-2026 columns, then re-import a 2026-only CSV; `SELECT year, count(*) FROM client_revenues GROUP BY 1` still shows 2024 and 2025 rows; the header total equals the sum of 2026 amounts.
- [ ] Score regression: before the change, `node -e` dump of `{name, strategicValue}` for all clients from `GET /api/data/clients`; after, identical (if no database, the `strategic.test.mjs` fixture stands in).

### 4.5 Not in scope

The two status vocabularies and CSV overwriting a manually set status (`data.cjs:241`) are Tier 2. The retired columns the CSV path still writes (`data.cjs:165-167, 287-352`) are harmless and stay.

---

## 5. WP2: AI, stop the bleeding

**Effort:** one to two sessions.
**Expected outcomes:**

- Every remaining AI button either produces an answer or a specific error message. Nothing 404s, nothing silently discards output, nothing runs on a retired model.
- No Anthropic call is made whose result the UI cannot display.
- All calls go through one module with one model constant; `temperature` no longer appears anywhere; responses are read by content-block type; truncation is detected and shown.
- The AI Advisor tab keeps its answers when the partner switches tabs and comes back.
- "Generate Plans" in the succession workflow produces real plans, one client at a time, with visible progress.
- Each AI call writes one structured log line with model, input/output tokens, duration, and user id, so cost is visible in the server log.

### 5.1 Current state (evidence)

See `REVIEW-2026-09.md` section 3.1 for the full table. Verified 2026-09-23:

- `succession-scenario.tsx` only reaches its `/api/scenarios/succession` call from the "Legacy Stage 2" form, rendered when `currentStage === 'mitigation' && !stage1Data` (line 293). `handleProceedToStage2` (line 45) always sets `stage1Data` before entering that stage, so the form and the endpoint are unreachable.
- `ScenarioModeler.jsx` Growth tab: `setResults(response.data)` (line 126) with a backend that never sets `data`; `departingLobbyists`/`departureAnalysis` (lines 30, 59-102) are never set by any control.
- `RedistributionModeler.jsx:253-266` renders the "AI Optimize Redistribution" button that calls `requestAIOptimization` in `PartnershipAnalytics.jsx:97-277` → `POST /api/claude/analyze` (404).
- `routes/scenarios.cjs:153` uses `claude-3-5-sonnet-20241022` (retired 2025-10-28), `temperature: 0.7`, and its prompt reads `client.average_revenue` (line 623), a key that does not exist on frontend client objects (`averageRevenue` does).
- `ClientReviewInterface.jsx:612-620` uses a bare `fetch` with a relative URL and `Authorization: Bearer null`; it works only if the API is same-origin and cookies ride along by default.
- Two Anthropic clients (`claude.cjs:50-71`, `scenarios.cjs:46-60`), both accepting `OPENAI_API_KEY`.
- `PROMPT_SETTINGS` (`claude.cjs:8-45`) unused; `createSuccessionScenarioPrompt`, `createCapacityScenarioPrompt`, `createGrowthScenarioPrompt` (`claude.cjs:793-1373`) unused.
- `AIAdvisor.jsx` keeps `results` in component state; the custom `TabsContent` (`src/components/ui/tabs.jsx:70`) returns `null` when inactive, unmounting the component.
- `formatAIResponse` (`AIAdvisor.jsx:143-158`) cannot render the `## HEADING` markdown the prompts request.

### 5.2 Changes

**A. One AI service: `services/anthropic.cjs`** (new)

```js
const { Anthropic } = require('@anthropic-ai/sdk');

const AI_MODEL = process.env.AI_MODEL || 'claude-opus-5';
const DEFAULT_MAX_TOKENS = 16000;          // thinking tokens count against this on current models
const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
const client = apiKey ? new Anthropic({ apiKey, timeout: 180_000, maxRetries: 2 }) : null;

function isConfigured() { return client !== null; }

// Pure: turn a Messages API response into what routes need. Unit-test this.
function parseResponse(res) {
  const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return {
    text,
    truncated: res.stop_reason === 'max_tokens',
    refused: res.stop_reason === 'refusal',
    stopReason: res.stop_reason,
    model: res.model,
    usage: res.usage,
  };
}

async function complete({ system, prompt, maxTokens = DEFAULT_MAX_TOKENS, userId, label }) {
  if (!client) { const e = new Error('AI not configured'); e.code = 'AI_NOT_CONFIGURED'; throw e; }
  const started = Date.now();
  const res = await client.messages.create({
    model: AI_MODEL,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: prompt }],
  });
  const out = parseResponse(res);
  console.log(JSON.stringify({ event: 'ai_call', label, userId, model: out.model, stop: out.stopReason,
    inputTokens: out.usage?.input_tokens, outputTokens: out.usage?.output_tokens, ms: Date.now() - started }));
  return out;
}

// Map SDK errors to an HTTP status and a message a partner can act on.
function describeError(err) {
  if (err?.code === 'AI_NOT_CONFIGURED') return { status: 503, message: 'AI is not configured on the server (missing API key).' };
  if (err instanceof Anthropic.AuthenticationError) return { status: 502, message: 'The AI service rejected the server\'s API key.' };
  if (err instanceof Anthropic.RateLimitError) return { status: 429, message: 'The AI service is rate-limiting us. Try again in a minute.' };
  if (err instanceof Anthropic.APIConnectionError) return { status: 504, message: 'Could not reach the AI service. Try again.' };
  if (err instanceof Anthropic.APIError && err.status >= 500) return { status: 503, message: 'The AI service is temporarily unavailable.' };
  if (err instanceof Anthropic.APIError) return { status: 502, message: `AI request rejected (${err.status}).` };
  return { status: 500, message: 'AI request failed.' };
}

module.exports = { AI_MODEL, isConfigured, complete, parseResponse, describeError };
```

Notes for the implementer: the installed SDK is 0.56.0; do not upgrade it in this WP (Tier 1 does, together with server-side refusal fallbacks and prompt caching, which need a newer SDK). Do not pass `temperature`, `top_p`, `thinking`, or `output_config`; `model`, `max_tokens`, `system`, `messages` are supported by every SDK version and every current model. The 16,000-token default stays under the SDK's non-streaming timeout guard.

**B. `claude.cjs`**

- Delete lines 8-71 (settings + client init) and 793-1373 (unused prompt builders); import the service.
- The three routes call `complete({ system: <the "You are a senior..." first paragraph of each prompt>, prompt: <the rest>, userId: req.user.userId, label: 'portfolio-analysis' | 'strategic-advice' | 'client-recommendations' })`. Moving the persona sentence into `system` is the only prompt change allowed in this WP.
- Response shape: `{ success: true, analysis|advice|recommendations: text, truncated, refused, model, usage, timestamp }`. On error: `const { status, message } = describeError(err); res.status(status).json({ success: false, error: message })`.
- Remove the per-route "client not initialised / malformed" checks; `complete` throws `AI_NOT_CONFIGURED` and `describeError` maps it.
- Remove the emoji step-by-step `console.log` lines in `/analyze-portfolio`; the `ai_call` log line replaces them.

**C. `routes/scenarios.cjs`**

- Delete `/succession`, `/capacity`, `/growth`, `calculateSuccessionMath`, `calculateCapacityMath`, `calculateGrowthMath`, the three `get*Analysis` functions, `aiCache`, `getCacheKey`, `getCachedAnalysis`, and the client init.
- Replace `/bulk-transition-plans` with `POST /transition-plan` taking `{ client, stage1Data }` for one client. Validate that `client.id` and `client.name` are strings and `stage1Data` is an object; otherwise 400. Build the prompt with `createTransitionPlanPrompt(client, stage1Data)` (renamed from `createBulkTransitionPlanPrompt`) after fixing its field reads: `client.averageRevenue` (not `average_revenue`), `client.stickinessScore` (replacing `relationshipStrength`), `client.effort`, `client.interaction_frequency`, `client.high_maintenance`; keep `successionRisk`, `transitionComplexity`, `relationshipType`, `practiceArea`, `primary_lobbyist`. Call `complete({ ..., maxTokens: 8000, label: 'transition-plan' })`. Parse with the existing `parseTransitionPlanResponse`; return `{ success: true, plan: { clientId, clientName, ...parsed, truncated } }`.
- Keep `router._setAnthropicClient` out; tests cover `parseTransitionPlanResponse` and `parseResponse` directly.

**D. `server.cjs` health check:** `anthropic: isConfigured() ? 'configured' : 'not configured'`, plus `model: AI_MODEL`. Drop the `OPENAI_API_KEY` mention.

**E. Frontend**

- `ClientReviewInterface.jsx` `handleGeneratePlans`: iterate the selected client ids with concurrency 2 (a tiny inline pool; do not add a dependency), `apiClient.post('/scenarios/transition-plan', { client, stage1Data })` per client, merge each returned plan into `transitionPlans` as it arrives, keep a `progress` state `{ done, total, failed: [] }` and render "Generating plan n of m" plus a list of failures with the server's `error` message. Remove the raw `fetch`, the `localStorage.getItem('token')` header, and the `bulk-transition-plans` reference.
- `succession-scenario.tsx`: delete the legacy Stage 2 form (lines 292-437 region), `runScenario`, and the `results`/`aiInsights`/`isLoading`/`error` state that only it used. Keep the stepper and the three real stages. Delete `SuccessionPlanningWorkflow.jsx` (imports the same component, is imported by nothing).
- `ScenarioModeler.jsx`: remove the Growth tab, `calculateGrowthScenario`, `scenarioParams`, `results`, `departingLobbyists`, `departureAnalysis`, and the results card. What remains is the header card and `<SuccessionScenario portfolioId="default" />`. If the tab list has one entry, drop the `Tabs` wrapper.
- `PartnershipAnalytics.jsx`: remove `requestAIOptimization`, `aiLoading`, the `onRequestAI`/`aiLoading` props, the `DOMPurify` import, and the `apiClient` import if unused. `RedistributionModeler.jsx`: remove the AI button block (lines 253-266) and the two props.
- `AIAdvisor.jsx`: move `results` and `error` into the store as `aiResults`/`aiError` (not in `partialize`); render with `react-markdown` (`npm i react-markdown@^10`; default settings, no raw-HTML plugin); when `truncated` is true show "The response was cut off; ask a narrower question." under the answer; when the server returns `success: false`, show its `error` text as is.
- `src/api.js`: no change needed; `post` already throws with the response body text on non-2xx. Make sure `AIAdvisor` extracts the JSON `error` from that text when present (it currently shows the raw message).

**F. Environment and docs**

- `.env.example`: add `AI_MODEL=claude-opus-5   # or claude-sonnet-5`, keep `ANTHROPIC_API_KEY`.
- `CLAUDE.md`: the AI section lists the four live endpoints (`/api/claude/analyze-portfolio`, `/strategic-advice`, `/client-recommendations`, `/api/scenarios/transition-plan`), the service module, the model constant, and the rule "every Anthropic call goes through `services/anthropic.cjs`".

### 5.3 Tests

- `ai-service.test.mjs`: `parseResponse` with `[thinking, text]` blocks returns only the text; `stop_reason: 'max_tokens'` → `truncated: true`; `'refusal'` → `refused: true`; empty content → `text: ''`. `describeError` maps a constructed `Anthropic.RateLimitError` to 429 (construct via `new Anthropic.RateLimitError(429, {}, 'x', {})` if the constructor signature allows; otherwise test the `AI_NOT_CONFIGURED` branch and the generic fallback only).
- `transition-plan.test.mjs`: `parseTransitionPlanResponse` on a fixture markdown with all six headings extracts strategy, successor, `timelineDays` 60 from "60 days", five tasks max, and the template; on empty text returns the documented defaults.
- Grep assertions (in CI via a test that reads files, or just in acceptance): no `temperature` in any `.cjs`; no `claude-3-5` or `claude-sonnet-4` model ids anywhere outside `docs/`.

### 5.4 Acceptance

- [ ] `grep -rn "temperature\|claude-3-5\|claude-sonnet-4\|OPENAI_API_KEY\|/api/claude/analyze\|bulk-transition-plans\|scenarios/growth\|scenarios/capacity\|scenarios/succession" --include=*.cjs --include=*.js --include=*.jsx --include=*.tsx --exclude-dir=node_modules --exclude-dir=docs .` returns nothing.
- [ ] `grep -rn "anthropic.messages.create\|new Anthropic(" --include=*.cjs --exclude-dir=node_modules .` returns only `services/anthropic.cjs`.
- [ ] Lint, tests, build green; `wc -l claude.cjs routes/scenarios.cjs` drops by roughly 700 lines combined.
- [ ] With a database and a key (dev box or Jeff's verification after deploy): the three AI Advisor actions return rendered markdown with real headings; switching to Dashboard and back keeps the answer; the succession workflow's "Generate Plans" for three clients shows "1 of 3", "2 of 3", "3 of 3" and three non-error plans; the server log shows one `ai_call` line per call with token counts.
- [ ] With `ANTHROPIC_API_KEY` unset: every AI button shows "AI is not configured on the server (missing API key)." and `/api/health` reports `anthropic: not configured`.
- [ ] The Scenarios tab shows only the succession workflow; the Partnership tab has no AI button.

### 5.5 Not in scope (Tier 1)

Rewriting the prompts, sending the whole book with stickiness/effort/partner data, prompt caching, streaming, saving answers to a table, the SDK upgrade, and refusal fallbacks. The three surviving prompts still talk about fields that do not exist; that is accepted for now and is the first Tier 1 item.

---

## 6. WP3: Server hardening

**Effort:** one session.
**Expected outcomes:**

- A cross-site form cannot act as a logged-in partner (cookie `SameSite=Lax`, no form-body parser).
- A password can only be guessed at 5 attempts per 15 minutes; six partners on one office IP do not lock each other out.
- AI spend is capped per user and per day regardless of UI bugs or double clicks.
- A forgotten password is fixed with one command on the server; partners can change their own password in the app.
- Sessions last exactly as long as the cookie says (7 days), no longer.
- One dropped database connection no longer kills the server process.
- Rate limiting and HTTPS detection work correctly behind nginx (`trust proxy`).
- The health endpoint tells the truth about AI configuration.

### 6.1 Current state (evidence)

- `routes/auth.cjs:24-29`: `sameSite: 'none'` in production; `maxAge` 24h; `utils/jwt.cjs:6`: `expiresIn: '7d'`.
- `server.cjs:104`: `express.urlencoded` enabled; `server.cjs:103`: JSON limit 50 MB; no `app.set('trust proxy')`; `server.cjs:62-72`: `*.onrender.com` CORS branch; `server.cjs:83-89`: CORS mismatch calls `callback(new Error(...))`, which turns a same-origin POST with a stale `FRONTEND_URL` into a 500.
- No rate limiter anywhere; `express-rate-limit` not installed. `.env.production.example` advertises `RATE_LIMIT_*` variables nothing reads.
- `db.cjs:14-17`: `pool.on('error', () => process.exit(-1))`; `db.cjs:11`: `rejectUnauthorized: false` whenever `NODE_ENV=production`.
- No password change or reset path; `create-admin.cjs` exits if the username exists; its `validatePassword`/`validateUsername` are exported but only used there.

### 6.2 Changes

1. **`config/session.cjs`** (new): `SESSION_TTL = process.env.SESSION_TTL || '7d'`; `SESSION_TTL_MS` parsed from it (support `d`, `h`, `m` suffixes; 7 days default). `utils/jwt.cjs` uses `SESSION_TTL`; `routes/auth.cjs` cookie uses `SESSION_TTL_MS`.
2. **`routes/auth.cjs`:** `sameSite: 'lax'` unconditionally in both `res.cookie` and `res.clearCookie`; `secure: NODE_ENV === 'production'` stays. Add `POST /change-password` (behind `authenticateToken`): body `{ currentPassword, newPassword }`; verify current with `compare`, validate new with the shared policy, `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`; 200 `{ success: true }`; 400 with the policy's error list; 401 on wrong current password.
3. **`utils/passwordPolicy.cjs`** (new): move `validatePassword` and `validateUsername` out of `create-admin.cjs`; `create-admin.cjs` imports them.
4. **`scripts/reset-password.cjs`** (new): `node scripts/reset-password.cjs <username> <newPassword>`; validates, hashes with `utils/hash.cjs`, updates by username, prints "Updated 1 user" or "No such user" (exit 1). npm script `reset:password`.
5. **`middleware/rateLimit.cjs`** (new, `npm i express-rate-limit@^8`):
   - `loginIpLimiter`: `windowMs: 15*60*1000, limit: 20`, keyed by `req.ip`.
   - `loginUserLimiter`: `windowMs: 15*60*1000, limit: 5, skipSuccessfulRequests: true, keyGenerator: (req) => String(req.body?.username || '').trim().toLowerCase() || req.ip`.
   - `aiUserLimiter`: `windowMs: 60*60*1000, limit: 30, keyGenerator: (req) => String(req.user?.userId ?? req.ip)`.
   - `aiGlobalLimiter`: `windowMs: 24*60*60*1000, limit: 300, keyGenerator: () => 'global'`.
   - All: `standardHeaders: 'draft-7', legacyHeaders: false, handler: (req, res) => res.status(429).json({ success: false, error: 'Too many requests. Try again later.' })`.
   - Mount: `router.post('/login', loginIpLimiter, loginUserLimiter, ...)` in `routes/auth.cjs`; in `claude.cjs` and `routes/scenarios.cjs`, `router.use(authenticateToken); router.use(aiUserLimiter); router.use(aiGlobalLimiter);`. Also put `loginIpLimiter` on `/change-password`.
6. **`server.cjs`:**
   - `const hops = parseInt(process.env.TRUST_PROXY_HOPS || '0', 10); if (hops > 0) app.set('trust proxy', hops);` before any middleware. (`express-rate-limit` refuses to run if `X-Forwarded-For` is present and `trust proxy` is unset; with nginx in front this must be `1`.)
   - Delete `express.urlencoded`; `express.json({ limit: '5mb' })`.
   - CORS: production allowlist is `[process.env.FRONTEND_URL].filter(Boolean)`; development stays the localhost list; on mismatch `callback(null, false)` (no headers, no error); log a startup warning if `NODE_ENV=production` and `FRONTEND_URL` is unset. Delete the Render branch and the "insecure origin" check (the build already enforces HTTPS).
   - Delete the dead `express.static('../frontend/build')` line and the commented catch-all; delete the duplicate `/api/auth` mount.
   - Health: as in WP2 D; add `uptimeSeconds`.
7. **`db.cjs`:** `pool.on('error', (err) => console.error(JSON.stringify({ event: 'pg_pool_error', message: err.message })))`. SSL from `DATABASE_SSL`: `'false'`/unset → `false`; `'no-verify'` → `{ rejectUnauthorized: false }`; `'verify'` → `{ rejectUnauthorized: true, ca: process.env.DATABASE_SSL_CA ? fs.readFileSync(...) : undefined }`. Remove the `NODE_ENV` coupling. `create-admin.cjs` and `scripts/reset-password.cjs` reuse `db.cjs` instead of building their own pool (they must `require('dotenv').config()` first).
8. **Frontend:** `LoginPage.jsx` shows the server's 429 text verbatim. Add a minimal "Change password" form (current, new, confirm) reachable from the header's logout area (a small modal or an inline card on a new "Account" menu item is fine). Client-side check that new and confirm match; server enforces the policy.
9. **`.env.example`:** add `SESSION_TTL=7d`, `TRUST_PROXY_HOPS=1`, `DATABASE_SSL=false`, and remove the never-read `RATE_LIMIT_*`, `SECURE_COOKIES`, `COOKIE_DOMAIN`, `JWT_REFRESH_SECRET`. Delete `.env.development.example` and `.env.production.example`; one `.env.example` with comments is enough (WP5 finalises it).
10. **`CLAUDE.md`:** environment variable list updated; new `reset:password` script documented; rate-limit numbers documented.

### 6.3 Tests

- `password-policy.test.mjs`: policy accepts `'Str0ng!pass'`, rejects short, no-digit, no-symbol; username rules.
- `session-ttl.test.mjs`: `'7d'` → 604,800,000 ms; `'12h'`; invalid → default.
- Rate limiting and cookies are verified manually (below); do not add `supertest`.

### 6.4 Acceptance

- [ ] Login response header contains `Set-Cookie: authToken=...; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax` (plus `Secure` in production).
- [ ] Six consecutive wrong-password POSTs for one username return 429 on the sixth; a different username on the same IP still gets 401 (not 429).
- [ ] `curl -X POST -H 'Content-Type: application/x-www-form-urlencoded' --data 'name=x' https://gbacpod.com/api/data/clients` returns 401 (unauthenticated) and, when replayed with a valid cookie, 400 or an empty-body error, never a created client.
- [ ] `grep -n "urlencoded\|onrender\|frontend/build" server.cjs` returns nothing.
- [ ] `node scripts/reset-password.cjs <user> 'NewPass1!'` prints "Updated 1 user"; login works with the new password; the in-app change-password flow works and rejects a wrong current password.
- [ ] Killing the Postgres connection (`pg_terminate_backend` on the app's connection) logs `pg_pool_error` and the next request succeeds; the process does not exit.
- [ ] `/api/health` on production shows `anthropic: configured`, `model`, `database: connected`.

### 6.5 Risks

`trust proxy` set to `1` when there is no proxy (local dev) makes Express trust a spoofable header; that is why it is env-driven and defaults to 0. If Jeff's server has nginx and another layer (Cloudflare), the hop count is 2; confirm in WP5's facts.

---

## 7. WP4: Backups

**Re-scoped 2026-09-24.** The first version of this section assumed a VPS: a systemd timer, an `rsync` or `rclone` copy to a Hetzner Storage Box, 30 days of local retention. Production has no such server. The API is a Render web service and the database is Render PostgreSQL (`CLAUDE.md`, Environment Configuration), and this repository is public, so its Actions logs and artifacts cannot touch production data or credentials. D12 records the replacement decision; this section describes what was built.
**Effort:** one session for the artifacts; about an hour of Jeff's time to install (`deploy/backup/INSTALL.md`) and run the first restore drill (`deploy/backup/RESTORE.md`).
**Expected outcomes:**

- Every night an encrypted `pg_dump` of the production database lands off-box: outside Render, as a workflow artifact in the private repository `zekusmaximus/client-portfolio-backups`, kept 90 days.
- A documented restore has been performed once, into a scratch database, and the row counts matched production.
- The two secrets that a rebuild would need (the `age` private key and the server's environment values, which live in the Render dashboard) are in the firm's password manager.
- A bad deploy, a disk failure, or a fat-finger delete costs at most one day of edits.

### 7.1 Design

- **Layer 1: Render.** Whatever Render provides for the database's instance type (backups, point-in-time recovery). Nothing is installed; `INSTALL.md` step 1 has Jeff confirm the instance type and its features in the dashboard, and says what to do if it is Free. Render-specific facts are cited by URL and confirmed in the dashboard, not restated.
- **Layer 2: a nightly logical backup in GitHub Actions**, in the private repository only, at `0 7 * * *` (07:00 UTC, about 3 am Eastern) and on `workflow_dispatch`. `deploy/backup/backup.yml` runs `deploy/backup/pg-backup.sh`. Both files are copied into the private repository, so the job that holds production credentials never runs code fetched from this public one. The job:
  1. installs `postgresql-client-$PG_MAJOR` from apt.postgresql.org (`PG_MAJOR` is a repository variable read off the Render dashboard) and `age`;
  2. in one REPEATABLE READ transaction, counts the rows of every table in the public schema of production (secret `BACKUP_DATABASE_URL`, the External Database URL, preferably a read-only role, `PGSSLMODE=require`) and runs `pg_dump --format=custom --no-owner --no-privileges --snapshot=<that transaction's snapshot>`, so the counts describe exactly what the dump holds;
  3. fails if `users`, `clients` or `client_revenues` is missing or `users` is empty (a dump of the wrong database), or if `pg_dump`, production and the restore-check server are not the same major version;
  4. restores the plaintext dump into an empty database on a throwaway `postgres:$PG_MAJOR` service container and requires identical counts for every table;
  5. only then encrypts the dump with `age` to one recipient (variable `AGE_RECIPIENT`; the private key exists only in the password manager), deletes the plaintext, and uploads `client_portfolio_<UTC stamp>.dump.age` as an artifact with `retention-days: 90`.
- **Failure signal:** any error exits non-zero, a trap deletes the plaintext and any partial output, and no artifact is uploaded. GitHub's failure email is the alarm. A run that never starts sends no email; the quarterly drill (RESTORE.md (f)) checks the latest run's date.
- **Recovery point:** at most one day from Layer 2; finer where Layer 1 offers point-in-time recovery.

### 7.2 Deliverables (in this repository)

| File | What it is |
|---|---|
| `deploy/backup/pg-backup.sh` | the backup (bash, `set -euo pipefail`, `umask 077`, configuration from environment variables only, never prints a connection string) |
| `deploy/backup/backup.yml` | the workflow Jeff copies into the private repository's `.github/workflows/`; not under `.github/workflows/` here |
| `deploy/backup/selftest.sh` | end-to-end self-test against a throwaway server with synthetic data |
| `.github/workflows/backup-selftest.yml` | runs the self-test on PostgreSQL 16, 17 and 18 for pull requests and pushes to `main` that touch `deploy/backup/**`, `init-db.sql` or the workflow; no secrets, no artifacts, no connection to Render |
| `deploy/backup/INSTALL.md` | Jeff's steps in PowerShell: instance type, optional read-only role, external access, key pair, private repository, secret and variables, first run |
| `deploy/backup/RESTORE.md` | download, decrypt, scratch restore, count comparison, production restore on Render (Render's path first, then from a dump), quarterly drill table |
| `deploy/backup/.gitattributes` | LF line endings, so the files still run under bash after a Windows copy |

### 7.3 Tests

`deploy/backup/selftest.sh` seeds `init-db.sql` plus synthetic rows, backs them up with an `age` key generated at runtime, decrypts and restores the output, and checks the counts. It also checks that a write during the dump does not cause a false mismatch. Each failure path must exit non-zero with its own message, leave no `.dump.age` and no plaintext, and print no connection string or private key: unreachable database, wrong password (when a password-checking server is available), missing variable, invalid recipient, a private key given as the recipient, restore target equal to the source, empty source, source without users, `pg_dump` failing inside the snapshot, a non-empty restore target, a count mismatch, and output that is not `age`. `shellcheck` covers both scripts; `actionlint` covers both workflows.

### 7.4 Acceptance (Jeff)

- [ ] Instance type, PostgreSQL major version and Layer 1 features confirmed in the Render dashboard (`INSTALL.md` step 1) and written into section 2; a Free instance upgraded.
- [ ] Key pair generated; the private key is in the password manager and `INSTALL.md` step 4's round trip printed `round trip ok`.
- [ ] `zekusmaximus/client-portfolio-backups` exists, is private, and holds `pg-backup.sh`, `.github/workflows/backup.yml` and `.gitattributes`.
- [ ] Secret `BACKUP_DATABASE_URL` (a read-only role where Render allows one) and variables `PG_MAJOR` and `AGE_RECIPIENT` set; artifact retention at least 90 days; failure emails on.
- [ ] First manual run green, its log shows `row counts match`, and the artifact downloaded.
- [ ] Restore drill per `RESTORE.md` (a) to (d): counts match the run's log; first row of the drill table filled in.
- [ ] The Render environment values are in the password manager.
- [ ] The next scheduled run is green.
- [ ] Section 2 status set to `verified on gbacpod.com` with the drill date.

### 7.5 Not in scope

A second copy outside GitHub, monitoring beyond GitHub's failure email, and anything in WP5.

---

## 8. WP5: Deployment as code, docs, and cleanup

**Effort:** one session after the facts in 8.1 are supplied; about an hour of Jeff's time to switch the server over.
**Expected outcomes:**

- The repo contains everything needed to rebuild gbacpod.com on a fresh VPS: nginx site config, systemd unit, deploy script, environment template, and a runbook.
- Deploying is one command that pulls, installs, builds, tests, restarts, and checks health; rolling back is one command.
- The page is served with real security headers (HSTS, CSP, no-sniff, frame denial) from nginx, and API calls that take a minute or more are not cut off by the proxy.
- An external uptime monitor watches `/api/health`.
- `CLAUDE.md` describes the system as it is; the stale status documents are archived; `README.md` explains the real deployment.

### 8.1 Facts a session needs from the server first

Jeff runs this on the VPS and pastes the output into the session (values only, never the contents of `.env`):

```bash
cat /etc/os-release | head -2; node --version; npm --version; nginx -v; psql --version
systemctl list-units --type=service | grep -i -E 'portfolio|node|pm2'; pm2 ls 2>/dev/null; ps -eo user,cmd | grep -E 'node|server.cjs' | grep -v grep
ls -la /etc/nginx/sites-enabled/; sudo cat /etc/nginx/sites-enabled/*gbacpod* 2>/dev/null
readlink -f "$(dirname "$(sudo find / -name server.cjs -path '*client-portfolio*' -not -path '*/node_modules/*' 2>/dev/null | head -1)")"
ls -la <app dir>/.env && sed -E 's/=.*/=<redacted>/' <app dir>/.env
sudo -u postgres psql -c '\l' | grep -i portfolio; grep -E '^(listen_addresses|ssl)' /etc/postgresql/*/main/postgresql.conf
sudo certbot certificates 2>/dev/null | grep -E 'Name|Expiry'
```

Plus three answers: does nginx serve `dist/` or proxy everything to Node; is there anything in front of nginx (Cloudflare, Hetzner load balancer); what `VITE_API_BASE_URL` was used for the current build.

### 8.2 Deliverables

1. **`deploy/nginx/gbacpod.com.conf`:** HTTP → HTTPS redirect; `root <app dir>/dist; try_files $uri /index.html;` for the SPA; `location /api/ { proxy_pass http://127.0.0.1:5000; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_read_timeout 300s; client_max_body_size 6m; }`; headers: `Strict-Transport-Security "max-age=31536000; includeSubDomains"` (no `preload` unless Jeff wants to submit the domain), `X-Content-Type-Options nosniff`, `Referrer-Policy strict-origin-when-cross-origin`, `Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"`; gzip for text assets; `location = /api/health` allowed without rate limits. If the CSP breaks a chart or the login form, relax `style-src` or `img-src` first, never `script-src`.
2. **`deploy/systemd/client-portfolio.service`:** `User=<app user>`, `WorkingDirectory=<app dir>`, `EnvironmentFile=<app dir>/.env`, `ExecStart=/usr/bin/node server.cjs`, `Restart=always`, `RestartSec=3`, `Environment=NODE_ENV=production`, hardening: `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=full`, `ProtectHome=read-only` (adjust if the app dir is under `/home`).
3. **`deploy/deploy.sh`:** `set -euo pipefail`; `cd <app dir>`; `git fetch origin && git checkout main && git pull --ff-only`; `npm ci`; `npm run lint && npm test`; `VITE_API_BASE_URL=https://gbacpod.com npm run build:prod`; `git tag -f "deploy-$(date -u +%Y%m%dT%H%M)"`; `sudo systemctl restart client-portfolio`; `sleep 2; curl -fsS https://gbacpod.com/api/health | tee /dev/stderr | grep -q '"status":"OK"'`. And **`deploy/rollback.sh <tag>`:** checkout the tag, rebuild, restart, health check.
4. **`.env.example`** (single file): `NODE_ENV`, `PORT`, `DATABASE_URL`, `DATABASE_SSL`, `JWT_SECRET` (with `openssl rand -base64 48` hint), `SESSION_TTL`, `FRONTEND_URL`, `TRUST_PROXY_HOPS`, `ANTHROPIC_API_KEY`, `AI_MODEL`; build-time `VITE_API_BASE_URL` documented separately.
5. **`deploy/README.md`** (the runbook): first-time server setup, deploy, rollback, backups (link to WP4), restore, add a partner (`create-admin.cjs`), reset a password, rotate `JWT_SECRET` (logs everyone out), rotate the Anthropic key, read the logs (`journalctl -u client-portfolio -f`), what `/api/health` fields mean, and the uptime monitor (UptimeRobot or similar on `https://gbacpod.com/api/health`, expect `"status":"OK"`, 5-minute interval, email alert).
6. **Cleanup:** `git mv` `CODE_REVIEW.md`, `CSV-UPSERT-IMPLEMENTATION.md`, `DASHBOARD-STATUS-UPDATE.md`, `GROWTH-SCENARIO-FIX.md`, `HTTPS-DEPLOYMENT-GUIDE.md`, `JAVASCRIPT-ERROR-FIXES.md`, `JWT-SECURITY-MIGRATION.md`, `PERFORMANCE.md`, `PRACTICE-AREA-FIX.md`, `REFACTOR-SUMMARY.md`, `REMOVAL_LOG.md`, `REVENUE-CONTRACT-FIXES.md`, `SECURITY-VALIDATION.md`, `SETUP-SECURITY.md`, `VALIDATION-SECURITY-IMPLEMENTATION.md`, `Client Portfolio Optimization Dashboard.md`, the `DELIVERY COMPLETE` file, `Pasted_content_01.txt`, `todo.md` into `docs/archive/`; delete `benchmark-csv.cjs`, `scripts/verify-ai-cache-perf.cjs` (its subject was deleted in WP2), `scripts/security-check.js`, `src/debug-console.js` (and its import in `main.jsx`), and the unused dependencies `multer`, `jwt-decode`, `uuid`, `dompurify`, `react-router-dom`, `class-variance-authority`, `react-dropzone`, `node-fetch` (verify each with a grep before removing; `isomorphic-dompurify` stays if `src/utils/validation.js` still uses it). Run `npm audit fix` (non-breaking) and record the remaining advisories in the runbook. Keep `PRODUCT_BRIEF.md`, `REVIEW-2026-09.md`, `README.md`, `CLAUDE.md`, `docs/plans/` at their current locations.
7. **`README.md`** rewritten to: what it is, how to run locally, how it is deployed (link to `deploy/README.md`), where the plan lives. **`CLAUDE.md`** brought fully in line: real tab list (six tabs including Partnership), real endpoints, real formula, the test and lint commands, the plan pointer.

### 8.3 Acceptance

- [ ] Jeff applies the nginx config (`nginx -t` then reload) and the systemd unit; the site behaves identically; `curl -sI https://gbacpod.com | grep -i -E 'strict-transport|content-security|x-content-type'` shows the headers; the browser console shows no CSP violations on any tab.
- [ ] `deploy/deploy.sh` run end to end on the server succeeds and prints the health JSON; `deploy/rollback.sh` to the previous tag succeeds.
- [ ] Uptime monitor configured and one test alert received.
- [ ] `ls *.md` at the repo root shows only `CLAUDE.md`, `PRODUCT_BRIEF.md`, `README.md`, `REVIEW-2026-09.md`.
- [ ] `npm ls --depth=0` shows none of the removed packages; lint, test, build green.

---

## 9. Deploying a merged WP before WP5 exists

Until `deploy/deploy.sh` lands, Jeff deploys each merged WP by hand:

```bash
cd <app dir> && git pull --ff-only origin main
npm ci
VITE_API_BASE_URL=https://gbacpod.com npm run build:prod
# restart however the process is managed today (systemctl restart ... / pm2 restart ...)
curl -s https://gbacpod.com/api/health
```

Then run that WP's acceptance list on the live site and set its status to `verified on gbacpod.com`. WP3 needs two new `.env` lines before restart: `TRUST_PROXY_HOPS=1` and `SESSION_TTL=7d`; WP2 optionally `AI_MODEL`.

---

## 10. Definition of done for Tier 0

Tier 0 is complete when all of the following are true on gbacpod.com:

1. The header, dashboard, cards, and AI tab show the current reporting year's revenue, and importing the next year's sheet needs no code change.
2. Every AI control either answers or explains why not; the model is current; the server log shows token counts per call.
3. Login is rate-limited per username, the cookie is `SameSite=Lax`, partners can change their own passwords, and a reset is one command.
4. A nightly encrypted backup exists off-box and one restore drill has succeeded.
5. `deploy/` can rebuild the server from scratch, `deploy.sh` deploys, CI blocks broken PRs, and `npm run lint && npm test` pass on `main`.
6. `CLAUDE.md`, `README.md`, and this file's status table describe reality.

What Tier 0 deliberately leaves broken or weak (for the Tier 1 and Tier 2 plans): prompts that reference nonexistent fields and see only five clients; AI answers not saved or shared; succession plans and partner assignments living in one browser; the two status vocabularies; succession-risk metrics reading wrong field names; validation rules not applied on the live write path; storage-time HTML escaping; the hard-coded partner roster.

---

## 11. Tier 1 and Tier 2 previews (separate plans to be written after Tier 0 merges)

**Tier 1, the AI rebuild (three to five days):** upgrade `@anthropic-ai/sdk`; send the whole book with the real axes and the per-partner table; replace the consulting-deck prompts with one "ask the book" prompt plus one structured brief; prompt caching on the stable book; streaming; refusal fallbacks; an `ai_answers` table with cost per answer; the AI tab shows recent answers to all partners.

**Tier 2, a shared six-partner tool (about a week):** `partners` table replacing `src/constants.js`; `updated_by` and a change log on clients; server-side succession plans and reassignments; one status vocabulary; validation on the live write path; delete the second scoring formula and the three dead `/api/data` endpoints; fix the succession-metric field reads; remove `sanitizeRequestBody`; contract tests per API route.
