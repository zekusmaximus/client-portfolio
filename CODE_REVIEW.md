# Fitness-for-Purpose Audit — Client Portfolio Optimization Dashboard

**Audit date:** 2026-06-18
**Auditor:** Senior staff engineer (read-only review)
**Scope:** Whole repository, static analysis only (no code executed, no tests run)

---

## Executive Summary

### Verdict
**This codebase does not meet its goal today, and the single biggest reason is that it has no working multi-tenant data isolation.** Every authenticated user can read, edit, delete, upload-over, and AI-analyze *every other user's* confidential client data. The `clients` table has a `user_id` column and the application *looks* like it scopes by user — routes pass `req.user.userId` into model calls and the AI endpoint even logs `"Fetching clients for user: <id>"` — but the model and data-layer functions silently drop that argument and run unfiltered `SELECT ... FROM clients` queries. For a product whose entire reason to exist is holding privileged government-relations / attorney client relationships and revenue, this is disqualifying. The git history (`e27e086 all users see all data`, `77f7434 database auth issue fix`, `9868d1c more user authorization database debug logs`) shows this was noticed and never actually fixed.

Beyond that, the application's *core metric* — "strategic value" — is computed by three different algorithms with three different weightings depending on which code path runs, and none of them match the formula documented in `CLAUDE.md`. The thing the app exists to calculate is not calculated consistently.

The codebase is a working prototype with a lot of scaffolding (auth, validation, security headers, CSV upsert, AI integration) but the scaffolding hides that the load-bearing logic is broken.

### Top 3 Highest-Leverage Changes
1. **Enforce `user_id` scoping on every query** (Critical, ~1 day). Add `WHERE user_id = $n` to all reads/updates/deletes in `data.cjs`, set `user_id` on every insert, and make `clientModel.cjs` actually use the `userId` its callers already pass. This is the difference between a demo and a product you can let two customers touch.
2. **Collapse strategic-value scoring to one implementation and reconcile it with the docs** (High, ~0.5 day). Delete two of the three copies; make the surviving one match `CLAUDE.md` (or update the docs to match the code). Right now the headline number is non-deterministic across endpoints.
3. **Delete the dead/duplicate data layer and the ~30 loose root-level scripts** (High, ~0.5 day). `routes/clients.cjs` + `clientModel` write path is broken and unused (frontend uses `/api/data/*`); 18 `test-*.js` files at root are not a test suite and there is no test runner. This dead weight is actively hiding the real bugs.

### Most Critical Risk
**Confidential cross-tenant data exposure (IDOR + missing row-level scoping).** Likelihood: certain the moment a second user exists. Impact: catastrophic (privileged client lists, revenue, lobbyist assignments leaked between law-firm users; regulatory/ethical exposure). Mitigation: item #1 above, plus an integration test that logs in as user B and asserts it cannot see user A's clients.

---

## Phase 1 — Discovery

### Inferred Context (not stated in prompt; inferred from code/docs)
- **Project name:** Client Portfolio Optimization Dashboard (`README.md`, `CLAUDE.md`).
- **Goal:** Let government-relations / lobbying attorneys import their book of business (CSV), score each client's "strategic value," visualize the portfolio, model business scenarios (succession, capacity, growth), and get Claude-generated strategic advice.
- **Intended users:** Individual attorneys / small firm partners managing a client portfolio. The presence of `users`/login implies **multi-tenant** (multiple independent users on one deployment).
- **Current stage:** Prototype trending toward production. Deployment docs target Render (`HTTPS-DEPLOYMENT-GUIDE.md`, `db.cjs` Render SSL note). Not production-ready (see findings).
- **Tech stack:** React 18 + Vite + Zustand + Tailwind/Shadcn (frontend); Node + Express 5 + PostgreSQL (`pg`) + JWT-in-cookie auth + Anthropic SDK (backend).
- **Definition of done (inferred):** A deployable, multi-user tool where each attorney sees only their own portfolio, gets consistent scores, and reliable AI advice.

