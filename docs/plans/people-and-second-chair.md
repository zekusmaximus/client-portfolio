# Plan: People, second chair, and a fresh book

**Status:** approved direction; progress is in the section 2 status table. Written 2026-09-25 against `031be08`, after Tier 0's code work merged (`docs/plans/tier-0.md`; its remaining items are Jeff's checks on the live site and do not block this plan).
**Why:** the firm's people changed. Six partners (Brendan, Jeff, Joe, Kevin, Mike, Paula), one emeritus (Jay), and associates to come. Steve and Fritz have handed over their clients. Every client needs one partner as lead and may have a second chair, and the scenarios must model an associate work split and the departure of anyone. The app knew none of this: its roster was a hard-coded list of nine names used only by the client form, and every "partner" view was built from whatever name was typed in a client's lead field.
**Audience:** future Claude Code sessions and Jeff. Sessions cannot reach Render or gbacpod.com; steps on production are Jeff's.

---

## 0. How a session uses this document

1. `CLAUDE.md`, then section 1 (decisions) and section 2 (status), then the one phase you are executing.
2. One phase per branch and pull request (Phase 5 is two). Branch from `origin/main` after the previous phase merged.
3. Gates before and after: `npm run lint` (0 errors; 7 `exhaustive-deps` warnings are expected), `npm test`, `VITE_API_BASE_URL=https://gbacpod.com npm run build:prod`. Phases that touch `init-db.sql` also run `tests/schema.test.mjs` against a throwaway PostgreSQL (`CLAUDE.md`, Testing).
4. Schema changes go in `init-db.sql`, idempotent, and never drop or rename a column an older `init-db.sql` names: a Render rollback runs the older file at start (`docs/plans/tier-0.md` section 12). Retired columns stay in the table.
5. Unchanged from Tier 0: do not change the scoring weights in `utils/strategic.cjs`, do not upgrade React, Vite or the Anthropic SDK across a major version, and do not start the Tier 1 AI rebuild. Phase 5 changes the transition-plan prompt only as far as section 8 says.
6. Every phase ends with gates green, `CLAUDE.md` updated where behaviour it documents changed, and this file's status table updated in the same PR.
7. If this plan and the code disagree, the code wins; note it in the PR and in section 2.

---

## 1. Decisions

