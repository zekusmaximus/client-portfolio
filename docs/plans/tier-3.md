# Tier 3 Plan: Tier 2's leftovers, the model choice, and what the partners decide next

**Status:** proposed: not approved. Written 2026-09-29 against `fc2f671` (`main` after PR #53, Tier 2 WP11). Every decision below is "proposed" until Jeff approves it. No Tier 3 code starts before he has approved the decisions a package needs and the gate in U1 is met.
**Why:** every Tier 2 package has merged. Three kinds of work remain. (1) WP11's later change, the model and effort Jeff chooses from his run of the evaluation tool, which waits for two weeks of saved answers (about 2026-10-10). (2) Small defects the Tier 2 sessions found and recorded as candidates (`docs/plans/tier-2.md` section 2's notes, (b) to (r), and a few unlettered ones), most with a clear fix and no product question. (3) Product questions only Jeff can answer: S17's items, S19 for the whole firm, the AI plans piling onto one person, WP9's ranking device, and a few smaller ones. This plan makes the first kind its first package (WP1, gated on Jeff's run), turns the second into three small packages a session can build once Jeff approves them (WP2 to WP4), and states the third kind as decisions with options and a recommendation, building nothing from them until he chooses.
**Background:** `docs/plans/tier-2.md` (section 2's notes, sections 13, 14, 16, 17 and 18); `docs/plans/tier-1.md` section 13; `REVIEW-2026-09.md` section 8; `PRODUCT_BRIEF.md`; `docs/plans/people-and-second-chair.md`; the `claude-api` skill (cached 2026-09-25) for everything about models, effort, caching and fallbacks.
**Audience:** future Claude Code sessions and Jeff. Sessions run in a container with the repository, a local PostgreSQL and no Anthropic key, and cannot reach Render, Netlify or gbacpod.com; every step on production is Jeff's.

---

## 0. How a session uses this document

### 0.1 Read order

1. `CLAUDE.md` (architecture, commands, the rules that bind every change).
2. This file: section 1 (decisions: only the approved ones bind a session), section 2 (status), section 3 (constraints), section 4 (every open item, its source, and where it went), then the one work package you are executing.
3. For WP1, and for any decision about the AI (U2 to U4, U11), load the `claude-api` skill before writing anything about models, prices, effort, caching, thinking blocks or fallbacks. Where the skill and this plan disagree about the API, the skill wins; say so in the PR and in section 2's notes.

### 0.2 Working agreement

1. One work package per branch and pull request. Section 2's order, except that WP1 runs when Jeff's choice arrives (before, between or after WP2 to WP4) and the packages in section 9 exist only once Jeff approves their decision. Branch from `origin/main` after the previous package has merged. Jeff's production checks may trail the next package by one at most (Tier 2's 0.2).
2. Gates before and after, all green: `npm ci`; `npm run lint` (0 errors; the 3 expected `exhaustive-deps` warnings, `src/App.jsx` twice and `src/DashboardView.jsx` once); `npm test`; `VITE_API_BASE_URL=https://gbacpod.com npm run build:prod`; the four database suites, each run on its own for its count, on a throwaway local PostgreSQL (`CLAUDE.md`, Testing): `schema`, `import-db`, `routes`, `eval-ai`. At `fc2f671`: `npm test` 499; `schema` 67; `import-db` 72; `routes` 329 (the inventory at 29 routes); `eval-ai` 33; CI's `schema` job 501, the four together; lint 0 errors and 3 warnings; `npm audit` 2 and `npm audit --omit=dev` 0. CI's job runs on PostgreSQL 18, which lists each `NOT NULL` in `pg_constraint` as `contype 'n'`: allow for it in any catalog query a test makes.
3. Schema changes only in `init-db.sql`, idempotent, one transaction with the rest of the file, in a section of their own with a marker the rollback tests cut at; never drop or rename a column or table an older `init-db.sql` names; never a data backfill there that can match rows created after it first ran. A data repair is a guarded script (the `reset-book` pattern). None of WP1 to WP4 changes the schema; only U3's option (c) would.
4. Unchanged rules: the scoring weights in `utils/strategic.cjs`; one Anthropic call site (`services/anthropic.cjs`, T1); never run anything against production; never commit a key, a password, or real client data, questions or answers (the repository is public); no test uses a real Anthropic key.
5. Every package ends with the gates green, `CLAUDE.md` updated where behaviour it documents changed, this file's status table updated in the same PR, and a PR description that lists the package's expected outcomes with the evidence for each and copies its "Jeff, after deploy" items.
6. Each new test is shown failing against the code it covers before it passes, where that is meaningful (for a route: the new `routes` or `import-db` tests run against `origin/main`'s server in a worktree, with only the test files and the pure helpers they import copied in).
7. If this plan and the code disagree, the code wins; say so in the PR and in section 2's notes. A candidate found during a package is recorded in section 2's notes, not fixed in passing.

### 0.3 Session start checklist

```bash
git fetch origin main
git checkout -b <the session's branch> origin/main
npm ci
npm run lint
npm test
VITE_API_BASE_URL=https://gbacpod.com npm run build:prod
service postgresql start   # then: sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres'"
SCHEMA_TEST_SERVER_URL=postgresql://postgres:postgres@127.0.0.1:5432 node --test tests/schema.test.mjs   # and import-db, routes, eval-ai, each on its own
```

---

## 1. Decisions

"Approved" means Jeff approved the decision as written; a session treats it as settled, and a change goes back to him. "Proposed" means this plan's recommendation, not yet approved: a session does not build on it. "Carried" means an earlier decision this plan keeps. Jeff can answer every row in one message ("U1 yes; U6 (b); U10 (a); ...").

| # | Decision | Rationale | Status |
|---|---|---|---|
| U1 | **The gate.** Tier 3 code starts when (a) Jeff has approved the decisions the package needs (section 2 lists them), (b) Tier 2's open after-deploy checks are done (`docs/plans/tier-2.md` section 2: WP6's other checks; WP8's; WP9's `/api/health` listing `hire-scenarios`; WP10's; the workshop and WP9's two questions are U9 and U10, and do not block), and (c) the nightly backup is green. WP1 also waits for Jeff's run and choice. A package that adds a table or column (only U3's option (c)) also needs a green backup before its merge and the next night's run counting it (Tier 2 section 17). | Tier 2's 0.2 lets production checks trail the next package by one; four packages' checks trail now (WP6, WP8, WP9, WP10). S1 held Tier 2 the same way until Tier 1's checks were done. The backup is the one safety net if a write-path fix (WP2) goes wrong on production. | proposed |
| U2 | **WP1: where the model is set.** Options: (a) `AI_MODEL` and `AI_EFFORT` on Render, set together after WP1's code deploys; the code changes only `FALLBACK_MODELS` (and U3, U4); (b) `DEFAULT_MODEL` in `services/anthropic.cjs` (`:40`) as well, with `AI_EFFORT` on Render. Recommendation: (a). Either way WP1 does what section 5 says for the outcome Jeff chooses. | (a) makes the switch, and its undoing, one Render save each (one redeploy), independent of code deploys; the code change is one list. (b) puts the choice in the repository, so a code rollback reverts it too, but it also moves the model every test server runs (`tests/routes.test.mjs:3142`, `:3151`; `tests/import-db.test.mjs:1287`, `:1713`, `:1729` pin `claude-opus-5`, the default, because they start `server.cjs` without `AI_MODEL`) and leaves the effort on Render anyway, so the choice would still live in two places. Tier 2 section 16 already said `DEFAULT_MODEL` changes "only if Jeff says so". | proposed |
| U3 | **Recording the effort an answer was given at (candidate (q)).** Options: (a) nothing: section 16 of Tier 2 records the date of each change, and answers are read against it; (b) the `ai_call` line gains `effort` (`null` for the API's default) and `/api/health`'s `services` gains `effort` beside `model`: no schema change; (c) (b) plus a nullable `ai_answers.effort` column, which the saved answers and the evaluation tool could show: a schema change with a backup gate (U1). Recommendation: (b), in WP1. | `AI_EFFORT` is one setting for the whole API, so the date of each change reconstructs it for every saved answer; what is missing is a way to see it on production without the Render dashboard (the health check) and in the logs Jeff already reads (runbook 9.3). A column earns its migration only if the effort ever varies per request, which nothing plans. | proposed |
| U4 | **D7's cheaper alternative (candidate (p)).** The code and docs name `claude-sonnet-5` (`services/anthropic.cjs:49-51`, `utils/aiCost.cjs:53`, `.env.example:58`, `CLAUDE.md`'s `AI_MODEL` line). Options: (a) leave it; (b) name `claude-sonnet-5-5`, the current Sonnet, in the docs and add it to `PRICES` in WP1 ($2 / $10, cache writes $2.50 and $4, reads $0.20, the skill's figures; re-read the pricing page then), not in `FALLBACK_MODELS` or `AI_MODEL` unless Jeff ever chooses it, and no Sonnet option in the evaluation tool unless he asks; (c) drop the "cheaper alternative" line. Recommendation: (b). | The skill resolves "a Sonnet" to `claude-sonnet-5-5`, at the same price as `claude-sonnet-5`. It differs from the Opus models in ways that matter only if it is ever chosen: `thinking: {type: "disabled"}` is a 400 (the service sends no `thinking`), server-side fallback in the `"default"` form only and only on the Claude API (the form the service sends), and no other model reads its thinking blocks, so a WP10 thread moved off it would continue without that reasoning. Whether to use a cheaper model at all stays Jeff's (D7). | proposed |
| U5 | **The defect packages as scoped: WP2, WP3 and WP4** (sections 6 to 8), with these choices inside them: (g) a duplicate name is a 400 detail on `name`, checked under one transaction-level advisory lock, with no unique index; the import refuses an amount above the form's 1,000,000,000 (candidate (w)); the import's request-check 400 drops `value`; the transition plan's client name comes from the book; `isomorphic-dompurify` is removed and `validator` moves to `devDependencies`. Recommendation: approve. | Each has a clear fix and no product question (section 4 gives the evidence line by line). A unique index is the stronger guarantee but `init-db.sql` is one transaction that stops the production server when a statement fails (`server.cjs:200-205`), and a pair already stored would fail it; the check refuses new pairs without that risk. The amount cap is the form's and the API's (`utils/clientRules.cjs:43`); between $1,000,000,000 and the column's $10,000,000,000 the import accepts what the form refuses, and at $10,000,000,000 it answers 500. | proposed |
| U6 | **`Financial` and transition complexity (candidate (e)).** Options: (a) keep: the complex areas are `healthcare`, `energy` and `financial services` (`utils/succession.cjs:50`, `src/utils/successionUtils.js:33`), and the form's `Financial` (`utils/clientRules.cjs:15-16`) contains none of them, so it adds nothing; (b) count `Financial` as complex on both sides, after Jeff's read-only count (`SELECT count(*) FROM clients WHERE 'Financial' = ANY(practice_area);`). Recommendation: (b), in WP2 if approved before WP2 starts, else its own small PR. | The rule plainly meant regulated practice areas, and the vocabulary renamed one of the three, so it has never matched anything since the form's list existed. It moves badges: each Financial client's complexity gains 1.5 before rounding (1 or 2 after), and its succession risk 0.3 of that (0 or 1 after rounding). The book's text is unchanged (the metrics are not in it; Tier 2 WP7 decision 4), so no WP10 thread is affected. | proposed |
| U7 | **The client form's practice-area requirement (candidate (k)).** Options: (a) keep: the form requires at least one practice area (`src/utils/validation.js:33-45`); (b) drop it: the form allows none, as the API (`checkClient`), the import and the book already do. Recommendation: (b), in WP4. | A client the import created with a blank `Practice Area` cannot be saved from the form, for a Stickiness change or anything else, until someone picks an area nobody chose. That is the data entry the brief rules out ("Every client costs ~two quick picks"), and the same class of defect PR #49 fixed for cadence. | proposed |
| U8 | **Candidates closed without a package**, each with its reason in section 4: (d) the History list not paged; (m) Stage 3's tasks naming their assignee by name; the `&nbsp;` leftovers; (y) notes and `originator_is_firm` unchecked on the server; a password's bytes after the 72nd. Recommendation: close them. | Each is either already moot (the `&nbsp;` leftovers: Jeff's preview found none), deliberate (`originator_is_firm` accepts `'true'`, `utils/people.cjs:116`), or costs more to change than it can ever cost the firm (section 4). Any can come back if it starts to bite. | proposed |
| U9 | **WP9's ranking device (Tier 2 WP9, decision 3).** A hire scenario counts each settled seat as relief of the associate's 20% share for its lead, in the ranking only, so proposals spread across the heavy partners; under P10 alone every proposal came from the one heaviest partner's book. Options: (a) keep it, as built; (b) P10 alone. Recommendation: (a). | On WP9's end-to-end book the four proposals went Kevin, Kevin, Paula, Kevin; under (b) all four would be Kevin's. The device never shows as a figure: the load table and S19's toggle are unchanged by it. It is a workshop device, and a workshop that proposes only one partner's clients answers less. | proposed |
| U10 | **S19 for the whole firm (a P10 decision).** Options: (a) keep P10 as amended (a lead carries a client's full effort whoever the second chair is; the second chair adds 20%); (b) S19 firm-wide: a lead carries 80% of a client's effort when its second chair is an associate; (c) any second chair relieves the lead: 80% and 20% for every client with a second chair. Recommendation: (a) until the partners have workshopped a hire with the toggle (WP9's open check); if they then want relief, (c) over (b). | (b) says a partner who seconds a client relieves nobody while an associate does, which the partners may not believe; (c) makes each client's effort add to 100% whoever the chairs are. Either (b) or (c) changes `src/utils/load.js` and `utils/book.cjs` together (held equal by `tests/book.test.mjs`), the Partnership tab, the Dashboard's heaviest-lead card, the exports, the departure engine's and the associate split's rankings (`totalLoad`), and the AI's book, whose text changes for the same data: on the deploy every earlier thread stops taking follow-ups (409) and every saved answer reads "on an earlier book", as happens anyway after any client edit, and the first answer after writes the book to the cache again. S19's toggle then shows nothing new and would go. Section 9's WP7. | proposed |
| U11 | **AI transition plans piling onto one person (Tier 2 section 13's box).** Each plan is one request for one client; it sees the book's loads (T14) but not the seats the scenario, or the other plans, have given anyone, so in Tier 1 WP6's check all four plans recommended the same lead. Options: (a) leave it: Stage 1's engine is the load-balanced view, and a plan's picks apply only through "Use these picks"; (b) the page sends the scenario's current seats for the other affected clients as ids, the server checks them against the People list (as `checkRoster` does) and describes them in the user turn, never as new load figures (T8, T14); (c) plans written one at a time, each told what the plans before it recommended. Recommendation: (a) for now; (b) when the partners first rely on the AI's seat picks in a real departure. | (b) keeps T14 (the server trusts no figure the page sends) and the cache (the seats go in the user turn); it is one to one and a half sessions (section 9's WP8). (c) serializes a run that now goes two at a time and still ignores the partner's own choices. The strategy, risks, tasks and timeline a plan gives are per-client and are not affected either way. | proposed |
| U12 | **S17's items.** (a) Exposure on the Dashboard: recommendation yes (section 9's WP5). (b) "Where a new client fits", the brief's what-if sandbox: recommendation yes, after (a) (WP6). (c) A load trend: recommendation later, once `client_changes` holds months of history (it began with WP6's deploy on 2026-09-29), not before spring 2027. (d) Surfacing the inputs to compensation conversations: recommendation no, not in Tier 3. | (a) is "the most actionable single signal the tool produces" (the brief), the book already computes it for the AI (`utils/book.cjs:328-332`), and no page shows it. (b) is the brief's third "glanceable truth" and its build step 3, never built; the ranking it needs exists (Phase 5 and 6's blocks). (c) needs history that does not exist yet. (d): the brief says "later, maybe" and "No compensation math"; the book already shows the originator beside the lead. | proposed |
| U13 | **Vite 8 (S13's revisit).** Options: (a) stay on Vite 4.5.14, whose two remaining advisories (Vite and esbuild) are in the dev server only (runbook section 12); (b) a package of its own that moves to Vite 8 (the version `npm audit` names, 8.3.1 on 2026-09-29) and its React plugin, with no React major. Recommendation: (b), after WP2 to WP4. | The page is developed on Windows, and runbook 12 lists Windows-only dev-server advisories (the open-in-editor endpoint's command injection and NTLMv2 hash disclosure). Production is untouched either way: Netlify serves static files. A major upgrade of the build tool is its own PR with its own evidence (section 9's WP9); React 19 buys nothing the page needs. | proposed |
| — | Carried unchanged: the one scorer and its weights; one Anthropic call site and T1's request rules; the book byte-identical for the same data (T8); D7 (the model is Jeff's; the skill's default, `claude-opus-5-5`, changes nothing until he chooses); the People model and its rules (P2 no roles or permissions, P3, P5, P9 no bulk seat moves); the brief's "no swap optimizer" and "no compensation math"; D11's rate limits (T16); T12's shared answers and S15's hiding. | | carried |

---

## 2. Status table (sessions update this)

| WP | Title | Size | Needs | Status | Branch / PR | Notes |
|---|---|---|---|---|---|---|
| — | Tier 2's close-out and this plan | 1 session | — | PR open | `claude/gifted-johnson-kmng62` | WP11 recorded as merged (`fc2f671`) in Tier 2's section 2 and `CLAUDE.md`; this plan written against `fc2f671`. Baselines measured there: section 0.2 item 2. No code, test or schema changed |
| WP1 | The model and effort Jeff chooses (WP11's later change) | 0.5 to 1 session | U1, U2, Jeff's run and choice; U3, U4 | not started | | Waits for Jeff's run (runbook 7.6; after about 2026-10-10) |
| WP2 | Write-path defects | 1 to 1.5 sessions | U1, U5; U6 for (e) | not started | | |
| WP3 | Start-up, scripts, dependencies and docs | 0.5 to 1 session | U1, U5 | not started | | |
| WP4 | The client form and Stage 2's leftovers (page only) | 0.5 to 1 session | U1, U5; U7 for (k) | not started | | |
| WP5 | Exposure on the Dashboard | 0.5 to 1 session | U12 (a) | only if approved | | |
| WP6 | Where a new client fits | 1.5 to 2 sessions | U12 (b) | only if approved | | |
| WP7 | Second-chair relief for the firm | 1 session | U10 (b) or (c) | only if approved | | |
| WP8 | AI plans that see the scenario's seats | 1 to 1.5 sessions | U11 (b) | only if approved | | |
| WP9 | Vite 8 | 1 session | U13 (b) | only if approved | | |

Status values: `not started`, `only if approved`, `in progress (date)`, `PR open`, `merged`, `deployed`, `verified on gbacpod.com`.

**Size, honestly.** WP1 to WP4: two and a half to four and a half sessions, plus Jeff's run. The defects are small in lines and large in proof: each one on a write path runs on both table shapes, is shown failing on `origin/main` first, gets an end-to-end run in the container and a PR with evidence, as every Tier 2 package did. WP5 to WP9, if all were approved: five to six and a half more. The order: U1's gate first (Jeff's checks and a green backup, as S1 did), then WP2, WP3 and WP4, then the approved ones in the order Jeff ranks them; WP1 whenever his choice arrives.

---

## 3. Constraints every work package keeps

Tier 2 section 3, carried forward and restated as the code is at `fc2f671`. Items 6 to 8 there described the code before Tier 2's WP4, WP5 and WP1; they are replaced here.

1. **Production's older tables.** `clients.id` and `client_revenues.client_id` are integers on Render and uuids in `init-db.sql`; production's `client_revenues` has no timestamps and may lack `UNIQUE (client_id, year)` (`tests/helpers/server.mjs`, `PRODUCTION_TABLES_SQL`). Compare ids as text (`data.cjs:588`, `:972`, `:984`) or use untyped placeholders; never cast a client id; never rely on `ON CONFLICT (client_id, year)`. A new table's `client_id` is `TEXT` with no key, as `ai_answers.client_id` and `client_changes.client_id` are.
2. **Keys to `users` never cascade.** `check-schema` fails and `delete-user` refuses while one does (`utils/schemaCheck.cjs`). The session token is not re-checked against `users` (`middleware/auth.cjs`), so write a key to `users` as `(SELECT id FROM users WHERE id = $n)` with the username copied beside it, and a session that outlived its account still saves.
3. **Keys to `clients` cascade or do not exist.** `reset-book` refuses while one does not cascade. History that must outlive a client (`client_changes`, `scenarios`, `ai_answers`) has no key.
4. **New columns are nullable or have defaults.** `deploy/backup/selftest.sh:53` inserts clients with an explicit column list. A new `clients` column appears in every client response (`clientsQuery` selects `c.*`, `data.cjs:505`; `withPeopleFields` removes only the joined keys and `status`, `utils/people.cjs:202-203`).
5. **Netlify before Render.** The page publishes about a minute after a merge; Render may lag, and may be rolled back alone. Page behaviour that needs new API behaviour an older API would get wrong gets a name in `/api/health`'s `features` (`server.cjs:152`, twelve names at `fc2f671`: `check-file`, `transition-plan-roster`, `second-chair-assign`, `ai-book`, `ask-the-book`, `ai-answers`, `ai-stream`, `plain-text`, `client-edit-conflict`, `saved-scenarios`, `hire-scenarios`, `ai-threads`) and a check on the page. None of WP1 to WP4 needs one; each section says why.
6. **What the client writes check, and in what order.** `POST` and `PUT /api/data/clients` apply `checkClient` (`utils/clientRules.cjs`) and then the people (`validateAssignment`, `utils/people.cjs`), answering one 400 `Validation failed` with both lists' details; every refusal about the body answers before the client is looked up, then 404, then 409 (Tier 2 WP4 and WP6). Every client write reads the client `FOR UPDATE`, writes, reads what it wrote, and logs one `client_changes` row per client that changed in the same transaction; a failed log fails the write; a write that changes nothing writes nothing (WP6). `PUT` takes `expected_updated_at` (S10). Locks: the people a write assigns `FOR SHARE` before the client `FOR UPDATE`, the order a rename takes (the person `FOR UPDATE`, then the clients); the second-chair route is the one exception (candidate (b), WP2).
7. **Text as typed.** `trimRequestBody` (`middleware/validation.cjs`) on `/api/data` (`data.cjs:58`) and `/api/scenarios` (`routes/scenarios.cjs:32`) trims every string and escapes nothing; nothing on the page or in the book decodes (`tests/escaping.test.mjs` scans the page). `unescapeStored` remains only as a guard in the import's name matching, `answerRow` and the repair script. `react-markdown` renders no raw HTML.
8. **Tests.** One contract per route in `tests/routes.test.mjs`, whose inventory fails when a route is registered without one (29 routes); a package that changes a route changes its contract in the same PR. Both table shapes for anything on a write path. No test imports `db.cjs`, `data.cjs`, `models/*`, a route file or `utils/jwt.cjs`; a new rule lives in a pure module. A test that reads a server's log right after an answer waits for the line (`waitFor`, `tests/helpers/server.mjs:81`): the output arrives on a pipe and can lag the answer (Tier 2 WP7's CI failure; candidate (i)).
9. **One scorer, and the page's copies held equal.** `utils/strategic.cjs`, weights untouched, D6 unchanged. The succession metrics (`utils/succession.cjs` and `src/utils/successionUtils.js`, `tests/succession.test.mjs`), the load model (`utils/book.cjs` and `src/utils/load.js`, `tests/book.test.mjs`), the client rules (`tests/client-rules.test.mjs`) and the scenario state (`tests/scenario-state.test.mjs`) each have a page copy held equal by a parity test: change both sides together.
10. **The AI.** One call site; `createService(` only in the service and `scripts/eval-ai.cjs`; `ai-grep`'s rules; the book byte-identical for the same data and nothing per request in the system blocks (T8). A follow-up is refused when the system blocks' hash (`utils/aiThreads.cjs:50-52`, the blocks only, not the model or the effort) differs from its thread's, and an answer reads "on an earlier book" when its `book_sha256` is not today's book's. Any client edit changes the book, so both happen in the normal course; a code change to how the book is written, or to `ASK_INSTRUCTIONS`, does the same for every thread and answer at once on its deploy (the instructions end the follow-ups only). The rate limits (T16).
11. **`init-db.sql` at every start, as one transaction.** In production a failing statement stops the server at start (`server.cjs:200-205`). Section markers for the rollback tests (`tests/schema.test.mjs`).
12. **Logs.** Never log a row: PostgreSQL's `detail` on a constraint failure prints the refused row, a note included. A new structured line gets a row in runbook 9.3.
13. **CSP.** The page may call only itself and the API (`netlify.toml`); nothing in this plan adds an origin.
14. **People and the brief.** No roles or permissions (P2): every signed-in partner can do everything. People are never deleted (P5). Seats are never moved in bulk (P9). The tool suggests; partners decide. No compensation math.

---

## 4. The inventory: every open item, its source, and where it went

Each "At `fc2f671`" entry was checked in the code by file and line for this plan. "Found by reading" means the defect follows from the code but has not been reproduced; the package that fixes it reproduces it first (0.2 item 6).

### 4.1 Tier 2's lettered candidates

| Item | Source | At `fc2f671` | Goes to |
|---|---|---|---|
| (b) The second-chair route locks the client before the people; a rename locks the person, then the clients: an Accept and a rename at the same moment can deadlock (PostgreSQL aborts one, a 500) | Tier 2 WP6 | Holds. `PUT /api/data/clients/:id/second-chair` (`data.cjs:921`) locks the client (`lockClient`, `:585-589`, `FOR UPDATE`) at `:937`, then reads the people `FOR SHARE` (`resolveAssignment`, `:556`) at `:957`. `PUT /api/people/:id` locks the person (`routes/people.cjs:80`), then updates the clients that name them (`:104-111`). Found by reading | WP2 |
| (c) A failed query is logged whole, `detail` included, so a refused row, its note included, can reach the log | Tier 2 WP6 | Holds, and wider than "the client routes": `console.error(..., error)` at `data.cjs:490`, `:635`, `:741`, `:899`, `:988`, `:1031`, `:1052`; `routes/people.cjs:33`, `:53`, `:121`; `routes/auth.cjs:55`, `:81`, `:118`; `routes/scenarios.cjs:83`; `server.cjs:178`, `:201`; and, for unexpected errors only, `routes/ai.cjs:194` and `routes/scenarios.cjs:136`. Two places already log without it: `failed()` in `routes/scenarios.cjs:170-172` (code and message) and the `client_changes` insert (`data.cjs:613-619`) | WP2 |
| (d) The History list is not paged | Tier 2 WP6 | Holds: `CLIENT_CHANGES_SQL` (`utils/clientChanges.cjs:224-228`) has no `LIMIT` | Closed (U8): one row per write that changed something; at six partners and one import a year, a client's history stays in the tens of rows for years. Revisit if one passes a few hundred (Jeff's read-only check: `SELECT client_id, count(*) FROM client_changes GROUP BY 1 ORDER BY 2 DESC LIMIT 5`) |
| (e) `Financial` never adds transition complexity | Tier 2 WP7 | Holds: `COMPLEX_AREAS` at `utils/succession.cjs:50` and `src/utils/successionUtils.js:33`; a substring match (`utils/succession.cjs:131`); the vocabulary's `Financial` at `utils/clientRules.cjs:15-16` | U6 |
| (g) The client form's `POST` accepts a name another client has, in any case; the import then refuses every sheet row naming it | Tier 2 WP7 | Holds: `POST` (`data.cjs:648`) and `PUT` (`:762`) compare no other client's name; pinned by `tests/routes.test.mjs:1151` | WP2 (U5) |
| (h) `resolveClientAxes` has no importer | Tier 2 WP7 | Holds: `src/utils/clientMetrics.js:94`; nothing in `src/`, `utils/` or `tests/` imports it | WP4 |
| (i) The pipe race wherever `tests/routes.test.mjs` reads a server's output right after its answer | Tier 2 WP7 | Holds at `tests/routes.test.mjs:586`, `:610` (`rate_limited`), `:1610` (`client_changes insert failed`) and `:3177` (`origin_refused`): no `waitFor` before the read. None has failed yet | WP3 |
| (j) The new-client form's empty revenue row blocks a save | Tier 2 WP8 | Holds: a new client starts with the current year and no amount (`src/ClientEnhancementForm.jsx:143`), as does a stored client with no revenue (`src/utils/clientForm.js:31-35`), and `validateRevenueEntry` requires an amount once a year is set (`src/utils/validation.js:189-191`) | WP4 |
| (k) The form requires a practice area; the server and the import do not | Tier 2 WP8 | Holds: `src/utils/validation.js:33-45` (`required`, `minItems: 1`) | U7 (WP4) |
| (l) A scenario whose transition sheet has been imported shows nothing in Stages 2 and 3 | Tier 2 WP8 | Holds by design: once the people leaving hold no seats the engine derives no decisions, and the records are kept unshown (`heldTransitions`, `src/utils/scenarioState.js:491`; WP8 decision 12) | Later (section 11): a view of a finished scenario is new scope |
| (m) Stage 3's tasks name their assignee by name, not id | Tier 2 WP8 | Holds: `src/utils/transitionPlans.js:187`; the pickers' values are names (`src/components/succession/TransitionPlanManager.jsx:194`, `:217`), and a name no longer on the list is kept as its own option (`:263`) | Closed (U8): a rename is rare and loses nothing (the old name stays on the task); an id would change the saved scenario's shape on both sides and every saved task |
| (n) Stage 2's "AI Plans" count reads the plan's strategy | Tier 2 WP8 | Holds: `src/components/succession/ClientReviewInterface.jsx:670`, and the "No AI plan" filter at `:477`, read `strategy` from `planViews` (`:564`), which lays the partner's edits over the AI's (`src/utils/scenarioState.js:227-240`), so a plan holding only a partner's text counts as an AI plan | WP4 |
| (o) `server.cjs` listens before `init-db.sql` has run | Tier 2 WP8 | Holds, and observed: `app.listen` (`server.cjs:213`) runs while the start-up at `:186-210` is still awaiting the database; on a fresh database the session that wrote this plan saw `Server running on port` printed before `PostgreSQL connection OK` | WP3 |
| (p) D7's cheaper model in the code is `claude-sonnet-5`; the current Sonnet is `claude-sonnet-5-5` | Tier 2 WP11 | Holds: `services/anthropic.cjs:49-51`, `utils/aiCost.cjs:53`, `.env.example:58`, `CLAUDE.md`'s `AI_MODEL` line | U4 (WP1) |
| (q) Nothing records the effort an answer was given at | Tier 2 WP11 | Holds: the `ai_call` line (`services/anthropic.cjs:252-267`) and `ai_answers` carry no effort | U3 (WP1) |
| (r) dotenv prints a banner on the standard output of every script but `eval-ai` | Tier 2 WP11 | Holds: `require('dotenv').config()` without `quiet` at `server.cjs:4`, `create-admin.cjs:18`, `scripts/check-schema.cjs:20`, `scripts/delete-user.cjs:23`, `scripts/reset-password.cjs:24`, `scripts/reset-book.cjs:34`, `scripts/unescape-book.cjs:45`; `scripts/eval-ai.cjs:58` passes `quiet: true`. Observed at start: `[dotenv@17.2.0] injecting env (0) from .env` | WP3 |

### 4.2 WP5's unlettered candidates

| Item | At `fc2f671` | Goes to |
|---|---|---|
| The import's request-check 400 echoes the whole file as `value`, notes included | Holds: `handleCSVValidationErrors` maps each error with `value: error.value` (`data.cjs:108-112`), which for `csvData` is the whole array. The page reads only `message` (`src/DataUploadManager.jsx:173-175`); `tests/routes.test.mjs:847` pins the three keys. It goes back only to the partner who sent the file, so it is bulk, not a leak | WP2 |
| The transition plan's `plan.clientName` echoes the request | Holds: `routes/scenarios.cjs:121`. Found with it, candidate (v): the saved answer's `client_name`, which every partner sees as "Transition plan: <client>", is also the request's (`client` passed to `answerRow` at `routes/scenarios.cjs:105-107`, read at `utils/aiAnswers.cjs:87`). The prompt already uses the book's entry (`bookClient`, `utils/transitionPlan.cjs:136-140`); nothing on the page reads `plan.clientName` | WP2 |
| `isomorphic-dompurify` and `validator` have no runtime importer | Holds: `package.json:34` and `:44`. Nothing imports `isomorphic-dompurify` (its dependencies are `dompurify` and `jsdom`); `validator` is imported only by five test files (`client-rules`, `schema`, `import-db`, `unescape-book`, `escaping`), and `express-validator` 7.3.2 depends on it itself (`npm ls validator`) | WP3 |
| The `&nbsp;` leftovers | Moot: Jeff's repair preview on 2026-09-28 found no entity-like text the repair would leave and none in any other text column (Tier 2 WP5's row), and nothing has stored escaped text since WP5's first PR | Closed (U8) |

### 4.3 Other Tier 2 packages' unlettered candidates

Found in Tier 2's rows for WP2 to WP4, still open at `fc2f671`.

| Item | Source | At `fc2f671` | Goes to |
|---|---|---|---|
| (w) An import amount of 1e10 or more fails in PostgreSQL (500) | Tier 2 WP4 | Holds: the import has no amount cap (`REVENUE_AMOUNT_MAX` is read only by `checkClient`, `utils/clientRules.cjs:43`, `:47`); `revenue_amount` is `NUMERIC(12, 2)` | WP2 (U5) |
| (x) The form will not save a client with a stored $0 revenue row | Tier 2 WP4 | Holds: `validateRevenueEntry` tests `revenue.revenue_amount` for truth (`src/utils/validation.js:182-191`), so the number 0 the API returns reads as missing. Only the form can store a $0 row (the import deletes one, D5) | WP4 |
| (y) Notes are not checked on the server; `originator_is_firm` takes the text `'true'` | Tier 2 WP4 | Notes: holds (`checkClient` does not read them). `originator_is_firm`: deliberate, `utils/people.cjs:116` reads `true` or `'true'` | Closed (U8): the page always sends text; a length rule would refuse notes the import stored; nothing breaks |
| (z) The store's uncalled actions and unread state | Tier 2 WP2 | Holds in `src/portfolioStore.js`: `setOriginalClients` (`:285`), `setUploadState` (`:345`), `setAnalysisState` (`:350`) and `getTopClients` (`:674`) have no caller; `originalClients` (`:113`), `uploadError` (`:126`), `isAnalyzing`, `analysisError`, `analytics` (`:129-131`), `optimization` and `optimizationParams` (`:147-148`) no reader; `partialize` persists `optimizationParams` to localStorage (`:995`) | WP4 |
| `timeCommitment` is always 40, and every client response carries the four retired columns | Tier 2 WP2 | Holds: `data.cjs:535`, `models/clientModel.cjs:54`; `withPeopleFields` drops only the joined keys and `status` (`utils/people.cjs:202-203`); nothing on the page reads either | Later (section 11): with a V4 migration that drops the retired columns and `status` (P13's note); changing the response keys alone changes contracts for nothing |
| The password policy has no upper bound, and bcrypt reads only the first 72 bytes | Tier 2 WP3 | Holds: `utils/passwordPolicy.cjs`; `tests/password-hash.test.mjs` pins the 72 bytes | Closed (U8): the first 72 bytes of any password the policy accepts are still a strong password |
| The dev server's advisories, Windows ones included | Tier 2 WP3 | Holds: `npm audit` 2 (Vite 4.5.14, esbuild), `--omit=dev` 0 | U13 |

### 4.4 Found while writing this plan

| Item | At `fc2f671` | Goes to |
|---|---|---|
| (s) Two renames at the same moment, of two people who hold seats on the same two clients, can deadlock | `PUT /api/people/:id` updates the clients that name the person in three statements with no order (`routes/people.cjs:104-111`): each rename locks one client with its first statement and waits for the other's with its second. Found by reading; rarer than (b) | WP2 |
| (t) Runbook 9.2's start-up order is not the code's | `deploy/README.md:1002-1005` lists `Database tables initialized` before `Server running on port`; the code prints `Server running on port` second (see (o)) | WP3: true once (o) lands |
| (u) `README.md` is stale in two places | `README.md:15` omits `scenarios` from the tables; `README.md:84-90` names `docs/plans/tier-0.md` as "the current plan" and Tier 1 and Tier 2 as previews. `REVIEW-2026-09.md` section 8, Tier 2 item 5 ("make `README.md` describe the real deployment") is otherwise met: its "How it is deployed" section is right (Netlify, Render, the private backup repository) | WP3 |
| (v) The saved transition plan's `client_name` comes from the request | With `plan.clientName`, section 4.2 | WP2 |

### 4.5 Section 18's items, S17, WP9's questions, and WP11's follow-up

| Item | Source | Goes to |
|---|---|---|
| WP11's later change: `PRICES`, `FALLBACK_MODELS`; `AI_EFFORT` on Render | Tier 2 section 16 | WP1 (U2) |
| Structured output for transition plans, with the roster as an enum | S16; Tier 1 section 13 | WP1, as a proposal for Jeff only if his `--plans` run shows recommendations the parser could not resolve |
| S17: exposure on the Dashboard; the what-if sandbox; a load trend; compensation inputs | Tier 2 S17 and section 18 | U12. Exposure is computed only for the AI's book (`utils/book.cjs:328-332`) and named on the page only in the AI tab's text (`src/AIAdvisor.jsx:577`, `:596`); nothing in `src/` is a sandbox |
| S13: Vite 8 and React majors | Tier 2 S13 and section 18 | U13 (Vite 8 only) |
| S19 for the whole firm | Tier 2 S19, WP9's open check | U10 |
| WP9's decision 3, the ranking device | Tier 2 WP9's open check | U9 |
| AI plans that see each other's picks | Tier 2 section 13's box, section 18 | U11 |
| An associate's promotion to partner | Tier 2 section 18 | Later (Jeff: not for at least five years; P5's role change already allows it) |
| A retention rule for saved answers | Tier 2 section 18 | Later: hiding (S15) keeps the list clean; nothing is deleted |
| Production's integer ids to uuids | Tier 2 section 18 | Later: a migration of its own (`CLAUDE.md`) |
| A time-to-first-word instruction, "if the pause before streamed text bothers partners" | Tier 1 section 13 (not taken up by Tier 2) | Later: the page says "Thinking… n s" until the first words (Tier 1 WP5), no partner has reported the pause, and WP1's effort choice changes it anyway |

### 4.6 Earlier plans' open checks, and Jeff's operations (no session work)

- **Tier 2's after-deploy checks** (section 2): WP6's other checks (`client-edit-conflict` listed, `check-schema` ending `OK`, a Stickiness change in History, the two-tab conflict); WP8's (`saved-scenarios` listed, the two-partner 409, the backup counting `scenarios`); WP9's (`hire-scenarios` listed, a hire workshopped, U9, U10); WP10's (`ai-threads` listed, a three-turn thread with cache reads on turns two and three, hide and show across two browsers, the backup counting `ai_answers` with its five new columns); WP11's run. U1's gate.
- **The people plan's unticked boxes** (`docs/plans/people-and-second-chair.md:118`, `:135`, `:148-151`, `:154-156`, `:174`, `:197`, `:213`, `:230`). Some are evidently met by later records: `/api/health` listing `check-file`, `transition-plan-roster` and `second-chair-assign` (Tier 2 WP2's verification recorded "the same seven features" on 2026-09-27), and the fresh book imported (its `:152-153`). The rest are Jeff's to tick or strike; this plan ticks none.
- **Tier 0's operations**: the uptime monitor (runbook section 11; `CLAUDE.md` says "once Jeff sets it up"); the rollback rehearsal (`docs/plans/tier-0.md:562`); the Render settings still marked "confirm in the dashboard" (`deploy/README.md:85-93`: instance type, region, root directory, pre-deploy command, auto-deploy, health check path); the Render build command, `npm install` where the code needs `npm ci` (`deploy/README.md:89`); the copy of `backup.yml` in the private repository (`docs/plans/tier-0.md:563`).
- **`main` is unprotected**: GitHub's branches API answered `protected: false` for `main` on 2026-09-29, as it did on 2026-09-25 (Tier 0 WP0's note), so CI reports on a pull request but does not stop its merge. Recommended (Jeff's setting, not a session's): require the CI workflow's jobs to pass before a merge to `main`.