### Entry Points & Data Flow
- **Backend entry:** `server.cjs` (port 5000). Registers `/api/auth`, `/api/clients`, `/api/revenues`, `/api/scenarios`, `/api/claude`, `/api/data`. Initializes DB tables from `init-db.sql` on boot (`server.cjs:173`).
- **Frontend entry:** `index.html` → `src/main.jsx` → `src/App.jsx` (tab navigation). State in `src/portfolioStore.js` (Zustand + `persist`).
- **Primary data flow (the *active* one):**
  1. CSV uploaded client-side, parsed with PapaParse in `src/DataUploadManager.jsx`, POSTed as JSON to `/api/data/process-csv` (`data.cjs:120`).
  2. CRUD via `src/portfolioStore.js` → `/api/data/clients` GET/POST/PUT/DELETE (`portfolioStore.js:84,118,136,153`).
  3. AI via `src/AIAdvisor.jsx` → `/api/claude/*`.
  4. Scoring in `clientAnalyzer.cjs` (for `/api/data`) and `utils/strategic.cjs` (for `/api/clients`).
- **A second, largely DEAD data flow exists:** `routes/clients.cjs` + `models/clientModel.cjs` + `utils/strategic.cjs`. `src/api.js` exports `postClient/putClient/deleteClient` but `portfolioStore.js` does **not** call them — it calls `/api/data/*`. So `/api/clients` is dead for writes (and broken — see Correctness §).

### External Services / Secrets
- **PostgreSQL** via `DATABASE_URL` (`db.cjs:3`). SSL `rejectUnauthorized: false` in prod (`db.cjs:11`).
- **Anthropic API** via `ANTHROPIC_API_KEY` (falls back to `CLAUDE_API_KEY` or, oddly, `OPENAI_API_KEY` — `claude.cjs:52`, `server.cjs:146`). Confidential client portfolio summaries are sent to Anthropic.
- **JWT secret** via `JWT_SECRET` (`utils/jwt.cjs:2`, throws if missing — good).
- **No real secrets are committed.** `.env*` are ignored (`.gitignore`), only `.env.*.example` templates are tracked. `cookies.txt` is an empty curl template. ✅

### Build / Run / Test Story (as it actually exists)
- **Run frontend:** `npm run dev` (Vite). **Run backend:** `npm start` (`node server.cjs`).
- **Build:** `npm run build`; prod build *requires* `VITE_API_BASE_URL` and enforces HTTPS (`vite.config.js`). ✅
- **Lint:** `npm run lint` → `eslint . --ext js,jsx --max-warnings 0`, but **there is no ESLint config file** (no `.eslintrc*`, no `eslintConfig` in `package.json`). With ESLint 8 this fails to run, which means **`npm run deploy:check` (which gates on lint) is broken.** (`package.json` scripts; confirmed absence of config.)
- **Tests:** **No test framework, no `test` script.** There are 18 root-level `test-*.js`/`.cjs` files (e.g. `test-upsert-logic.js`, `test-strategic-value.cjs`) that are ad-hoc scripts, plus duplicates (`test-strategic-value.js` *and* `.cjs`; `test-integration-upsert.js` *and* `.cjs`). None run under a harness or in CI. Critical paths (auth scoping, scoring, CSV upsert) have **no automated coverage**.

### Churn Hotspots (`git log` name-only)
`data.cjs` (12), `server.cjs` (10), `portfolioStore.js` (9), `claude.cjs` (8), `.claude/settings.local.json` (8), `DashboardView.jsx` (7), `ClientListView.jsx` (7). The hotspots are exactly the files with the bugs below — `data.cjs` and `claude.cjs` churn reflects repeated, unsuccessful attempts to fix auth/scoring (commit messages `database debug`, `database auth issue fix`, `daqtabase debug`).

### Grep Results
- **TODO/FIXME/HACK:** none found in source.
- **Hardcoded secrets:** none found (all keys read from `process.env`). ✅
- **Debug logging:** heavy emoji-laden `console.log` throughout `claude.cjs` (29), `server.cjs` (15), `data.cjs` (8), including logging full request bodies (`routes/clients.cjs:30,60`) and user IDs/JWT contents (`claude.cjs:164`). Noisy and leaks PII into logs.