| # | Decision | Rationale |
|---|---|---|
| P1 | People are rows in a `people` table: `name` (unique, case-insensitive), `role` (`partner`, `emeritus`, `associate`), `active`. A new database is seeded with Brendan, Jeff, Joe, Kevin, Mike and Paula as partners and Jay as emeritus, only when the table is empty. Steve, Fritz and Zeke leave the roster; Zeke was Jeff. `src/constants.js` is deleted. | Associates will be hired over time; a constant means a deploy per hire, and the server needs the roster to validate assignments. Seeding only an empty table means a rename or a role change survives every restart. |
| P2 | Roles describe a person's place in the book, not app permissions. The partners are equal in the app: no admin, no permission roles, everyone signed in sees and edits everything. The firm's managing partner is not modelled. Associates do not get logins. | Jeff, 2026-09-25. The book shows every partner's revenue. |
| P3 | Every client has exactly one lead, an active partner, and at most one second chair: any active person other than the lead (partner, emeritus or associate). Stored as `clients.lead_id` and `clients.second_chair_id`, foreign keys to `people`. `lobbyist_team` is retired. | The firm's model is lead plus second chair. Foreign keys stop a typo from becoming a phantom partner and let the server enforce the lead rule. |
| P4 | The originator is a person (any role, active or not) in `clients.originator_id`, plus `clients.originator_is_firm`: ticked when that person's origination credit has ended, or when the firm itself originated the client. Ticking it keeps the person on record. Display: `Kevin`, `Firm (originated by Kevin)`, or `Firm`. | Jeff, 2026-09-25: the originator must be able to toggle to "firm" after the origination credit ends. Who brought a client in stays worth knowing after the credit lapses. |
| P5 | People are never deleted. A person cannot leave the partner role or be deactivated while leading a client, or be deactivated while second chair on one. A departure is modelled on Scenarios, the assignments are changed, then the person is deactivated. | Keeps every client valid under P3 at all times, and keeps the originator history of people who have left. |
| P6 | Until each view is rebuilt, the API keeps returning the legacy fields, filled from the new ones: `primary_lobbyist` = the lead's name, `lobbyist_team` = `[lead, second chair]` or `[lead]` (the succession metrics read its length as the number of people on the client), `client_originator` = `Firm` or the originator's name. A client not yet saved under P3 (no `lead_id`) returns its stored legacy values. Writes also store the legacy text, and a rename rewrites it. | The Partnership tab, the Scenarios workflow, the AI prompts and the exports all read the legacy fields; they keep working lead-only until Phases 4 and 5 replace them. The stored text keeps a Render rollback to pre-plan code showing correct leads. Edits made while rolled back change only the legacy text; after rolling forward, the ids win for any client that has a lead. |
| P7 | The book is started over once: a script deletes every client and revenue row in one transaction after a manual backup, and the new sheet (section 3) is imported. Accounts and people are untouched. | Jeff, 2026-09-25. Leads changed wholesale; restarting also removes the need to migrate multi-name teams to one second chair. |
| P8 | The import sheet (section 3) carries `Lead` and `Second Chair`, and optional originator and judgment columns. As with the revenue years (D5), the file is authoritative for exactly the columns it has: a column the file lacks leaves that field untouched. A file with any people error (unknown name, a non-partner lead, a missing lead, second chair equal to lead) imports nothing and lists every bad row. | A partial book is worse than a refused file. |
| P9 | The associate split suggests second-chair assignments and a partner accepts each one; accepting writes the assignment. The brief's "no automated swap optimizer" rule is relaxed for second chairs only. Lead changes are only ever suggested as candidates, during a departure. | Jeff, 2026-09-25. A second chair does not own the relationship, so proposing a balanced set does not risk it. |
| P10 | Load is measured against peers in the same role, as the brief says, not against a fixed ceiling. Lead load and second-chair load are shown separately, each as clients, revenue and effort (`getEffort` in `utils/strategic.cjs`); no factor splits a client's effort between the two chairs. | Replaces three conflicting capacity formulas (clients ÷ 15, ÷ 30, thresholds 80 and 85). No new number for anyone to negotiate. |
| P11 | Scenario state stays in the browser; Phase 5 moves it into the store so a tab switch no longer loses it. Saving scenarios on the server is later work. | Scope. |
| P12 | This plan runs before the Tier 1 AI rebuild. | Tier 1 sends "the whole book with the per-partner table", which depends on the people model. |

---

## 2. Status table (sessions update this)

