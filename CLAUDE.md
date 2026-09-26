# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current work plan

Active plan: `docs/plans/people-and-second-chair.md` (the People list, one
partner lead and an optional second chair per client, a fresh book, then the
Partnership and Scenarios rebuilds). Phases 1 to 6 have merged; its remaining
items are Jeff's checks on the live site. Read it before making changes and
update its status table when you finish a phase. `docs/plans/tier-0.md`
(stabilisation) is done in code; its remaining items are Jeff's checks on the
live site. Next: `docs/plans/tier-1.md` (the AI rebuild), approved by Jeff on
2026-09-26; read it before any AI change, run its work packages in order and
update its status table when you finish one.
Background and evidence: `REVIEW-2026-09.md`. Product direction:
`PRODUCT_BRIEF.md` (one shared book for six equal partners; no per-user
data scoping by design; an emeritus and associates appear in the book as
second chairs but do not sign in).

## Development Commands

### Frontend Development
- `VITE_API_BASE_URL=http://localhost:5000 npm run dev` - Vite dev server on http://localhost:5173 (PowerShell: `$env:VITE_API_BASE_URL = 'http://localhost:5000'; npm run dev`). Without the variable the page calls relative `/api`, which Vite does not proxy
- `VITE_API_BASE_URL=https://gbacpod.com npm run build:prod` - the production build CI and Netlify run (`NODE_ENV=production vite build`, POSIX syntax; on Windows use `npx vite build`, production is Vite's default mode). A production build refuses a missing or non-`https://` `VITE_API_BASE_URL`
- `npm run build` - `vite build` without the `NODE_ENV` prefix; `npm run preview` serves `dist/`
- `npm run lint` - Run ESLint on JS/JSX/CJS files (errors fail the gate, warnings are informational; 3 `exhaustive-deps` warnings are expected, in `App.jsx` and `DashboardView.jsx`, D3; the other four went with the components Phase 4 deleted)
- `npm run security:audit` / `npm run security:audit-fix` - `npm audit` / non-breaking `npm audit fix`; never `--force` (the remaining advisories need majors, `deploy/README.md` section 12)

### Backend Development
- `npm start` or `node server.cjs` - Start Express.js backend server on port 5000
- Backend runs on http://localhost:5000 with CORS enabled for development
- `npm run create:admin -- <username> <password>` - add a partner (`create-admin.cjs`; refuses an existing username)
- `npm run reset:password -- <username> <newPassword>` - reset a forgotten password (`scripts/reset-password.cjs`); prints `Updated 1 user`, or `No such user` and exits 1. On Render, run it from the web service's Shell tab, which has the service's environment; locally, set `DATABASE_URL` to the Render database's External Database URL and `DATABASE_SSL=no-verify`. Both scripts validate with `utils/passwordPolicy.cjs` and connect through `db.cjs`
- `npm run check:schema` - read-only: lists every foreign key to `users` with its `ON DELETE` action and the clients per creating account; ends `OK: ...` and exits 0, or `FAIL: ...` and exits 1 when any key cascades (`scripts/check-schema.cjs`)
- `npm run delete:user -- <username>` - delete an account without touching the book (`scripts/delete-user.cjs`): one transaction that refuses while any key to `users` cascades, refuses the last account, and commits only if the client and revenue-row counts are unchanged. Runbook `deploy/README.md` 7.3. Both run where the two scripts above do and share the check in `utils/schemaCheck.cjs`
- `npm run reset:book`, then `npm run reset:book -- --confirm` - start the book over (`scripts/reset-book.cjs`; people plan P7, runbook `deploy/README.md` 7.4). Without an argument it prints each foreign key to `clients` and the numbers of accounts, people, clients, revenue rows and the rows of any other table that references `clients`, deletes nothing and exits 1; any other argument is a usage error that needs no database. With `--confirm`: one REPEATABLE READ transaction that locks `clients` against writes (10 s lock timeout), refuses while any foreign key to `clients` is not `ON DELETE CASCADE` (`checkClientForeignKeys`), deletes every client, and commits only if `clients`, `client_revenues` and every other referencing table (production may still hold V2's `revenues`) are empty and the account and people counts unchanged (`checkBookReset`); prints `Removed <n> clients and <r> revenue rows. Accounts: <a> and people: <p>, unchanged.` Accounts and people are never touched. Runs where the scripts above do; there is deliberately no API endpoint or button for it

### Testing
- `npm test` - Run the test suite with Node's built-in runner (`node --test "tests/**/*.test.mjs"`); no test dependencies to install
- Tests live in `tests/*.test.mjs` and use `node:test` + `node:assert/strict`. Import CommonJS modules with a default import (`import strategic from '../utils/strategic.cjs'`)
- Current suites: `people` (the People list's validators, the P5 change rules, the legacy-field shim, which also drops the retired `status`, the page's picker helpers and the client list's person filters), `load` (Phase 4: each person's lead book and second-chair load, the second chair's 20% effort share (P10 as amended), the role averages over active people, the ratios and "—" where there is no peer, the lead-book order, an inactive person only while in a seat, and the page's effort equal to the server's `getEffort` for every cadence; its fixture book is `tests/fixtures/books.mjs`, shared with `book`), `book` (Tier 1 WP2, `utils/book.cjs`: parity with the page's `partnershipModel` at the page's reporting year on the fixture book and 200 seeded random books, every person's counts, revenue, effort and ratios within 1e-9 and shown identically; `reportingYear` equal to `computeReportingYear`; the two `SECOND_CHAIR_EFFORT_SHARE` values equal; the same text for shuffled clients and people and for two `now` values in one reporting year; every client once, sorted by name regardless of case then id as text, integer and uuid ids; `&amp;` decoded; no note, id, date, `user_id` or retired column; "not rated" and "not set" for defaults, an unrated client under unrated exposure; the legend's formula equal to the scorer's; an inactive person with a seat listed and marked; the empty book), `partnership-exports` (the load CSV row by row, CSV quoting and formula guarding, the report built from the model with `strategicValue`, escaped names and the second-chair share in its effort columns), `smoke` (scoring formula), `strategic` (score regression fixture, D6), `csv-import` (year rule, D5, and each year's total; a `Contract Period` column changes nothing and raises no issue, P13), `import-sheet` (the import sheet's people and judgment columns, P8: header matching, each vocabulary, name resolution, every refusal, blank cells clearing, a file without the new columns reading and writing as before, and `public/client-book-template.csv` against the plan's section 3 example), `reporting-year` (D4), `ai-service` (Tier 1 WP1: the real SDK driven through `createService({ apiKey: 'test', fetch })` by the recorded streams in `tests/fixtures/anthropic/`: thinking then text, `max_tokens`, a refusal before output and one mid-stream, a fallback served mid-stream and before output, the whole chain refusing, cache writes, an unpriced model, `onText` in order and a throwing `onText`; the recorded request (streamed, the system blocks unchanged, the fallback beta and `"default"` on `claude-opus-5` only, `output_config.effort` only when set, nothing else); `AI_EFFORT` validation and `server.cjs` refusing to start on a bad value; `ANTHROPIC_BASE_URL` honoured outside production and ignored in it; 429, 401, 500, 529, 400, a mid-stream `overloaded_error` and a network failure through `describeError`; no request without a key; and the timeout bounding only the wait for an answer to start, on Node's own fetch), `ai-cost` (WP1, `utils/aiCost.cjs`: the price table, cache writes by lifetime and reads, a fallback priced per attempt at each model, the refusal billing rule, no guess for an unpriced model, the normalised counts), `transition-plan` (per-client prompt and parser, D9; the request check, which takes production's integer client ids; Phase 5b: the roster check against the People list, the prompt's roster and its two seat sections, the parser resolving each recommendation against the roster only, a name off the roster resolving to nobody, and no invented timeline), `transition-plans` (Phase 5b, `src/utils/transitionPlans.js`: the request's roster, the accepted plan as an import sheet of CLIENT, Lead and Second Chair, who still holds a seat after it, approval blockers, and Stage 3's transitions with no invented dates or rates), `departure` (Phase 5's departure engine: who needs a new lead or second chair, each seat's candidates in order by total effort, the promoted second chair's seat, a departing emeritus or associate, several people at once, no candidate, the partner's choices applied or refused with the reason, P3 after every departure on random books, the before and after loads with the 20% share, the defaults spreading a book, accepting a default moving no other, and the store's two scenario helpers), `succession-utils` (the transition complexity reads `interaction_frequency` and the conflict label), `associate-split` (Phase 6, `src/utils/associateSplit.js`: the clients with a lead and no second chair, heaviest first, an associate proposed for each by fit then total load, proposals spreading, the picker's associates then everyone else P3 allows, a pick applied or refused with the reason, a client whose lead is not an active partner shown but not proposed for, each associate's load before and after against the associates' average, P3 on random books, and no associates), `ai-grep` (the grep assertions, widened in Tier 1 WP1: no retired model ids, sampling parameters or thinking budget; one module that calls `messages.create(`, `messages.stream(`, `countTokens(` or `new Anthropic(`; `betas`, `fallbacks` and `output_config` only in the service, and `output_config` only as `output_config: { effort }`), `password-policy` and `session-ttl` (WP3), `schema` (the pure `checkClientForeignKeys` and `checkBookReset`, and `reset-book`'s usage error without a database; `init-db.sql` on a real PostgreSQL: `clients.user_id` is `ON DELETE SET NULL` on a new database and after migrating one with the old cascade, deleting a user keeps its clients and revenue rows, and the two scripts above, Tier 0 plan section 12; the `people` table's seed, uniqueness and role check, the client foreign keys and the second-chair check, a pre-plan database migrating intact, and a rollback start running the pre-plan file on a migrated database; `reset-book` printing the counts and deleting nothing, emptying a seeded book with the users and people rows unchanged, counting and emptying V2's `revenues` table through its cascade, refusing and naming a key that does not cascade, and succeeding on an empty book), `import-db` (run twice: on the tables `init-db.sql` creates, and on production's older tables with integer ids, created before `init-db.sql` runs, each run first checking its id type; `POST /api/data/process-csv` on `server.cjs` and a real PostgreSQL: the section 3 example with the People counts, the clients' people and the stored legacy text; a refused file leaving clients, revenue and people byte-for-byte unchanged; a file without the people columns leaving them untouched; blank cells clearing; a name with an apostrophe resolving through the request sanitizer; a kept second chair who would equal a new lead; Check file (`dryRun`) writing nothing and answering exactly what the import answers; then Phase 3's flow: `reset-book` on the suite's database, the book empty and every People count 0 in the same session, and the section 3 template imported into the empty book; then P13: a file with only `CLIENT` and the years and the same file with a `Contract Period` column writing identical rows, inserted and updated, with Check file writing nothing, the stored `status` never written by the import or by a `PUT` or `POST` carrying a stray `status`, and no client response carrying one; then Phase 5: `POST /api/scenarios/transition-plan` with this run's client id type passing every check to the 503 of a missing key, and refusing a roster naming someone not on the People list or someone leaving; and a transition sheet of only `CLIENT`, `Lead` and `Second Chair` changing the two seats and nothing else, after which the partner who left can be deactivated; then Phase 6: `PUT /api/data/clients/:id/second-chair` setting one seat and its legacy text with every other column, revenue row and person unchanged, answering 409 when the seat changed since the page loaded, 400 for the lead, an inactive or an unknown person or a malformed body, 404 for a missing client of either id type, and clearing the seat; then Tier 1 WP1: the AI Advisor's three routes reading the book on this table shape and stopping at the missing key with 503; and Tier 1 WP2, right after Phase 3's template import: `GET /api/ai/book` listing every client once, each listed person's lead and second-chair counts equal to the People list's, no note and no uuid in the text, and 401 without sign-in). Functions that depend on the clock take a `now` argument (`computeReportingYear(clients, now)`) so tests are deterministic
- Never import `db.cjs`, `data.cjs`, `models/*`, or `utils/jwt.cjs` from tests: they throw at load time without `DATABASE_URL` / `JWT_SECRET`
- The `schema` and `import-db` suites' database tests need `SCHEMA_TEST_SERVER_URL`, the superuser URL of a throwaway server without a database name; each `schema` test creates and drops its own `schema_test_*` database, connects with `pg` directly and runs the scripts as child processes; `import-db` creates one `import_test_*` database, starts `server.cjs` on it as a child process on a free port, adds an account with `create-admin.cjs`, signs in, posts files parsed with PapaParse as the page does, and runs `scripts/reset-book.cjs` against that database. Without the variable they are skipped. Locally, after plan section 0.4's `service postgresql start`: `sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres'"`, then `SCHEMA_TEST_SERVER_URL=postgresql://postgres:postgres@127.0.0.1:5432 node --test tests/schema.test.mjs tests/import-db.test.mjs`
- `npm run deploy:check` runs lint, tests, and the production build; GitHub Actions (`.github/workflows/ci.yml`) runs the same three on every PR and push to `main`, and its `schema` job runs `tests/schema.test.mjs` and `tests/import-db.test.mjs` against PostgreSQL 18

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
  - `GET /api/data/clients`, `POST /api/data/clients`, `PUT /api/data/clients/:id`, `DELETE /api/data/clients/:id`, `POST /api/data/process-csv` (`data.cjs`; the year rule and the import sheet, below). `PUT /api/data/clients/:id/second-chair` `{ second_chair_id, expected_second_chair_id }` (Phase 6, P9) sets one client's second chair and its legacy `lobbyist_team` and nothing else: the client is read `FOR UPDATE` (by `id::text`), the person `FOR SHARE` and checked by `validateAssignment`; 409 when the stored seat is not `expected_second_chair_id` (null for none) or the client has no lead, 400 with `details` for the lead, an inactive or unknown person. `data.cjs` also still defines `POST /update-client`, `/optimize-portfolio` and `/analytics`, which nothing calls and which use a second, retired scoring formula (review 4.5; deleting them is Tier 2)
  - `POST /api/claude/analyze-portfolio`, `/api/claude/strategic-advice`, `/api/claude/client-recommendations` - the AI Advisor tab (`claude.cjs`)
  - `GET /api/ai/book` - the book as the AI sees it (`routes/ai.cjs`, Tier 1 WP2): `{ success, reportingYear, clientCount, peopleCount, chars, estimatedTokens, text }`, built at each request by `buildBook` (`utils/book.cjs`) from `clientModel.listWithMetrics()` and `SELECT id, name, role, active FROM people`. `peopleCount` is the people the text lists; `estimatedTokens` is `chars / 4`, rounded, an estimate (no Anthropic call, no token count). Behind `authenticateToken`, with no AI rate limiter (T16) and no request sanitizer
  - `POST /api/scenarios/transition-plan` `{ client, stage1Data: { departing, impactData, reportingYear }, roster }` - one succession transition plan for one client (`routes/scenarios.cjs`); the roster of people staying is checked against the People list before the model is called (400 with the names otherwise)
  - `GET /api/people`, `POST /api/people` `{ name, role }`, `PUT /api/people/:id` `{ name?, role?, active? }` - the People list (`routes/people.cjs`); no delete. `PUT` answers 409 with the reason when a partner who leads clients would stop being a partner or be deactivated, or anyone who is a second chair would be deactivated, and a rename rewrites the legacy text columns
  - `GET /api/health` - no sign-in; fields under "Auth, sessions and rate limits" below and in `deploy/README.md` section 10
- **AI service**: every Anthropic call goes through `services/anthropic.cjs` (see "AI Integration" below)
- **Data Processing**: Client analysis engine in `clientAnalyzer.cjs`

### People (`docs/plans/people-and-second-chair.md`)
- The `people` table (`name` unique regardless of case, `role` `partner` / `emeritus` / `associate`, `active`) replaces the old `src/constants.js` roster. A new database is seeded with Brendan, Jeff, Joe, Kevin, Mike and Paula as partners and Jay as emeritus, only while the table is empty, so edits survive restarts. People are never deleted, only deactivated.
- Each client: `lead_id` (required by the API; an active partner), `second_chair_id` (optional; any other active person), `originator_id` (anyone, active or not) and `originator_is_firm` (the origination credit has passed to the firm; the person stays recorded). The database enforces the foreign keys and `second_chair_id <> lead_id`; `utils/people.cjs` enforces the rest, and `POST`/`PUT /api/data/clients` answer 400 `{ success: false, error: 'Validation failed', details: [{ field, message }] }`.
- Client responses nest `lead`, `secondChair` and `originator` (`{ id, name, role, active }` or null) and keep the legacy fields, filled from them for a client that has a lead: `primary_lobbyist` = lead, `lobbyist_team` = `[lead, second chair]`, `client_originator` = `Firm` or the originator. A client without a lead (saved before this change) returns its stored legacy text. Writes store the legacy text too, so a rollback to older code still shows the right names. The Partnership tab, its exports, the Dashboard's lead-book card and the client list read the nested people (Phase 4), and so does every stage of Scenarios, through the departure engine (Phase 5); the AI Advisor's prompts still read the legacy fields until the Tier 1 prompt rewrite.
- Every client query that returns people goes through the join in `utils/people.cjs` (`CLIENT_PEOPLE_COLUMNS`, `CLIENT_PEOPLE_JOINS`, `CLIENT_PEOPLE_GROUP_BY`, `withPeopleFields`), used by `data.cjs` and `models/clientModel.cjs`. The client writes read the people they assign `FOR SHARE` (the CSV import reads the whole list `FOR SHARE` when the file has a `Lead` column, and the clients it updates `FOR UPDATE`) and `routes/people.cjs` reads the person `FOR UPDATE`, so a concurrent assignment cannot slip past the P5 counts.
- Page: the header's **People** button (`src/PeopleDialog.jsx`); the client form's lead, second chair and originator pickers use `src/utils/people.js` and `NativeSelect` (`src/components/ui/native-select.jsx`), because `ui/select.jsx` shows the raw value in its trigger. The store loads `people` after sign-in and clears it on logout.
- Contract status is retired (plan P13): the book holds only active clients, so the form, the import, the views, the exports and the AI prompts have no status. `clients.status` stays in the table for a Render rollback (plan rule 0.4) and nothing reads or writes it: `POST`/`PUT /api/data/clients` ignore a `status` in the body, and `withPeopleFields` drops the column from every client response. Do not bring it back as a hook; contract tracking, if it returns, is its own design.

### Key Application Components

#### Core Views (Tab-based Navigation)
Six tabs in `src/App.jsx`, switched by the store's `currentView` (a hand-rolled
tabs component, `src/components/ui/tabs.jsx`; no router, the URL never changes):
1. **Data Upload** (`DataUploadManager.jsx`, `data-upload`) - CSV import through a file picker, parsed in the browser by PapaParse and posted to `/api/data/process-csv`; lists a refused file's problems by row, shows the sheet's columns (plan section 3) and links `public/client-book-template.csv`. **Check file** posts the same file with `dryRun: true` and writes nothing; it answers `The file is ready to import: ...` without the updated/new split, which before a reset is measured against the old book
2. **Dashboard** (`DashboardView.jsx`, `dashboard`) - Analytics and visualizations
3. **Client Details** (`ClientListView.jsx` + `ClientEnhancementForm.jsx`, `client-details`) - Client management
4. **Partnership** (`PartnershipAnalytics.jsx`, `partnership`) - who's carrying what (plan Phase 4, P10): the partners' lead books and everyone's second-chair load by role, as clients, reporting-year revenue and effort, each against the average of the active people in the same role (`partnershipModel` in `src/utils/load.js`; no capacity ceiling, no health score). The lead carries a client's full effort and the second chair 20% of it (`SECOND_CHAIR_EFFORT_SHARE` in `src/utils/load.js`, P10 as amended by Jeff on 2026-09-25); counts and revenue count in full for both chairs, and each client's own `effort` and strategic score are unchanged. Every second-chair effort figure on the page reads that one constant. The server's copy is `SECOND_CHAIR_EFFORT_SHARE` in `utils/book.cjs` (Tier 1 WP2, which ports `partnershipModel`, `computeReportingYear` and `resolveEffort` for the AI's book); `tests/book.test.mjs` fails when the two constants or the two models' figures differ, so change both sides together. The page's `formatMoney`, `formatEffort` and `formatRatio` settle a figure to 12 significant digits before rounding, as the book's do, because the book sums its clients in name order and the page in the API's order, and without it a sum such as 5.45 shows as 5.4 on one side and 5.5 on the other. A name opens that person's clients (`components/PersonLoadSheet.jsx`); Export gives a printable report and everyone's load as CSV (`src/utils/partnershipExports.js`, pure builders). No departure modelling here: that is Scenarios. The Dashboard's "Heaviest lead book" card (`heaviestLeadBook`) links here, and the client list (Client Details) shows each client's lead and second chair and filters by either (`personFilterOptions`, `matchesPersonFilter` in `src/utils/people.js`). The tab's **Associate split** (`components/AssociateSplit.jsx`, plan Phase 6, P9): each active associate's second-chair load against the associates' average, now and with every proposal accepted, and the clients with a lead and no second chair, each with an associate proposed by `associateSplitModel` (`src/utils/associateSplit.js`, pure, Phase 5's ranking as it is: practice-area fit with every client they hold, then the lighter total load, proposals settled heaviest client first and spreading). The picker offers the associates, then everyone else P3 allows, and "Not now". A partner accepts each proposal one at a time (never in bulk, P9); accepting calls the store's `assignSecondChair`, which writes that one seat (`PUT /api/data/clients/:id/second-chair`, with the seat the page saw), then reloads the book and the People counts. A 409 reloads the list and says someone changed the seat. Lead changes are never proposed here; the page asks `/api/health` for `second-chair-assign` and keeps Accept off without it
5. **AI Advisor** (`AIAdvisor.jsx`, `ai`) - Claude API integration for strategic advice. Under the header, the collapsed **What the AI is given** panel (`components/AIBookPanel.jsx`, Tier 1 WP2): each time a partner opens it, it asks `/api/health` for `ai-book` ("The API has not been updated yet." without it) and then fetches `GET /api/ai/book`, and shows the text in a `<pre>` with the reporting year, the client count, the characters, the estimated tokens (labelled an estimate at 4 characters per token) and "Client notes are never sent to the AI." Until WP3 the three AI Advisor buttons still send their old prompts, not this book
6. **Scenarios** (`ScenarioModeler.jsx`, `scenarios`) - the three-stage succession workflow (`src/components/succession/SuccessionScenario.tsx`); the Growth and capacity scenarios were deleted in WP2 (D8). Stage 1 (`ImpactAnalysisWorkbench.jsx`, plan Phase 5) lists every active person by role as someone who may leave and runs the departure engine, `departureModel` in `src/utils/departure.js` (pure): each client a leaving person leads needs a new lead, an active partner who is staying (the client's second chair first when a partner who is staying, then practice-area fit with the candidate's lead book, then the lighter total load); each seat a leaving person holds as second chair, and the seat of a second chair promoted to lead, is emptied and gets candidates (everyone active and staying but the lead, by practice-area fit with every client they hold, then the lighter total load). The total load, for both seats, is the lead effort plus the second-chair effort with the 20% share, then both seats' revenue, then the name (`totalLoad`; Jeff, 2026-09-25: the firm will be adding and removing both kinds of responsibility, so one seat's load is the wrong measure). "Lighter" counts what the scenario has already given each person: clients are settled heaviest effort first, in a fixed order, so accepting a default moves no other. The partner's choices (`{ [clientId]: { leadId, secondChairId } }`) override the defaults; a choice P3 or the departures forbid is refused with its reason (`assignmentProblems`) and the default stands; no candidate leaves the seat empty and says so. Stage 1 shows the affected clients with their proposals and everyone's lead and second-chair load before and after (the leaving at zero, and out of the role averages). `rankCandidates`, `secondChairPool`, `createLedger` and `areaIndex` are Phase 6's building blocks. Stage 2 (`ClientReviewInterface.jsx`, PR 5b): each affected client's plan holds a new lead and a new second chair, the scenario's choices over the engine's candidates, picked with `NativeSelect`s that list only eligible people (never someone leaving, never "Unassigned"); a pick P3 or the departures refuse shows its reason and the proposal stands. The AI plan (after `/api/health` lists `transition-plan-roster`) adds a strategy, risks, tasks, a timeline and a recommended lead and second chair from the roster, which "Use these picks" turns into choices; nothing is applied automatically. Approving pins the seats (`approveTransitionPlans`); a client no partner can lead cannot be approved. The accepted plan exports as an import sheet, `CLIENT,Lead,Second Chair` (`buildTransitionSheet` in `src/utils/transitionPlans.js`; quoted, no formula guard and no BOM, so the import reads each name exactly; a kept second chair is written out, since a blank cell clears the seat), which the partner applies with Data Upload's Check file, then Upload: no new write endpoint, and Scenarios writes nothing to the database. `TransitionSheetPanel.jsx` says who can then be deactivated on the People list (P5) and who still holds a seat. Stage 3 (`TransitionPlanManager.jsx`) shows the approved clients' new seats, the plan's timeline (none when the plan has none), the plan's action items as tasks owned by the new lead, statuses and a communication log, all in the store (`startExecution`, `syncTransitions`); no retention rate, average duration or sample alert

#### Data Flow
1. CSV upload → `data.cjs` processes via `clientAnalyzer.cjs`; the pure helpers in `utils/csvImport.cjs` read the years and the sheet's optional columns from the header, check the file (`checkSheet`) and plan the writes
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
The import deletes every `(client, year)` pair the file names and inserts the
positive amounts, as the client form writes revenue; it uses no `ON CONFLICT`
and no type cast on `client_id` (production's older tables, under File
Structure). `processCSVData` attaches the file's years to every client as `revenueYears`,
and `POST /api/data/process-csv` returns them as `summary.revenueYears`.

**Import sheet (P8; `docs/plans/people-and-second-chair.md` section 3).** Beside
`CLIENT` and the years, the only structural columns, a CSV may carry `Lead`,
`Second Chair`, `Originator`, `Credit To Firm`, `Stickiness`, `Cadence`,
`Handful`, `Conflict Risk`, `Practice Area` and `Notes`, matched
case-insensitively and trimmed (`CLIENT` still matches exactly). A
`Contract Period` column is ignored like any unknown header (P13): a sheet that
has it imports exactly as one without it. As with the years, the file is authoritative for exactly the columns
it has. A column it lacks leaves that field as it is: the columns the import has
always written keep their preserve logic, and `stickiness`, `high_maintenance`
and the four people columns are left out of the `UPDATE` (`importWriteColumns`),
so a file without the new columns writes what it wrote before. A blank cell in a
column the file has clears the field: no second chair, no originator,
stickiness NULL, Handful false, Conflict Risk `Medium`, practice areas `{}`,
notes and cadence `''`. Names resolve against the People list regardless of case
and after `decodeHTMLEntities` (`sanitizeRequestBody` escapes `O'Brien` on the
way in). `Firm` in `Originator` means no person and `originator_is_firm`;
`Credit To Firm` `Y` sets the flag, and without that column a person in
`Originator` keeps the stored flag. The rules are `validateAssignment` and
`legacyText` from `utils/people.cjs`; a people column the file lacks is checked
with the stored value, so a new lead who is the kept second chair is refused.
`Second Chair`, `Originator` and `Credit To Firm` need a `Lead` column. Any
problem refuses the whole file before anything is written: 400
`{ success: false, error, errors: [{ row, client, message }] }`, rows numbered as
a spreadsheet shows them (the header is row 1, and header problems are listed as
row 1). The problems: a name not on the list, a missing lead or one who is not an
active partner, a second chair who is the lead or inactive, a value outside its
column's vocabulary (Stickiness `1`-`5`; Cadence `Daily`/`Weekly`/`Monthly`/
`Quarterly`/`As-Needed`; Conflict Risk `Low`/`Medium`/`High`; Handful and Credit
To Firm `Y` or blank; Practice Area from the form's twelve, `;`-separated; all
case-insensitive), a column given twice, a people column without `Lead`, and a
`CLIENT` named twice regardless of case, which refuses every file, with or
without the new columns. Contract periods no longer produce `validation.issues`;
the list stays in the response and still does not block. With `dryRun: true` (the page's **Check file**) every check and
every write runs in the same transaction, which is then rolled back: the same
400, or `{ success: true, dryRun: true, validation, summary }` with nothing
written; `dryRun` must be a boolean (400 otherwise). Every successful import or
check returns `summary.revenueTotals`, each year's total of the amounts it
writes (`revenueTotals` in `utils/csvImport.cjs`), because the page totals only
the reporting year and the runbook compares every year with the sheet. The pure helpers are `findSheetColumns`, `readSheetRow`,
`resolveSheetPeople`, `checkSheet`, `importWriteColumns` and `valuesList` in
`utils/csvImport.cjs`; a successful import returns the columns it read as
`summary.sheetColumns`.

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
- `services/anthropic.cjs` - the one Anthropic client: `createService()` and the default instance's `AI_MODEL`, `isConfigured()`, `complete()`; `parseResponse()`, `describeError()`
- `utils/aiCost.cjs` - the estimated cost of one AI call from list prices (`PRICES`, `PRICES_READ_ON`, `callCost`, `normalizeUsage`; pure)
- `claude.cjs` - the three AI Advisor routes and their prompt builders
- `utils/book.cjs` - the book as the AI sees it (Tier 1 WP2, T3 to T5; pure): `reportingYear`, `bookModel` (each person's lead book and second-chair load as the page's `partnershipModel` computes them, the role averages and ratios, revenue per effort, the practice areas each person holds, totals by year, exposure, the clients without a lead or a second chair), `renderBook` (deterministic text: a legend, the people by role, totals, exposure, coverage, one row per client; names through `unescapeText`; no notes, ids, dates, sign-in names, `user_id` or retired columns; "not rated" and "not set" for defaults) and `buildBook`. Exposure (T5) is the reporting-year revenue of clients rated Stickiness 1 or 2, in total and by lead; unrated clients are counted separately, never as safe. It never `require()`s the page's `src/` (T3): `tests/book.test.mjs` holds the port to the page's modules
- `routes/ai.cjs` - `GET /api/ai/book` (WP2); later work packages add the AI's POST routes here
- `routes/scenarios.cjs` - `POST /transition-plan`; its request check (`checkPlanRequest`: a client id is a uuid string or production's integer), prompt and parser are the pure helpers in `utils/transitionPlan.cjs`
- `routes/people.cjs` - the People list; its rules are the pure helpers in `utils/people.cjs`
- `data.cjs` - Data processing API endpoints
- `clientAnalyzer.cjs` - Core business logic and calculations
- `routes/auth.cjs` - login, logout, me, change-password; the auth cookie attributes
- `config/session.cjs` - `SESSION_TTL` / `SESSION_TTL_MS`, one lifetime for the JWT and the cookie
- `middleware/rateLimit.cjs` - the four limiters (D11)
- `utils/passwordPolicy.cjs` - `validatePassword`, `validateUsername` (pure, importable from tests)
- `utils/schemaCheck.cjs` - the SQL that lists foreign keys to `users` and `checkUserForeignKeys(rows)`; the SQL that lists foreign keys to `clients`, `checkClientForeignKeys(rows)` and `checkBookReset(before, after)` (pure, importable from tests)
- `db.cjs` - the one `pg` pool (`DATABASE_URL`, `DATABASE_SSL`); pool errors are logged, never fatal
- **Production's tables are older than `init-db.sql`.** Render's `users`, `clients` and `client_revenues` existed before this file, and its `CREATE TABLE IF NOT EXISTS` never replaced them: `clients.id` and `client_revenues.client_id` are **integers** there, not the `uuid` this file declares, and `client_revenues` may lack `UNIQUE (client_id, year)`, its timestamps and `contract_end_date` (`models/clientModel.cjs` read that column until Tier 1 WP1, and every AI Advisor route answered 500 on the older shape). Never cast a client id to a type in SQL (compare `id::text`, or use untyped placeholders that take the column's type), and do not rely on `ON CONFLICT (client_id, year)` or `client_revenues.updated_at`. The first real import on Render failed on exactly that (`column "client_id" is of type integer but expression is of type uuid`); `tests/import-db.test.mjs` now runs on both shapes. Changing production's column types is a migration of its own, not something to do in passing
- `init-db.sql` - the schema (users, clients, client_revenues, people), applied idempotently by `server.cjs` at every start as one multi-statement query, so it is one transaction: a failing statement leaves the database as it was and, in production, stops the server. `clients.user_id` (the account that created the client; no current code reads or writes it) is `ON DELETE SET NULL`: deleting a user keeps its clients and clears their `user_id`. The `DO` block at the end migrates a database that still has the old `ON DELETE CASCADE`, matching the key by column, and is a catalog read on every later start. Keep migrations in this file idempotent, and do not drop a column an older `init-db.sql` still names: a Render rollback runs the older file at start (plan section 12)
- `create-admin.cjs`, `scripts/reset-password.cjs`, `scripts/check-schema.cjs`, `scripts/delete-user.cjs`, `scripts/reset-book.cjs` - add a partner, reset a password, check that no key to `users` cascades, delete an account, start the book over

### Frontend Structure
- `src/App.jsx` - Main application with tab navigation
- `src/portfolioStore.js` - Zustand state management
- `src/api.js` - every API call; prefixes `VITE_API_BASE_URL`, sends the cookie (`credentials: 'include'`)
- `src/PeopleDialog.jsx`, `src/utils/people.js` - the People dialog, the pickers' rules and the client list's person filters
- `src/utils/departure.js` - the departure engine (Phase 5): `departureModel`, the candidate ranking Phase 6 reuses, `assignmentProblems`, and the store's `toggleId` and `withChoice` (pure)
- `src/utils/transitionPlans.js` - Scenarios' Stages 2 and 3 (Phase 5b): the transition-plan request and its roster, approval blockers and pinned choices, the import sheet and who still holds a seat after it, Stage 3's transitions and counts (pure)
- `src/utils/associateSplit.js`, `src/components/AssociateSplit.jsx` - the associate split (Phase 6): proposals and loads (pure), and the Partnership tab's section that accepts them
- `src/utils/load.js` - lead books and second-chair loads against the role average (pure; the Partnership tab, the Dashboard card and the exports read it, and Phase 6 reuses it); effort comes from `resolveEffort` in `src/utils/clientMetrics.js`, which prefers the API's `effort` and otherwise mirrors `getEffort`; a second chair's effort is `secondChairEffort`, `SECOND_CHAIR_EFFORT_SHARE` (0.2) of the client's. `utils/book.cjs` is the server's port (Tier 1 WP2), held equal by `tests/book.test.mjs`
- `src/components/AIBookPanel.jsx` - the AI tab's "What the AI is given" panel (WP2)
- `public/client-book-template.csv` - the import sheet's header and the plan's two example rows (the Data Upload page's "Download template"); `tests/import-sheet.test.mjs` keeps it equal to the plan's section 3 example
- `src/components/ui/` - Reusable UI components (button, card, etc.)
- Core feature components at `src/` root level

### Deployment, operations and docs
- `netlify.toml` - the page's Netlify build (command, publish directory, Node version) and its security headers (D13)
- `deploy/README.md` - the runbook: hosting, rebuild, deploy, rollback, partners, secrets, logs, health, uptime, remaining advisories
- `deploy/backup/` - the nightly backup (WP4) and its install and restore guides
- `.env.example` - the one environment template
- `.github/workflows/ci.yml` (lint, test, build on every PR and push to `main`, plus the `schema` job on PostgreSQL 18), `.github/workflows/backup-selftest.yml`
- `docs/plans/tier-0.md` - the plan and its status table; `docs/archive/` - superseded status documents, history only

## Environment Configuration

### Hosting and deploying (runbook: `deploy/README.md`)
- **Frontend:** built and served by Netlify (project `client-portfolio2`, auto-deployed from `main`) at https://gbacpod.com. `netlify.toml` pins the build (`npm run build:prod`, publish `dist`, `NODE_VERSION` 22, repository root as base) and sets the page's headers: HSTS without preload, nosniff, `strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, and a CSP of `'self'` plus `connect-src https://client-portfolio-backend.onrender.com`. `VITE_API_BASE_URL` is a Netlify UI build variable, deliberately not in `netlify.toml`. No SPA redirect: there are no client-side routes.
- **CSP rules for new code:** the page may load only its own scripts, styles, images (`data:` allowed) and fonts, and may call only itself and the API. Never add `'unsafe-inline'` or `'unsafe-eval'` to `script-src`; an external font, script or API needs a deliberate `netlify.toml` change. If the API's address changes, change `VITE_API_BASE_URL`, `connect-src` and the uptime monitor together.
- **Backend:** a Render web service (`client-portfolio-backend`) running `node server.cjs` behind Render's proxy, with a Render PostgreSQL database; the browser reaches it at https://client-portfolio-backend.onrender.com. The page and the API are therefore different sites (this shapes the cookie, below). No `render.yaml` or Blueprint in Tier 0: linking one can change the live services.
- **Deploying is merging to `main`:** Netlify builds the page, and Render deploys the API if its auto-deploy is on. Then check `/api/health` and the work package's acceptance list. Pull requests get a Netlify Deploy Preview; the API has none, and a preview cannot sign in (its `*.netlify.app` origin is not `FRONTEND_URL`, so the API refuses it), so sign-in and the tabs are checked on gbacpod.com after merge. Rollback is per provider (runbook section 5).
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
- `AI_MODEL` - model id for every AI call (default `claude-opus-5`; `claude-sonnet-5` is the cheaper alternative, D7). A model not in `utils/aiCost.cjs`'s `PRICES` logs `costUsd: null`
- `AI_EFFORT` - optional: `low`, `medium`, `high`, `xhigh` or `max`, sent as `output_config.effort` on every AI call (T11); unset means the API's default (`high` on `claude-opus-5`); any other value stops the server at start
- `ANTHROPIC_BASE_URL` - local tests only: points the SDK at `tests/helpers/fakeAnthropic.mjs`. Ignored in production, where AI calls always go to `https://api.anthropic.com`; never set it on Render

### Vite Configuration
- `src/api.js` prefixes every call with `import.meta.env.VITE_API_BASE_URL`. Production builds require an `https://` value (`vite.config.js` enforces it). For `npm run dev`, start Vite with `VITE_API_BASE_URL=http://localhost:5000`: without it the frontend calls relative `/api`, which Vite does not proxy (the `http://localhost:5000` fallback in `vite.config.js` only defines `process.env.VITE_API_BASE_URL`, which `api.js` does not read)
- Path alias `@` points to `./src`

### Auth, sessions and rate limits (WP3)
- **Cookie:** `authToken`, `HttpOnly`, `Path=/`, `Max-Age` = `SESSION_TTL` (604800 s for `7d`), the same span as the JWT's `exp`. In production `SameSite=None; Secure`, because the API (onrender.com) and the page (gbacpod.com) are different sites and a `Lax` cookie would never reach the API; in development `SameSite=Lax` (page and API are both on localhost, one site). This deviates from D10, which assumed a same-origin API. `res.clearCookie` gets the same attributes.
- **Cross-site requests:** no form-body parser (`express.json` only, 5 MB; a larger body answers 413), CORS allows only the allowlist (`FRONTEND_URL` in production, `localhost:3000`/`5173` in development) and answers other origins without CORS headers rather than with an error, and `server.cjs` refuses POST/PUT/PATCH/DELETE whose `Origin` is neither allowlisted nor the server's own with 403 (`origin_refused` log line). The origin check is what stops a cross-site form from triggering the body-less AI Advisor POSTs; do not remove it while the cookie is `SameSite=None`.
- **Rate limits (D11, `middleware/rateLimit.cjs`, express-rate-limit 8):** login 20 per 15 min per IP (`/login` and `/change-password` share it) and 5 failed per 15 min per username (case-folded; successful logins do not count); AI 30 per hour per partner and 300 per day for the firm, one budget across `/api/claude/*` and `/api/scenarios/*`, mounted after `authenticateToken`. Over the limit: 429 `{ success: false, error: 'Too many requests. Try again later.' }`, which the login page shows verbatim, and a `rate_limited` log line with the limiter and key. Counters are in memory: a redeploy resets them. A custom `keyGenerator` that falls back to the IP must wrap it in `ipKeyGenerator` (the library logs `ERR_ERL_KEY_GEN_IPV6` otherwise). Five wrong passwords lock that username for 15 minutes, including for its owner.
- **Passwords:** `POST /api/auth/change-password` `{ currentPassword, newPassword }` (the header's "Change password" dialog): 200, 400 with the policy's errors, 401 for a wrong current password. `npm run reset:password` for a forgotten one. Neither ends sessions already issued (the JWT is stateless); rotate `JWT_SECRET` to sign everyone out.
- **Database:** a dropped connection logs `{"event":"pg_pool_error",...}`; the pool reconnects on the next query and the process keeps running.
- **Health:** `GET /api/health` needs no sign-in, always answers HTTP 200, and returns `status` (`OK`, or `DEGRADED` when the database query fails or no Anthropic key is set), `timestamp`, `uptimeSeconds`, `environment`, `features` (`["check-file", "transition-plan-roster", "second-chair-assign", "ai-book"]`: what this API can do that an older deploy cannot) and `services` (`database`, `anthropic`, `model`). The upload page asks it before **Check file** and sends nothing to an API without `check-file`, which would ignore `dryRun` and import the file; it also shows "Nothing was written" only when the answer carries `dryRun: true`. Scenarios' Stage 2 asks it before its AI plans and sends nothing to an API without `transition-plan-roster`, which would ignore the roster and recommend nobody from it. The Partnership tab's associate split asks it on load and keeps Accept off without `second-chair-assign`. The AI tab's "What the AI is given" panel asks it each time it opens and says "The API has not been updated yet." without `ai-book`, which has no `GET /api/ai/book`. Add a feature name here when the page starts depending on new API behaviour that an older API would get wrong. A monitor must check the body for `"status":"OK"`, not the status code.
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
- Scenario state lives in the store (plan P11), so a tab switch keeps it: `successionWorkflow` (`currentStage`: `impact`, `mitigation` or `implementation`; `departingIds`; `choices`, the partner's picks per client, set with `setDepartureChoice`), `transitionPlans` (Stage 2's plans) and Stage 3's execution state. Not persisted (`partialize`), cleared on logout and by `resetSuccessionWorkflow` (the stepper's "Start over"); saving scenarios on the server is later work (review section 7, Tier 2). The Partnership tab's departing flags, redistribution models and custom reassignments are gone (Phase 4); the store's `partners`/`fetchPartners`, derived from the legacy text with an "Unassigned" entry, are gone (PR 5b). Stage 2's plans (`updateTransitionPlan`, `approveTransitionPlans`, which pins each client's seats as choices, `setTransitionPlanStatus`) and Stage 3's `activeTransitions`, `transitionTasks` and `communicationLog` (`startExecution`, `updateTransition`, the task and communication actions) are store state too; Stage 3's counts come from `executionSummary`
- The associate split's picks are the component's own state (they only change what is proposed); accepting goes through the store's `assignSecondChair`, the one write
- AI Advisor answers live in the store (`aiResults`, `aiError`, not persisted, cleared on logout) so switching tabs, which unmounts the tab content, does not discard a paid answer
- Use `usePortfolioStore()` hook to access state in components

### API Integration
- Frontend calls backend APIs via `src/api.js`
- Backend serves both data processing and AI endpoints
- Error handling implemented throughout the stack

## Common Development Patterns

### Adding New Client Fields
1. Update CSV processing in `clientAnalyzer.cjs:processCSVData`; a column of the import sheet goes in `SHEET_COLUMNS`, `readSheetRow` and `importWriteColumns` (`utils/csvImport.cjs`) and in plan section 3
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
  `complete({ system, prompt, maxTokens, userId, label, onText })` and never
  construct a client or call the Messages API themselves;
  `tests/ai-grep.test.mjs` fails if `messages.create(`, `messages.stream(`,
  `countTokens(` or `new Anthropic(` appears anywhere else, or `betas`,
  `fallbacks` or `output_config` outside the service.
- SDK `@anthropic-ai/sdk` 0.128.0 (Tier 1 WP1, `docs/plans/tier-1.md` T2). The
  service is a factory, `createService({ apiKey, model, effort, fetch, baseURL })`;
  the module exports the default instance, built from the environment at start
  (`AI_MODEL`, `isConfigured`, `complete`), plus `createService`,
  `parseResponse` and `describeError`. Every call streams from Anthropic
  (`client.beta.messages.stream(...)`, then `finalMessage()`; `onText` gets each
  text delta, and an error it throws is logged once as `ai_on_text_error` and
  never stops the call). The request carries `model`, `max_tokens`, `system` (a
  string, or `{ type: 'text', text, cache_control? }` blocks passed through
  unchanged) and one user turn; plus, only while the model is in
  `FALLBACK_MODELS` (`claude-opus-5`), `fallbacks: 'default'` with the beta
  `server-side-fallback-2026-07-01` (T10); plus, only when `AI_EFFORT` is set,
  `output_config: { effort }` (T11). Nothing else: no sampling parameters, no
  `thinking` (the model thinks by default, and `max_tokens` caps thinking and
  answer together), no tools, no prefill. The SDK's `timeout` (180 s) bounds the
  wait for an answer to start, not the answer (checked with Node's own fetch;
  the module comment has the details). In production the address is always
  `https://api.anthropic.com`: `ANTHROPIC_BASE_URL` is ignored there with an
  `anthropic_base_url_ignored` warning at start (T17). Only the API key is sent
  (`authToken: null`).
- `parseResponse()` collects text by content-block type, skipping `thinking` and
  `fallback` blocks; text on either side of a `fallback` block (a mid-stream
  decline the fallback model continued) is joined with nothing between. It
  flags `truncated` (`stop_reason: max_tokens`) and `refused`; a refusal nothing
  rescued returns empty text, whatever streamed before it, and
  `refusalCategory` from `stop_details`. It adds `servedBy` (the message's
  `model`), `fellBack` (a `fallback_message` entry in `usage.iterations`), the
  counts summed over the call's attempts as `tokens`
  (`{ inputTokens, outputTokens, cacheReadTokens, cacheWrite5mTokens, cacheWrite1hTokens, iterations }`)
  and keeps the raw `usage`. `complete()` adds `costUsd` and `pricesReadOn`. Every
  AI answer is still
  `{ success: true, <analysis|advice|recommendations|plan>, truncated, refused, model, usage, timestamp }`;
  the UI shows "The response was cut off; ask a narrower question." when
  `truncated` is true and "The AI declined to answer this request." when
  `refused` is.
- Errors: `describeError(err)` maps SDK errors to a status and a message a
  partner can act on (503 not configured, 429 rate limited, 504 unreachable,
  503 upstream 5xx, 502 bad key or rejected request). An `error` event in the
  middle of a stream arrives as an `APIError` with no status and a `type`:
  `overloaded_error` and `api_error` give 503, `rate_limit_error` 429, another
  type 502 naming it. Routes answer `{ success: false, error }`;
  `apiErrorMessage()` in `src/api.js` extracts that text on the frontend.
- One structured log line per call:
  `{"event":"ai_call",label,userId,model,servedBy,fellBack,stop,refusalCategory,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,costUsd,ms}`
  (`model` is the one requested; `ai_error` with `status`, `type` and `message`
  on failure). `costUsd` is an estimate from list prices in
  `utils/aiCost.cjs` (pure): `PRICES` per model, `PRICES_READ_ON`, and
  `callCost(usage, model, { declined })`, which prices each attempt in
  `usage.iterations` at its own model (cache writes 1.25x for 5 minutes and 2x
  for 1 hour, reads 0.1x) and follows Anthropic's refusal billing rule (a
  refusal before any output is billed only for `bio`, `frontier_llm` and
  `reasoning_extraction`). A model without a price gives `costUsd: null` and an
  `ai_cost_unknown_model` line, never a guess: add the model to `PRICES` when
  `AI_MODEL` or a fallback target changes. The Anthropic Console is the bill.
- Testing without a key (`docs/plans/tier-1.md` section 4):
  `tests/fixtures/anthropic/` holds recorded streams (`*.sse`, written from the
  documented wire format) and HTTP errors (`*.json`);
  `tests/helpers/fakeAnthropic.mjs` exports `fakeFetch(queue)` for
  `createService({ apiKey: 'test', fetch })` and `startFakeAnthropic()`, an
  http server on 127.0.0.1 that answers `POST /v1/messages` from a queue (it
  can hold a stream open) and records each request. As a script,
  `node tests/helpers/fakeAnthropic.mjs --port 5099`, it answers every request
  with a short text naming what it received (a transition-plan request gets a
  plan in the six sections, recommending people from the prompt's roster);
  `POST /__fake/enqueue { "fixtures": ["refusal-before-output.sse"] }` queues a
  fixture and `GET /__fake/requests` lists what it received. Run the page end
  to end against it with `NODE_ENV=development ANTHROPIC_API_KEY=test
  ANTHROPIC_BASE_URL=http://127.0.0.1:5099 node server.cjs`.
- Live endpoints: `/api/claude/analyze-portfolio`, `/api/claude/strategic-advice`
  and `/api/claude/client-recommendations` (prompt builders in `claude.cjs`,
  each returning `{ system, prompt }` with the persona paragraph as `system`),
  and `POST /api/scenarios/transition-plan` (`utils/transitionPlan.cjs`; one
  client per request, the succession workflow calls it with concurrency 2 and
  shows progress, D9). Its request carries the roster of people staying, with
  the lead and second-chair loads the page's `partnershipModel` computes;
  `checkRoster` keeps it to at most 50 active people on the People list who
  are not leaving (the list's names and roles, whatever the page sent, after
  undoing the request sanitizer's escaping), and the prompt asks for a
  `RECOMMENDED LEAD` and a `RECOMMENDED SECOND CHAIR` by name from it, in
  their own sections. The parser resolves the first line of each against the
  same roster (`resolveRecommendation`): a name off the roster, two names, a
  non-partner lead or a second chair who is the lead resolve to nobody, with
  the reason, and never fill a seat; the page applies a recommendation only
  when the partner asks. A plan's timeline is the `TIMELINE` section's
  number of days, or none.
- Deleted in WP2 (D8), do not resurrect: the succession, capacity, growth and
  bulk-transition-plans scenario endpoints, the nonexistent Partnership
  "analyze" endpoint and its AI Optimize button, the Growth tab, the legacy
  succession form, `PROMPT_SETTINGS` and the three unused prompt builders.
- The AI Advisor renders answers with `react-markdown` (default settings, no raw
  HTML plugin) and keeps them in the store (`aiResults`).
- The three surviving prompts still describe fields that do not exist; the
  prompt rewrite is the first Tier 1 item (plan section 5.5).
- The book (Tier 1 WP2, `utils/book.cjs`, `GET /api/ai/book`) is the text
  Ask and the brief will send from WP3, as the cached system block (T8). It
  renders byte-identically for the same data (sorted, fixed number formats,
  no date), which the prompt cache needs: never add a timestamp, an id or
  anything in arrival order to it. It holds no client notes (T4); the AI tab
  shows the exact text. Nothing in it calls Anthropic or counts tokens.