### What the project is trying to do, in my words
It's a single-purpose analytics dashboard for a lobbyist/attorney to answer "which of my clients are worth my time, what's my revenue risk, and what should I do about it," backed by an LLM advisor. The ambition is clear and the UI surface is broad (succession planning, partnership analytics, scenario modeling). The problem is that the foundation — *whose data is this, and what is each client worth* — is not solid.

### Where docs/naming/comments disagree with the code
- **`CLAUDE.md` strategic-value formula vs. code.** Docs say Revenue 20% / Relationship 30% / Strategic fit 15% / Renewal 15% / Crisis 10% / Growth 10%. Neither implementation matches: `clientAnalyzer.cjs:118` uses 50/35/15 (no growth, no fit, no crisis); `utils/strategic.cjs:48` uses 45/20/25/10 (growth yes, fit/crisis no). "Crisis management" and "strategic fit" weights described in docs **do not exist in code at all.**
- **`claude.cjs:170` logs `"Fetching clients for user: <userId>"`** but `clientModel.listWithMetrics(userId)` ignores `userId` and fetches all users' clients (`clientModel.cjs:108`). The log actively lies.
- **`clientAnalyzer.cjs:32` comment:** "Use current date: July 12, 2025 as specified" but code uses `new Date()`. Stale comment.
- **`CLAUDE.md`** says backend AI routes are under `/api/claude/*` and lists endpoints, but the frontend `PartnershipAnalytics.jsx:172` calls `/api/claude/analyze`, **which does not exist** (only `/strategic-advice`, `/analyze-portfolio`, `/client-recommendations` are defined — `claude.cjs:82,137,252`). That feature is a guaranteed 404.
- **`server.cjs:120`** serves static files from `../frontend/build` — a path that does not exist in this repo layout (the frontend builds to `dist/` here). Dead/incorrect.

---

## Phase 2 — Evaluation

### 1. Goal Alignment / Fitness for Purpose (lead)

**[CRITICAL] `data.cjs` (all `/clients` handlers) + `models/clientModel.cjs` — no `user_id` scoping; complete loss of tenant isolation.**
- Evidence: `data.cjs:578` GET `/clients` runs `SELECT c.* FROM clients c LEFT JOIN client_revenues ...` with **no `WHERE user_id`**. `data.cjs:664` POST inserts a client **without a `user_id` column at all** (so rows get `NULL`). `data.cjs:786` UPDATE and `data.cjs:894` DELETE filter only by `id`. In the model path, `clientModel.cjs:5` `listWithRevenues = async () =>` takes no args; `clientModel.cjs:24` `create = async (data)` hardcodes `VALUES (1, ...)` (every client owned by user 1); `clientModel.cjs:61/79/83` `update/remove/get` filter by `clientId` only.
- Why it matters for the goal: the product holds confidential, ethically-protected client books for *multiple* attorneys. With no scoping, user B sees and mutates user A's clients. This is the difference between shippable and not.
- Fix: thread `req.user.userId` into every query: `WHERE user_id = $n` on read/update/delete, `user_id` in every insert. Add a Postgres `NOT NULL` constraint on `clients.user_id` and consider RLS as defense-in-depth. Then add a cross-user integration test.

**[CRITICAL] `claude.cjs:173 / 106 / 285` AI endpoints analyze *all* users' data.** `clientModel.listWithMetrics(userId)` ignores the arg (`clientModel.cjs:108` → unfiltered `listWithRevenues()`), so portfolio summaries built from *the entire database* are sent to Anthropic and returned to whichever user asked. Cross-tenant leak **and** confidential-data egress at the same time. Fix: same scoping fix in the model; the endpoints already pass `userId`.

**[CRITICAL] `data.cjs:120` CSV upsert merges across all tenants by client *name*.** `data.cjs:164` `SELECT ... FROM clients WHERE LOWER(name) = ANY($1)` matches against the **global** client pool with no `user_id`. Two users (or two firms) with a client named "City of Springfield" will silently overwrite each other's records, and enhancements get cross-contaminated (`data.cjs:192-236`). Fix: scope the existence query and all writes by `user_id`; match on `(user_id, name)`.