### 4.7 Plan against code, and against the skill

1. `deploy/README.md` 9.2's start-up order is not what the code prints ((t)).
2. `README.md`'s table list and plan pointer are stale ((u)).
3. Tier 2 section 3 items 6, 7 and 8 describe the code before Tier 2's WP4, WP5 and WP1; section 3 here restates them.
4. Tier 2's candidate (c) names "the other client routes"; the same whole-error logs are in `routes/people.cjs`, `routes/auth.cjs`, `routes/scenarios.cjs:83` and `server.cjs` too ((c)).
5. Tier 2 WP4's candidate "`originator_is_firm` takes the text `'true'`" is deliberate in the code (`utils/people.cjs:116`).
6. `services/anthropic.cjs:49-51` says the skill documents `"default"` fallback routing "for claude-opus-5, not for claude-sonnet-5". The skill (cached 2026-09-25) now says to include the server-side fallback by default for `claude-fable-5-1`, `claude-opus-5-5`, `claude-opus-5` and `claude-sonnet-5-5` (the last in the `"default"` form only, on the Claude API). Still not `claude-sonnet-5`, so the code's list is right for what it can run today; WP1 updates the comment.
7. The skill's default model is `claude-opus-5-5`; D7 keeps `claude-opus-5` until Jeff chooses (Tier 2 WP11 recorded the same). No other disagreement between the skill and Tier 2's section 16 was found: `claude-opus-5-5` takes `fallbacks: "default"` (targets from `allowed_fallback_models`, expected `claude-opus-5` and `claude-opus-4-8`), its effort defaults to `medium`, it reads `claude-opus-5`'s thinking blocks and not the reverse, and caches are per model.