| Phase | Title | Status | Branch / PR | Notes |
|---|---|---|---|---|
| 1 | People and second chair | merged | `claude/eager-wozniak-43ogq7`, [PR #19](https://github.com/zekusmaximus/client-portfolio/pull/19) | Section 4's session items pass. Where the plan and the code differed, the code won: (1) `lobbyist_team` is written as `[lead, second chair]`, not `[second chair]`, because `deriveRelationshipType` reads its length as the number of people on the client; (2) the pickers are native `<select>`s (`src/components/ui/native-select.jsx`) because `ui/select.jsx` shows the raw value, an id, in its trigger; (3) found while testing and fixed here because it blocks this phase's workflow: the form's status validation accepted only `Active`/`Prospect`/`Inactive`/`Former`, while every CSV-imported client carries `IF`/`P`/`D`/`H`, so the form could not save any imported client; it now accepts and offers both (merging the vocabularies stays Tier 2); (4) saving a pre-plan client replaces its legacy names with the picks; the form shows the old names first (`Recorded before the People list: ...`) so nothing disappears unseen; (5) not fixed, for Phase 4: `ClientListView` calls `fetchPartners()` inside `useMemo`, a store update during render that React warns about. Jeff's: section 4's last acceptance item after deploy |
| 2 | Import reads people and judgments | not started | | |
| 3 | Fresh book | not started | | Jeff's steps after Phase 2 is deployed |
| 4 | Who's carrying what (Partnership tab) | not started | | |
| 5 | Departure engine and Scenarios rework | not started | | two PRs |
| 6 | Associate split | not started | | |

Status values: `not started`, `in progress (date)`, `PR open`, `merged`, `deployed`, `verified on gbacpod.com`.

---

## 3. The import sheet

This is the format Phase 2 builds and the sheet Jeff assembles (with Cowork) for Phase 3. Save it as CSV (UTF-8); the page parses CSV in the browser. One header row, then one row per client.

| Column | Required | Values | Notes |
|---|---|---|---|
| `CLIENT` | yes | the client's name | as it should appear in the app; unique in the file |
| `Contract Period` | yes | `M/D/YY-M/D/YY`, `Expired M/D/YY` or `expires M/D/YY` | the status (In Force, Done, Proposal, Hold) is derived from it |
| `2024 Contracts`, `2025 Contracts`, `2026 Contracts` | at least one | amounts: `72000`, `$72,000` or `$72,000.00`; blank or `0` for none | one column per year (D5). After the reset these columns are the only revenue history, so include every year the dashboard should show |
| `Lead` | yes | one active partner's name | exactly as on the People list (case does not matter) |
| `Second Chair` | no | any active person other than the lead | blank for none |
| `Originator` | no | a person's name, or `Firm` | anyone on the People list, active or not; add a former colleague as an inactive person first if the sheet names them |
| `Credit To Firm` | no | `Y` or blank | `Y` when the originator's origination credit has ended; implied when `Originator` is `Firm` |
| `Stickiness` | no | `1` to `5` | 5 Personal bond (won't leave), 4 Strong, established, 3 Solid but transactional, 2 New / still shallow, 1 Cold (never met in person). Half of the strategic score |
| `Cadence` | no | `Daily`, `Weekly`, `Monthly`, `Quarterly`, `As-Needed` | how often the client is touched; drives effort |
| `Handful` | no | `Y` or blank | every interaction is heavy; effort × 1.5 |
| `Conflict Risk` | no | `Low`, `Medium`, `High` | subtracts 0, 1 or 3 from the score |
| `Practice Area` | no | one or more of `Healthcare`, `Municipal`, `Corporate`, `Energy`, `Financial`, `Education`, `Transportation`, `Environmental`, `Technology`, `Real Estate`, `Non-Profit`, `Other`, separated by `;` | |
| `Notes` | no | free text | |

Header line and two example rows:

```csv
CLIENT,Contract Period,2024 Contracts,2025 Contracts,2026 Contracts,Lead,Second Chair,Originator,Credit To Firm,Stickiness,Cadence,Handful,Conflict Risk,Practice Area,Notes
Example Health Network,1/1/26-12/31/26,"$60,000","$66,000","$72,000",Kevin,Jay,Jay,Y,5,Weekly,,Low,Healthcare,
Example Energy Coalition,7/1/25-6/30/27,,"$40,000","$85,000",Paula,,Paula,,3,Monthly,Y,Medium,Energy;Environmental,Renewal talks in spring
```

Without the judgment columns every client gets the same stickiness fallback and a Medium conflict penalty, so the strategic score ranks by revenue alone until partners fill them in one client at a time. If the sheet omits a judgment column, a later import that includes it fills it in.

---

## 4. Phase 1: People and second chair

**Expected outcomes**

- A People dialog (header button) lists everyone by role, adds a person, renames, changes a role, and deactivates or reactivates, refusing a change P5 forbids with the reason.
- The client form picks a lead from active partners, a second chair from everyone else who is active, and an originator with a "credit to the firm" toggle. The server refuses a client without an active partner lead, a second chair equal to the lead, or an unknown person, with a message on the field.
- Existing views keep working through the legacy fields (P6), lead-only as before. Until Phase 4, a second chair who leads nothing appears on the Partnership tab as a "partner" card with no clients, because that tab lists every name in `lobbyist_team`.

**Changes**

1. `init-db.sql`: `people` with the unique index on `lower(name)` and the seed (P1); `clients.lead_id`, `second_chair_id`, `originator_id` (`REFERENCES people(id)`, nullable) and `originator_is_firm BOOLEAN NOT NULL DEFAULT false`, each `ADD COLUMN IF NOT EXISTS`; `CHECK (second_chair_id IS NULL OR second_chair_id <> lead_id)` added by a guarded `DO` block. No backfill: the book is replaced in Phase 3, and until then a client keeps its legacy names until it is next saved.
2. `utils/people.cjs` (pure): the roles, the person and assignment validators, the P5 blockers, the SQL that joins a client's three people, and `withPeopleFields(row)`, which nests `lead`, `secondChair` and `originator` and fills the legacy fields (P6).
3. `routes/people.cjs`, mounted at `/api/people` behind `authenticateToken`: `GET /` (everyone, with how many clients each leads, seconds and originated), `POST /` `{ name, role }`, `PUT /:id` `{ name?, role?, active? }` (409 with the reason for a P5 violation or a duplicate name; a rename rewrites the legacy text in the same transaction). No delete. `sanitizeRequestBody` is not applied: names are validated against a strict pattern and React escapes them on render.
4. `data.cjs` `GET/POST/PUT /clients` and `models/clientModel.cjs` join the people and return `withPeopleFields`. `POST` and `PUT` take `lead_id`, `second_chair_id`, `originator_id` and `originator_is_firm`, validate them, answer 400 `{ success: false, error: 'Validation failed', details: [{ field, message }] }` (the shape the form already parses), and store the legacy text. The CSV import is unchanged until Phase 2.
5. Frontend: `people` in the store (loaded with the clients after sign-in, cleared on logout), `src/PeopleDialog.jsx`, `src/utils/people.js` (pure: candidates for each picker, labels), the form's "Team Assignment" section replaced, `src/constants.js` deleted.
6. `PRODUCT_BRIEF.md`: the "Who it's for" paragraph states P2.

**Tests**

- `tests/people.test.mjs`: the validators, the blockers, `withPeopleFields` for a new-model and a legacy row, and the frontend picker helpers.
- `tests/schema.test.mjs`: a new database has the seven people and the new columns; applying `init-db.sql` again adds nobody; a renamed person is not re-seeded; names are unique regardless of case; the check refuses a second chair equal to the lead; the foreign keys refuse an unknown person; a database built with the pre-plan `init-db.sql` migrates with its clients and revenue intact.

**Acceptance**

- [x] Gates green (lint 0 errors and the 7 expected warnings; `npm test` 89 of 89, and 99 of 99 with `SCHEMA_TEST_SERVER_URL` set; production build); `tests/schema.test.mjs` 14 of 14 on PostgreSQL 16 locally; `deploy/backup/selftest.sh` 14 passed with the new table. CI's `schema` job (PostgreSQL 18) runs on the PR.
- [x] End to end in the container, on a database built with the pre-plan `init-db.sql` holding a legacy client (lead Steve, team Steve and Fritz): the server migrated it at start; the API refused no lead, an emeritus lead, second chair = lead, an unknown originator, an inactive second chair, a duplicate name regardless of case and the reserved name `Firm`, deactivating a second chair, and moving or deactivating a partner who leads a client, each with its message; a rename rewrote the stored legacy text. In headless Chromium: the People dialog listed six partners and the emeritus, added an associate and showed the refusal for deactivating Kevin; the form refused a client without a lead, offered only partners as lead, created a client with Paula as lead, the associate as second chair and the emeritus as originator with credit to the firm, and saved the legacy client with a new lead after showing its old names. No console error from this change (React's pre-existing warning from `ClientListView` aside, status row note 5).
- [ ] Jeff, after deploy: the People dialog shows the six partners and Jay; the Render start-up log shows `Database tables initialized`.

---

## 5. Phase 2: Import reads people and judgments

**Outcome:** a sheet in the section 3 format imports leads, second chairs, originators and the judgment columns, or refuses with every bad row listed.

- `utils/csvImport.cjs` (pure): read the optional columns by header (case-insensitive, trimmed), parse `Y`, `1`–`5`, the cadence and conflict vocabularies and `;` lists; resolve names against the people list; return per-row errors. `processCSVData` carries the parsed fields; `validateClientData` merges the people errors into `issues`.
- `data.cjs` `/process-csv`: when any people error exists, answer 400 with the list and write nothing. Otherwise the insert and update passes set `lead_id`, `second_chair_id`, `originator_id`, `originator_is_firm` and the judgment columns for the columns present (P8), and the legacy text (P6). The current "preserve the existing value" logic stays for columns the file lacks.
- `DataUploadManager.jsx`: the expected-columns help lists section 3, with a "Download template" link to a static `public/client-book-template.csv`.
- Tests: parsing, name resolution, every refusal, a file without the people columns behaving exactly as today.

## 6. Phase 3: Fresh book

- `scripts/reset-book.cjs` (`npm run reset:book -- --confirm`): prints the client and revenue-row counts, refuses without `--confirm`, then deletes every client (revenue rows cascade) in one transaction and prints what it removed. Accounts and people are untouched. Runbook section in `deploy/README.md`.
- Jeff: run the backup by hand and keep that run's artifact beyond 90 days if the old book should outlive the retention (`deploy/backup/INSTALL.md` step 7); `npm run reset:book -- --confirm` from the Render Shell or locally (runbook 7.2's environment); import the sheet; spot-check totals by year and a few leads; then remove Steve's and Fritz's accounts if they have them (`npm run delete:user`), and add associates on the People dialog as they join.

## 7. Phase 4: Who's carrying what

The Partnership tab rebuilt from the people and the clients, by role: partners' lead books (clients, revenue in the reporting year, effort) and everyone's second-chair load, each compared to the role's average (P10). Removes the invented data (the deep dive's revenue trend at × 0.8 and × 0.9, the `Math.random` workload chart, the fixed "+11.1%"), the "Unassigned" pseudo-partner, the three capacity formulas, and the tab's own redistribution modeler (departures move to Scenarios). Fixes the `strategic_value` reads (the API sends `strategicValue`; five components and the exports read the wrong name, so "high-value clients at risk" is always 0 and the exports show N/A). The client list filters by lead or second chair and shows both, and stops calling `fetchPartners()` inside `useMemo` (a store update during render; React warns).

## 8. Phase 5: Departure engine and Scenarios rework

- A pure, tested departure engine: for one or more departing people, each client a departing partner leads needs a new partner lead, with suggested candidates (the second chair first when a partner, then practice-area fit, then lighter lead load); each seat a departing second chair held becomes empty, with candidates from the Phase 6 logic. Output: the clients needing a decision and every person's load before and after.
- Stage 1 uses it and lists every active person, by role, as departable. Stage 2's plan holds a new lead and a new second chair, checked against P3, instead of one `successorPartner` string (today the AI's paragraph is copied into that field). The transition-plan prompt receives the roster with roles and loads and must name its recommendation from it; the parser reads that name separately. Stage 3's mock data ("ClientCorp", fixed 95% retention and 45 days) and the retention estimate built on the retired `relationshipStrength` are removed. Scenario state moves into the store (P11).
- Fixes found in the trace: `successionUtils.js` reads `communication_frequency` (the column is `interaction_frequency`) and `parseFloat`s the conflict label; the successor pickers list the departing people and "Unassigned".

## 9. Phase 6: Associate split

A view of each associate's second-chair load against the associate average, the clients with no second chair, and a proposed assignment for them (practice-area fit, then lighter load, respecting P3). A partner accepts or edits each proposal; accepting writes `second_chair_id` (P9). Reuses Phase 4's load helpers and Phase 5's candidate logic.
