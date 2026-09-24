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
- `npm run dev` - Start Vite development server for React frontend
- `npm run build` - Build production React app
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint on JS/JSX/CJS files (errors fail the gate, warnings are informational)

### Backend Development
- `npm start` or `node server.cjs` - Start Express.js backend server on port 5000
- Backend runs on http://localhost:5000 with CORS enabled for development

### Testing
- `npm test` - Run the test suite with Node's built-in runner (`node --test "tests/**/*.test.mjs"`); no test dependencies to install
- Tests live in `tests/*.test.mjs` and use `node:test` + `node:assert/strict`. Import CommonJS modules with a default import (`import strategic from '../utils/strategic.cjs'`)
- Current suites: `smoke` (scoring formula), `strategic` (score regression fixture, D6), `csv-import` (year rule, D5), `contract-status`, `reporting-year` (D4), `ai-service` (response parsing and SDK error mapping, WP2), `transition-plan` (per-client prompt and parser, D9), `ai-grep` (the WP2 grep assertions: no retired model ids or sampling parameters, one SDK call site). Functions that depend on the clock take a `now` argument (`deriveContractStatus(period, now)`, `computeReportingYear(clients, now)`) so tests are deterministic
- Never import `db.cjs`, `data.cjs`, `models/*`, or `utils/jwt.cjs` from tests: they throw at load time without `DATABASE_URL` / `JWT_SECRET`
- `npm run deploy:check` runs lint, tests, and the production build; GitHub Actions (`.github/workflows/ci.yml`) runs the same three on every PR and push to `main`

## Architecture Overview

This is a **Client Portfolio Optimization Dashboard** for government relations attorneys, consisting of:

### Frontend (React + Vite)
- **Framework**: React 18 with Vite bundler
- **State Management**: Zustand with localStorage persistence (`src/portfolioStore.js`)
- **UI Library**: Shadcn/UI components with Tailwind CSS
- **Charts**: Recharts for data visualizations
- **Main Entry**: `src/main.jsx` renders `src/App.jsx`

### Backend (Node.js + Express)
- **Server**: Express.js server in `server.cjs` (port 5000)
- **API Routes**:
  - `/api/auth/*` - login, logout, session (`routes/auth.cjs`)
  - `/api/data/*` - Data processing endpoints (`data.cjs`)
  - `/api/claude/analyze-portfolio`, `/api/claude/strategic-advice`, `/api/claude/client-recommendations` - the AI Advisor tab (`claude.cjs`)
  - `POST /api/scenarios/transition-plan` - one succession transition plan for one client (`routes/scenarios.cjs`)
- **AI service**: every Anthropic call goes through `services/anthropic.cjs` (see "AI Integration" below)
- **Data Processing**: Client analysis engine in `clientAnalyzer.cjs`

### Key Application Components

#### Core Views (Tab-based Navigation)
1. **Data Upload** (`DataUploadManager.jsx`) - CSV import with drag-and-drop
2. **Dashboard** (`DashboardView.jsx`) - Analytics and visualizations
3. **Client Details** (`ClientListView.jsx` + `ClientEnhancementForm.jsx`) - Client management
4. **AI Advisor** (`AIAdvisor.jsx`) - Claude API integration for strategic advice
5. **Scenarios** (`ScenarioModeler.jsx`) - the three-stage succession workflow (`src/components/succession/SuccessionScenario.tsx`); the Growth and capacity scenarios were deleted in WP2 (D8)

#### Data Flow
1. CSV upload → `data.cjs` processes via `clientAnalyzer.cjs`; the pure helpers in `utils/csvImport.cjs` read the years from the header and plan the revenue writes
2. Client data stored in Zustand store with localStorage persistence
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

### Frontend Structure
- `src/App.jsx` - Main application with tab navigation
- `src/portfolioStore.js` - Zustand state management
- `src/components/ui/` - Reusable UI components (button, card, etc.)
- Core feature components at `src/` root level

## Environment Configuration

### Required Environment Variables
- `ANTHROPIC_API_KEY` - For AI functionality (Claude API); unset means every AI button reports "not configured"
- `AI_MODEL` - model id for every AI call (default `claude-opus-5`; `claude-sonnet-5` is the cheaper alternative, D7)
- `PORT` - Server port (defaults to 5000)
- `NODE_ENV` - Environment mode

### Vite Configuration
- API base URL configured as `http://localhost:5000` in `vite.config.js`
- Path alias `@` points to `./src`

## Development Notes

### State Management
- All client data persists in browser localStorage via Zustand
- Store includes clients array, UI state, and analytics cache
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