**[HIGH] The core metric is computed three incompatible ways.** `clientAnalyzer.cjs:90` (active for `/api/data`), `utils/strategic.cjs:10` (active for `/api/clients` and AI), and the `CLAUDE.md` spec all disagree (see doc-mismatch list). `utils/strategic.cjs` additionally uses **min-max normalization across the current set** (`utils/strategic.cjs:28`), so a single client's "strategic value" *changes when other clients are added or removed* — the number is not a stable property of the client. For a decision-support tool, an unstable, path-dependent headline metric undermines the entire value proposition. Fix: one scoring module, deterministic normalization (fixed baselines, not relative), reconciled with documented weights.

**[MEDIUM] Over-build relative to a broken core.** There is a large surface (`src/components/succession/*`, `partnership/*`, `scenarios/*` including `-fixed`, `-new`, and original variants of `capacity-optimization` and `growth-modeling`) layered on top of a data layer that doesn't isolate tenants or score consistently. Effort is going into breadth while the foundation leaks. Candidate for freeze-and-fix-core.

### 2. Architecture & Design

**[HIGH] Two parallel, divergent data layers.** `/api/data/*` (raw SQL in `data.cjs`, scoring via `clientAnalyzer.cjs`) and `/api/clients` (`routes/clients.cjs` → `clientModel.cjs`, scoring via `utils/strategic.cjs`). The frontend uses only the former. The latter is partly broken: `routes/clients.cjs:31` calls `clients.create(req.user.userId, req.body)` but `clientModel.create(data)` takes **one** arg, so `data` becomes the numeric userId and every field is `undefined` — a create through this path inserts an all-null row. This duplication is the root cause of the scoring inconsistency and the churn. Fix: pick one (the `models/` + router pattern is cleaner once scoped), delete the other.

**[MEDIUM] `src/components/scenarios/` ships dead variants.** `capacity-optimization.tsx`, `capacity-optimization-new.tsx`, `capacity-optimization-fixed.tsx`, plus the same trio for `growth-modeling`. Only one of each can be wired up. The others are confusion-as-code. Fix: delete the unused variants.

**[MEDIUM] Mixed module systems and file types.** `.cjs` backend, `.js`/`.jsx` frontend, scattered `.ts`/`.tsx` (`src/lib/ai-service.ts`, `src/types/scenario.ts`, scenario components) with a `tsconfig.json` but a JS-only lint script and no typecheck in any build step. TypeScript is present but not enforced — false sense of safety.

### 3. Correctness & Robustness

**[HIGH] `routes/clients.cjs` create path is non-functional** (see Architecture above) — `clientModel.create` argument mismatch produces null rows.

**[MEDIUM] `data.cjs:641` connection handling is fragile.** `const client = db.pool.connect();` is the *unawaited promise*; every use is `(await client)`. If `connect()` rejects, the `finally { (await client).release() }` (`data.cjs:756`) throws a second error and the pooled client may leak. Same pattern in PUT/DELETE handlers. Fix: `const client = await db.pool.connect();` once, with try/finally on the resolved client.

**[MEDIUM] Contract-status parsing is locale/format-fragile.** `clientAnalyzer.cjs:60` `new Date("M/D/YY")` relies on JS engine parsing of ambiguous 2-digit years and `M/D/YY`; results vary and silently fall back to `'H'`. Revenue strings are stripped with `replace(/[$,]/g,'')` (`clientAnalyzer.cjs:218`) — parentheses-negatives, "k"/"M" suffixes, or blank cells aren't handled. For a CSV-import-first product this is a primary failure surface with **no tests**.

**[MEDIUM] `data.cjs:148` recomputes scores on every read** and `processCSVData` assigns random non-UUID ids (`clientAnalyzer.cjs:224` `'client_' + Math.random()`) that are then discarded — harmless but indicates the in-memory model and the DB model were never reconciled.

**[LOW] Validation gaps in `data.cjs` write paths.** `/api/data/clients` POST/PUT do **not** use `clientValidationRules` (those are only wired to the dead `routes/clients.cjs`). The active create/update path accepts arbitrary `status`, unvalidated `revenues`, etc., relying only on `sanitizeRequestBody`.

### 4. Security

**[CRITICAL] Cross-tenant IDOR** — covered in §1 (the dominant security issue).

