# Tier 1 Plan: The AI rebuild

**Status:** approved by Jeff on 2026-09-26, every proposed decision as recommended (marked "approved" in section 1); progress is in the section 2 status table. Written 2026-09-25 against `29d2a67` (`main` after PR #28), when Tier 0's code work and the people plan's Phases 1 to 6 had merged.
**Why:** `docs/plans/tier-0.md` section 11 previewed Tier 1 and section 5.5 deferred it: the AI still sees five clients through three consulting-deck prompts that read fields which do not exist and the legacy lead text, answers vanish on refresh, and nobody can see what an answer cost. `PRODUCT_BRIEF.md` promises an "Ask the AI" box with the per-partner picture loaded ("Smarter Ask", build step 4). The people plan has since built that picture (`partnershipModel` in `src/utils/load.js`), in the browser only.
**Background:** `REVIEW-2026-09.md` sections 3 (the AI as it was) and 8 (Tier 1); `docs/plans/tier-0.md` sections 5, 10 and 11; `docs/plans/people-and-second-chair.md` (P10 as amended, Phase 5's roster, Phase 6).
**Audience:** future Claude Code sessions and Jeff. Sessions run in a container with the repository, a local PostgreSQL and no Anthropic key, and cannot reach Render, Netlify or gbacpod.com; every step on production is Jeff's.

---

## 0. How a session uses this document

### 0.1 Read order

1. `CLAUDE.md` (architecture, commands, the AI rules).
2. This file: section 1 (decisions), section 2 (status), section 3 (constraints), section 4 (testing without a key), section 5 (cost), then the one work package you are executing.
3. Before writing anything about the SDK, models, prompt caching, streaming, refusals or prices, load the `claude-api` skill and use what it says is current. The SDK version (T2) and the prices (section 5) in this file are dated; re-check both in WP1.

### 0.2 Working agreement

1. One work package per branch and pull request, in the order WP1, WP2, WP3, WP4, then WP5 and WP6 in either order. Branch from `origin/main` after the previous package has merged. Jeff's production checks may trail the next package, but not by more than one.
2. Gates before and after, all green:
   - `npm ci`
   - `npm run lint`: 0 errors; the 3 expected `exhaustive-deps` warnings (`App.jsx` twice, `DashboardView.jsx` once).
   - `npm test`
   - `VITE_API_BASE_URL=https://gbacpod.com npm run build:prod`
   - both database suites on a throwaway local PostgreSQL, set up as `CLAUDE.md` (Testing) says: `SCHEMA_TEST_SERVER_URL=<the superuser URL, no database name> node --test tests/schema.test.mjs tests/import-db.test.mjs`. CI's `schema` job runs them on PostgreSQL 18.
3. Schema changes go only in `init-db.sql`, idempotent, and never drop or rename a column or table an older `init-db.sql` names: a Render rollback runs the older file at start (`docs/plans/tier-0.md` section 12).
4. Unchanged rules: do not change the scoring weights in `utils/strategic.cjs`; no React or Vite major upgrade; no Anthropic call outside `services/anthropic.cjs`; never run anything against production; never commit a key or a password. No test uses a real Anthropic key (section 4).
5. Every package ends with the gates green, `CLAUDE.md` updated where behaviour it documents changed, this file's status table updated in the same PR, and a PR description that lists the package's expected outcomes and the evidence for each.
6. If this plan and the code disagree, the code wins; say so in the PR and in section 2's notes.

### 0.3 Session start checklist

```bash
git fetch origin
git checkout -b claude/tier1-wpN-short-name origin/main
npm ci
npm run lint
npm test
VITE_API_BASE_URL=https://gbacpod.com npm run build:prod
```

---

## 1. Decisions

"Carried" means an existing decision this plan keeps; "Jeff" means Jeff's direction (Tier 1's scope in `docs/plans/tier-0.md` section 11); "approved" means this plan's recommendation, which Jeff approved as written on 2026-09-26. Sessions treat every decision here as settled; a change goes back to Jeff.

| # | Decision | Rationale | Status |
|---|---|---|---|
| T1 | Every Anthropic call stays in `services/anthropic.cjs`; `AI_MODEL` stays the one model setting (default `claude-opus-5`, D7); the request still carries no sampling parameter (`temperature`, `top_p`, `top_k`), no `budget_tokens` or other thinking configuration, no tools and no prefill. Tier 1 adds to the one request only: streaming from Anthropic, `system` as text blocks with one cache marker (T8), the refusal fallback (T10) and, when set, `output_config.effort` (T11). | The WP2 rules that made the AI dependable. `tests/ai-grep.test.mjs` keeps enforcing them, widened to the streaming call. | carried (D7, WP2) |
| T2 | Upgrade `@anthropic-ai/sdk` from 0.56.0 to the newest 0.x on the day (0.128.0 on 2026-09-25, from `npm view`), alone in WP1, before anything uses the new features. | Server-side fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`), `usage.iterations` with each attempt's model, `stop_details` and cache usage by TTL exist only in recent versions. Checked on 2026-09-25, while writing this plan, in a scratch install of 0.128.0: the CommonJS `require('@anthropic-ai/sdk').Anthropic` export and its error classes, `client.beta.messages.stream(...).finalMessage()`, the typed `fallbacks` parameter and its beta header, and a custom `fetch` all behave as this plan uses them. A 0.x minor may break anything, so WP1 changes nothing else. | Jeff (scope) |
| T3 | The book the AI sees is built on the server, from the database, at each request, by a pure CommonJS module (`utils/book.cjs`) that ports the page's load arithmetic (`partnershipModel`, `SECOND_CHAIR_EFFORT_SHARE`, `computeReportingYear`). Parity tests import the page's modules and the port and require equal figures on fixture and random books. | Every prompt and every saved answer then rests on the database's book, not on what a page (stale, or crafted) sends. `CLAUDE.md` already prescribes a CommonJS mirror with a parity test for the effort share. Rejected: `require()` of the page's ES modules from the server, which needs Node 20.19 or 22.12 while Render's Node version is unconfirmed (runbook 1.2), and would tie the API to files the page refactors freely; and the page sending its figures, as the transition plan does today. | approved (Jeff, 2026-09-26) |
| T4 | The book holds every client with its lead, second chair, originator (and firm credit), practice areas, revenue in every year on file, the stickiness pick as its label or "not rated", cadence or "not set", the handful flag, conflict risk, effort and strategic value; every active person, and anyone inactive who still holds a seat, with role, lead book and second-chair load (clients, reporting-year revenue, effort) against the role average, revenue per effort and the practice areas they hold; totals by year; the clients without a lead or a second chair; exposure (T5). It never holds client notes, the partners' sign-in names, `user_id` or the retired columns. A default is labelled as one: an unrated client's neutral stickiness is never shown as a rating. The AI tab shows the exact text sent. | The brief's three axes and flag and its "who's carrying what", with nothing around them invented. Notes are the one free-text field that may hold confidential matter and are not needed to answer questions about the book; the review (section 5) asked for this to be a deliberate choice. Showing the text is how a partner learns what leaves the building. | approved (Jeff, 2026-09-26) |
| T5 | Exposure, the brief's "high revenue sitting on thin relationships", is the reporting-year revenue of clients rated Stickiness 1 (Cold) or 2 (New / still shallow), in total and by lead. Clients with no rating are counted separately, never as safe. | One definition shared by the book, the brief and every answer; the two lowest anchors are the brief's thin relationships. | approved (Jeff, 2026-09-26) |
| T6 | Two prompts replace the three: **Ask the book** (the partner's question) and **the brief** (a fixed request under five headings: Who's carrying what; Where the exposure is; Coverage; Worth a conversation; What the book can't tell you). Both share one system prefix: the instructions, then the book. The instructions: answer the question asked, first; cite the book's figures and names as written there; say what the book cannot support; name only people and clients in the book; never invent owners, dates, targets, KPIs, contacts or fields; balance is relative to the role average, with no capacity ceiling; suggest candidates with reasons and never tell the partners to move a client (a departure scenario asks for new seats explicitly); no compensation or origination-credit arithmetic; keep answers short. The three consulting-deck routes and their prompts are deleted. | The brief's "Ask the AI" box and build step 4; the review's section 3.2 and its Tier 1 item 3. One shared prefix lets one cache entry serve both. | Jeff (scope); headings and rules approved (Jeff, 2026-09-26) |
| T7 | Each question stands alone with the book: no conversation history in Tier 1. | The brief's examples are single questions. Follow-ups mean sending the earlier turns back unchanged, thinking blocks included, and cost more per turn as the history grows. Earlier answers stay on screen and saved (T12). | approved (Jeff, 2026-09-26) |
| T8 | Prompt caching: one explicit `cache_control` breakpoint at the end of the book block, with the default 5-minute lifetime. Today's date and the question come after it. The book renders byte-identically for the same data: sorted, fixed number formats, no timestamps. | The 5-minute cache breaks even at two requests; the 1-hour cache doubles the write and pays only at three or more requests an hour on the same book. Hits come from follow-up questions and Stage 2 runs (T14). At this book's size the saving is cents per question (section 5); the saved answers record cache reads and writes (T12), so the hit rate is measured before anyone changes the lifetime. | approved (Jeff, 2026-09-26) |
| T9 | Streaming: the server streams from Anthropic from WP1 (the SDK's `stream().finalMessage()`); the page receives the answer as it is written from WP5, as `text/event-stream` read with `fetch` and a stream reader, with a heartbeat every 15 seconds. Checks, and upstream errors before the first event, answer JSON with their usual status and message. | Streaming from Anthropic lifts the SDK's non-streaming guard on large `max_tokens`. `EventSource` cannot send a POST body; `fetch` with `credentials: 'include'` already reaches the API under the page's CSP. | Jeff (scope) |
| T10 | Refusal fallbacks: `fallbacks: "default"` with beta `server-side-fallback-2026-07-01` on every call while `AI_MODEL` is `claude-opus-5` (a list in the service; other models run without it). The API reruns a policy decline on the model it recommends for the category, billed at that model's prices. The service records who served the answer and whether a fallback ran. A refusal the chain did not rescue discards any partial text and shows the existing "The AI declined to answer this request." with the category. | Current models' safety classifiers can decline benign work, and a request without fallbacks simply stops. `"default"` routes by category, so the app never names a fallback model it would later have to migrate. The `claude-api` skill documents the fallback for `claude-opus-5` and the Fable models, not for `claude-sonnet-5` (D7's cheaper option); this plan does not assume it there, so after a switch to that model refusals show as they are. | approved (Jeff, 2026-09-26) |
| T11 | Output budget: `max_tokens` 32,000 for Ask and the brief (16,000 today) and 16,000 for a transition plan (8,000 today). An optional `AI_EFFORT` (`low`, `medium`, `high`, `xhigh` or `max`; unset means the API's default, `high` on `claude-opus-5`), read once like `AI_MODEL` and refused at start when invalid. | The current model thinks by default and `max_tokens` caps thinking and answer together, so today's budgets risk cut-off answers; output is billed only as generated. Effort is the documented cost and latency lever for this model: the variable lets Jeff compare `medium` with the default on real questions, using the saved costs, with no code change. | approved (Jeff, 2026-09-26) |
| T12 | Saved answers: a new `ai_answers` table holds every answer an AI route returns (Ask, the brief, transition plans): who asked, the question or client, the answer, the model requested and the model that served it, the flags, the tokens by kind and the estimated cost. Errors are logged, not saved. Every partner sees every answer; nobody can delete one in Tier 1. `client_id` is text with no foreign key and the client's name beside it; `asked_by` references `users` `ON DELETE SET NULL` with the username beside it. | The brief's one shared book, and the review's "partners share answers, the cost is visible, and a tab switch does not lose work". Text and no key: production's client ids are integers and `init-db.sql`'s are uuids, `reset-book` refuses while any key to `clients` does not cascade, and a cascade would empty the answers at every reset. `SET NULL` keeps `check-schema` and `delete-user` working. | approved (Jeff, 2026-09-26) |
| T13 | Cost per answer is the sum, over the call's attempts (`usage.iterations`, or the top-level usage when there are none), of input, output (thinking included), cache-write and cache-read tokens times the price of the model that ran that attempt. Prices live in one pure module, `utils/aiCost.cjs`, per model per million tokens, with the date they were read; each saved answer stores its tokens, its cost and that date, so a later price change never rewrites history. A model without a price gets no cost (null and a log line), never a guess. The AI tab shows each answer's cost and the month's total to every partner. It is an estimate from list prices; the Anthropic Console is the bill. | Cost visibility belongs with shared answers; a stored date keeps old figures honest. | approved (Jeff, 2026-09-26) |
| T14 | Transition plans keep their endpoint, request and response, their roster check and their resolution against the roster: a name off the roster never fills a seat. In WP6 they move onto the shared prefix (instructions and cached book), and the roster's loads and the client's facts come from the server's book instead of the page's figures. They are not folded into the brief: a plan is per client and per scenario, and the page parses it. | The model then sees every candidate's clients and practice areas, which is what the recommendation of a lead and a second chair rests on, and the page can no longer feed it different loads. Cost: slightly more per Stage 2 run than today (section 5). | approved (Jeff, 2026-09-26) |
| T15 | When the page's connection drops mid-answer, the server finishes the answer and saves it; it does not abort the call. | A partner who closes the tab finds the answer under Recent answers, and the input is already paid for when the connection drops. The extra cost is bounded by `max_tokens` and the rate limits. | approved (Jeff, 2026-09-26) |
| T16 | Rate limits stay as D11: 30 AI requests per partner per hour and 300 per day for the firm, counted per request as it arrives, one budget across Ask, the brief and transition plans. A streamed answer counts once, a cache hit counts like a miss, and a fallback is part of its request. The new GET routes (the book, recent answers) make no AI call and are outside the AI budget. | Caching and streaming change a request's cost and latency, not the number of requests. The limiter is the worst-case cost cap (section 5), with a spend limit on the Anthropic workspace behind it. | carried (D11) |
| T17 | Testing without a key: the service is built by a factory that takes a `fetch`, so unit tests drive the real SDK with recorded streams; a fake Anthropic server on localhost, reached through `ANTHROPIC_BASE_URL`, serves the route, database and browser tests; Playwright routing covers page states alone. In production the service always calls `https://api.anthropic.com`, whatever `ANTHROPIC_BASE_URL` says. | There is no key in the container, and the SDK's own handling of streams, fallback blocks and errors is what WP1 must prove. Pinning the address in production means a stray variable on Render cannot send the key elsewhere. | approved (Jeff, 2026-09-26) |

---

## 2. Status table (sessions update this)

| WP | Title | Size | Status | Branch / PR | Notes |
|---|---|---|---|---|---|
| WP1 | SDK upgrade and the service | 1 session | deployed | `claude/tier1-wp1-sdk-service-i4sksr`, [PR #30](https://github.com/zekusmaximus/client-portfolio/pull/30) | SDK 0.56.0 → 0.128.0; `npm audit` 5 before and after (1 moderate, 3 high, 1 critical; none in the SDK). Pricing and refusal pages re-read on 2026-09-26: prices as section 5's table, `PRICES_READ_ON` 2026-09-26. Where the plan and the code differed, the code won: (1) the refusal billing rule is now published and is encoded: a refusal before any output is billed only for `bio`, `frontier_llm` and `reasoning_extraction`, not counted as section 5 said until then; (2) `callCost(usage, model, { declined })`: usage alone cannot say which attempts declined or why, so `parseResponse` lists each declined attempt's category (the `fallback` blocks' `trigger.category`, then `stop_details.category`); (3) the normalised counts are `tokens`, summed over the attempts with `iterations` per attempt; `usage` stays raw and `model` stays beside `servedBy`; the `ai_call` line's `model` is now the model requested; (4) text either side of a `fallback` block is joined with nothing (the fallback model continues mid-sentence); (5) a mid-stream `APIError` of another type gives 502 naming it, and one with no type 500; (6) `authToken: null`, since the SDK reads `ANTHROPIC_AUTH_TOKEN` by default; (7) `createService` also takes `timeout`, for the timeout test; (8) HTTP error fixtures are `*.json` beside the `*.sse` streams, and the fake server has `/__fake/enqueue` and `/__fake/requests`; (9) the SDK's stream helper takes the cache-write split only from `message_start`; (10) 0.128.0 supports Node 20 or later and Render's Node version is unconfirmed: a Jeff item before the merge; (11) outside this package's file list: `models/clientModel.cjs` read `client_revenues.contract_end_date`, which production's older table shape (as `tests/import-db.test.mjs` models it) lacks, so every AI Advisor route answered 500 on it before any AI call; fixed in its own commit with an `import-db` test on both shapes. WP2's "whose join already runs on both shapes" is true only from this commit. Timeout confirmed with Node's own fetch (module comment). End to end in the container on production's table shape: the three AI Advisor buttons and four Stage 2 plans rendered the fake's answers, a refusal fixture showed the notice, and 17 `ai_call` lines matched 17 requests with the new fields and `costUsd`. Before the merge Jeff confirmed Render runs Node 22.16.0 and set the Console spend limit, $50 a month for testing (2026-09-26). Deployed: on 2026-09-26 `/api/health` reported `anthropic: configured` and `model: claude-opus-5`, and a client recommendation answered. Left: the `ai_call` line against the Console (section 6) |
| WP2 | The book on the server | 1 session | deployed | `claude/gallant-faraday-cxhwfx`, [PR #31](https://github.com/zekusmaximus/client-portfolio/pull/31) | Gates green; database suites 65 pass on PostgreSQL 16 (61 before). End to end on production's table shape with a 24-client book (section 7's acceptance): 10,232 characters, about 2,558 tokens, so about 7,500 tokens for 100 clients, below section 5's assumed 12,000. Where the plan and the code differed, the code won: (1) the parity test found the page's `formatMoney`, `formatEffort` and `formatRatio` (`src/utils/load.js`) rounding a float sum differently by summation order (5.45 shown as 5.4 or 5.5); the book sorts before summing, so both sides now settle a figure to 12 significant digits before rounding; (2) parity is within 1e-9 on the numbers and exact on the displayed figures, not bit for bit; (3) `tests/load.test.mjs`'s fixture book moved to `tests/fixtures/books.mjs`, shared by both suites; (4) `peopleCount` is the people the text lists (every active person and anyone inactive who holds a seat); (5) revenue per effort is a person's lead-book revenue in the reporting year ÷ their lead effort, with the book's own in Totals; (6) exposure also shows "Rated 3 to 5" and the unrated band by lead; coverage lists the unled clients and those with a lead and no second chair; (7) an imported blank Conflict Risk is stored as Medium and a blank Handful as no (P8), so only stickiness and cadence can read as defaults; (8) the panel is `src/components/AIBookPanel.jsx`, fetches on every opening, and until WP3 the three AI Advisor buttons still send their old prompts; (9) the route reads clients and people in two queries, not one snapshot; (10) `import-db` pinned the feature list and now includes `ai-book`; (11) outside the file list, in its own commit: `init-db.sql`'s stickiness backfill ran at every start and, since `relationship_intensity` is 5 on every new row, turned every unrated client into a 3 at the next start (on Render, every deploy); it now runs only in the start that adds the column, with two `schema` tests that failed on the old file; production's unrated clients are very likely 3s now, and a re-import of the sheet after the deploy restores them (Jeff item 5 in the PR). Found here and fixed on its own branch, `claude/serene-hopper-yl53i0`, [PR #32](https://github.com/zekusmaximus/client-portfolio/pull/32): the import matched names decoded, so a client whose name the form stored escaped (`&amp;`, `&#x27;`) was duplicated by the next import; it now matches stored names unescaped and writes the sheet's spelling back (CLAUDE.md, Import sheet). That fix must be live before the PR's item 5 re-import; on 2026-09-26 the API started 36 seconds after #32 merged. Deployed: on 2026-09-26 `/api/health` listed `ai-book`, and the production book is 84 clients, 17,637 characters, about 4,409 tokens. Left: the panel checks and the stickiness restore in section 7 |
| WP3 | Ask the book and the brief | 1.5 sessions | not started | | |
| WP4 | Saved answers and cost | 1 session | not started | | |
| WP5 | Streaming to the page | 1.5 sessions | not started | | |
| WP6 | Transition plans on the book | 0.5 to 1 session | not started | | |

Status values: `not started`, `in progress (date)`, `PR open`, `merged`, `deployed`, `verified on gbacpod.com`.

**Size, honestly.** A session here is what each people-plan phase took: code, tests, the database suites, an end-to-end run in the container and the PR. The total is 6.5 to 7 sessions, about four to six working days with Jeff's checks, against section 11's "three to five days". The difference is the test harness that replaces the missing key (section 4) and streaming, which only Render can prove. WP3's prompt can be judged only with a key: expect a small follow-up PR after Jeff's first real answers.

---

## 3. Constraints every work package keeps

Each was checked against the code at `29d2a67`.

1. **One call site.** `tests/ai-grep.test.mjs:39` fails if any file other than `services/anthropic.cjs` matches `messages.create(` or `new Anthropic(`; `:44` pins the request to `model`, `max_tokens`, `system` and `messages` and forbids `top_p`, `thinking:`, `output_config`, `tool_choice` and `stream:`. WP1 widens the first pattern to `messages.stream(` and `countTokens(`, and rewrites the second: still no `temperature`, `top_p`, `top_k`, `budget_tokens`, `thinking:`, `tool_choice` or `tools:`; `output_config` only as `output_config: { effort }`; `betas` and `fallbacks` only in the service. `AI_MODEL` (`services/anthropic.cjs:12`) stays the one model setting and `/api/health` keeps reporting it (`server.cjs:135`).
2. **What the service changes, and how refusals and cut-offs surface.** `complete()` (`services/anthropic.cjs:51`) calls `client.messages.create` and returns `parseResponse()`'s `{ text, truncated, refused, stopReason, model, usage }`; the routes pass `truncated` and `refused` to the page, which shows "The response was cut off; ask a narrower question." and "The AI declined to answer this request." (`src/AIAdvisor.jsx:25` to `43`). After WP1: `complete()` streams (`client.beta.messages.stream(...)`, then `finalMessage()`), accepts `system` as text blocks, sends the fallback (T10) and the effort (T11), and calls an optional `onText` with each piece of text. `parseResponse()` skips `fallback` blocks as it skips `thinking` blocks; on a refusal it returns empty text and `refusalCategory` from `stop_details`; it adds `servedBy` (the message's `model`), `fellBack` (a `fallback_message` entry in `usage.iterations`) and the token counts by kind. `describeError()` keeps its statuses and messages, and gains the case the SDK upgrade exposes: an `error` event in the middle of a stream arrives as an `APIError` with no `status` and a `type` (checked on 0.128.0: `overloaded_error` gives `status` undefined), which today would read "AI request rejected (undefined)."; WP1 maps `overloaded_error` and `api_error` to 503 and `rate_limit_error` to 429. The page's two notices are unchanged.
3. **Production's older tables.** `clients.id` and `client_revenues.client_id` are integers on Render and uuids in `init-db.sql` (`CLAUDE.md`, File Structure); every query compares `id::text` (`data.cjs:378`, `:425`, `:916`) or uses untyped placeholders. Tier 1 adds one table, `ai_answers` (WP4), whose `client_id` is `TEXT` with no foreign key (T12), written with `String(client.id)`; no new SQL casts a client id. WP2's book reads through `clientModel.listWithMetrics()`, whose join already runs on both shapes. `tests/import-db.test.mjs` runs every new route on both table shapes.
4. **`init-db.sql`.** It runs at every start as one transaction (`server.cjs`), so a failing statement stops a production start and leaves the database as it was. WP4's table and index are `CREATE ... IF NOT EXISTS`; nothing is dropped or renamed. A Render rollback runs an older file that does not mention `ai_answers`, which leaves the table and its rows alone; `tests/schema.test.mjs` proves it.
5. **Netlify before Render.** Netlify publishes the page about a minute after a merge and Render may lag or have auto-deploy off. Every page behaviour that needs new API behaviour gets a name in `/api/health`'s `features` (`server.cjs:120`, today `check-file`, `transition-plan-roster`, `second-chair-assign`) and a check on the page: `ai-book` (WP2), `ask-the-book` (WP3), `ai-answers` (WP4), `ai-stream` (WP5). WP1 and WP6 change no page behaviour and add none. The reverse case, an open tab running the old page against a newer API, loses only the three deleted AI Advisor routes after WP3 (a 404 shown as the error until the tab is refreshed); rolling back Netlify past WP3 without Render has the same effect, so from WP3 on a rollback rolls back both providers together (WP3 adds this to the runbook's section 5).
6. **CSP.** `netlify.toml:44`: the page may connect only to itself and `https://client-portfolio-backend.onrender.com`. Streaming is a `fetch` to that origin with `credentials: 'include'`, as every call in `src/api.js` is; no `EventSource`, WebSocket, new origin or `netlify.toml` change. Streaming starts only after authentication, the rate limits, the request checks and the upstream call's first event, so a missing key still answers JSON 503 with "AI is not configured on the server (missing API key)." (`services/anthropic.cjs:92`). Streaming through Render's proxy: the server sends `Cache-Control: no-cache, no-transform` and a heartbeat, and uses no compression middleware (`server.cjs` has none today; one would buffer the stream). Whether Render passes the stream through unbuffered can only be seen on gbacpod.com (WP5's last acceptance item); the session cannot reach render.com to read its documentation.
7. **Rate limits.** `middleware/rateLimit.cjs:64` (30 per partner per hour) and `:72` (300 per day for the firm), mounted after authentication in `claude.cjs` and `routes/scenarios.cjs` with one shared counter each. express-rate-limit counts a request when it passes the middleware, before the route runs, so streaming and caching change nothing (T16). The new router mounts the two AI limiters on its POST routes only, so opening the book or the recent answers never spends the AI budget.
8. **Cost.** Today's `ai_call` line (`services/anthropic.cjs:65`) carries `inputTokens` and `outputTokens` only. WP1 adds cache reads and writes, the model that served, whether a fallback ran, the refusal category and `costUsd`; WP4 stores the same per answer (section 5).
9. **Tests.** No test imports `db.cjs`, `data.cjs`, `models/*`, `utils/jwt.cjs`, or a route file (each loads `utils/jwt.cjs` through the auth middleware). Every new rule lives in a pure module a test can import: `utils/aiCost.cjs`, `utils/book.cjs`, `utils/askPrompts.cjs`, `utils/aiAnswers.cjs`, `utils/sse.cjs`, `src/utils/sse.js`. Routes are tested through `server.cjs` as a child process, as `tests/import-db.test.mjs` does (section 4).
10. **Scores and frameworks.** The book reads `strategicValue`, `effort` and `stickinessScore` from `calculateStrategicScores` (`utils/strategic.cjs`) through `listWithMetrics`; no second formula, no weight change. `generatePortfolioSummary` goes with its only caller in WP3; deleting it changes no score. No React or Vite upgrade.
11. **The request sanitizer.** `sanitizeRequestBody` HTML-escapes every string in a body (`routes/scenarios.cjs:20`, `data.cjs:38`); a question passing through it would reach the model as `Smith &amp; Co`. The new router does not mount it, as `routes/people.cjs` does not: a question is validated as a string of 1 to 2,000 characters, is stored and sent as written, and is rendered by React as text. Names saved through the client form may already be stored escaped (review 4.9), so the book decodes them with `unescapeText` (`utils/escaping.cjs`, re-exported by `utils/transitionPlan.cjs`), which undoes exactly the sanitizer's set.

---

## 4. Testing without a key

No Anthropic key exists in the container, and none may be added. Four layers, each used where it proves something:

1. **The real SDK against recorded streams (unit).** WP1 turns the service into a factory, `createService({ apiKey, model, effort, fetch, baseURL })`, and exports a default instance built from the environment, so `require('./services/anthropic.cjs')` works as today. Tests pass a fake `fetch` that records each request and answers with a fixture from `tests/fixtures/anthropic/`: server-sent events written from the documented wire format (`message_start`, `content_block_start`, `content_block_delta`, `message_delta`, `message_stop`, `error`) or a JSON error with its status. The SDK parses them exactly as it parses Anthropic's own. Checked on 2026-09-25 on 0.128.0: a fixture with a `fallback` block and two `usage.iterations` entries came back as one text, `model` naming the fallback model and each attempt's model in `iterations`; the request carried `fallbacks: "default"`, the `anthropic-beta: server-side-fallback-2026-07-01` header and `stream: true`, and nothing else beyond `model`, `max_tokens`, `system` and `messages`; a 429 JSON answer threw `RateLimitError`.
2. **A fake Anthropic server (routes, database, browser).** `tests/helpers/fakeAnthropic.mjs` (WP1) starts an `http` server on `127.0.0.1` port 0 that answers `POST /v1/messages` from a queue of fixtures, can hold a stream open between events, and records each request body. `tests/import-db.test.mjs` starts `server.cjs` with `NODE_ENV=development`, `ANTHROPIC_API_KEY=test` and `ANTHROPIC_BASE_URL` pointing at it (today it passes an empty key and stops at the 503), so a route runs end to end (auth, limits, book, prompt, SDK, parse, save, response) on both table shapes. The suite keeps its keyless server for the 503 checks and starts a second `server.cjs` on the same database for these. Run as a script (`node tests/helpers/fakeAnthropic.mjs --port 5099`), it answers every request with a short text naming what it received (the number of client rows in the book, the question), which is how a session drives the page end to end in headless Chromium. The SDK reads `ANTHROPIC_BASE_URL` by default (checked on 0.128.0); T17 pins the address in production.
3. **Playwright routing (page only).** For states the page alone decides: an older API's `/api/health` without a feature name, a 503, a 429, a dropped stream, as Phase 5b did.
4. **What only production proves.** Real answers (the prompt's quality), the prices against the Console, a cache hit in production, and Render's proxy passing a stream through. Each package's last acceptance items are Jeff's, on gbacpod.com, after deploy.

---

## 5. Cost: what an answer costs and where the prices live

**Definition (T13).** For each attempt of a call, from `usage.iterations` when present (a declined attempt and the fallback attempt are separate entries, each naming its model), otherwise the top-level `usage` and the message's `model`:

```
cost = ( input_tokens                 × input price
       + output_tokens                × output price        (thinking tokens are billed as output)
       + cache_creation, 5-minute     × 1.25 × input price
       + cache_creation, 1-hour       × 2    × input price
       + cache_read_input_tokens      × 0.1  × input price ) ÷ 1,000,000
```

summed over the attempts. Whether a declined-before-output attempt is billed is set by Anthropic's refusal billing rules (<https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#how-refusals-are-billed>); WP1 reads that page and encodes the rule, and until it does such attempts are counted (an overestimate, said so in the code).

**Where the prices live.** `utils/aiCost.cjs`: one entry per model the service may use, in dollars per million tokens, and `PRICES_READ_ON`, the date they were checked. Prices read on 2026-09-25 from the `claude-api` skill's model table (cached 2026-06-24) and its caching multipliers; WP1 re-reads <https://platform.claude.com/docs/en/about-claude/pricing.md> if the container can reach it, and says so either way:

| Model | Why it is listed | Input | Output | Cache write, 5 min | Cache write, 1 h | Cache read |
|---|---|---|---|---|---|---|
| `claude-opus-5` | `AI_MODEL`'s default | $5.00 | $25.00 | $6.25 | $10.00 | $0.50 |
| `claude-opus-4-8` | the documented fallback for cyber-category declines | $5.00 | $25.00 | $6.25 | $10.00 | $0.50 |
| `claude-sonnet-5` | D7's cheaper alternative | $2.00 | $10.00 | $2.50 | $4.00 | $0.20 |

A model not in the table (a fallback the API chose that is not listed, or a new `AI_MODEL`) gives a null cost and an `ai_cost_unknown_model` log line.

**Estimates (not measurements).** Before WP2 this plan assumed 8,000 to 15,000 tokens for a book of roughly 100 clients, and 12,000 below. Measured on production on 2026-09-26 (WP2's panel): 84 clients, 17,637 characters, about 4,409 tokens at 4 characters per token, itself an estimate until WP3's first `ai_call` line reports the cache write. The figures below still use 12,000, so they overstate the book's share: at about 4,400 tokens a cache write is about $0.03 and a read under $0.01. On `claude-opus-5`:

- A question when the book is not cached: the cache write, 12,000 × $6.25 per million = $0.075, plus the answer and its unseen thinking, 1,000 to 5,000 output tokens at $25 per million = $0.025 to $0.125. About **$0.10 to $0.20** per answer; a brief somewhat more.
- A question within five minutes of the last one: the book read from the cache, 12,000 × $0.50 per million = $0.006, plus the output. About **$0.03 to $0.13**.
- The worst case of one request: 32,000 output tokens (T11) = $0.80, plus about $0.08 of input, about $0.88. At the firm's 300 requests a day that is about **$264 a day**. The rate limit, not caching, is the app's cap, which is why Jeff should also set a monthly spend limit in the Anthropic Console (a Console setting, not code; WP1's Jeff items).
- A Stage 2 run of 15 transition plans (WP6): the book adds two cache writes (the first two plans run in parallel and cannot read each other's entry) and thirteen reads, about $0.23 per run more than today.

Output, including thinking, dominates; caching saves a few cents a question at this size. The value of Tier 1's cost work is that each answer's cost is visible and the month's total is on the AI tab, so the effort setting (T11) and the model (D7) can be chosen from real figures.

---

## 6. WP1: SDK upgrade and the service

**Size:** one session. The risk is the jump from 0.56.0 across more than seventy 0.x releases, which the fixture suite pins.
**Expected outcomes:**

- `@anthropic-ai/sdk` is the newest 0.x (0.128.0 or later), installed with `npm install`, never by editing the lockfile.
- Every call streams from Anthropic and returns the final message; the routes' responses and the page are unchanged, so no feature name is added.
- On `claude-opus-5` a policy decline is rerun server-side (T10); a refusal nothing rescued returns `refused: true`, empty text and the category, and the page's existing notice shows.
- A stream that fails midway answers with the right status and message, not "AI request rejected (undefined).".
- Each `ai_call` log line adds `servedBy`, `fellBack`, `refusalCategory`, `cacheReadTokens`, `cacheWriteTokens` and `costUsd`.
- In production the SDK calls `https://api.anthropic.com` whatever `ANTHROPIC_BASE_URL` says.

**Changes by file**

- `package.json`, `package-lock.json`: the SDK version. Record `npm audit`'s count before and after in the PR.
- `services/anthropic.cjs`:
  - `createService({ apiKey, model, effort, fetch, baseURL })` returns `{ AI_MODEL, isConfigured, complete }`; the module exports the default instance's members as today, plus `createService`, `parseResponse` and `describeError`.
  - The client: `new Anthropic({ apiKey, timeout: 180_000, maxRetries: 2, baseURL, fetch })`, with `baseURL` fixed to `https://api.anthropic.com` when `NODE_ENV` is `production` (and a start-up warning if `ANTHROPIC_BASE_URL` is set there), and left to the SDK otherwise. With streaming, the SDK's timeout covers the wait for the stream to start, not the whole answer (checked on 0.128.0 with a custom `fetch`: a stream that ran past the timeout finished normally); WP1 confirms this with the real `fetch` and records it in the module's comment.
  - `complete({ system, prompt, maxTokens, userId, label, onText })`: `system` is a string or an array of `{ type: 'text', text, cache_control? }` blocks, passed through unchanged. The request is `client.beta.messages.stream({ model, max_tokens, system, messages: [{ role: 'user', content: prompt }] })`, plus `betas: ['server-side-fallback-2026-07-01']` and `fallbacks: 'default'` when the model is in `FALLBACK_MODELS` (`claude-opus-5`), plus `output_config: { effort }` when `AI_EFFORT` is set. `onText` receives each text delta; `finalMessage()` gives the message `parseResponse()` reads.
  - `AI_EFFORT`: read once; an invalid value stops the server at start with a message naming the five values, as an invalid `DATABASE_SSL` does.
  - `parseResponse(message)` as section 3 item 2 describes, and the usage normalised: `{ inputTokens, outputTokens, cacheReadTokens, cacheWrite5mTokens, cacheWrite1hTokens, iterations }`, keeping the raw `usage` for the routes.
  - `describeError(err)`: the existing mapping, plus an `APIError` without a status by its `type` (section 3 item 2). Confirm every class and constructor the tests build under the new SDK.
  - The log line: the new fields; `costUsd` from `utils/aiCost.cjs`.
- `utils/aiCost.cjs` (new, pure): `PRICES`, `PRICES_READ_ON`, `callCost(usage, model)` giving `{ usd, attempts: [{ model, usd }], unknownModels }`.
- `claude.cjs`, `routes/scenarios.cjs`: no change beyond what the service's return shape needs (they already pass `truncated` and `refused`).
- `tests/helpers/fakeAnthropic.mjs` and `tests/fixtures/anthropic/*.sse` (new; section 4).
- `.env.example`: `AI_EFFORT=` (commented, with the five values); a line that `ANTHROPIC_BASE_URL` is for local tests and ignored in production.
- `CLAUDE.md`: the AI Integration section (the SDK version, streaming inside the service, fallbacks, the new log fields, `AI_EFFORT`, the factory and the fake server); remove "The SDK stays at 0.56.0 until Tier 1".

**Tests**

- `tests/ai-service.test.mjs`, rewritten around `createService({ apiKey: 'test', fetch })` and the fixtures: a leading `thinking` block and text gives the text only; `max_tokens` gives `truncated`; a refusal before any output and one mid-stream without a fallback give `refused`, empty text and the category; a served fallback gives one continuous text, `servedBy` the fallback model and `fellBack`; `onText` receives the deltas in order. The recorded request: `model`, `max_tokens`, `system` blocks with the cache marker passed through, `stream: true`, no sampling key, the beta header and `fallbacks: "default"` for `claude-opus-5` and neither for `claude-sonnet-5`, `output_config.effort` only when set. Errors: 429 gives 429, 401 gives 502, 500 and 529 give 503, a mid-stream `overloaded_error` gives 503, a network failure gives 504. Without a key, `AI_NOT_CONFIGURED` and the fake `fetch` never called. With `NODE_ENV=production`, the client's base URL is Anthropic's even when `ANTHROPIC_BASE_URL` is set.
- `tests/ai-cost.test.mjs`: a plain call; 5-minute and 1-hour cache writes; cache reads; a fallback priced per attempt at each model's price; an unknown model gives null; every model the service can send, and the documented fallback target, has a price.
- `tests/ai-grep.test.mjs`: section 3 item 1.
- The existing `tests/transition-plan.test.mjs` passes unchanged.

**Acceptance**

- [x] Gates green; both database suites green (the server starts on the new SDK in `import-db`'s child process and still answers 503 without a key).
- [x] `npm ls @anthropic-ai/sdk` shows the new version; `npm audit` before and after recorded.
- [x] The grep assertions pass; `grep -rn "messages.create\|messages.stream\|new Anthropic(" --include=*.cjs --exclude-dir=node_modules .` finds only `services/anthropic.cjs`.
- [x] End to end in the container: `server.cjs` against the fake server (section 4 item 2); the AI Advisor's three buttons and a Stage 2 plan render the fake's answers; a refusal fixture shows the existing notice; the log shows one `ai_call` line per call with the new fields and a cost.
- [x] Jeff, before or with the merge: set a monthly spend limit in the Anthropic Console's limits settings for the organisation or workspace that holds the production key, and record the amount here. Set by Jeff before the merge, 2026-09-26: $50 a month, for testing.
- [x] Jeff, before the merge (added in WP1: SDK 0.128.0 supports Node 20 or later): Render's Node version. 22.16.0, from Jeff on 2026-09-26.
- [ ] Jeff, after deploy: `/api/health` reports `anthropic: configured` and `model: claude-opus-5`; one AI Advisor question answers; the Render log's `ai_call` line shows `servedBy`, `cacheReadTokens` and `costUsd`, and the Console's usage for that minute is in the same range as `costUsd`. 2026-09-26, Jeff: health as required; a client recommendation for one client answered at length; the Console showed $0.64. Open: the `ai_call` line, and its `costUsd` against the Console.

---

## 7. WP2: The book on the server

**Size:** one session.
**Expected outcomes:**

- One pure module renders the whole book as the AI will see it, from the database (T3, T4, T5), with the same per-person figures as the Partnership tab, held equal by parity tests.
- The AI tab shows "What the AI is given": the exact text, its size in characters and estimated tokens (4 characters per token, labelled as an estimate), the reporting year and the client count, and the line "Client notes are never sent to the AI."
- `/api/health` lists `ai-book`.

**Changes by file**

- `utils/book.cjs` (new, pure):
  - `SECOND_CHAIR_EFFORT_SHARE = 0.2`, with a comment naming `src/utils/load.js` as the page's copy and the parity test that holds them equal.
  - `reportingYear(clients, now)`, the port of `computeReportingYear` (`src/utils/revenue.js:17`).
  - `bookModel({ people, clients, now })`: each person's lead book and second-chair load (clients, reporting-year revenue, effort, the second chair's effort at the share), the averages over the active people in each role (those with no clients included), the ratios with `partnershipModel`'s rules (none below two active members or at a zero average; a lead-book comparison only for a partner or someone who leads), revenue per effort, the practice areas each person holds, totals by year, exposure (T5), the unled clients and those without a second chair.
  - `renderBook(model)`: deterministic text. A legend (the stickiness labels from the people plan's section 3; cadence and the handful flag as effort; the strategic value formula as `CLAUDE.md` states it; which values are defaults; that a second chair carries 20% of a client's effort in the load figures while counts and revenue count in full), then the people table by role, the totals by year, exposure, and one table row per client sorted by name regardless of case, then id as text. Names pass through `unescapeText`. No date, no ids, no notes.
- `routes/ai.cjs` (new), mounted at `/api/ai` in `server.cjs` behind `authenticateToken`: `GET /api/ai/book` answers `{ success, reportingYear, clientCount, peopleCount, chars, estimatedTokens, text }` from `clientModel.listWithMetrics()` and `SELECT id, name, role, active FROM people`. No AI limiter (T16), no request sanitizer.
- `server.cjs`: the mount; `features` adds `ai-book`.
- `src/AIAdvisor.jsx`: a collapsed "What the AI is given" panel that asks `/api/health` for `ai-book`, fetches the book when opened, and shows the text in a `<pre>` with the counts; without the feature, "The API has not been updated yet."
- `CLAUDE.md`: the module, the route, the feature, the parity rule.

**Tests**

- `tests/book.test.mjs`: parity with `partnershipModel` (`src/utils/load.js`) at the page's reporting year, for the fixture books of `tests/load.test.mjs` and 200 random books (roles, inactive people with seats, clients without a lead or second chair, several revenue years): every person's counts, revenue, effort and ratios equal; `reportingYear` equals `computeReportingYear` for the same `now`; the two `SECOND_CHAIR_EFFORT_SHARE` values are equal. Determinism: shuffled clients and people give identical text, and two `now` values in the same reporting year give identical text. Content: each client once; `&amp;` decoded; a note never appears; an unrated client reads "not rated" and counts under unrated exposure, not as safe; integer and uuid ids both render; an empty book renders a short text that says so; an inactive person holding a seat is listed and marked inactive.
- `tests/import-db.test.mjs`, both table shapes: after the section 3 import, `GET /api/ai/book` answers 200 with every imported client once and each person's lead count equal to the People counts; 401 without sign-in.

**Acceptance**

- [x] Gates and both database suites green.
- [x] End to end in the container on production's table shape with a 24-client book: in headless Chromium, the panel's text shows every client once and each person's figures equal the Partnership tab's; an API answering an older feature list shows the message. Done 2026-09-26: 24 client rows, each once; "&" decoded (one name stored as `&amp;` by the client form); a Notes cell's text nowhere on the page; Kevin's, Paula's and Mike's lead and second-chair clients, revenue and effort equal to the Partnership tab's; `/api/health` routed without `ai-book` shows "The API has not been updated yet." and requests no book; no console error after sign-in. That book: 10,232 characters, about 2,558 tokens (the estimate at 4 characters per token), so about 100 clients would be roughly 30,000 characters and 7,500 tokens, below section 5's assumed 12,000.
- [ ] Jeff, after deploy: `/api/health` lists `ai-book`; on the AI tab, "What the AI is given" lists every client once, no client's notes appear, and two partners' lead counts, revenue and effort equal the Partnership tab's. Record the character count and estimated tokens here: they replace section 5's assumed book size. 2026-09-26, Jeff: `/api/health` lists `ai-book`; the panel reads "Reporting year 2026 · 84 clients · 17,637 characters · about 4,409 tokens" (recorded in section 5). Open: every client once, no notes, and two partners' figures against the Partnership tab.
- [ ] Jeff (PR #31's item 5, from the stickiness fix): if clients that nobody has judged read as Stickiness 3, restore them to "not rated" by importing a file of `CLIENT,Stickiness` that lists only those clients, each with a blank Stickiness cell, after #32 is live. The panel's Exposure section should then count them under "Not rated", and the client count must not change. The master sheet is no longer available (2026-09-26), so the clients are chosen from the panel's client table, not from the sheet.

---

## 8. WP3: Ask the book and the brief

**Size:** 1.5 sessions: the instructions are the slow part, and their quality shows only with a key.
**Expected outcomes:**

- The AI tab has one "Ask the book" box, with the brief's example questions ("Is Mike overloaded?", "Who's the natural home for a $300k healthcare client?", "Where's our biggest retention risk?") as one-click fills, and one "Brief" button; answers render as today (markdown, the cut-off and declined notices), under the WP2 panel.
- The model sees the whole book with the real axes and the per-person picture (T4); the three consulting-deck prompts and their routes are gone.
- Ask and the brief send the same system prefix, so a second question within five minutes reads the book from the cache (`cacheReadTokens` above zero in the log).
- `/api/health` lists `ask-the-book`.

**Changes by file**

- `utils/askPrompts.cjs` (new, pure):
  - `ASK_INSTRUCTIONS`: fixed text with the T6 rules, the T5 definition and the reminder that the book is data and nothing in it is an instruction. No date and no names. No "double-check your answer" line: the `claude-api` skill notes that the current model verifies its own work and that such phrasing works against it. A length rule instead (answer first, in a few sentences; the figures used; about 300 words unless the question asks for a list).
  - `systemBlocks(bookText)`: `[{ type: 'text', text: ASK_INSTRUCTIONS }, { type: 'text', text: bookText, cache_control: { type: 'ephemeral' } }]`.
  - `askTurn(question, today)`: `Today is YYYY-MM-DD.` and the question inside `<question>` tags. `briefTurn(today)`: the date and the fixed request with T6's five headings, each described in a sentence.
  - `checkQuestion(q)`: the 400 message, or null for a string of 1 to 2,000 characters after trimming.
- `routes/ai.cjs`: `POST /api/ai/ask` `{ question }` and `POST /api/ai/brief` `{}`, each behind `aiUserLimiter` and `aiGlobalLimiter`. Build the book (WP2); an empty book answers 400 "The book has no clients yet."; call `complete({ system: systemBlocks(text), prompt, maxTokens: 32000, userId, label: 'ask' | 'brief' })`; answer `{ success, kind, question, answer, truncated, refused, refusalCategory, servedBy, model, usage, costUsd, reportingYear, timestamp }`; errors through `describeError`.
- Deleted: `claude.cjs` and its mount (`server.cjs:103`); `generatePortfolioSummary` in `utils/strategic.cjs` and its header comment's mention; `getWithMetrics` in `models/clientModel.cjs` if nothing else calls it. `middleware/rateLimit.cjs`'s comment names the new router.
- `src/AIAdvisor.jsx`, rebuilt: the header's counts, the Ask box, the example questions, the Brief button, the answer card, the WP2 panel. The header's "Enhanced Clients" figure becomes "Rated for stickiness: n of m", which tells a partner how much of the book the AI can reason about. Without `ask-the-book` in `/api/health` the tab shows "The API has not been updated yet; try again in a few minutes." and no buttons.
- `src/portfolioStore.js`: `EMPTY_AI_RESULTS` becomes `{ ask: null, brief: null }`.
- `tests/ai-grep.test.mjs`: `/claude/` joins the deleted-endpoint list for `src/` and `server.cjs`.
- `deploy/README.md` section 5: from this package on, a rollback rolls back the page and the API together (section 3 item 5).
- `CLAUDE.md`: the routes, the tab, the prompts, the deleted list ("do not resurrect").

**Tests**

- `tests/ask-prompts.test.mjs`: the system blocks for two different questions and for the brief are byte-identical (one cache entry serves all three); the question and the date appear only in the user turn; the cache marker is on the last system block and nowhere else; `checkQuestion`'s limits; the brief turn names the five headings; the instructions contain each T6 rule (key phrases, so an edit that drops "never tell the partners to move a client" fails).
- `tests/import-db.test.mjs`, both table shapes: without a key, `ask` answers 503 with the existing message, an empty question and a 2,001-character one answer 400, and a request without sign-in answers 401. With the fake server: `ask` and `brief` return the fake's text; the request it received has the instructions and the book as its two system blocks, the marker on the second, every imported client in the book and the question in the user turn.
- In the session, headless Chromium against `server.cjs` and the fake server: an example question fills the box, Ask and Brief render, a tab switch keeps both answers, and an older feature list shows the message.

**Acceptance**

- [ ] Gates and both database suites green; `wc -l` shows `claude.cjs` (635 lines) gone.
- [ ] End to end in the container as above; no console error from this change.
- [ ] Jeff, after deploy: `/api/health` lists `ask-the-book`; ask the three example questions and read each answer against the Partnership tab and the book panel: every figure cited is in the book and nobody or nothing is invented; run the brief; ask a second question within five minutes and check its `ai_call` line in the Render log shows `cacheReadTokens` above zero. Record `costUsd` for the first five answers here. Expect a small follow-up PR tuning `ASK_INSTRUCTIONS` from what the answers show.

---

## 9. WP4: Saved answers and cost

**Size:** one session.
**Expected outcomes:**

- Every Ask, brief and transition-plan answer is saved (T12) with who asked, the question or client, the answer, the models, the flags, the tokens and the estimated cost (T13).
- The AI tab lists the 20 newest answers for everyone, opens any of them, loads older ones, and shows this month's count and estimated cost; another partner's browser shows the same list.
- A failed save never loses an answer the partner has paid for: the answer is returned with `saved: false` and an `ai_answer_save_failed` log line.
- `/api/health` lists `ai-answers`.

**Schema** (`init-db.sql`, appended, idempotent):

```sql
-- AI answers (docs/plans/tier-1.md, T12, T13). No foreign key to clients:
-- client ids are integers on production's older tables and uuids here, and
-- reset-book refuses while any key to clients does not cascade. The client's
-- and the asker's names are copied so an answer reads the same after either
-- is gone.
CREATE TABLE IF NOT EXISTS ai_answers (
    id SERIAL PRIMARY KEY,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('ask', 'brief', 'transition-plan')),
    question TEXT,
    answer TEXT NOT NULL,
    client_id TEXT,
    client_name VARCHAR(255),
    asked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    asked_by_username VARCHAR(255),
    model VARCHAR(100) NOT NULL,
    served_by VARCHAR(100),
    fell_back BOOLEAN NOT NULL DEFAULT false,
    stop_reason VARCHAR(40),
    truncated BOOLEAN NOT NULL DEFAULT false,
    refused BOOLEAN NOT NULL DEFAULT false,
    refusal_category VARCHAR(60),
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd NUMERIC(10, 4),
    prices_read_on DATE,
    book_sha256 CHAR(64),
    reporting_year INTEGER,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_answers_created_at ON ai_answers (created_at DESC, id DESC);
```

`book_sha256` records which book an answer was given, for a later "given on an earlier book" marker (section 13).

**Changes by file**

- `utils/aiAnswers.cjs` (new, pure): `answerRow({ kind, question, client, user, result, bookText, reportingYear, durationMs })` gives the column values (a refused answer stores empty text and the category; the cost and `prices_read_on` from `utils/aiCost.cjs`; the book's SHA-256); the insert, list, one-answer and month-summary SQL as constants with untyped placeholders.
- `routes/ai.cjs`: Ask and the brief insert after the call returns and answer with the row's `id`. `GET /api/ai/answers?before=<id>&limit=20` (newest first: `kind`, `question`, `client_name`, `asked_by_username`, `created_at`, `served_by`, `truncated`, `refused`, `cost_usd`, the first 200 characters); `GET /api/ai/answers/:id` (the row; 404 for an id that is not a positive integer or not found); `GET /api/ai/answers/summary` (this calendar month's count and cost, the month taken in `America/New_York`; registered before `:id`). No AI limiter on the GETs.
- `routes/scenarios.cjs`: a transition plan is saved as `kind 'transition-plan'` with `client_id` `String(client.id)` and the client's name.
- `server.cjs`: `features` adds `ai-answers`.
- `src/AIAdvisor.jsx`, `src/portfolioStore.js`: "Recent answers" under the Ask box (when, who, the question, "Brief" or "Transition plan: <client>", the cost; a row opens the answer in place; "Older answers"), and "This month: n answers, about $x", after checking `ai-answers`. The answer just given opens from the list after a refresh.
- `CLAUDE.md`: the table, the routes, the feature; `deploy/README.md`: the backup section notes that `ai_answers` is counted like every other public table.
- `deploy/backup/`: no change; `pg-backup.sh` counts every public table.

**Backups (Jeff, before the merge).** The backup role reads new tables only if it was given `pg_read_all_data` or the default privileges in `deploy/backup/INSTALL.md` step 3. `people` (Phase 1) was the first table created after the role; if every nightly backup since Phase 1 merged is green, `ai_answers` needs nothing. If one failed with `permission denied for table people`, grant as INSTALL.md says before this package deploys, or the first night after it fails too.

**Tests**

- `tests/schema.test.mjs`: a new database has `ai_answers` with its checks; applying `init-db.sql` twice changes nothing; a database built with the pre-WP4 file migrates with clients, revenue and people intact; a rollback start running the pre-WP4 file on a migrated database succeeds and leaves the table and its rows; `check-schema` still ends `OK` (the new key to `users` is `SET NULL`); `delete-user` on an account with answers keeps them, with `asked_by` null and the username kept; `reset-book --confirm` with answers saved succeeds and leaves them untouched.
- `tests/import-db.test.mjs`, both table shapes, with the fake server: an Ask is saved with the signed-in user; a transition plan saves `client_id` as text, an integer on the production shape and a uuid on the other; the list is newest first and pages with `before`; the summary counts this month; 401 without sign-in; `/api/ai/answers/abc` answers 404.
- `tests/ai-answers.test.mjs`: `answerRow` for a plain, a truncated, a refused and a fallback-served result; the question stored as written; the book hash.
- In the session, headless Chromium with two signed-in accounts: the second sees the first's answer under Recent answers, and the month's total equals the sum of the saved costs.

**Acceptance**

- [ ] Gates and both database suites green.
- [ ] End to end in the container as above.
- [ ] Jeff, before the merge: the nightly backups since Phase 1 are green, or the grant is made (above).
- [ ] Jeff, after deploy: `/api/health` lists `ai-answers`; ask a question; another partner, or another browser signed in as another partner, sees it under Recent answers; this month's estimated cost is in the range of the Anthropic Console's usage for the same days; the next nightly backup is green and its counts include `ai_answers`.

---

## 10. WP5: Streaming to the page

**Size:** 1.5 sessions; whether Render's proxy passes the stream through shows only on gbacpod.com.
**Expected outcomes:**

- Ask and brief answers appear as they are written; before the first words, the page shows "Thinking… n s".
- Switching tabs while an answer streams keeps it streaming (the store owns the request).
- Closing the tab loses nothing: the server finishes and saves the answer (T15), and it appears under Recent answers.
- A declined answer replaces any partial text with the notice.
- Errors before the stream (sign-in, the rate limits, the checks, a missing key, an upstream error before the first event) answer JSON with their usual status and message; an error after it opens arrives as an `error` event and is shown the same way.
- `/api/health` lists `ai-stream`.

**Wire format.** `POST /api/ai/ask` and `/api/ai/brief` sent with `Accept: text/event-stream` answer:

```
event: start
data: {"model":"claude-opus-5"}

event: text
data: {"text":"Mike leads "}

: ping

event: done
data: {"answerId":42,"truncated":false,"refused":false,"refusalCategory":null,"servedBy":"claude-opus-5","costUsd":0.0712,"saved":true}

event: error
data: {"error":"The AI service is temporarily unavailable."}
```

Without that header they answer JSON as in WP3 and WP4, for tests, `curl` and an older page. Headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, sent (`flushHeaders`) once the upstream stream has produced its first event. A `: ping` comment every 15 seconds (`AI_STREAM_PING_MS`, for tests) until `done`. When the connection closes, the route stops writing and lets the call finish and save (T15). Transition plans stay JSON: the page runs them two at a time and shows progress per client.

**Changes by file**

- `utils/sse.cjs` (new, pure): `sseEvent(type, data)`, `ssePing()`.
- `routes/ai.cjs`: the streaming branch of both routes; `complete()`'s `onText` writes `text` events.
- `src/utils/sse.js` (new, pure): `createSseParser(onEvent)`, for chunks split at any byte, CRLF line ends, comments and multi-line `data`.
- `src/api.js`: `postStream(path, body, { onEvent, signal })`: `fetch` with `credentials: 'include'` and the `Accept` header; a response that is not `text/event-stream` goes through the existing error handling (`apiErrorMessage`); otherwise reads `response.body.getReader()` through the parser.
- `src/portfolioStore.js`: `aiStreaming` (`{ kind, question, text, startedAt, firstTextAt }`) and `askStream(kind, question)`; the answer moves into `aiResults` on `done`; logout aborts the request, nothing else does.
- `src/AIAdvisor.jsx`: the live answer (re-rendered at most about ten times a second), "Thinking… n s", the refusal replacing the partial, and on a dropped connection: "The connection dropped. The answer is still being written and will appear under Recent answers." Uses streaming when `/api/health` lists `ai-stream`, JSON otherwise.
- `server.cjs`: `features` adds `ai-stream`; a comment by the middleware that a compression middleware would buffer the stream.
- `netlify.toml`: no change (section 3 item 6).
- `deploy/README.md`: a note that the AI answers stream through Render's proxy, and what buffering looks like (the whole answer at once at the end).
- `CLAUDE.md`.

**Tests**

- `tests/sse.test.mjs`: a recorded stream split at every byte offset parses to the same events; pings are ignored; an `error` event; `sseEvent` output round-trips through the page's parser.
- `tests/import-db.test.mjs`, both table shapes, with the fake server: a streamed Ask gives `start`, `text` events and `done` in order, the joined text equals the JSON answer's for the same fixture, and `done`'s `answerId` is a saved row; a client that disconnects after the first `text` event still leaves a saved row with the whole text; an upstream 429 before the first event answers JSON 429 with the existing message; without a key, JSON 503; a fixture that holds the stream open longer than `AI_STREAM_PING_MS` produces a ping.
- In the session, headless Chromium against `server.cjs` and the fake server serving the page with `netlify.toml`'s headers from a local replica, as Tier 0's WP5 did: the text grows before `done`; a tab switch mid-stream keeps it; a refusal fixture replaces the partial; closing the page mid-stream and reopening shows the answer under Recent answers; no CSP violation.

**Acceptance**

- [ ] Gates and both database suites green.
- [ ] End to end in the container as above.
- [ ] Jeff, after deploy: `/api/health` lists `ai-stream`; on gbacpod.com an answer's words appear progressively (if they all arrive at once at the end, something between Render and the browser is buffering: report it, and the page still works); switching tabs and back mid-answer keeps it; closing the tab mid-answer and reopening the AI tab shows the answer under Recent answers; the browser console shows no CSP error.

---

## 11. WP6: Transition plans on the book

**Size:** half a session to one.
**Expected outcomes:**

- Stage 2's AI plans are written with the whole book in view (every candidate's clients and practice areas), from the same cached prefix as Ask (T14).
- The roster's loads and the client's facts come from the database's book, not the page's figures. The roster check (`checkRoster`) and the resolution against the roster (`resolveRecommendation`) are unchanged: a name off the roster never fills a seat.
- The request and response shapes are unchanged: no page change and no feature name.

**Changes by file**

- `utils/transitionPlan.cjs`: `createTransitionPlanPrompt(client, stage1Data, roster, book)` returns `{ system: systemBlocks(book.text), prompt }` (the shared blocks from `utils/askPrompts.cjs`); the user turn keeps the scenario (who is leaving, the client, the roster, the six sections) and its plan-specific rules, and drops the old persona. `ASK_INSTRUCTIONS`' "never tell the partners to move a client" already excepts a departure scenario (T6).
- `routes/scenarios.cjs`: build the book (WP2); find the client in it by `String(client.id)` (404 "Client not found." when absent); after `checkRoster`, replace each roster person's loads with the book's; the page's succession metrics (`successionRisk`, `transitionComplexity`, `relationshipType`) still come from the request, since the server has no copy of `src/utils/successionUtils.js` (section 13). `maxTokens` 16,000 (T11); the PR records how many saved plans were cut off at 8,000 since WP4, as the before figure.
- `CLAUDE.md`.

**Tests**

- `tests/transition-plan.test.mjs`: the system blocks equal Ask's for the same book; the prompt's roster loads are the book's even when the request's are inflated; the client's facts come from the book; every existing roster and resolution test passes unchanged.
- A parity test: for a fixture scenario, the loads the server puts on the roster equal the page's `rosterFor(departure)` (`src/utils/transitionPlans.js`).
- `tests/import-db.test.mjs`, both table shapes, with the fake server: a plan for an integer-id client on the production shape and a uuid client on the other; the fake receives the book and the client; the recommendation resolves against the roster; an unknown client id answers 404; the existing roster refusals still answer 400.

**Acceptance**

- [ ] Gates and both database suites green.
- [ ] End to end in the container: a Stage 2 run of four plans against the fake server; the fake recorded the same two system blocks, byte for byte, on every plan and on an Ask, with the cache marker on the book (whether the cache is read shows only on production).
- [ ] Jeff, after deploy: on Scenarios, mark someone leaving and generate plans for three or more clients: each recommendation names people from the roster; the Render log's `ai_call` lines show `cacheReadTokens` above zero on all but the first two; the plans' cost is in the AI tab's month total.

---

## 12. Deploying a work package

As `docs/plans/tier-0.md` section 9: merging to `main` deploys; Netlify publishes the page within about a minute; Render deploys the API if its auto-deploy is on (otherwise Manual Deploy). Then `Invoke-RestMethod https://client-portfolio-backend.onrender.com/api/health | ConvertTo-Json`: `status` must be `OK`, and `features` must list the package's name. Run the package's Jeff items and set its status to `deployed`, then `verified on gbacpod.com`. New environment variables (`AI_EFFORT`, only if Jeff chooses to set one) go on the Render service's Environment page. Rolling back after WP3 rolls back both providers together (section 3 item 5).

---

## 13. What Tier 1 leaves for Tier 2

- Follow-up questions with history (T7).
- A "given on an earlier book" marker on saved answers (the hash is stored from WP4), and deleting or hiding an answer, with a retention rule.
- Saving scenarios, Stage 2's plans and Stage 3's execution on the server (people plan P11; review section 7).
- The succession metrics (`successionRisk`, `transitionComplexity`, `relationshipType`) computed on the server, so a transition-plan request needs nothing from the page but ids.
- Structured output for the transition plan (an answer schema whose names are limited to the roster), if the text parser proves brittle on real answers.
- Choosing the effort level and the model from WP4's saved costs and answers, with a small evaluation set of the firm's real questions; a time-to-first-word instruction if the pause before streamed text bothers partners.
- A load trend ("total load up 30% since spring", the brief's answer to its blind spot), which needs the change log.
- Already Tier 2 (`docs/plans/tier-0.md` section 11): `updated_by` and a change log on clients; removing `sanitizeRequestBody`; deleting the second scoring formula and the three dead `/api/data` endpoints; validation on the live write path; contract tests per route.
- Not planned: reconciling costs with Anthropic's usage and cost reports, which need an admin key and raw HTTP.
