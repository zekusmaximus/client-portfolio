# Tier 2 Plan: A shared six-partner tool

**Status:** approved by Jeff on 2026-09-27: S1 to S17 as proposed, and S18 and S19 (an associate in Scenarios, WP9), added at his request and approved as proposed the same day. No Tier 2 code starts before the gate in S1. Written 2026-09-27 against `0b7f6b6` (`main` after PR #37, Tier 1 WP6).
**Why:** after Tier 0 and Tier 1 the book is correct, the AI reads the whole book, and every answer is saved and shared. What is still one browser's, or nobody's, is everything else a shared tool needs: who changed a client and when, the Scenarios work a partner does (lost on refresh, invisible to the other five), server-side checks on what the client form writes, and an input path that stores what partners typed rather than HTML-escaped text. `REVIEW-2026-09.md` section 7 calls the persistence gap "the gap that matters most after the year bug"; section 8's Tier 2 lists the rest.
**Background:** `REVIEW-2026-09.md` sections 4, 7 and 8 (Tier 2); `docs/plans/tier-0.md` sections 10 to 12; `docs/plans/tier-1.md` section 13; `docs/plans/people-and-second-chair.md` (P2, P5, P6, P9, P11, P13); `PRODUCT_BRIEF.md`.
**Audience:** future Claude Code sessions and Jeff. Sessions run in a container with the repository, a local PostgreSQL and no Anthropic key, and cannot reach Render, Netlify or gbacpod.com; every step on production is Jeff's.

---

## 0. How a session uses this document

### 0.1 Read order

1. `CLAUDE.md` (architecture, commands, the rules that bind every change).
2. This file: section 1 (decisions), section 2 (status), section 3 (constraints), section 4 (what is already done), then the one work package you are executing.
3. For the AI packages (WP10, WP11), load the `claude-api` skill before writing anything about models, caching, multi-turn requests, thinking blocks or prices, and use what it says is current.

### 0.2 Working agreement

1. One work package per branch and pull request, in section 2's order unless a package says it may move. Branch from `origin/main` after the previous package has merged. Jeff's production checks may trail the next package by one at most (as Tier 1's 0.2).
2. Gates before and after, all green: `npm ci`; `npm run lint` (0 errors; the 3 expected `exhaustive-deps` warnings); `npm test`; `VITE_API_BASE_URL=https://gbacpod.com npm run build:prod`; both database suites on a throwaway local PostgreSQL (`CLAUDE.md`, Testing). CI's `schema` job runs them on PostgreSQL 18, which lists each `NOT NULL` in `pg_constraint` as `contype 'n'`: allow for it in any catalog query a test makes.
3. Schema changes only in `init-db.sql`, idempotent, one transaction with the rest of the file; never drop or rename a column or table an older `init-db.sql` names; never a data backfill there that can match rows created after it first ran (`CLAUDE.md`, `init-db.sql`). A data repair is a guarded script (the `reset-book` pattern: a read-only preview, then `--confirm` in one transaction that commits only if the counts are as expected).
4. Unchanged rules: the scoring weights in `utils/strategic.cjs`; no React or Vite major upgrade (S13); one Anthropic call site (`services/anthropic.cjs`, T1); never run anything against production; never commit a key or a password; no test uses a real Anthropic key.
5. Every package ends with the gates green, `CLAUDE.md` updated where behaviour it documents changed, this file's status table updated in the same PR, and a PR description that lists the package's expected outcomes with the evidence for each, and copies its "Jeff, after deploy" items.
6. Each new test is shown failing against the code it covers before it passes, where that is meaningful (for a route: the new `import-db` or `routes` tests run against `origin/main`'s server in a worktree, with only the test files and the pure helpers they import copied in).
7. If this plan and the code disagree, the code wins; say so in the PR and in section 2's notes.

### 0.3 Session start checklist

```bash
git fetch origin
git checkout -b <the session's branch> origin/main
npm ci
npm run lint
npm test
VITE_API_BASE_URL=https://gbacpod.com npm run build:prod
service postgresql start   # then the ALTER USER in CLAUDE.md's Testing section
```

---

## 1. Decisions

"Approved" means Jeff approved the decision as written (2026-09-27); a session treats it as settled, and a change goes back to Jeff. "Proposed" means this plan's recommendation, not yet approved: a session does not build on it until Jeff approves it. "Carried" means an earlier decision this plan keeps.

| # | Decision | Rationale | Status |
|---|---|---|---|
| S1 | **The gate.** Tier 2 code starts when (a) Jeff has run Tier 1's WP3 to WP6 after-deploy checks (`docs/plans/tier-1.md` sections 8 to 11) and (b) WP0's docs part has merged. This plan and WP0 may land before; WP0's prompt tuning follows Jeff's first answers and may run alongside WP1. | Tier 1's 0.2 lets production checks trail by one package; four are open. The backups check (Tier 1 WP4) must be green before Tier 2 adds tables. Jeff's first real answers decide WP0's prompt changes, and the saved costs decide WP11. | approved (Jeff, 2026-09-27) |
| S2 | **Contract tests per route.** A new suite, `tests/routes.test.mjs`, runs `server.cjs` on both table shapes (as `import-db` does) and pins, for every registered route, its success status and top-level keys, the keys the page reads, its 401 without sign-in, and its documented 400/404/409 answers. An inventory test reads the route files and fails when a route is registered without a contract entry (as `ai-grep` reads the source). | The review's Tier 2 item 4: "so a UI/backend shape mismatch cannot ship again". Today every HTTP test lives in `import-db`, ordered around the import; logout, `/me`, change-password, the health fields and every 401 outside `/api/ai` have none (section 3 item 8). The later packages change routes; the net goes in first. | approved (Jeff, 2026-09-27) |
| S3 | **Delete what nothing calls.** The three `/api/data` endpoints and the second scoring formula, `optimizePortfolio`, the four unused express-validator rule sets, the store's uncalled actions, `@radix-ui/react-icons` and `nodemon`. | The review's 4.5; `CLAUDE.md`'s "single source of truth" is true only once the second formula is gone. `clientValidationRules` escapes with `validator.escape` (`middleware/validation.cjs:5-14`): wiring it later would bring storage escaping back. | approved (Jeff, 2026-09-27) |
| S4 | **Retired columns.** Stop reading and writing `relationship_strength`, `renewal_probability`, `strategic_fit_score` and `relationship_intensity` in code; the columns stay in the table (rollback, 0.2 item 3). The score's stand-in for an unrated client (today derived from `relationship_intensity`, `utils/strategic.cjs:137-141`, about 4.44 when it is 5) becomes a named constant with the same value, once a read-only count on production shows every client at `relationship_intensity` 5; otherwise Jeff chooses. | An unrated client's strategic value rests on a retired column the form no longer writes. A constant equal to today's value changes no score (D6 and the weights untouched) and lets the import stop writing retired columns; their column defaults already give new rows the values the import writes today (5, 0.7, 5 and 5; `init-db.sql` and production's older table alike). | approved (Jeff, 2026-09-27) |
| S5 | **The "Enhanced" badge** (Client Details) counts a client as complete when it has a stickiness pick and a cadence, the brief's "two quick picks", instead of fields every API client has. | `isClientEnhanced` (`src/utils/clientUtils.js:11-33`) keys on `strategicFitScore`, which `toApiClient` sets to 5 for every client (`data.cjs:645`), so every client shows "Enhanced" and the rate is 100%. | approved (Jeff, 2026-09-27) |
| S6 | **bcrypt 6**, alone in its package, verified with a Render deploy. | The runbook's section 12: the one critical advisory (`tar`, via bcrypt 5's `node-pre-gyp`) runs at `npm ci` on Render; bcrypt 6 drops node-pre-gyp. A native module, so its own PR (as the runbook says). | approved (Jeff, 2026-09-27) |
| S7 | **Validation on the live write path.** One pure module, `utils/clientRules.cjs`, holds the client vocabularies the import already enforces (`utils/csvImport.cjs:173-176` and its `readSheetRow` checks) and the form's name pattern, and `POST`/`PUT /api/data/clients` apply it: 400 `{ success: false, error: 'Validation failed', details: [{ field, message }] }`, the shape `validateAssignment` already answers. A `PUT` without `revenues` leaves revenue as it is instead of deleting every row. The page's `src/utils/validation.js` keeps its copy, held equal by a parity test. No express-validator chains. | The review's 4.8: the live `POST`/`PUT` check only the people (section 3 item 6); a direct request stores any practice area, cadence, stickiness or amount, and a `PUT` without `revenues` deletes the client's revenue (`data.cjs:811`, `:849`). | approved (Jeff, 2026-09-27) |
| S8 | **Stop escaping on the way in; repair what is stored.** `sanitizeRequestBody` goes from `data.cjs` and `routes/scenarios.cjs`, the CSV path stops decoding cells, and the page's `sanitizeFormData` stops running text through DOMPurify (React renders text; there is no raw-HTML sink, section 3 item 7). Validation (S7) takes over trimming. The text already stored escaped is repaired by a guarded one-off script, `scripts/unescape-book.cjs` (preview, then `--confirm` in one transaction), never by `init-db.sql`. The one-level display decoders go once Jeff has run the repair; `unescapeStored` stays in the import's name matching as a harmless guard. | The review's 4.9. Stored `&amp;` shows raw in more than a dozen places on the page and prints literally in the Partnership report (section 3 item 7); a note with `<` is stored two levels deep. `init-db.sql` runs at every start and each pass would strip another level (`CLAUDE.md`). The repair cannot tell a typed literal `&amp;` from an escape; nor can today's decoders, so nothing new is lost. | approved (Jeff, 2026-09-27) |
| S9 | **Who changed what.** A `client_changes` table records one row per client per write that changed something: who (`changed_by`, a key to `users` `ON DELETE SET NULL`, with the username copied), when, the source (form, import, second chair, delete), and each changed field with its before and after, revenue by year included. It is written in the same transaction as the change, so a change never lands without its row. `client_id` is text with no key to `clients` (production's integer ids; `reset-book` refuses a key that does not cascade, and history should outlive a deleted client and a reset). `clients` gains `updated_by`. `clients.user_id` stays as it is (Tier 0 12.1 left that to this plan: it is the only record of who created the pre-July-2025 clients). | The review's section 7: "no one can tell who changed a stickiness rating". Tier 1 section 13's load trend needs this history. Only real changes are logged: the import rewrites every matched client (`data.cjs:378-385`) and must not log a change for each. | approved (Jeff, 2026-09-27) |
| S10 | **Edit conflicts.** `PUT /api/data/clients/:id` carries the `updated_at` the page loaded; a stale one answers 409, and the page reloads the client and says who changed it (from S9). Feature name `client-edit-conflict`. | Today a `PUT` is a full overwrite with no lock (`data.cjs:822-841`): two partners editing one client lose the first save silently, revenue included. The second-chair route already works this way (409 on a stale seat). | approved (Jeff, 2026-09-27) |
| S11 | **Succession metrics on the server.** `utils/succession.cjs` computes `relationshipType`, `transitionComplexity` and `successionRisk` from the nested people, not the legacy text, and every client response carries them, as it carries `strategicValue` and `effort`. The page reads them; its `successionUtils.js` stays only for the client form's live preview, held equal by a parity test. The transition-plan route computes them itself and ignores the request's. The rule changes this brings (listed in WP7) move badges; Jeff approved them with S11. | Tier 1 section 13. Today the metrics are computed in the browser from `primary_lobbyist`, `lobbyist_team` and `client_originator` (`src/utils/successionUtils.js:14-51`), cadence counts twice, and the plan's prompt takes them from whatever the page sends. | approved (Jeff, 2026-09-27) |
| S12 | **Saved scenarios.** A `scenarios` table holds named scenarios every partner can open, save and delete: what the partner entered (who is leaving, the stage, the seat choices, each plan's AI fields with its `answerId` and the partner's edits kept apart, approvals, Stage 3's statuses, tasks and communication log), never what the engine derives from the book. Saved with a version number (409 on a stale save). Opened against the current book: a choice the book no longer allows is refused with the engine's reason, as today. Feature name `saved-scenarios`. | P11 deferred it; the review's section 7 and Tier 2 item 2. The departure model is recomputed from the book at every render (`SuccessionScenario.tsx:40-50`), so storing only the inputs keeps a scenario valid as the book changes. | approved (Jeff, 2026-09-27) |
| S13 | **Upgrades not in Tier 2.** No Vite 8 or React major. | Vite 4's advisories touch only `npm run dev` (runbook 12); a major upgrade is its own plan. Revisit after Tier 2. | approved (Jeff, 2026-09-27) |
| S14 | **Follow-up questions (lifting T7).** A partner can ask up to five follow-ups on an answer. Each follow-up sends that thread's earlier turns unchanged after the cached book, as the `claude-api` skill requires for multi-turn requests (append-only history; the assistant's content blocks replayed as returned). A saved answer therefore also stores its content blocks and its parent. Each turn is saved and costed like any answer; the rate limits count each turn (T16). | Tier 1 section 13. T7 deferred it because follow-ups resend the earlier turns and cost more as a thread grows; a limit of five keeps the worst case bounded. | approved (Jeff, 2026-09-27) |
| S15 | **Answers on an earlier book, and hiding answers.** The Recent answers list marks an answer given on a book other than today's (the stored `book_sha256` against the current book's hash). Any partner can hide an answer from the list; it stays in the table with who hid it and when, and "Show hidden" lists them. No deletion, no retention rule. | Tier 1 section 13 offered "deleting or hiding an answer, with a retention rule". Hiding keeps the shared record intact, which is the point of T12; a retention rule can come later if the table grows. | approved (Jeff, 2026-09-27) |
| S16 | **Model and effort from real answers.** After two to four weeks of saved answers, a session builds an evaluation set from the firm's real questions (Jeff picks them), runs it at `AI_EFFORT` `medium` and at the default, and on `claude-opus-5-5` if Jeff wants it compared; Jeff approves the spend first and chooses. The code change is then `PRICES`, `FALLBACK_MODELS` and `AI_EFFORT` (a 5.5 switch sets `AI_EFFORT` explicitly: its default is `medium`, Opus 5's is `high`). Structured output for transition plans only if the saved plans show recommendations the parser could not resolve. | Tier 1 section 13; WP3's finding on `claude-opus-5-5` (D7 is Jeff's). A choice made on real questions and real costs, not on guesses. | approved (Jeff, 2026-09-27) |
| S17 | **Not scheduled; Jeff decides whether any joins a later plan:** the brief's what-if sandbox ("where a new client fits"); exposure on the Dashboard (today only the AI's book shows it); a load trend (needs S9's history to accumulate for months); surfacing the inputs to compensation conversations (brief, build step 5). | Each is product scope beyond the review's Tier 2. The brief calls exposure "the most actionable single signal"; the page never shows it. | approved (Jeff, 2026-09-27) |
| S18 | **An associate in Scenarios.** Scenarios gains a second kind of scenario, "Add an associate": one or more hypothetical associates (a label, optional practice areas of focus, a target), proposed second-chair seats from the partners' books ranked by how far each partner's load sits above the partners' average, picks the partner edits freely, and every person's load before and after. Nothing is written: the hypothetical person never enters the People list, the book, the AI or any other tab. Saved and shared with S12. Once the associate is hired and on the People list, the scenario's picks can be accepted one at a time through the associate split's write (P9). Promotion to partner, and so to lead (P3), is not modelled. | Jeff, 2026-09-27: "add an associate and workshop ideas for client second chair assignments based on current partner loads"; the associate would lead once made partner, and no partners will be named for at least five years. The ranking already exists (the departure engine, Phase 5; the associate split, Phase 6): a hire is the same question asked the other way round. | approved (Jeff, 2026-09-27) |
| S19 | **Associate relief, a scenario-only toggle.** Off by default. When on, and only in a hire scenario's figures, a client whose second chair is an associate moves the second chair's share (20%, `SECOND_CHAIR_EFFORT_SHARE`) off the lead: the lead carries 80% of that client's effort instead of all of it, and the associate the 20% as now. The Partnership tab, the Dashboard, the book and the AI keep P10 as amended. Adopting it for the whole firm is a later decision: it amends P10 and changes `src/utils/load.js` and `utils/book.cjs` together, which `tests/book.test.mjs` holds equal. | Under P10 as amended a lead carries a client's full effort whoever the second chair is, so an associate second chair relieves no lead: a workshop about relieving partners would show relief only where an associate takes a seat a partner held as second chair. Jeff raised a formula change or a toggle; a toggle inside the scenario lets the partners see both readings before anyone changes the firm's numbers. The 20% is P10's own share; another figure is Jeff's call. | approved (Jeff, 2026-09-27) |
| — | Carried unchanged: the one scorer and its weights; one Anthropic call site and T1's request rules; the People model and its rules (P2 no roles or permissions, P3, P5, P9 no bulk seat moves); the brief's "no swap optimizer" and "no compensation math"; D11's rate limits (T16); T12's shared answers. | | carried |

---

## 2. Status table (sessions update this)

| WP | Title | Size | Status | Branch / PR | Notes |
|---|---|---|---|---|---|
| WP0 | Close out Tier 1 | 0.5 session | PR open | `claude/busy-ritchie-csogzc`, [PR #39](https://github.com/zekusmaximus/client-portfolio/pull/39) | Docs part: the runbook's 9.3 lists every log line the source writes (13, a grep in the PR; `ai_error` also gained `type`); `README.md` names the five tables; Tier 1's WP3 to WP6 verified on gbacpod.com with Jeff's figures, so S1's part (a) is met and part (b) with this PR's merge. Found and fixed at Jeff's request: the catch blocks in `routes/ai.cjs` and `routes/scenarios.cjs` said a missing key is "already described by the ai_error log line", but `complete()` throws before its logging `try`, so a missing key writes no line (9.3 says so); both comments corrected, no behaviour changed. The prompt tuning: Jeff found the first answers' tone and length right and saying so when the book lacks the information, so no change is needed now; revisit if later answers show one. Seen in WP6's check: the four plans all recommended the same lead, since each is written alone (Tier 1 section 11's box); noted in section 13 (WP8) for Jeff's decision |
| WP1 | Contract tests per route | 1 session | not started | | |
| WP2 | Dead code and small defects | 0.5 to 1 session | not started | | S4's count done: Jeff's read-only query on production on 2026-09-27 found one row, `relationship_intensity` 5, `relationship_strength` 5, `renewal_probability` 0.70, for all 84 clients, so the constant changes no score |
| WP3 | bcrypt 6 | 0.5 session | not started | | May run any time after WP1 |
| WP4 | Validation on the live write path | 1 session | not started | | |
| WP5 | Stop escaping; repair stored text | 1 to 1.5 sessions | not started | | Jeff runs the repair between WP5 and its follow-up |
| WP6 | Who changed what, and edit conflicts | 1.5 sessions | not started | | |
| WP7 | Succession metrics on the server | 1 session | not started | | |
| WP8 | Saved scenarios | 2 sessions | not started | | |
| WP9 | An associate in Scenarios | 1.5 to 2 sessions | not started | | S18 and S19; after WP8 |
| WP10 | Follow-up questions; earlier-book marker; hiding answers | 1.5 sessions | not started | | |
| WP11 | Model and effort from real answers | 1 session and Jeff's review | not started | | Needs weeks of saved answers and Jeff's spend approval |

Status values: `not started`, `in progress (date)`, `PR open`, `merged`, `deployed`, `verified on gbacpod.com`.

**Size, honestly.** About 13 to 14 sessions, against the review's "about a week". The difference is what Tier 0 and Tier 1 taught: each package that touches a write path runs on both table shapes, gets an end-to-end run in the container and a PR with evidence, and three packages (WP5, WP8, WP11) need Jeff between their steps. WP9 was added at Jeff's request on 2026-09-27.

---

## 3. Constraints every work package keeps

Each was checked against the code at `0b7f6b6`.

1. **Production's older tables.** `clients.id` and `client_revenues.client_id` are integers on Render and uuids in `init-db.sql`; production's `client_revenues` has no timestamps and may lack `UNIQUE (client_id, year)` (`tests/import-db.test.mjs`, `PRODUCTION_TABLES_SQL`). Compare ids as text (`data.cjs:383`, `:921`, `:955`) or use untyped placeholders; a new table's `client_id` is `TEXT` with no key, as `ai_answers.client_id` is (`init-db.sql`, the `ai_answers` table).
2. **Keys to `users` never cascade.** `check-schema` fails and `delete-user` refuses while any key to `users` cascades (`utils/schemaCheck.cjs:12-20`, `scripts/delete-user.cjs:40-44`): `ON DELETE SET NULL`, with the username copied beside it. The session token is not re-checked against `users` (`middleware/auth.cjs:15`), so write the key as `(SELECT id FROM users WHERE id = $n)`, as `utils/aiAnswers.cjs` does, and a session that outlived its account still saves.
3. **Keys to `clients` cascade or do not exist.** `reset-book` refuses while any key to `clients` does not cascade, and commits only if every referencing table is empty afterwards (`utils/schemaCheck.cjs:51-59`, `scripts/reset-book.cjs:114-127`). History that must outlive a client (S9, S12) has no key.
4. **New columns are nullable or have defaults.** `deploy/backup/selftest.sh:53-56` inserts clients with an explicit column list; a new `NOT NULL` column without a default breaks the backup self-test. A new `clients` column appears in every client response (`clientsQuery` selects `c.*`, `data.cjs:612-631`; `withPeopleFields` removes only the joined keys and `status`).
5. **Netlify before Render.** The page publishes about a minute after a merge; Render may lag. Page behaviour that needs new API behaviour gets a name in `/api/health`'s `features` (`server.cjs:135`: `check-file`, `transition-plan-roster`, `second-chair-assign`, `ai-book`, `ask-the-book`, `ai-answers`, `ai-stream`) and a check on the page. Names this plan adds: `client-edit-conflict` (WP6), `saved-scenarios` (WP8), `ai-threads` (WP10).
6. **What the live client writes check today.** Only the people (`validateAssignment`, `utils/people.cjs:78-127`, via `data.cjs:654-666`). The four express-validator rule sets in `middleware/validation.cjs` (`:17-148`, `:198-209`) have no importer; `handleValidationErrors` on the transition-plan route has no rules before it and does nothing; `error.param` should be `error.path` in express-validator 7 (`data.cjs:134`, `middleware/validation.cjs:156`). Four handlers take a pool client without `await` (`data.cjs:160`, `:697`, `:790`, `:972`), so a failed connect throws again in `finally`.
7. **What is stored escaped, and who decodes it.** `sanitizeRequestBody` (`middleware/validation.cjs:173-195`) trims and escapes every string on `/api/data` (`data.cjs:40`) and `/api/scenarios` (`routes/scenarios.cjs:23`); `routes/people.cjs` and `routes/ai.cjs` deliberately skip it. So `clients.name` and `clients.notes` saved through the form are escaped (notes with a `<` twice, because the page's DOMPurify serializes first: `src/utils/validation.js:4-7`, `:226-246`), and legacy people text from before `ca89493` may be. Decoders: server `utils/escaping.cjs` (the book, the plan, the import's matching, saved answers), two copies of `decodeHTMLEntities` (`data.cjs:43-55`, `clientAnalyzer.cjs:25-37`, so a CSV `CLIENT` is decoded twice); page `src/utils/escaping.js`, `formatClientName` (`src/utils/textUtils.js:47`, about twenty call sites). Raw, escaped displays: `PartnershipAnalytics.jsx:122`, `AssociateSplit.jsx:80`, `:91`, `:197`, `:209`, `:244`, `PersonLoadSheet.jsx:58`, `ClientReviewInterface.jsx:264`, `:277`, `:502`, `TransitionPlanManager.jsx:131`, `:209`, `:320`, and the Partnership report (`src/utils/partnershipExports.js:106` escapes the stored text again). No `dangerouslySetInnerHTML` anywhere; `react-markdown` renders no raw HTML.
8. **Tests.** Every HTTP test is in `tests/import-db.test.mjs` (36 per shape, order-dependent, one database per shape). With no HTTP test: `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password`, login's 400/401 and its limiters, `/api/health`'s `status` and `services`, any 401 on `/api/data`, `/api/people` or `/api/scenarios`, a 400 on `POST`/`PUT /api/data/clients`, a 404 on `PUT` or `DELETE`, `POST /api/people`'s 400 and 409, and a person's rename or role change (the rename rewrites the clients' legacy text, `routes/people.cjs:103-111`). No test imports `db.cjs`, `data.cjs`, `models/*`, a route file or `utils/jwt.cjs`; a new rule lives in a pure module.
9. **Scoring.** One scorer (`utils/strategic.cjs`), weights untouched, D6 unchanged. The second formula (`data.cjs:57-84`) is dead code (S3), not a second source of truth to reconcile.
10. **The AI.** One call site; T1's request rules; `AI_MODEL` the one model setting; the book byte-identical for the same data and nothing per request in the system blocks (T8); the rate limits (T16).
11. **CSP.** The page may call only itself and the API (`netlify.toml`); nothing in this plan adds an origin.
12. **People and the brief.** No roles or permissions (P2): every signed-in partner can do everything, including deleting a saved scenario and hiding an answer. People are never deleted (P5). Seats are never moved in bulk (P9). The tool suggests; partners decide.

---

## 4. Already done (the previews' Tier 2 items that landed earlier)

| Preview item | Where it landed |
|---|---|
| A `partners` table replacing `src/constants.js` | The People list, `docs/plans/people-and-second-chair.md` Phase 1 (P1) |
| One status vocabulary | Superseded: contract status retired (P13) |
| Removing an account never removes clients | `docs/plans/tier-0.md` section 12.1, PR #18 |
| Archive the root status files; correct the formula and tab list in `CLAUDE.md`; a real `README.md` | Tier 0 WP5, PR #17 |
| Unused dependencies (multer, jwt-decode, uuid, dompurify, react-router-dom, class-variance-authority, react-dropzone, node-fetch, p-limit) | Tier 0 WP5, `4f8957b` |
| `/api/auth` mounted twice | Tier 0 WP3, `845a608` |
| The succession metrics' `communication_frequency` read and `parseFloat` of the conflict label | `2b5d399` (people plan Phase 5a); `tests/succession-utils.test.mjs` holds both. The legacy-text reads remain (S11) |
| `TransitionChecklist`'s localStorage (review section 7) | Gone with the component, `631c4d1` (people plan Phase 4) |

---

## 5. WP0: Close out Tier 1

**Size:** half a session, in two parts.
**Expected outcomes:**

- The runbook documents the log lines partners and Jeff now read: section 9.3's `ai_call` row lists WP1's fields (`servedBy`, `fellBack`, `refusalCategory`, `cacheReadTokens`, `cacheWriteTokens`, `costUsd`), and the table gains `ai_answer_save_failed`, `ai_cost_unknown_model`, `ai_on_start_error`, `ai_on_text_error`, `ai_book_error`, `ai_answers_error` and `anthropic_base_url_ignored`. Today the row lists only `label`, `userId`, `model`, `stop`, the two token counts and `ms`, while WP6's after-deploy check asks Jeff to read `cacheReadTokens`.
- `README.md`'s database line names every table (`users`, `clients`, `client_revenues`, `people`, `ai_answers`).
- `docs/plans/tier-1.md`: WP3 to WP6 set to `deployed` or `verified on gbacpod.com` with Jeff's figures (the first five answers' costs, the before figure of WP6, the cache reads).
- Second part, after Jeff's first real answers: `ASK_INSTRUCTIONS` tuned from what they show (Tier 1 section 8 expected "a small follow-up PR"), with `tests/ask-prompts.test.mjs` keeping every rule's key phrase.

**Acceptance:** gates green; the runbook's table matches every `event` in the source (a grep in the PR); Jeff's figures recorded.

---

## 6. WP1: Contract tests per route

**Size:** one session.
**Expected outcomes:**

- Every route the server registers has a contract: its success status and top-level keys, the keys the page reads (named in a comment with the page file that reads them), its 401 without sign-in, and its documented refusals. The 21 live routes (24 with the three S3 deletes; `routes/auth.cjs:28`, `:61`, `:67`, `:92`; `data.cjs:159`, `:675`, `:696`, `:789`, `:903`, `:971`; `routes/people.cjs:24`, `:38`, `:60`; `routes/ai.cjs:32`, `:166`, `:174`, `:187`, `:202`, `:213`; `routes/scenarios.cjs:59`; `server.cjs:115`).
- The gaps in section 3 item 8 closed.
- A route added without a contract fails the suite.

**Changes by file**

- `tests/routes.test.mjs` (new): both table shapes, its own database per shape, `server.cjs` as a child process (the helpers `import-db` uses, moved to `tests/helpers/server.mjs` and shared). Independent of `import-db`'s order: each test creates what it needs.
- `tests/helpers/server.mjs` (new): `startServer`, `freePort`, `waitFor`, the production shape's SQL, sign-in; `tests/import-db.test.mjs` imports them instead of defining them.
- The inventory test: reads `routes/*.cjs`, `data.cjs` and `server.cjs` for `router.(get|post|put|delete)(` and `app.get(`, and compares with the contract list.
- `CLAUDE.md`: the suite.

**Acceptance:** gates and both database suites green; the inventory test shown failing with a route removed from the contract list; each new 401/400/404/409 test shown failing against a deliberately broken copy where meaningful. No production step.

---

## 7. WP2: Dead code and small defects

**Size:** half a session to one.
**Expected outcomes:**

- Gone (S3): `POST /api/data/update-client`, `/optimize-portfolio`, `/analytics` and the second formula (`data.cjs:57-84`, `:485-607`); `optimizePortfolio` (`clientAnalyzer.cjs:39-73`) and its import; `clientValidationRules`, `revenueValidationRules`, `idValidationRules`, `revenueIdValidationRules`, `sanitizeInput` and `sanitizeArray` (`middleware/validation.cjs`), and `handleValidationErrors` from the transition-plan route; the store's uncalled `resetUpload` (which also set a non-existent tab, `src/portfolioStore.js:583-591`), `setAnalytics`, `setOptimization`, `setOptimizationParams`, `resetAnalysis`, `resetOptimization` (`:269-279`, `:593-599`; `deleteTransitionTask` stays for WP8); the Dashboard's unread `lowRenewalClients` (`src/DashboardView.jsx:103-106`) and `highRiskClients`; `@radix-ui/react-icons` and `nodemon` from `package.json`; the duplicate `decodeHTMLEntities` in `clientAnalyzer.cjs` (the other goes in WP5).
- Fixed: the four pool connections awaited, their rollbacks guarded as the second-chair route's is (`data.cjs:916`, `:962`); `error.path` in the CSV validation's details (`data.cjs:134`).
- S4: the import stops writing the retired columns (`utils/csvImport.cjs:468-475`, `data.cjs:287-356`); `getStickiness`'s stand-in becomes a named constant, after Jeff's read-only count (below), with a `strategic` test proving no score moves on the fixture books, and the book's legend (`utils/book.cjs`) saying the stand-in is a fixed value, not a rating.
- S5: the badge counts a stickiness pick and a cadence.
- The routes' 404 for the three deleted paths is in WP1's contract list.

**Jeff, before the merge (S4):** in Render's Shell, a read-only count: `node -e "require('./db.cjs').query('SELECT relationship_intensity, relationship_strength, renewal_probability, count(*)::int FROM clients GROUP BY 1, 2, 3 ORDER BY 4 DESC').then((r) => { console.table(r.rows); process.exit(0); })"`. Every client at 5, 5, 0.70 means the constant changes no score; anything else goes back to Jeff before S4's part lands.

**Acceptance:** gates and both database suites green; `npm audit` counts unchanged or lower; a grep in the PR shows no importer left for anything deleted. Jeff, after deploy: the Client Details badge counts only rated clients with a cadence; `/api/health` OK.

---

## 8. WP3: bcrypt 6

**Size:** half a session. May run any time after WP1 (its login and change-password contracts are the check).
**Expected outcomes:** `bcrypt` 6 in `package.json`; `npm audit` loses the `tar`, `@mapbox/node-pre-gyp` and `bcrypt` advisories; existing password hashes still verify (a test hashes with 5's output format and verifies with 6, or verifies a fixture hash made by bcrypt 5); runbook section 12 updated.
**Jeff, after deploy:** Render's deploy log shows `npm ci` without node-pre-gyp; every partner can sign in with their existing password; change-password works once.

---

## 9. WP4: Validation on the live write path

**Size:** one session.
**Expected outcomes:**

- `POST` and `PUT /api/data/clients` refuse with 400 and `details` (S7): a name missing, blank, over 255 characters or outside the form's pattern; a practice area outside the twelve; a cadence, conflict risk or stickiness outside its vocabulary (blank allowed where the form allows it); a revenue year the import would not read as a `YYYY Contracts` column (`revenueYearOfHeader`, `utils/csvImport.cjs`), an amount below 0 or not a number, a year given twice; a `high_maintenance` that is not a boolean; a body that is not an object. The people checks are unchanged.
- A `PUT` without `revenues` leaves the client's revenue as it is (today it deletes every row, `data.cjs:811`, `:849`); a `PUT` with `revenues: []` still clears it.
- The import's vocabulary checks and the form's read the same lists (`utils/clientRules.cjs`); the page's lists are held equal by a test.

**Changes by file:** `utils/clientRules.cjs` (new, pure); `utils/csvImport.cjs` reads its vocabularies from it; `data.cjs` applies it before the people check; `src/utils/validation.js` (unchanged behaviour, a parity test); `CLAUDE.md`.
**Tests:** a `client-rules` unit suite; WP1's contract tests gain each 400; `import-db`'s form-save tests keep passing (the page's own values pass).
**Acceptance:** gates and both database suites green; end to end in the container: the client form saves a new and an edited client unchanged, and the page shows a 400's `details` beside the field (it already reads `detail.field`, `ClientEnhancementForm.jsx:257-260`). Jeff, after deploy: edit and save two clients, one with a note; nothing else changes.

---

## 10. WP5: Stop escaping; repair stored text

**Size:** one to one and a half sessions, in two PRs with Jeff's repair between them.
**Expected outcomes:**

- New writes store what partners typed (S8): `sanitizeRequestBody` removed from `data.cjs:40` and `routes/scenarios.cjs:23` and deleted; the CSV path stops decoding every cell (`data.cjs:174-180`, `:112`); the page's `sanitizeFormData` trims and nothing else. A note typed as `R&D < 5% of "budget"` is stored exactly so.
- `scripts/unescape-book.cjs` (`npm run unescape:book`): without an argument, a read-only preview listing each column with escaped text (client name, notes, the three legacy text columns) and a count, and a few examples; with `--confirm`, one transaction that applies `unescapeStored` to exactly those rows and commits only if the number changed equals the preview's and no two clients end up with the same name regardless of case (the import's rule); prints what changed. Idempotent: a second run changes nothing.
- After the repair the Partnership report prints `&` once: its own `escapeHtml` (`src/utils/partnershipExports.js:106`) is right for plain text and stays.
- Second PR, after Jeff's repair: the one-level display decoders go (`formatClientName`'s decoding, `book.cjs`'s `text()`, the plan's `unescapeText` calls, the raw displays needing none); `unescapeStored` stays in the import's name matching and in `answerRow`; the `escaping` suite shrinks to what remains.

**Tests:** `import-db`'s assertions that pin escaped storage (`:1046`, `:1047`, `:1048`, `:1088`, `:1147`, `:1243`, `:1535` at `0b7f6b6`) change to plain text, each shown failing first against `main`; the repair script on both table shapes (escaped rows, two levels, a note with `<`, a would-be duplicate refused with nothing written, a second run a no-op); the book, the book sheet and the transition sheet on plain names.
**Jeff, between the two PRs:** a backup (runbook section 6), then the preview, then `--confirm` with the preview's count, in Render's Shell; bring the output to the session.
**Acceptance:** gates and both database suites green; end to end: a client named `Barnes & Noble` and a note with `<` and `&` saved through the form, stored, shown, exported and re-imported unchanged. Jeff, after each deploy: the same by hand; the Partnership report shows `&` once.

---

## 11. WP6: Who changed what, and edit conflicts

**Size:** one and a half sessions.
**Schema** (`init-db.sql`, appended, idempotent):

```sql
-- Who changed a client, and what (docs/plans/tier-2.md, S9). No key to
-- clients: production's ids are integers and this file's uuids, reset-book
-- refuses a key that does not cascade, and history outlives a deleted client.
CREATE TABLE IF NOT EXISTS client_changes (
    id SERIAL PRIMARY KEY,
    client_id TEXT NOT NULL,
    client_name VARCHAR(255),
    changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    changed_by_username VARCHAR(255),
    source VARCHAR(20) NOT NULL CHECK (source IN ('form', 'import', 'second-chair', 'delete')),
    changes JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_changes_client ON client_changes (client_id, created_at DESC);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
```

`changes` is `{ field: { from, to } }` over the fields a partner sets (name, lead, second chair, originator and firm credit as people ids with names, stickiness, cadence, handful, conflict risk, practice areas, notes) and `revenue: { year: { from, to } }`. The legacy text columns are derived and not logged; a person's rename changes no client field and logs nothing.

**Expected outcomes:**

- Every client write path (the form's `POST`, `PUT` and `DELETE`, `data.cjs:696`, `:789`, `:971`; the second-chair route, `:903`; the import, `:159`) reads the rows it changes, computes the difference with a pure `utils/clientChanges.cjs`, and inserts one row per client that changed, in its own transaction; `clients.updated_by` and `updated_at` set together. The import logs only the clients whose fields or revenue changed.
- `GET /api/data/clients/:id/changes` (newest first) and "Last changed by <name> on <date>" plus a History list on the client form.
- S10: `PUT /api/data/clients/:id` takes `expected_updated_at`; a mismatch answers 409 with the latest change's who and when; the page reloads the client and says so. `features` adds `client-edit-conflict`; without it the page saves as today.
- `check-schema` still ends `OK`; `delete-user` keeps an account's changes with `changed_by` null; `reset-book --confirm` leaves `client_changes` untouched and logs nothing (a script, with no partner behind it).

**Tests:** `client-changes` unit suite (every field, revenue by year, nothing changed gives no row, names unescaped after WP5); `schema` (the table, its key, a second start, a rollback start with the pre-WP6 file, `delete-user`, `reset-book`); `import-db` and WP1's contracts on both shapes (each path logs once, the import logs only real changes, a 409 on a stale save, nothing logged when a write fails).
**Acceptance:** gates and both database suites green; end to end: two browsers edit one client, the second save is refused with the first partner's name, the history lists both. Jeff, before the merge: the nightly backup green (the new table is counted, `deploy/backup/INSTALL.md` step 2's grant permitting). After deploy: edit a stickiness rating and see it in the history; the next backup counts `client_changes`.

---

## 12. WP7: Succession metrics on the server

**Size:** one session.
**Rule changes (S11, approved by Jeff on 2026-09-27)** (each moves badges on the Dashboard, Client Details and Scenarios):

1. Relationship type reads the nested people: `orphaned` when the client has no lead; `primary` when the lead is the recorded originator and there is no second chair (also when the credit has passed to the firm, P4, since the person stays recorded); `shared` when there is a second chair and stickiness is 7 or more on the 0 to 10 scale; otherwise `secondary`. Today it reads `primary_lobbyist`, `lobbyist_team` and `client_originator` (`src/utils/successionUtils.js:14-51`): `orphaned` only when `primary_lobbyist` is blank, which no client with a lead is; `shared` when `lobbyist_team` has two names and stickiness is 7 or more; `primary` when `primary_lobbyist` equals `client_originator`, which a firm credit (`Firm`) never does.
2. Cadence counts once: through `effort` only, dropping the separate cadence term (`successionUtils.js:81-90`), which double-counts it today.
3. The practice-area term reads `practice_area` or `practiceArea`, so the form's live preview counts it too.
4. An unrated client's stickiness term is the stand-in S4 names, not a rating, and the Stage 2 risk badge says "not rated" beside it.

**Expected outcomes:** `utils/succession.cjs` (pure) and every client response (`GET`, `POST`, `PUT`) carrying the three metrics; the page reads them and computes only the form's preview, with `src/utils/successionUtils.js` held equal by a parity test on the fixture books; the transition-plan route computes them from the book's client and ignores the request's; `tests/transition-plan.test.mjs` updated; the Stage 3 snapshot unchanged.
**Acceptance:** gates and both database suites green; end to end: the Dashboard's risk tiles, the client list's filters and Stage 2's badges read the server's figures, and a plan's prompt shows them. Jeff, after deploy: the Dashboard's risk distribution before and after (a screenshot each), checked against the rule changes he approved.

---

## 13. WP8: Saved scenarios

**Size:** two sessions.
**Schema:**

```sql
-- Saved Scenarios (docs/plans/tier-2.md, S12): what partners entered, never
-- what the departure engine derives from the book. No key to clients.
CREATE TABLE IF NOT EXISTS scenarios (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    state JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by_username VARCHAR(255),
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by_username VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`state` holds `kind: 'departure'` (WP9 adds `'hire'`), `currentStage`, `departingIds`, `choices` (with approval's pins), each client's plan as `{ answerId, ai: { strategy, recommendedLead, recommendedSecondChair, timelineDays, risks, tasks, communicationTemplate, priority, truncated, refused }, edits: { strategy?, risks?, timelineDays? }, status, updatedAt }`, Stage 3's `{ startDate, status }` per client, the tasks and the communication log. Today the page merges the AI's fields and the partner's edits in place and drops `answerId` (`ClientReviewInterface.jsx:582-587`); keeping them apart means regenerating a plan never loses an edit and an edit never loses the AI's text.

**Expected outcomes:**

- `GET /api/scenarios` (name, who and when, the people leaving), `GET /api/scenarios/:id`, `POST`, `PUT` (with `version`; 409 when stale, naming who saved last) and `DELETE`, none behind the AI limiters: they move from `router.use` (`routes/scenarios.cjs:20-22`) to the transition-plan route alone, and `CLAUDE.md`'s rate-limit line changes from `/api/scenarios/*` to that route. The budget itself is unchanged (T16).
- Scenarios opens a list: New, Open, Save, Save as, Delete (any partner, P2), with "unsaved changes" shown and a prompt before leaving them. The store's scenario state becomes the open scenario's; logout clears it as today. `features` adds `saved-scenarios`; without it the tab works as today, in the browser only.
- A scenario opened on a changed book re-derives everything; choices the engine refuses show their reasons; a person no longer on the list is dropped from `departingIds` with a notice.
- The transition sheet and Stage 3 unchanged.

**Noted, not scheduled (Jeff, 2026-09-27): the AI plans pile onto one person.** In Tier 1 WP6's check on gbacpod.com, one partner marked leaving and plans for four of their clients: the AI recommended the same partner as lead on all four, and the same person as second chair on three. Each plan is one request for one client, and it sees the book's loads (T14) but not the seats the other plans, or the scenario's choices, have just given anyone, so every plan picks whoever looks lightest in the book as it stands. Stage 1's proposals do spread the load, because `departureModel` counts what the scenario has already given each person (`createLedger`), so today the engine is the load-balanced view and the AI's picks are per-client advice; a recommendation is applied only by "Use these picks", so nothing is moved by it. A fix is a design choice for Jeff, not part of WP8 unless he approves it: the user turn (not the cached system blocks, T8) could list the scenario's current seats for the other affected clients and each roster person's load after them. Those figures come from the page's engine, which the server has no port of, and T14 moved the roster's loads to the book's so that the server does not trust the page's figures; so the likely shape is the page sending the scenario's choices as ids and the server checking them against the People list, as `checkRoster` does, and describing them, not new load figures. The resolution against the roster (`resolveRecommendation`) and P9 (no bulk moves) are unchanged either way. WP9's hire scenario would meet the same question if it ever asks the AI for plans.

**Tests:** a pure `scenarioState` module (what is saved, what is dropped on open, the plan's AI and edits kept apart) with unit tests; the routes on both shapes (409, delete, two partners); `schema` (the table, a rollback start, `reset-book` and `delete-user` leaving scenarios); WP1's contracts.
**Acceptance:** gates and both database suites green; end to end in headless Chromium: build a scenario with four plans, an edit, an approval and a Stage 3 task, save, refresh, open in a second browser as another partner, see the same, save a change, get a 409 in the first browser. Jeff, after deploy: the same with two partners.

---

## 14. WP9: An associate in Scenarios

**Size:** one and a half to two sessions, after WP8 (a hire scenario is saved and shared as a departure scenario is).
**Why:** Jeff, 2026-09-27: the partners want to try out, before a hire, which clients a new associate would second-chair, chosen by where the partners' load is heaviest. The associate would become a lead only on making partner, at least five years away; that is not modelled here.

**What the figures can show today, and why S19 matters.** Under P10 as amended, a lead carries a client's full effort whoever the second chair is, and a second chair adds 20% of it to their own load. So giving a partner's client an associate as second chair lowers no partner's figure unless the associate takes a seat a partner held as second chair. Without S19's toggle the workshop shows the new associate's load rising and every lead's unchanged; with it, each lead the associate seconds carries 80% of that client's effort.

**Expected outcomes:**

- Scenarios starts with a choice of kind: "Someone leaves" (today's three stages) or "Add an associate". A hire scenario holds one or more hypothetical associates, each with a label ("New associate" by default), optional practice areas of focus (the form's twelve) and a target: a number of clients, or the active associates' average second-chair load (the default; a number of clients when the firm has no active associate).
- Proposals from a pure `hireScenarioModel` (`src/utils/hireScenario.js`), built on Phase 5 and 6's blocks (`partnershipModel`, `createLedger`, `areaIndex`, `rankCandidates`; `src/utils/load.js`, `src/utils/departure.js`):
  - The seats open to a new associate: clients with a lead and no second chair, and clients whose second chair is a partner (the associate would take the seat and free that partner's 20%). A seat an existing associate or the emeritus holds is never proposed away, and nothing touches a lead (P3, P9).
  - Ranked for relief: partners by how far their total load (lead effort plus second-chair effort, `totalLoad`) sits above the partners' average, heaviest first, and within each partner their clients by effort, heaviest first; practice-area fit with the associate's focus breaks ties. Settled one seat at a time, each added to the ledger before the next is ranked (as the associate split does), so the proposals spread across the heavy partners; stopped at the target.
  - Every person's lead and second-chair load before and after, against the role averages (`partnershipModel` over the book with the picks applied and the hypothetical people added); each hypothetical associate against the associates' average; with S19's figures beside them when the toggle is on.
- The partner adds and removes picks freely; a pick P3 refuses shows why. Nothing is written.
- Saved with S12: the scenario's `state` gains `kind: 'hire'`, the hypothetical associates (a scenario-local id, label, focus, target), the picks and the toggle. A hypothetical id never reaches the API outside that `state`.
- After the hire: once the associate is on the People list, "Link to a person" maps the hypothetical to that person, and each pick can be accepted one at a time through the associate split's write (the store's `assignSecondChair`, `PUT /api/data/clients/:id/second-chair` with the seat the page saw; a 409 reloads and says the seat changed), behind `/api/health`'s `second-chair-assign`. A pick whose seat has changed since the scenario was saved shows why and is not applied.
- The hypothetical person never appears in the People list, the book, the AI's prompts, the Partnership tab or the Dashboard.
- Not in this package: asking the AI about a hire scenario (the book is the database's, and Ask already answers "which clients could a new associate second-chair to relieve the heaviest partner?" from it); modelling promotion to partner; S19 for the whole firm.

**Tests:** a `hire-scenario` unit suite: proposals ranked by each partner's load above the average and spreading across partners; the target, both kinds; practice-area focus breaking ties; a partner's second-chair seat taken and that partner's load falling by the 20%; existing associates' and the emeritus's seats untouched; P3 on seeded random books (a hypothetical person never leads, never seconds a client they would lead); with the toggle off, every real person's figures equal to `partnershipModel`'s on the same picks; with it on, each seconded lead at 80% of that client's effort and nothing else changed; the saved state's round trip. On both table shapes (`routes` or `import-db`): a saved hire scenario, then a real person linked and one pick accepted through the second-chair route, writing that one seat and nothing else.
**Acceptance:** gates and both database suites green; end to end in headless Chromium: add "New associate" with a Healthcare focus and a target of four clients, see the proposals come from the heaviest partners' books, change two picks, turn the toggle on and see those leads' figures fall, save, open the scenario in a second browser as another partner; the `clients` table byte for byte unchanged throughout. Jeff, after deploy: workshop a hire with the partners; say whether S19's reading should become the firm's (a P10 decision).

---

## 15. WP10: Follow-up questions; earlier-book marker; hiding answers

**Size:** one and a half sessions. Load the `claude-api` skill first (multi-turn requests, replaying assistant content, preserved thinking if `AI_MODEL` has moved to a 5.5 or Fable model, caching the growing history).
**Schema:** `ai_answers` gains `parent_id INTEGER REFERENCES ai_answers(id)` (a self-reference; no key to `clients`), `content JSONB` (the assistant's content blocks as returned, only for answers in a thread), `hidden_at TIMESTAMPTZ`, `hidden_by INTEGER REFERENCES users(id) ON DELETE SET NULL` and `hidden_by_username`, all nullable. A follow-up is `kind 'ask'` with a `parent_id`, so the table's `CHECK` on `kind` needs no change (changing a `CHECK` idempotently needs a `DO` block, and a rollback start would keep the new one).
**Expected outcomes:**

- S14: "Ask a follow-up" under an answer; the request carries the parent's id; the route loads the thread, sends the book blocks unchanged, then the earlier user and assistant turns as saved, then the new question; at most five follow-ups; streamed like Ask (Tier 1 WP5); each turn saved with its parent and priced. `features` adds `ai-threads`.
- S15: the list marks "given on an earlier book"; Hide and Show hidden, with who hid it.
- The AI budget counts each turn (T16); the one call site and T1's rules hold (`ai-grep`).

**Tests:** the thread's request built by a pure function (byte-identical book blocks, earlier turns unchanged, the limit), recorded against the fake server; `ai-answers` for the new columns; `schema` and `import-db` on both shapes.
**Acceptance:** gates and both database suites green; end to end against the fake: a question, two follow-ups, the fake's recorded requests show the history appended and never edited. Jeff, after deploy: a real thread of three turns; the `ai_call` lines show cache reads on the second and third.

---

## 16. WP11: Model and effort from real answers

**Size:** one session, plus Jeff's review of the side-by-side answers; runs after two to four weeks of saved answers.
**Expected outcomes (S16):** an evaluation set of 10 to 20 of the firm's real questions, chosen by Jeff from the saved answers, and a script that runs it through `services/anthropic.cjs` with each configuration Jeff approves and writes the answers and costs side by side; Jeff's choice recorded here; the code change it needs (`PRICES`, `FALLBACK_MODELS`, `AI_EFFORT` on Render). If saved plans show recommendations the parser could not resolve, a proposal for structured output with the roster as an enum, for Jeff to approve.
**Before anything runs:** Jeff approves the spend (the script prints an estimate from `utils/aiCost.cjs` first) and runs it himself, from his machine with the key or from Render's Shell; the session never holds a key (Tier 1 section 4). The script writes nothing to the database, so its cost shows in the Console and not in the AI tab's month total.

---

## 17. Deploying a work package

As `docs/plans/tier-0.md` section 9 and `docs/plans/tier-1.md` section 12: merging to `main` deploys; Netlify publishes the page within about a minute; Render deploys the API if its auto-deploy is on. Then `/api/health`: `status` `OK`, and `features` lists the package's name if it adds one. A package that adds a table or columns (WP6, WP8, WP10) needs a green backup before the merge (the nightly run, or one run by hand) and the next night's run to count the new table. Roll both providers back together (runbook section 5).

---

## 18. What Tier 2 leaves for later

- S17's items: the what-if sandbox, exposure on the Dashboard, the load trend, compensation inputs.
- S13: Vite 8 and React majors.
- S19 for the whole firm (a P10 amendment, both sides of the load model together), if the partners want it after WP9.
- An associate's promotion to partner, and so to lead (P3): not for at least five years (Jeff, 2026-09-27); the People list's role change (P5) already allows it when it comes.
- A retention rule for saved answers (S15 hides; nothing is deleted).
- AI transition plans that see each other's picks (noted in section 13, WP8): today each plan sees only the book, so several can recommend the same person; Jeff decides whether it joins WP8.
- Changing production's integer ids to uuids (a migration of its own, `CLAUDE.md`).