---

## 5. WP1: The model and effort Jeff chooses (WP11's later change)

**Size:** half a session once Jeff has chosen; about one with U3 and U4. **Needs:** U1, U2, Jeff's run of `scripts/eval-ai.cjs` (runbook 7.6; after about 2026-10-10) and his choice; U3 and U4 if approved. Load the `claude-api` skill first. It may run before, between or after WP2 to WP4: it touches the service, its tests and the docs, and of their files only `server.cjs` (under U3 (b), the health check).

**First, record Jeff's choice** in `docs/plans/tier-2.md` section 16 ("Jeff's choice"): the questions' count, the configurations run, what the run cost (the Console's figure), the model, the effort, whether `FALLBACK_MODELS` changes, and, if he ran it, `--plans`' counts. The date of the change on Render comes after the merge (trap 1); the next session records it. If those counts show recommendations the parser could not resolve, write the structured-output proposal as a decision for Jeff here; do not build it.

**By outcome.**

- **A. `claude-opus-5` at the API's default effort** (`high`; what production sends while `AI_EFFORT` is unset, which Jeff confirms on Render's Environment page). No code change and nothing on Render. The package records the choice and builds U3 and U4 if approved.
- **B. `claude-opus-5` with `AI_EFFORT` `medium`.** Render only: `AI_EFFORT=medium` on the web service (one redeploy). Every call then sends `output_config: { effort: 'medium' }` (T11). A change of top-level effort invalidates the prompt cache (the skill), so the first answer after the redeploy writes the book again and each thread's next follow-up writes its history again. WP10's threads carry on: the same model, and the system blocks' hash (`utils/aiThreads.cjs:50-52`) does not include the effort. Undo: delete `AI_EFFORT`.
- **C. `claude-opus-5-5` at a named effort** (`low`, `medium`, `high`, `xhigh` or `max`). Code: `FALLBACK_MODELS` (`services/anthropic.cjs:52`) gains `claude-opus-5-5`, and its comment (`:49-51`) says why. Nothing else in the request changes: the service sends no `thinking` field (5.5's thinking cannot be disabled, and omitting it runs adaptive), no `tool_choice`, no prefill and no sampling parameter (T1). Render, after the code has deployed: `AI_MODEL=claude-opus-5-5` and `AI_EFFORT=<level>` in one save (one redeploy), the effort set explicitly even when it is `medium`, because 5.5's default is `medium` and `claude-opus-5`'s is `high`. `DEFAULT_MODEL` stays unless U2 (b).

**What C relies on** (the `claude-api` skill, cached 2026-09-25, "Migrating to Claude Opus 5.5"; re-read it in the session):

- **Fallback from day one.** `fallbacks: "default"` with the beta `server-side-fallback-2026-07-01`, the form the service already sends (T10). The permitted targets are published as `allowed_fallback_models` on the model's `/v1/models` entry, expected `claude-opus-5` and `claude-opus-4-8`, both priced (`utils/aiCost.cjs`). A turn the fallback serves runs without 5.5's thinking blocks. 5.5's classifiers add `bio` and `reasoning_extraction` to `cyber`, and a `reasoning_extraction` decline is not retried on a fallback. The prompts ask for "the reasons from the book" for a candidate (`utils/askPrompts.cjs:38`; `utils/transitionPlan.cjs:213-214`, `:257`), not for the model's own reasoning, so nothing in them invites that decline; a decline shows as any decline does (the AI tab's notice, `refusalCategory` in the `ai_call` line).
- **Effort and `max_tokens`.** At a given level 5.5 thinks more per turn than `claude-opus-5`, and thinking counts toward `max_tokens`: Ask and the brief send 32,000 (`utils/askPrompts.cjs:69`), a transition plan 16,000 (`routes/scenarios.cjs:39`). The side-by-side shows any cut-off at 32,000. If Jeff chooses `xhigh` or `max`, or the run shows a cut-off, WP1 raises the limits (the service always streams from Anthropic, so a larger limit risks no timeout) with `ASK_MAX_TOKENS`'s test.
- **Preserved thinking.** 5.5 reads `claude-opus-5`'s thinking blocks, so a WP10 thread begun before the switch continues with its reasoning. The history-editing check (enforced by default for accounts created on or after 2026-08-31) is met by WP10's append-only replay: the same system blocks byte for byte and the earlier turns as stored (`threadHistory`), and a follow-up after a book change is refused (409) before any call. After a rollback, `claude-opus-5` drops 5.5's blocks, unbilled, and the thread continues without that reasoning. Nothing is stripped by our code, before or after.
- **Caches are per model.** The first answer on 5.5 writes the book to the cache again, and each thread's next follow-up its history. 5.5's cache reads cost 0.05x of input ($0.20 per million), already in `PRICES` (`utils/aiCost.cjs:56`).
- **Rate limits.** 5.5 has its own pool. Jeff checks his tier's 5.5 limits in the Console before switching.
- **Prices.** Re-read <https://platform.claude.com/docs/en/about-claude/pricing> (reachable from the container on 2026-09-29) and move `PRICES_READ_ON` only if a price changed.

**Tests that change (C):**

- `tests/ai-grep.test.mjs:99` pins `const FALLBACK_MODELS = ['claude-opus-5'];`: the new list.
- `tests/ai-service.test.mjs`: a request test for `claude-opus-5-5` beside `:309`'s for `claude-opus-5` (streamed, the system blocks unchanged, the fallback beta and `"default"`, `output_config.effort` as set, nothing else); `:327` (`claude-sonnet-5`: no fallback, no beta header) and `:335` (effort only when set) unchanged.
- `tests/ai-cost.test.mjs:36-40` (every model the service can send, and every fallback target, has a price) passes unchanged; `:20` and `tests/ai-service.test.mjs:112` pin `PRICES_READ_ON` and move only with a re-read that changed a price.
- `tests/eval-ai.test.mjs:639-656` (the `--opus-5-5` run "without the fallback": its request `['claude-opus-5-5', 'medium', null]` at `:653`, no beta header at `:655`) and `:286` (the estimate's "Runs without the server-side refusal fallback"), with the note in `utils/evalAi.cjs:596`: they flip, because the tool builds its service through `createService`, which reads `FALLBACK_MODELS`.
- Under U3 (b): the `ai_call` line's fields in `tests/ai-service.test.mjs`, and `/api/health`'s contract (`tests/routes.test.mjs:3142`, `:3151`) gaining `effort`. Under U4 (b): `tests/ai-cost.test.mjs`'s price table.
- Not changed under U2 (a): the tests that pin `claude-opus-5` as the model their servers run (`tests/routes.test.mjs:3142`, `:3151`; `tests/import-db.test.mjs:1287`, `:1713`, `:1729`) and the evaluation tool's base configurations (`utils/evalAi.cjs:37-40`, `tests/eval-ai.test.mjs:111-121`).

**Docs:** `CLAUDE.md` (`AI_MODEL`, `AI_EFFORT`, AI Integration's WP11 paragraph, and U4's alternative); `.env.example:58`; runbook sections 2, 7.6 (what was chosen), 9.3 (U3's `effort`) and 10 (`services`); Tier 2 section 16.

**Traps:**

1. The order on Render: the code first, then the setting. The other way round runs 5.5 without the fallback until the code deploys (a decline shows as one; nothing breaks).
2. D7 is Jeff's: the skill's default model changes nothing here by itself.
3. Never strip thinking blocks from a thread's history, before or after a switch: the API drops what a model cannot read, unbilled.
4. The evaluation tool's base configurations stay `claude-opus-5` (`utils/evalAi.cjs:37-40`). A later run after a switch compares against the old model unless it adds `--opus-5-5`; leave the tool as it is and say so in runbook 7.6.

**Mixed versions:** no page change, so Netlify's timing does not matter. Undoing C is deleting `AI_MODEL` and `AI_EFFORT` on Render (one redeploy): `claude-opus-5` at its default, threads continuing without 5.5's reasoning, the cache written again. A code rollback to before WP1 with `AI_MODEL` still `claude-opus-5-5` runs 5.5 without the fallback, priced (5.5 has been in `PRICES` since `fc2f671`).

**Acceptance:** gates and the four database suites green; the fake Anthropic server's recorded request for `claude-opus-5-5` carries the fallback beta, `"default"` and the effort; a follow-up on a thread whose earlier turns carry `claude-opus-5`'s thinking blocks sends them unchanged.

**Jeff, after deploy:** (C) check the Console's rate limits for 5.5; set `AI_MODEL` and `AI_EFFORT` in one save; `/api/health` shows `model` `claude-opus-5-5` (and `effort`, under U3 (b)); ask one question: its `ai_call` line shows `model` and `servedBy` `claude-opus-5-5` and `cacheWriteTokens` above 0, and a second question within five minutes shows `cacheReadTokens` above 0; follow up a thread begun before the switch; write one transition plan in Stage 2; the AI tab's month line prices both. (B) set `AI_EFFORT`, then the same checks without the model. Either way, tell the session the date of the change.

---

## 6. WP2: Write-path defects

**Size:** one to one and a half sessions. Every item is on a write path or in a route's contract: both table shapes, an end-to-end run, a PR with evidence. **Needs:** U1, U5; U6 for (e).

**Expected outcomes:**

- **(b)** The second-chair route takes its locks in a rename's order: it reads the client without a lock (404 when there is none), reads the people it assigns `FOR SHARE` (the client's lead and originator and the new second chair), then locks the client `FOR UPDATE` and answers 409, with a message of its own, when its lead or originator changed in between. The page needs no change: both callers reload on any 409 and say nothing was written (`src/components/AssociateSplit.jsx:88-92`, `src/components/succession/HireScenario.jsx:389-391`), though their text names the second chair, as it already does for the route's other 409 (a client with no lead); a lead changing in the same instant is rare enough for that wording. Proven by a test that holds a person `FOR UPDATE` on its own connection, as a rename's first statement does, while the route runs, then updates that client as a rename's next statement does: on `origin/main` PostgreSQL aborts one of the two (`40P01`, the route's 500); after, the route waits for the person and completes.
- **(s)** A rename locks the clients it rewrites in id order before its three updates (`SELECT id FROM clients WHERE lead_id = $1 OR second_chair_id = $1 OR originator_id = $1 ORDER BY id FOR UPDATE`, after the person), so two renames at once wait instead of deadlocking; proven the same way with two connections.
- **(c)** One helper logs a failed query's `code` and `message` and, where PostgreSQL sets them, `constraint`, `table` and `column`, never `detail`, `where` or the error object, at every site in 4.1's (c). Proven with a `CHECK (false) NOT VALID` added to `clients` for the test (as `tests/routes.test.mjs:1600-1611` does for `client_changes`): a `PUT` answers 500, and the log names the constraint without the note.
- **(g)** `POST` and a `PUT` that changes the name refuse a name another client has, regardless of case and unescaped (the import's rule, `unescapeStoredSql`): a 400 `Validation failed` with `{ field: 'name', message }` among the fields' details, so the form shows it beside the name (`formErrors`, `src/utils/clientForm.js:105-106`) with no page change. A `PUT` that keeps a client's stored name is not refused, so a pair already stored stays editable until a partner renames or deletes one. Every write that creates or renames a client (`POST`, such a `PUT`, the import when it creates or renames one) takes one transaction-level advisory lock first, so two saves at once cannot both pass. No unique index (U5). `tests/routes.test.mjs:1151` flips.
- **The import's request-check 400** answers each detail as `{ field, message }`, without `value` (`data.cjs:108-112`; `tests/routes.test.mjs:847`; `CLAUDE.md`'s route line).
- **(v)** The transition plan's `plan.clientName` and its saved `client_name` come from the book's entry (`bookClient`), not the request.
- **(w)** The import refuses an amount above `REVENUE_AMOUNT_MAX` (1,000,000,000) with its row, before anything is written (a `checkSheet` problem, the whole file refused, as every sheet problem is).
- **(e)**, if U6 (b) is approved before WP2 starts: `financial` among the complex areas on both sides, `tests/succession.test.mjs` updated (its test at `:183`, "Financial, the form's practice area, is not a complex area", flips), and the PR giving Jeff's count and what moves.

**Not in this package:** any page change; notes' length (U8); the History list's paging (U8).

**Tests:** `routes`, both shapes: (b) and (s) as above, each shown failing on `origin/main`; (c)'s log; (g) on `POST`, on a renaming `PUT`, on a `PUT` keeping a shared name (accepted), and two `POST`s in flight with one name (one 201, one 400); the CSV 400's keys; the plan's name from the book (a request carrying another name). `import-db` or `routes`: (w). Pure tests for the log helper and `checkSheet`'s amount rule.

**Acceptance:** gates and the four database suites green; end to end in headless Chromium: a new client named as an existing one in another case refused beside the name with nothing written; the Associate split's Accept still writes one seat and one `second-chair` history row; a rename on the People dialog still rewrites the legacy text.

**Traps:**

1. WP6's order of refusals holds: (g) is a body 400, before the client is looked up; (b)'s new 409 comes after the 404.
2. Production's integer ids: compare as text; never cast.
3. No `CREATE UNIQUE INDEX` in `init-db.sql`: a pair already stored would fail the whole file and stop the production server at start (constraint 11).
4. The log helper must keep what Jeff reads to act: the code, the message, the constraint. Runbook 9.3 gains nothing (no new event), but 13 ("When something is wrong") may say what the lines now show.
5. The advisory lock key is one constant shared by every name-changing write; client writes are rare, so one lock costs nothing.

**Jeff, after deploy:** `/api/health` `OK`; before the deploy, the read-only check for names already shared (`SELECT LOWER(name), count(*) FROM clients GROUP BY 1 HAVING count(*) > 1`); on Client Details, a new client named as an existing one in another case is refused beside the name; one Accept in the Associate split; from now on an `Error ...` line in Render's logs shows a code and a message, never a row.

---

## 7. WP3: Start-up, scripts, dependencies and docs

**Size:** half a session to one. No write path and no route contract changes; the database suites run because each starts `server.cjs`. **Needs:** U1, U5.

**Expected outcomes:**

- **(o)** `server.cjs` listens only once its start-up (the connection test and `init-db.sql`) has finished. In production a failure still exits before listening; in development it still listens without a database, as today. On Render, a deploy then takes traffic only once its tables exist, and no route answers 500 for the moments before. Proven by a test that holds a lock `init-db.sql` needs, on its own connection, while `server.cjs` starts: on `origin/main` the port answers before the lock is released; after, nothing listens until it is. `tests/helpers/server.mjs:55-57` already waits for both lines, so no helper changes.
- **(t)** Runbook 9.2's order is then the code's; the text is checked against a real start.
- **(r)** Every `require('dotenv').config()` passes `{ quiet: true }` (the seven sites in 4.1), so the scripts print only their own lines; no test reads the banner (`tests/eval-ai.test.mjs:660` asserts its absence for the one script that already has it).
- **Dependencies:** `isomorphic-dompurify` removed (with `jsdom` and whatever else only it needed; the lockfile regenerated with `npm uninstall`, never by hand); `validator` moved to `devDependencies`, since only tests import it and `express-validator` brings its own. The PR gives `npm ci`'s package counts before and after, with and without dev dependencies, and `npm audit` before and after.
- **(i)** The four reads in `tests/routes.test.mjs` wait for their line (`waitFor`), as constraint 8 says.
- **(u)** `README.md`: the tables line names `scenarios`; "Where the plan lives" names the plans as they are (Tier 0, 1 and 2 done in code with Jeff's checks, this plan proposed), in two or three sentences, pointing at `CLAUDE.md`'s "Current work plan" rather than repeating it.

**Tests:** the start-up test above (in `routes`, which starts servers of its own; both shapes need not differ, one is enough); the four waits; nothing else changes. `npm test` and the four suites keep their counts but for the new test.

**Acceptance:** gates and the four database suites green; `npm ci` from a clean `node_modules`; `npm run build:prod`'s bundle does not grow; a start on a fresh database prints `Database tables initialized` before `Server running on port`.

**Traps:**

1. Render's build runs `npm install` over its cache (`deploy/README.md:89`): a lockfile that removes packages is fine, but check `package.json` and the lockfile agree (`npm ci` fails when they do not; `npm install` would not).
2. Keep the development path listening without a database: a partner's local run without PostgreSQL still gets the page's sign-in error, not a hung process.
3. Do not change what the scripts print beyond the dotenv line: runbook 7.1 to 7.6 quote their output.

**Jeff, after deploy:** the Render deploy log's package count (fewer); the start-up log's order (runbook 9.2); `/api/health` `OK`.

---

## 8. WP4: The client form and Stage 2's leftovers (page only)

**Size:** half a session to one. Page only: no route, no schema, no feature name (the page asks the API for nothing new). **Needs:** U1, U5; U7 for (k).

**Expected outcomes:**

- **(j)** A revenue row with a year and no amount is not an error (`validateRevenueEntry`, `src/utils/validation.js:189-191`). The save already leaves such a row out (`revenuesToSend`, `src/utils/clientForm.js:63`, which keeps only rows with both), so a new client saves without revenue and a stored client with none saves unchanged. The row stays in the form for the partner to fill.
- **(x)** An amount of 0 is not "missing": `validateRevenueEntry` (`:182-191`) tests for a value, not for truth, so a client with a stored $0 row saves again. The save leaves the $0 row out (`revenuesToSend` reads 0 as none, as the import's year rule reads `$0`, D5), so the stored row goes at the next save that changes something, and the history logs nothing for it (WP6 reads a `$0` row as none).
- **(k)**, if U7 (b): the form allows no practice area (`src/utils/validation.js:33-45`), as the API, the import and the book do; `src/utils/validation.js`'s rules and `utils/clientRules.cjs` stay equal (`tests/client-rules.test.mjs`).
- **(n)** Stage 2's "AI Plans" count and its "No AI plan" filter read the AI's own fields (`plan.ai`), so a plan holding only a partner's text is not counted as an AI plan (`src/components/succession/ClientReviewInterface.jsx:477`, `:670`).
- **(h)** and **(z)** deleted: `resolveClientAxes` (`src/utils/clientMetrics.js:94`), and the store's uncalled actions and unread state (4.3's (z)), with `optimizationParams` out of `partialize` (a stale key left in a partner's localStorage is ignored by the store).

**Tests:** `client-form` (a new client and a stored client with no revenue save; a stored $0 row saves; a year with no amount is left out), `client-rules` (the form's rules, under U7 (b)), and a small pure test for Stage 2's count if it lives in a helper; lint catches a deleted name still referenced.

**Acceptance:** gates green; the four database suites unchanged; end to end in headless Chromium: a new client saved with no revenue (and, under U7 (b), no practice area); an imported client with no practice area saved after changing only its Stickiness, with one history row naming only Stickiness; a client with a $0 row saved; Stage 2's count with a partner-only plan.

**Traps:**

1. `revenuesToSend` and `clientRequestBody` are held equal to frozen copies of the code they replaced (`tests/client-form.test.mjs`): (j) and (x) need no change there, only in the form's validation; leave them as they are.
2. A save that changes nothing still writes nothing (WP6): check it end to end for a client with no revenue and for one with a $0 row.

**Jeff, after deploy:** add a client with no revenue; open an imported client with no practice area and change its Stickiness; Stage 2's "AI Plans" count after editing a plan's strategy by hand.

---

## 9. Packages that exist only if Jeff approves them

Sketches, so that Jeff can weigh each decision; the session that builds one first expands its section to the shape of sections 5 to 8 (outcomes, tests, acceptance, traps, "Jeff, after deploy") and has Jeff approve that.

- **WP5: Exposure on the Dashboard (U12 (a)).** A Dashboard card and a per-lead breakdown of the reporting year's revenue on clients rated Stickiness 1 or 2, with unrated clients counted apart and never as safe (T5), computed on the page by a port held equal to `utils/book.cjs`'s exposure (`:328-332`, written out by `exposureSection` at `:493`) by a parity test, as `src/utils/load.js` is (the server never requires the page's code, T3). A lead's figure opens their clients (`components/PersonLoadSheet.jsx`). No API change, no feature name, no write. Half a session to one.
- **WP6: Where a new client fits (U12 (b)).** The brief's sandbox: a name, a rough revenue, practice areas and an expected cadence (and optionally a Stickiness) give, with nothing saved, the client's strategic value and effort from the one scorer's page mirror, the partners ranked as a lead would be in a departure (practice-area fit, then the lighter total load, `rankCandidates` and `totalLoad`), each with their load before and after against the partners' average, and any conflict flag. A suggestion, never an assignment (P9, the brief). A partner who then wants the client adds it on Client Details as today. Probably a third kind of scenario under "What to model", so it can be saved if wanted (S12). One and a half to two sessions.
- **WP7: Second-chair relief for the firm (U10 (b) or (c)).** P10 amended in `src/utils/load.js` and `utils/book.cjs` together, `SECOND_CHAIR_EFFORT_SHARE`'s readers checked one by one, `tests/book.test.mjs` and every load test updated, S19's toggle removed, and the book's text change handled as constraint 10 says (the PR says so; it is what any client edit already does). One session.
- **WP8: AI plans that see the scenario's seats (U11 (b)).** The request gains the scenario's current seats for the other affected clients, as ids; the server checks them against the People list and the book and lists them in the user turn (never the system blocks, T8), without new figures (T14); the prompt asks the plan to weigh them. A new feature name beside `transition-plan-roster`, since an older API would ignore the new field and the page would say the plans saw the seats when they had not. One to one and a half sessions.
- **WP9: Vite 8 (U13 (b)).** Vite and `@vitejs/plugin-react` to the versions `npm audit` then names, `vite.config.js` adjusted, Netlify's `NODE_VERSION` 22 checked against Vite 8's Node requirement, the build's output compared (bundle, CSS warnings, headers), `npm audit` 0 with and without dev dependencies, runbook 12 rewritten; no React major. One session.

---

## 10. Deploying a work package

As Tier 2 section 17: merging to `main` deploys; Netlify publishes the page within about a minute; Render deploys the API if its auto-deploy is on. Then `/api/health`: `status` `OK`. No package here adds a feature name, a table or a column (unless U3 (c) or a package in section 9 is approved); one that did would need the green backup before its merge and the next night's run counting it. WP1's switch is a Render setting after its code deploys (section 5). Roll both providers back together (runbook section 5); WP1's switch is undone on Render alone.

---

## 11. What Tier 3 leaves for later

- A load trend (U12 (c)): once `client_changes` holds months of history.
- Compensation inputs (U12 (d)).
- A view of a finished scenario, whose transition sheet has been imported ((l)).
- A V4 migration that drops the retired columns (`relationship_strength`, `renewal_probability`, `strategic_fit_score`, `relationship_intensity`), `status` and the always-40 `timeCommitment` from the responses, once no Render rollback target reads them (P13's note).
- Production's integer ids to uuids (a migration of its own).
- An associate's promotion to partner (not for at least five years).
- A retention rule for saved answers.
- Stage 3's tasks by id ((m)) and the History list's paging ((d)), if either starts to bite.
- A time-to-first-word instruction, if the pause before streamed text bothers partners.
- React 19.