**[HIGH] `sanitizeRequestBody` HTML-escapes data at storage time, corrupting it.** `middleware/validation.cjs:189` recursively `validator.escape()`s every string in every request body, so `"Smith & Co"` is stored as `"Smith &amp; Co"`, `O'Brien` as `O&#x27;Brien`. The app then carries a `decodeHTMLEntities` function (`clientAnalyzer.cjs:7`) and multiple "html parsing" commits / `test-html-decode.js` to undo it on the way out. This is the wrong layer: escaping belongs at *render* time (React already escapes), not at persistence. It both mangles data and provides a false sense of XSS protection while leaving stored values double-encoded. Fix: remove storage-time HTML escaping; rely on parameterized queries (already used) for SQLi and on React/`DOMPurify` for output.

**[MEDIUM] CORS allows any `*.onrender.com` origin in production.** `server.cjs:69` `if (origin.includes('.onrender.com')) return callback(null, true)`. Combined with `credentials: true` and `SameSite=None` cookies (`routes/auth.cjs:27`), any app hosted on Render could make authenticated cross-origin requests. Fix: allowlist the exact frontend origin only.

**[MEDIUM] No rate limiting or brute-force protection on `/api/auth/login`** (`routes/auth.cjs:8`) and no rate limit on the AI endpoints (cost/DoS exposure). Fix: `express-rate-limit` on auth and `/api/claude/*`.

**[MEDIUM] `db.cjs:11` `ssl: { rejectUnauthorized: false }` in production** disables cert validation (MITM risk). It's a known Render workaround but should use the provider CA bundle instead.

**[LOW] CSP allows `'unsafe-inline'` scripts** (`server.cjs:39`), weakening XSS defense. **LOW:** verbose error/PII logging (`claude.cjs:164`, `routes/clients.cjs:30`) leaks user IDs and full client bodies to stdout/log aggregators.

**[LOW] `pool.on('error', () => process.exit(-1))`** (`db.cjs:14`) — a single transient PG error takes down the whole server. Availability foot-gun.

### 5. Performance & Scalability
Mostly adequate for the expected small-portfolio scale. Positives: CSV upsert was de-N+1'd (`data.cjs:164` batch fetch), bulk inserts use multi-row VALUES, and `routes/scenarios.cjs:25` uses `p-limit(5)` to cap Anthropic concurrency. **[LOW]** `data.cjs:148` and the model layer recompute all strategic scores on every list read; fine at hundreds of clients, wasteful at scale — cache or compute on write if the book grows. Not a current blocker.

### 6. Maintainability & Testability

**[HIGH] No real test suite on critical paths.** 18 ad-hoc root scripts, several duplicated across `.js`/`.cjs`, no runner, no CI gate. The exact logic most likely to be wrong (auth scoping, scoring, CSV parsing, upsert preservation) is untested. Fix: adopt Vitest/Jest; first tests should be (a) user B cannot see user A's data, (b) strategic value is deterministic for fixed input, (c) CSV upsert preserves manual enhancements.

**[MEDIUM] ~25 markdown "status" docs at repo root** (`GROWTH-SCENARIO-FIX.md`, `JAVASCRIPT-ERROR-FIXES.md`, `🎉 ... DELIVERY COMPLETE.md`, etc.) plus `Pasted_content_01.txt`, `todo.md`, `query`, `cookies.txt`. This is changelog-as-clutter that buries `README.md` and makes the repo hard to navigate. Move to `/docs` or delete.

**[MEDIUM] Broken lint gate** (no ESLint config, §Build) means the one automated quality check doesn't run.

### 7. Operations, Config & Secrets
- **Good:** secrets via env with fail-fast (`utils/jwt.cjs:2`, `db.cjs:4`); HTTPS enforcement in build and at runtime (`vite.config.js`, `server.cjs:12`); security headers (`server.cjs:23`); health endpoint with DB + API-key checks (`server.cjs:128`).
- **[MEDIUM]** Running `init-db.sql` on every boot (`server.cjs:183`) is fine for `CREATE IF NOT EXISTS` but there is **no migration framework** — `V2__update_clients_schema.sql` exists but nothing applies it deterministically. Schema drift risk. Fix: adopt a migration runner (node-pg-migrate / Flyway-style).
- **[LOW]** Observability is `console.log` only — no structured logging, no request IDs, no error tracking. When tenant data leaks in prod, you won't have an audit trail.

### 8. Dependencies & Supply Chain
- **[LOW] Likely-unused deps:** `multer` (CSV is parsed client-side and sent as JSON — no multipart upload found), `jwt-decode` (token is httpOnly; frontend can't read it), and possibly `isomorphic-dompurify` *and* `dompurify` (redundant). Trim to reduce surface.
- **[LOW]** Express 5 (`^5.1.0`) is comparatively new; verify middleware compatibility. `node-fetch` ^3 is ESM-only — fine here since `"type":"module"`, but mixed with `.cjs` requires care.
- **Action:** `npm audit` was **not run** (dynamic analysis off). Run `npm audit --production` and review `pg`, `jsonwebtoken`, `express`, `multer` advisories before any prod deploy.

---

## Phase 3 — Synthesis

### Top 3 Highest-Leverage Changes
1. **Add `user_id` scoping everywhere** (`data.cjs` all handlers, `clientModel.cjs`, the CSV upsert query, AI model calls). One focused day converts this from "data breach by design" to "multi-tenant." Highest goal-impact per effort, full stop.
2. **One scoring module, reconciled with docs, deterministic normalization.** Delete `clientAnalyzer.cjs`'s and/or `utils/strategic.cjs`'s duplicate; make the survivor match `CLAUDE.md` or fix the docs. Makes the product's headline number trustworthy.
3. **Cut the dead weight:** delete the unused `/api/clients` write path + `clientModel` create bug, the `-new`/`-fixed` scenario variants, and move/delete the ~25 root status docs and 18 loose test scripts. Replace with a real test suite seeded by the cross-tenant test.

### Goal-Gap Summary (what's missing to actually meet the purpose)
- **Tenant isolation** — the #1 prerequisite for a multi-user tool; currently absent.
- **Deterministic, single-source strategic scoring** that matches its own spec.
- **Validated, robust CSV import** (the front door) with tests for date/revenue edge cases.
- **A working `/api/claude/analyze` endpoint** (frontend calls a 404) or removal of that UI.
- **A test + lint + migration pipeline** so regressions in the above are caught.
- **Output-time sanitization** instead of storage-time escaping, so data isn't corrupted.

### Risk Register (ranked, likelihood × impact)
| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | Cross-tenant data exposure / IDOR (confidential client books) | Certain (any 2nd user) | Catastrophic | `user_id` scoping + RLS + cross-user test |
| 2 | Confidential portfolio sent to Anthropic *for all tenants* via AI endpoints | Certain on AI use | Catastrophic | Scope model queries; the rest already passes userId |
| 3 | CSV upsert overwrites another tenant's client by name | High | High | Scope existence query + writes by `user_id` |
| 4 | Headline "strategic value" inconsistent/non-deterministic | Certain | High (wrong decisions) | Single deterministic scorer matching docs |
| 5 | Broken deploy gate (no ESLint config) ships unreviewed code | High | Medium | Add `eslint.config.js`; fix `deploy:check` |
| 6 | Schema drift (no migration runner; `V2` SQL unapplied) | Medium | Medium | Adopt migrations |
| 7 | Login brute force / AI cost abuse (no rate limiting) | Medium | Medium | `express-rate-limit` |
| 8 | Permissive `*.onrender.com` CORS with credentials | Medium | Medium | Exact-origin allowlist |
| 9 | `pool.on('error') → process.exit` whole-server crash | Medium | Medium | Handle/log, don't exit |

### Verdict
**No — this codebase does not meet its goal today.** It is a feature-broad prototype sitting on a foundation that fails its single most important requirement: keeping one attorney's confidential client portfolio separate from another's. The `user_id` column exists, the routes pass the user id, the logs claim to scope by user — but the data and model layers throw that scoping away and query the whole table, so every user sees and can alter everyone's data, and the AI advisor analyzes the entire database for whoever asks. Compounding it, the product's defining metric is calculated three inconsistent ways, none matching the documentation. The fixes are not large — scoping is roughly a day, scoring consolidation half a day — but until they land, this is a convincing demo, not a tool you can safely give to two paying users.
