// Contract tests per route (docs/plans/tier-2.md, S2 and WP1): for every route
// server.cjs registers, its success status and top-level keys, the keys the
// page reads (each named, in a comment, with the page file that reads it), its
// 401 without sign-in, and its documented refusals (400, 404, 409), so that a
// change to a route's shape cannot ship without a test saying so.
//
// The inventory test needs no database and always runs: it reads the route
// files (routes/*.cjs, data.cjs, server.cjs) for router.METHOD( and app.METHOD(
// and fails when a route is registered without an entry in CONTRACTS, when an
// entry names a route that is no longer registered, when an entry has no
// route('...') block of tests below, or when a route in REMOVED is back.
//
// The database tests need SCHEMA_TEST_SERVER_URL, the superuser URL of a
// THROWAWAY PostgreSQL server (as tests/import-db.test.mjs; CI's schema job
// sets it), and are skipped without it. They run twice, on the tables
// init-db.sql creates and on production's older tables (integer ids), each
// shape with its own routes_test_* database and its own server.cjs processes
// (tests/helpers/server.mjs): one pointed at the fake Anthropic server
// (tests/helpers/fakeAnthropic.mjs) for everything a signed-in partner does,
// one without a key for the 503s and the sign-in routes, and, for each login
// limiter, a server of its own, because the limiters count in memory per
// process. Every test creates the clients, people, accounts and saved answers
// it needs, so none depends on another's order or on import-db's. The seed
// people (init-db.sql) are read, never changed; people a test changes are its
// own.
//
// Where a contract pins behaviour the plan calls a defect, a comment says so
// and names the work package that changes it; that package changes the test.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import aiAnswers from '../utils/aiAnswers.cjs';
import clientChanges from '../utils/clientChanges.cjs';
import scenarioState from '../utils/scenarioState.cjs';
import { startFakeAnthropic } from './helpers/fakeAnthropic.mjs';
import {
  repo, serverUrl, generatedPassword, urlFor, freePort, startServer, SHAPES, addAccount, cookieOf, signIn, waitFor,
} from './helpers/server.mjs';
import { createSseParser, eventJson } from '../src/utils/sse.js';
import succession from '../utils/succession.cjs';
import clientRules from '../utils/clientRules.cjs';
import { clientFormData, clientRequestBody, revenuesToSend } from '../src/utils/clientForm.js';
import { sanitizeFormData } from '../src/utils/validation.js';
import { toPersonId } from '../src/utils/people.js';
import { enhanceClientWithSuccessionMetrics } from '../src/utils/successionUtils.js';
import { departureModel, withChoice } from '../src/utils/departure.js';
import { pinnedChoice, planRequest, syncTransitions } from '../src/utils/transitionPlans.js';
import { revenueForYear } from '../src/utils/revenue.js';
import { openState, planViews, stateFromStore, stateJson, withAiPlan, withEdits } from '../src/utils/scenarioState.js';
import { acceptance, hireScenarioModel, newAssociate, withPick } from '../src/utils/hireScenario.js';

// Every route server.cjs registers, as METHOD and the full path, with whether
// it needs a signed-in partner and the page files that call it.
const CONTRACTS = {
  'POST /api/auth/login': { signIn: false, page: 'src/portfolioStore.js (login), src/LoginPage.jsx' },
  'POST /api/auth/logout': { signIn: false, page: 'src/portfolioStore.js (logout)' },
  'GET /api/auth/me': { signIn: true, page: 'src/portfolioStore.js (checkAuth)' },
  'POST /api/auth/change-password': { signIn: true, page: 'src/ChangePasswordDialog.jsx' },
  'POST /api/data/process-csv': { signIn: true, page: 'src/DataUploadManager.jsx' },
  'GET /api/data/clients': { signIn: true, page: 'src/portfolioStore.js (fetchClients)' },
  'POST /api/data/clients': { signIn: true, page: 'src/portfolioStore.js (addClient), src/ClientEnhancementForm.jsx' },
  'PUT /api/data/clients/:id': { signIn: true, page: 'src/portfolioStore.js (updateClient), src/ClientEnhancementForm.jsx' },
  'PUT /api/data/clients/:id/second-chair': { signIn: true, page: 'src/portfolioStore.js (assignSecondChair), src/components/AssociateSplit.jsx' },
  'DELETE /api/data/clients/:id': { signIn: true, page: 'src/portfolioStore.js (deleteClient)' },
  'GET /api/data/clients/:id/changes': { signIn: true, page: 'src/ClientEnhancementForm.jsx (fetchHistory), src/utils/clientHistory.js' },
  'GET /api/people': { signIn: true, page: 'src/portfolioStore.js (fetchPeople), src/PeopleDialog.jsx' },
  'POST /api/people': { signIn: true, page: 'src/portfolioStore.js (addPerson), src/PeopleDialog.jsx' },
  'PUT /api/people/:id': { signIn: true, page: 'src/portfolioStore.js (updatePerson), src/PeopleDialog.jsx' },
  'GET /api/ai/book': { signIn: true, page: 'src/components/AIBookPanel.jsx' },
  'POST /api/ai/ask': { signIn: true, page: 'src/portfolioStore.js (askStream), src/AIAdvisor.jsx' },
  'POST /api/ai/brief': { signIn: true, page: 'src/portfolioStore.js (askStream), src/AIAdvisor.jsx' },
  'GET /api/ai/answers': { signIn: true, page: 'src/portfolioStore.js (fetchAiAnswers, fetchOlderAiAnswers), src/AIAdvisor.jsx' },
  'GET /api/ai/answers/summary': { signIn: true, page: 'src/portfolioStore.js (fetchAiAnswers), src/utils/recentAnswers.js' },
  'GET /api/ai/answers/:id': { signIn: true, page: 'src/portfolioStore.js (toggleAiAnswer), src/AIAdvisor.jsx' },
  'POST /api/ai/answers/:id/hide': { signIn: true, page: 'src/portfolioStore.js (setAiAnswerHidden), src/AIAdvisor.jsx' },
  'POST /api/ai/answers/:id/show': { signIn: true, page: 'src/portfolioStore.js (setAiAnswerHidden), src/AIAdvisor.jsx' },
  'POST /api/scenarios/transition-plan': { signIn: true, page: 'src/components/succession/ClientReviewInterface.jsx' },
  'GET /api/scenarios': { signIn: true, page: 'src/portfolioStore.js (fetchScenarios), src/components/succession/ScenarioBar.jsx' },
  'GET /api/scenarios/:id': { signIn: true, page: 'src/portfolioStore.js (openScenario), src/utils/scenarioState.js (openState)' },
  'POST /api/scenarios': { signIn: true, page: 'src/portfolioStore.js (saveScenario)' },
  'PUT /api/scenarios/:id': { signIn: true, page: 'src/portfolioStore.js (saveScenario)' },
  'DELETE /api/scenarios/:id': { signIn: true, page: 'src/portfolioStore.js (deleteScenario)' },
  'GET /api/health': { signIn: false, page: 'src/DataUploadManager.jsx, src/components/AIBookPanel.jsx, src/AIAdvisor.jsx, src/components/AssociateSplit.jsx, src/components/succession/ClientReviewInterface.jsx, src/ClientEnhancementForm.jsx, src/portfolioStore.js (checkScenarioFeature)' },
};

// Routes deleted in earlier packages: none may be registered again, and each
// answers 404. Tier 1 WP3 deleted claude.cjs; Tier 2 WP2 (S3) the three
// /api/data routes nothing on the page called, update-client scoring with a
// second, retired formula.
const REMOVED = [
  'POST /api/claude/analyze-portfolio',
  'POST /api/claude/strategic-advice',
  'POST /api/claude/client-recommendations',
  'POST /api/data/update-client',
  'POST /api/data/optimize-portfolio',
  'POST /api/data/analytics',
];

/* -------------------------------------------------------------------------- */
/*                                 INVENTORY                                  */
/* -------------------------------------------------------------------------- */

const readSource = (file) => readFileSync(join(repo, file), 'utf8');
const ROUTE_FILES = ['server.cjs', 'data.cjs', ...readdirSync(join(repo, 'routes')).filter((f) => f.endsWith('.cjs')).sort().map((f) => `routes/${f}`)];

// Where server.cjs mounts each router file: app.use('<prefix>', require('./<file>'))
// or app.use('<prefix>', <name>) after const <name> = require('./<file>')
function mountsOf(serverSource) {
  const required = new Map([...serverSource.matchAll(/const (\w+) = require\('\.\/([^']+)'\)/g)].map((m) => [m[1], m[2]]));
  const mounts = new Map();
  for (const m of serverSource.matchAll(/app\.use\(\s*'([^']+)'\s*,\s*(?:require\('\.\/([^']+)'\)|(\w+))\s*\)/g)) {
    const file = m[2] || required.get(m[3]);
    if (file) mounts.set(file, m[1]);
  }
  return mounts;
}

// Every METHOD path the route files register, with the mount prefix
function registeredRoutes() {
  const mounts = mountsOf(readSource('server.cjs'));
  const routes = [];
  const unmounted = [];
  for (const file of ROUTE_FILES) {
    const source = readSource(file);
    const owner = file === 'server.cjs' ? 'app' : 'router';
    const calls = [...source.matchAll(new RegExp(`\\b${owner}\\.(get|post|put|patch|delete|all)\\(\\s*(['"\`])([^'"\`]*)\\2`, 'g'))];
    if (file !== 'server.cjs' && calls.length > 0 && !mounts.has(file)) unmounted.push(file);
    const prefix = file === 'server.cjs' ? '' : mounts.get(file) || `(${file} is not mounted)`;
    for (const [, method, , path] of calls) routes.push(`${method.toUpperCase()} ${prefix}${path === '/' ? '' : path}`);
  }
  return { routes, unmounted };
}

// The route('...') blocks in this file
const routeBlocks = () => [...readFileSync(fileURLToPath(import.meta.url), 'utf8').matchAll(/\broute\('([A-Z]+ \/[^']*)'/g)].map((m) => m[1]);

test('inventory: every registered route has a contract with tests, every contract a registered route, and no removed route is back', () => {
  const { routes, unmounted } = registeredRoutes();
  assert.deepEqual(unmounted, [], 'a router file with routes that server.cjs does not mount');
  // The inventory reads router.METHOD(path) and app.METHOD(path) only
  const chained = ROUTE_FILES.filter((file) => /\b(router|app)\.route\(/.test(readSource(file)));
  assert.deepEqual(chained, [], 'router.route() chains are not read by the inventory; register each METHOD on its own');

  const contracts = Object.keys(CONTRACTS);
  assert.equal(new Set(routes).size, routes.length, `a route registered twice: ${routes}`);
  assert.deepEqual(routes.filter((r) => !contracts.includes(r)), [], 'registered without a contract in CONTRACTS');
  assert.deepEqual(contracts.filter((r) => !routes.includes(r)), [], 'a contract for a route that is not registered');
  assert.deepEqual(routes.filter((r) => REMOVED.includes(r)), [], 'a removed route is registered again');

  const blocks = routeBlocks();
  assert.deepEqual(contracts.filter((r) => !blocks.includes(r)), [], 'a contract without a route() block of tests');
  assert.deepEqual(blocks.filter((r) => !contracts.includes(r)), [], 'a route() block without a contract');
  assert.equal(new Set(blocks).size, blocks.length, 'a route() block written twice');
  // The plan's count (docs/plans/tier-2.md, section 6): 21 live routes, once
  // WP2 deleted S3's three; 22 with WP6's GET /api/data/clients/:id/changes;
  // 27 with WP8's five saved-scenario routes; 29 with WP10's hide and show
  assert.equal(routes.length, 29);
});

/* -------------------------------------------------------------------------- */
/*                         THE CONTRACTS, PER SHAPE                           */
/* -------------------------------------------------------------------------- */

const keysOf = (object) => Object.keys(object).sort();
const letters = (n) => Array.from(randomBytes(n), (b) => String.fromCharCode(97 + (b % 26))).join('');
// A name no other test uses; letters only, as the People list requires
const uniqueName = (prefix) => `${prefix} ${letters(1).toUpperCase()}${letters(7)}`;
const TOO_MANY = { success: false, error: 'Too many requests. Try again later.' };
const MISSING_TOKEN = { error: 'Missing token' };
const INVALID_TOKEN = { error: 'Invalid token' };
const NOT_CONFIGURED = { success: false, error: 'AI is not configured on the server (missing API key).' };
const FEATURES = ['check-file', 'transition-plan-roster', 'second-chair-assign', 'ai-book', 'ask-the-book', 'ai-answers', 'ai-stream', 'plain-text', 'client-edit-conflict', 'saved-scenarios', 'hire-scenarios', 'ai-threads'];
// The seed people init-db.sql adds to a new database (docs/plans/people-and-second-chair.md, P1)
const SEED = { Brendan: 'partner', Jeff: 'partner', Joe: 'partner', Kevin: 'partner', Mike: 'partner', Paula: 'partner', Jay: 'emeritus' };
const PERSON_KEYS = ['active', 'id', 'lead_count', 'name', 'originator_count', 'role', 'second_chair_count'];
const NESTED_PERSON_KEYS = ['active', 'id', 'name', 'role'];

// The client fields the page reads from every client response (GET, POST and
// PUT /api/data/clients and the second-chair route), and where:
//   id, name, notes, practiceArea, conflict_risk, interaction_frequency,
//   stickiness, high_maintenance, lead_id, second_chair_id, originator_id,
//   originator_is_firm, revenues: src/utils/clientForm.js (the client form)
//   lead, secondChair, originator, practice_area: src/utils/bookSheet.js
//   revenues: src/utils/revenue.js (the reporting year, each year's revenue)
//   effort, stickinessScore: src/utils/clientMetrics.js (resolveEffort,
//   getStickiness), which src/utils/load.js and src/utils/departure.js use
//   lead, secondChair: src/utils/load.js, src/utils/departure.js
//   primary_lobbyist, lobbyist_team, client_originator: src/utils/successionUtils.js
//   (the store's succession metrics, src/portfolioStore.js)
//   strategicValue: src/ClientListView.jsx, src/DashboardView.jsx
//   updated_at_exact: src/ClientEnhancementForm.jsx, sent back as
//   expected_updated_at (Tier 2 WP6, S10)
const CLIENT_KEYS_THE_PAGE_READS = [
  'id', 'name', 'notes', 'practiceArea', 'practice_area', 'conflict_risk', 'interaction_frequency', 'stickiness',
  'high_maintenance', 'lead_id', 'second_chair_id', 'originator_id', 'originator_is_firm', 'revenues', 'lead',
  'secondChair', 'originator', 'effort', 'stickinessScore', 'primary_lobbyist', 'lobbyist_team', 'client_originator',
  'strategicValue', 'updated_at_exact',
  // Tier 2 WP7 (S11): the succession metrics, which the Dashboard, the client
  // list and Scenarios show (src/DashboardView.jsx, src/ClientListView.jsx,
  // src/components/succession/*, src/utils/transitionPlans.js)
  'relationshipType', 'transitionComplexity', 'successionRisk',
];
const METRIC_KEYS = ['relationshipType', 'transitionComplexity', 'successionRisk'];
const metricsOf = (client) => Object.fromEntries(METRIC_KEYS.map((k) => [k, client[k]]));
// The body the client form sends for its state, as handleSave builds it
// (src/ClientEnhancementForm.jsx), and the form's live preview of that state
const formSaveBody = (form) => {
  const sent = sanitizeFormData(form);
  return clientRequestBody({
    ...sent,
    lead_id: toPersonId(form.lead_id),
    second_chair_id: toPersonId(form.second_chair_id),
    originator_id: toPersonId(form.originator_id),
    originator_is_firm: form.originator_is_firm === true,
    revenues: revenuesToSend(sent.revenues).revenues,
  });
};
const previewOf = (form) => metricsOf(enhanceClientWithSuccessionMetrics(form));
// A client_changes row as GET /api/data/clients/:id/changes answers it (WP6)
const CHANGE_KEYS = ['changed_by_username', 'changes', 'client_id', 'client_name', 'created_at', 'id', 'source'];
const EXACT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/;

// The field rules POST and PUT /api/data/clients apply (utils/clientRules.cjs,
// docs/plans/tier-2.md, WP4): [what, the body's fields over a valid form body,
// the 400's details]. Each detail's field is the body's, or `revenue_<n>` for
// the n-th revenue entry (the client form's key for its row).
// The 21 a message lists (docs/plans/tier-3.md, section 18), never a retired name
const PRACTICE_AREA_LIST = clientRules.PRACTICE_AREAS.join(', ');
const detail = (field, message) => [{ field, message }];
const yearDetail = (year, n = 0) => detail(`revenue_${n}`, `Revenue year ${year} must be a whole year from 1900 to 2099.`);
const amountDetail = (year) => detail('revenue_0', `The amount for ${year} must be a number from 0 to 1,000,000,000.`);
const FIELD_REFUSALS = {
  name: [
    ['no name', { name: undefined }, detail('name', 'Client name is required')],
    ['a null name', { name: null }, detail('name', 'Client name is required')],
    ['a blank name', { name: '   ' }, detail('name', 'Client name is required')],
    ['a name that is not text', { name: 42 }, detail('name', 'Client name must be text')],
    ['a name over 255 characters', { name: 'A'.repeat(256) }, detail('name', 'Client name must not exceed 255 characters')],
    ['a name with a ;', { name: 'Acme; Inc' }, detail('name', 'Client name contains invalid characters')],
    ['a name with a #', { name: 'Acme #1' }, detail('name', 'Client name contains invalid characters')],
    ['a name with a <', { name: 'Acme <b>' }, detail('name', 'Client name contains invalid characters')],
    // As a client saved before WP5 is stored until the repair, sent back by a
    // direct request: checked as sent since WP5 (accepted and escaped once
    // more until then)
    ['a name as stored escaped before WP5', { name: 'Barnes &amp; Noble' }, detail('name', 'Client name contains invalid characters')],
  ],
  vocabularies: [
    ['a practice area off the list', { practice_area: ['Tax'] }, detail('practice_area', `Practice area "Tax" is not on the list: ${PRACTICE_AREA_LIST}.`)],
    ['a practice area in the wrong case', { practice_area: ['healthcare', 'Energy'] }, detail('practice_area', `Practice area "healthcare" is not on the list: ${PRACTICE_AREA_LIST}.`)],
    ['practice areas that are not a list', { practice_area: 'Healthcare' }, detail('practice_area', `Practice areas must be a list from: ${PRACTICE_AREA_LIST}.`)],
    ['a conflict risk off the list', { conflict_risk: 'Severe' }, detail('conflict_risk', 'Conflict risk "Severe" must be Low, Medium or High.')],
    ['a blank conflict risk', { conflict_risk: '' }, detail('conflict_risk', 'Conflict risk must be Low, Medium or High.')],
    ['no conflict risk', { conflict_risk: undefined }, detail('conflict_risk', 'Conflict risk must be Low, Medium or High.')],
    ['a cadence off the list', { interaction_frequency: 'Hourly' }, detail('interaction_frequency', 'Interaction frequency "Hourly" must be one of Daily, Weekly, Monthly, Quarterly, As-Needed, or blank.')],
    ['stickiness 0', { stickiness: 0 }, detail('stickiness', 'Stickiness must be a whole number from 1 to 5, or null for not rated.')],
    ['stickiness 6', { stickiness: 6 }, detail('stickiness', 'Stickiness must be a whole number from 1 to 5, or null for not rated.')],
    ['stickiness as text', { stickiness: '3' }, detail('stickiness', 'Stickiness must be a whole number from 1 to 5, or null for not rated.')],
    ['high-maintenance as text', { high_maintenance: 'yes' }, detail('high_maintenance', 'High-maintenance must be true or false.')],
    ['high-maintenance null', { high_maintenance: null }, detail('high_maintenance', 'High-maintenance must be true or false.')],
  ],
  revenue: [
    ['a year before 1900', { revenues: [{ year: 1899, revenue_amount: 1000 }] }, yearDetail(1899)],
    ['a year after 2099', { revenues: [{ year: 2100, revenue_amount: 1000 }] }, yearDetail(2100)],
    ['a year as text', { revenues: [{ year: '2026', revenue_amount: 1000 }] }, yearDetail('"2026"')],
    ['a negative amount', { revenues: [{ year: 2026, revenue_amount: -1 }] }, amountDetail(2026)],
    ['an amount over 1,000,000,000', { revenues: [{ year: 2026, revenue_amount: 1e9 + 1 }] }, amountDetail(2026)],
    ['an amount NUMERIC(12, 2) cannot hold', { revenues: [{ year: 2026, revenue_amount: 1e10 }] }, amountDetail(2026)],
    ['an amount as text', { revenues: [{ year: 2026, revenue_amount: '5000' }] }, amountDetail(2026)],
    ['a year given twice', { revenues: [{ year: 2025, revenue_amount: 1 }, { year: 2025, revenue_amount: 2 }] },
      detail('revenue_1', '2025 is given more than once; give each year once.')],
    ['revenue that is not a list', { revenues: { 2026: 1000 } }, detail('revenues', 'Revenue must be a list of { year, revenue_amount } entries.')],
    ['revenue null', { revenues: null }, detail('revenues', 'Revenue must be a list of { year, revenue_amount } entries.')],
  ],
};
// A name the client form allows (70 characters) that was 270 once the request
// sanitizer had escaped it, over clients.name's VARCHAR(255): refused with how
// much to cut from WP4 (500 until then), stored as typed from WP5
const LONG_ONCE_ESCAPED = `${'&'.repeat(50)}${'A'.repeat(20)}`;
const NOT_AN_OBJECT = detail('body', "The request body must be a JSON object of the client's fields.");
const failed = (details) => ({ success: false, error: 'Validation failed', details });

// A saved answer's columns, as GET /api/ai/answers/:id returns them
// (ONE_ANSWER_SQL in utils/aiAnswers.cjs), and from Tier 2 WP10 its place in
// its thread (can_follow_up, earlier_book, follow_up, thread) and the new
// columns but content, the stored turn, which the page never needs
const ANSWER_KEYS = [
  'answer', 'asked_by', 'asked_by_username', 'book_sha256', 'cache_read_tokens', 'cache_write_tokens', 'can_follow_up',
  'client_id', 'client_name', 'cost_usd', 'created_at', 'duration_ms', 'earlier_book', 'fell_back', 'follow_up',
  'hidden_at', 'hidden_by', 'hidden_by_username', 'id', 'input_tokens', 'kind', 'model', 'output_tokens', 'parent_id',
  'prices_read_on', 'question', 'refusal_category', 'refused', 'reporting_year', 'served_by', 'stop_reason', 'thread',
  'truncated',
];
// From WP10 a list row also carries earlier_book, hidden_at,
// hidden_by_username and parent_id
const LIST_ANSWER_KEYS = [
  'asked_by_username', 'client_name', 'cost_usd', 'created_at', 'earlier_book', 'hidden_at', 'hidden_by_username', 'id',
  'kind', 'parent_id', 'preview', 'question', 'refused', 'served_by', 'truncated',
];
// Ask's and the brief's JSON answer (routes/ai.cjs); `done` carries the same but
// success, kind and question, with answerId for id. From WP10: canFollowUp,
// followUp and parentId
const AI_ANSWER_KEYS = [
  'answer', 'canFollowUp', 'costUsd', 'followUp', 'id', 'kind', 'model', 'parentId', 'question', 'refusalCategory',
  'refused', 'reportingYear', 'saved', 'servedBy', 'success', 'timestamp', 'truncated', 'usage',
];
const THREAD_TURN_KEYS = ['answer', 'asked_by_username', 'created_at', 'id', 'kind', 'question', 'refused', 'truncated'];

for (const shape of SHAPES)
describe(`route contracts on PostgreSQL (${shape.name})`, { skip: serverUrl ? false : 'SCHEMA_TEST_SERVER_URL is not set' }, () => {
  const dbName = `routes_test_${randomBytes(6).toString('hex')}`;
  // A well-formed id no client has, in this shape's id type; and one in the other shape's
  const missingId = shape.idType === 'integer' ? '2147483000' : '00000000-0000-4000-8000-000000000000';
  const otherShapeId = shape.idType === 'integer' ? '00000000-0000-4000-8000-000000000000' : '2147483000';
  let admin;
  let db;
  let env;
  let fake;
  // api: pointed at the fake Anthropic server; everything a signed-in partner does.
  // keyless: no key, for the 503s and /api/health's DEGRADED, and the sign-in
  // routes (login, logout, me, change-password), whose per-IP limiter (20 per
  // 15 minutes, in memory) the tests below spend 14 of on it.
  let api;
  let keyless;
  let account;
  let cookie;
  const servers = [];

  // A server.cjs on this shape's database, with `extra` over the suite's environment
  const launch = async (extra = {}, options) => {
    const port = await freePort();
    const server = startServer({ ...env, ...extra, PORT: String(port) }, options);
    servers.push(server);
    await server.ready;
    server.base = `http://127.0.0.1:${port}`;
    return server;
  };
  const stop = (server) => {
    server.child.kill();
    servers.splice(servers.indexOf(server), 1);
  };

  before(async () => {
    admin = new pg.Client({ connectionString: urlFor('postgres') });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    if (shape.tables) {
      const setup = new pg.Client({ connectionString: urlFor(dbName) });
      await setup.connect();
      await setup.query(shape.tables);
      await setup.end();
    }
    env = {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: urlFor(dbName),
      DATABASE_SSL: 'false',
      JWT_SECRET: randomBytes(32).toString('hex'),
      SESSION_TTL: '7d',
      TRUST_PROXY_HOPS: '0',
      FRONTEND_URL: '',
      ANTHROPIC_API_KEY: '',
      CLAUDE_API_KEY: '',
      ANTHROPIC_BASE_URL: '',
      AI_MODEL: '',
      AI_EFFORT: '',
      AI_STREAM_PING_MS: '',
    };
    fake = await startFakeAnthropic();
    // One after the other: each applies init-db.sql at start
    keyless = await launch();
    api = await launch({ ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: fake.url });

    db = new pg.Client({ connectionString: urlFor(dbName) });
    await db.connect();
    account = { username: 'contracts', password: generatedPassword() };
    await addAccount(env, account);
    cookie = await signIn(api.base, account);
  });

  after(async () => {
    for (const server of [...servers]) server.child.kill();
    await fake?.close();
    await db?.end().catch(() => {});
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await admin?.end();
  });

  // One request: { status, headers, body (parsed JSON, or null), text }.
  // `as` is the Cookie header ('' for none); the signed-in partner's by default.
  const request = async (base, method, path, { body, as = cookie, headers = {} } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(as ? { Cookie: as } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, body: json, text };
  };
  const call = (method, path, body, options = {}) => request(api.base, method, path, { ...options, body });
  const logLines = (server, event) => server.output.split('\n')
    .filter((line) => line.includes(`"event":"${event}"`))
    .map((line) => JSON.parse(line.slice(line.indexOf('{'))));

  // Fixtures, written straight to the tables so that each test depends only
  // on the route it is about
  const seed = async (name) => (await db.query('SELECT id, name, role, active FROM people WHERE name = $1', [name])).rows[0];
  const addPerson = async (role = 'partner', prefix = 'Contract Person') => (await db.query(
    'INSERT INTO people (name, role) VALUES ($1, $2) RETURNING id, name, role, active', [uniqueName(prefix), role])).rows[0];
  // A client as the client form writes one: people ids, the legacy text they
  // imply (P6), and one revenue row per year
  const addClient = async ({ name = uniqueName('Contract Client'), lead = null, second = null, originator = null, firm = false, revenues = { 2026: 100000 } } = {}) => {
    const { rows: [row] } = await db.query(`
      INSERT INTO clients (name, practice_area, conflict_risk, notes, interaction_frequency, stickiness, high_maintenance,
                           lead_id, second_chair_id, originator_id, originator_is_firm,
                           primary_lobbyist, lobbyist_team, client_originator)
      VALUES ($1, $2, 'Low', '', 'Monthly', 3, false, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, name`,
    [name, ['Healthcare'], lead?.id ?? null, second?.id ?? null, originator?.id ?? null, firm,
      lead?.name ?? '', [lead, second].filter(Boolean).map((p) => p.name), firm ? 'Firm' : originator?.name ?? '']);
    for (const [year, amount] of Object.entries(revenues)) {
      await db.query('INSERT INTO client_revenues (client_id, year, revenue_amount) VALUES ($1, $2, $3)', [row.id, Number(year), amount]);
    }
    return row;
  };
  const storedClient = async (id) => (await db.query('SELECT * FROM clients WHERE id::text = $1', [String(id)])).rows[0];
  const revenueRows = async (id) => (await db.query(
    'SELECT year, revenue_amount::float AS amount FROM client_revenues WHERE client_id::text = $1 ORDER BY year', [String(id)])).rows;
  const clientCount = async () => (await db.query('SELECT count(*)::int AS n FROM clients')).rows[0].n;
  // Who changed what (WP6): a client's history rows, oldest first, and its
  // updated_at as the API sends it (updated_at_exact)
  const changeRows = async (id) => (await db.query(
    'SELECT * FROM client_changes WHERE client_id = $1 ORDER BY id', [String(id)])).rows;
  const changeCount = async () => (await db.query('SELECT count(*)::int AS n FROM client_changes')).rows[0].n;
  const exactOf = async (id) => (await db.query(
    `SELECT ${clientChanges.updatedAtExactSql('updated_at')} AS t FROM clients WHERE id::text = $1`, [String(id)])).rows[0].t;
  const accountId = async (username = account.username) => (await db.query('SELECT id FROM users WHERE username = $1', [username])).rows[0].id;
  // The client as GET /api/data/clients lists it, which is what the page loads
  const listedClient = async (id, base = api.base, as = cookie) => (await request(base, 'GET', '/api/data/clients', { as })).body
    .clients.find((c) => String(c.id) === String(id));
  // A form body equal to what addClient stored: a save of it changes nothing
  const storedBody = (created, lead, overrides = {}) => formBody({
    name: created.name, practice_area: ['Healthcare'], conflict_risk: 'Low', notes: '', lead_id: lead.id,
    interaction_frequency: 'Monthly', stickiness: 3, revenues: [{ year: 2026, revenue_amount: 100000 }], ...overrides,
  });
  // The 409 a stale save answers, for its latest history row (or none)
  const conflictOf = (latest) => JSON.parse(JSON.stringify(clientChanges.conflictBody(latest)));
  // The body the client form sends (formatClientForAPI in src/portfolioStore.js)
  const formBody = (overrides = {}) => ({
    name: uniqueName('Form Client'),
    practice_area: ['Healthcare'],
    conflict_risk: 'Low',
    notes: 'A note',
    lead_id: null,
    second_chair_id: null,
    originator_id: null,
    originator_is_firm: false,
    interaction_frequency: 'Weekly',
    stickiness: 4,
    high_maintenance: false,
    revenues: [{ year: 2025, revenue_amount: 50000 }, { year: 2026, revenue_amount: 60000 }],
    ...overrides,
  });
  // A saved answer, written as saveAnswer writes one
  const addAnswer = async ({ kind = 'ask', question = 'A saved question?', cost = '0.1234', createdAt = null, bookSha = 'a'.repeat(64) } = {}) => (await db.query(`
    INSERT INTO ai_answers (kind, question, answer, client_id, client_name, asked_by_username, model, served_by,
                            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, prices_read_on,
                            book_sha256, reporting_year, duration_ms, created_at)
    VALUES ($1, $2, $3, $4, $5, 'contracts', 'claude-opus-5', 'claude-opus-5', 10, 20, 30, 40, $6, '2026-09-01',
            $7, 2026, 1234, COALESCE($8::timestamptz, now()))
    RETURNING id`,
  [kind, kind === 'ask' ? question : null, `The answer. ${'x'.repeat(250)}`, kind === 'transition-plan' ? '42' : null,
    kind === 'transition-plan' ? 'A client' : null, cost, bookSha, createdAt])).rows[0].id;
  // Tier 2 WP10: a partner of the test's own, whose AI budget (30 an hour,
  // per partner) no other test spends; the SHA-256 of today's book, as the
  // AI is given it; and the firm's AI budget left, from the limiters'
  // RateLimit header (the daily limiter answers last, so it is its count)
  const newPartner = async (prefix = 'thread') => {
    const partner = { username: `${prefix}-${letters(8)}`, password: generatedPassword() };
    await addAccount(env, partner);
    return { ...partner, cookie: await signIn(api.base, partner) };
  };
  const todaysBookSha = async () => createHash('sha256').update((await call('GET', '/api/ai/book')).body.text, 'utf8').digest('hex');
  const aiBudgetLeft = (res) => Number(/remaining=(\d+)/.exec(res.headers.get('ratelimit') || '')?.[1]);
  const answerCount = async () => (await db.query('SELECT count(*)::int AS n FROM ai_answers')).rows[0].n;
  // Tier 3 WP2: a connection of the test's own, standing in for another write
  // that holds row locks while a route runs. Its deadlock_timeout is long, so
  // when a deadlock forms the route's backend (the server's default, 1 s) is
  // the one PostgreSQL aborts, and the route answers for it. lockWaiters
  // counts the backends in this database waiting for a lock: the route,
  // blocked by the holder
  const lockHolder = async () => {
    const holder = new pg.Client({ connectionString: urlFor(dbName) });
    await holder.connect();
    await holder.query("SET deadlock_timeout = '10min'");
    return holder;
  };
  const lockWaiters = async () => (await db.query(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")).rows[0].n;
  // Clients whose name has `name`'s key, regardless of case (the import's rule)
  const clientsNamed = async (name) => (await db.query('SELECT id, name FROM clients WHERE LOWER(name) = LOWER($1)', [name])).rows;
  // The 400 detail for a name another client, stored as `stored`, has (Tier 3 WP2, (g))
  const nameTakenDetail = (stored) => detail('name', `Another client is already named "${stored}" (names are compared regardless of case). Give this client a different name.`);
  // A server's log line starting with `label`, and holding `marker`, once it
  // has arrived (the output comes on a pipe and can lag the answer); its JSON
  const logged = async (server, label, marker) => {
    const line = await waitFor(() => server.output.split('\n').find((l) => l.startsWith(`${label}: `) && l.includes(marker)), `the "${label}" line`);
    return JSON.parse(line.slice(label.length + 2));
  };

  // Every contract's block: its 401 without sign-in, then the route's own tests
  const route = (key, tests) => describe(key, () => {
    if (CONTRACTS[key].signIn) {
      test(`${key}: 401 { error: 'Missing token' } without sign-in`, async () => {
        const [method, path] = key.split(' ');
        const res = await request(api.base, method, path.replace(':id', '1'), {
          as: '',
          body: method === 'GET' || method === 'DELETE' ? undefined : {},
        });
        assert.deepEqual([res.status, res.body], [401, MISSING_TOKEN]);
      });
    }
    tests();
  });

  test('the tables have this run\'s id type', async () => {
    const { rows } = await db.query(`
      SELECT table_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'clients' AND column_name = 'id')
           OR (table_name = 'client_revenues' AND column_name = 'client_id'))
       ORDER BY table_name`);
    assert.deepEqual(rows, [
      { table_name: 'client_revenues', data_type: shape.idType },
      { table_name: 'clients', data_type: shape.idType },
    ]);
  });

  /* ------------------------------- /api/auth ------------------------------- */

  route('POST /api/auth/login', () => {
    // The page reads success and user (src/portfolioStore.js, login); a
    // refusal's error is shown as it is (src/LoginPage.jsx, apiErrorMessage)
    test('200 { success, user: { id, username } } and the session cookie: HttpOnly, Path=/, SameSite=Lax outside production, Max-Age the session\'s 7 days', async () => {
      const partner = { username: `login-${letters(6)}`, password: generatedPassword() };
      await addAccount(env, partner);
      const res = await request(keyless.base, 'POST', '/api/auth/login', { as: '', body: partner });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['success', 'user']);
      assert.equal(res.body.success, true);
      assert.deepEqual(keysOf(res.body.user), ['id', 'username']);
      assert.equal(res.body.user.username, partner.username);
      const [setCookie] = res.headers.getSetCookie();
      assert.match(setCookie, /^authToken=[^;]+; Max-Age=604800; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax$/);
      const me = await request(keyless.base, 'GET', '/api/auth/me', { as: cookieOf(res) });
      assert.deepEqual([me.status, me.body.user.username], [200, partner.username]);
    });

    test('400 { error } without a username or a password', async () => {
      for (const body of [{ username: account.username }, { password: account.password }]) {
        const res = await request(keyless.base, 'POST', '/api/auth/login', { as: '', body });
        assert.deepEqual([res.status, res.body], [400, { error: 'Username and password required' }], JSON.stringify(body));
        assert.deepEqual(res.headers.getSetCookie(), []);
      }
    });

    test('401 { error: "Invalid credentials" } for an unknown username and for a wrong password alike', async () => {
      for (const body of [{ username: `nobody-${letters(6)}`, password: account.password }, { username: account.username, password: 'Wrong-password-1' }]) {
        const res = await request(keyless.base, 'POST', '/api/auth/login', { as: '', body });
        assert.deepEqual([res.status, res.body], [401, { error: 'Invalid credentials' }], body.username);
        assert.deepEqual(res.headers.getSetCookie(), []);
      }
    });

    // D11: five failed sign-ins per username per 15 minutes, the username
    // case-folded; a successful one does not count. On a server of its own:
    // the limiters count in memory per process.
    test('429 after five failed sign-ins for one username in any case, even with the right password; successful ones do not count; another username still signs in', async () => {
      const server = await launch();
      try {
        const partner = { username: `limited-${letters(6)}`, password: generatedPassword() };
        const other = { username: `other-${letters(6)}`, password: generatedPassword() };
        await addAccount(env, partner);
        await addAccount(env, other);
        const login = (body) => request(server.base, 'POST', '/api/auth/login', { as: '', body });
        const wrong = (username) => login({ username, password: 'Wrong-password-1' });
        const upper = partner.username.toUpperCase();

        for (const username of [partner.username, upper]) assert.equal((await wrong(username)).status, 401);
        assert.equal((await login(partner)).status, 200, 'a success in between is not counted');
        assert.equal((await login(partner)).status, 200);
        for (const username of [upper, partner.username, upper]) assert.equal((await wrong(username)).status, 401);
        const refused = await login(partner);
        assert.deepEqual([refused.status, refused.body], [429, TOO_MANY], 'the sixth, with the right password');
        assert.deepEqual(refused.headers.getSetCookie(), []);
        assert.equal((await login(other)).status, 200, 'another username is not locked');
        // Read once the line has arrived: the output comes on a pipe and can
        // lag the answer (waitFor, constraint 8; Tier 3 WP3, candidate (i))
        const limited = await waitFor(() => {
          const lines = logLines(server, 'rate_limited');
          return lines.length > 0 && lines;
        }, 'the rate_limited line');
        assert.deepEqual(limited.map((l) => [l.limiter, l.key, l.path]),
          [['login_user', `user:${partner.username}`, '/api/auth/login']]);
      } finally {
        stop(server);
      }
    });

    // D11: twenty requests per 15 minutes per address, sign-ins and password
    // changes together. On a server of its own.
    test('429 on the 21st request from one address in 15 minutes, sign-ins and password changes counted together; then for both', async () => {
      const server = await launch();
      try {
        for (let i = 0; i < 19; i += 1) {
          const res = await request(server.base, 'POST', '/api/auth/login', { as: '', body: { username: `nobody-${letters(8)}`, password: 'x' } });
          assert.equal(res.status, 401, `request ${i + 1}`);
        }
        const change = await request(server.base, 'POST', '/api/auth/change-password', { as: '', body: {} });
        assert.equal(change.status, 401, 'the 20th: counted before the sign-in check');
        const login = await request(server.base, 'POST', '/api/auth/login', { as: '', body: account });
        assert.deepEqual([login.status, login.body], [429, TOO_MANY], 'the 21st, with the right password');
        const changeSignedIn = await request(server.base, 'POST', '/api/auth/change-password', {
          body: { currentPassword: account.password, newPassword: generatedPassword() },
        });
        assert.deepEqual([changeSignedIn.status, changeSignedIn.body], [429, TOO_MANY]);
        // Both refusals' lines, once they have arrived (waitFor, constraint 8)
        const limited = await waitFor(() => {
          const lines = logLines(server, 'rate_limited');
          return lines.length >= 2 && lines;
        }, 'two rate_limited lines');
        assert.deepEqual([...new Set(limited.map((l) => l.limiter))], ['login_ip']);
      } finally {
        stop(server);
      }
    });
  });

  route('POST /api/auth/logout', () => {
    // The page reads nothing from it (src/portfolioStore.js, logout)
    test('200 { success, message } without sign-in, clearing the cookie with the attributes it was set with', async () => {
      const res = await request(keyless.base, 'POST', '/api/auth/logout', { as: '' });
      assert.deepEqual([res.status, res.body], [200, { success: true, message: 'Logged out successfully' }]);
      const [setCookie] = res.headers.getSetCookie();
      assert.match(setCookie, /^authToken=; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax$/);
    });

    // Pinned, not a new finding: the session is a stateless JWT (CLAUDE.md,
    // "Passwords"), so logout clears the browser's cookie and revokes nothing
    test('the session\'s token still signs in after logout: logout revokes nothing', async () => {
      const res = await request(keyless.base, 'POST', '/api/auth/logout');
      assert.equal(res.status, 200);
      const me = await request(keyless.base, 'GET', '/api/auth/me');
      assert.deepEqual([me.status, me.body.user.username], [200, account.username]);
    });
  });

  route('GET /api/auth/me', () => {
    // The page reads user (src/portfolioStore.js, checkAuth); no success key
    test('200 { user: { id, username } } for the signed-in partner', async () => {
      const res = await request(keyless.base, 'GET', '/api/auth/me');
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['user']);
      assert.deepEqual(keysOf(res.body.user), ['id', 'username']);
      assert.equal(res.body.user.username, account.username);
    });

    test('401 { error: "Invalid token" } for a token this server did not sign, and for an expired one', async () => {
      const { user } = (await request(keyless.base, 'GET', '/api/auth/me')).body;
      const claims = { userId: user.id, username: user.username };
      const tokens = {
        garbage: 'not-a-token',
        otherSecret: jwt.sign(claims, randomBytes(32).toString('hex'), { expiresIn: '1h' }),
        expired: jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 }, env.JWT_SECRET),
      };
      for (const [what, token] of Object.entries(tokens)) {
        const res = await request(keyless.base, 'GET', '/api/auth/me', { as: `authToken=${token}` });
        assert.deepEqual([res.status, res.body], [401, INVALID_TOKEN], what);
      }
      // The header the middleware still accepts (middleware/auth.cjs)
      const bearer = await request(keyless.base, 'GET', '/api/auth/me', { as: '', headers: { Authorization: `Bearer ${tokens.expired}` } });
      assert.deepEqual([bearer.status, bearer.body], [401, INVALID_TOKEN]);
    });

    test('404 { error: "User not found" } for a session whose account no longer exists', async () => {
      const ghost = jwt.sign({ userId: 2147483000, username: 'ghost' }, env.JWT_SECRET, { expiresIn: '1h' });
      const res = await request(keyless.base, 'GET', '/api/auth/me', { as: `authToken=${ghost}` });
      assert.deepEqual([res.status, res.body], [404, { error: 'User not found' }]);
    });
  });

  route('POST /api/auth/change-password', () => {
    // The page reads error on a refusal (src/ChangePasswordDialog.jsx, apiErrorMessage)
    test('200 { success: true }; the new password signs in and the old one no longer does', async () => {
      const partner = { username: `change-${letters(6)}`, password: generatedPassword() };
      await addAccount(env, partner);
      const session = await signIn(keyless.base, partner);
      const newPassword = generatedPassword();
      const res = await request(keyless.base, 'POST', '/api/auth/change-password', {
        as: session, body: { currentPassword: partner.password, newPassword },
      });
      assert.deepEqual([res.status, res.body], [200, { success: true }]);
      const login = (password) => request(keyless.base, 'POST', '/api/auth/login', { as: '', body: { username: partner.username, password } });
      assert.equal((await login(newPassword)).status, 200);
      assert.equal((await login(partner.password)).status, 401);
    });

    test('400 without the current password, and with the policy\'s errors for a weak new one', async () => {
      const passwordHash = async () => (await db.query('SELECT password_hash FROM users WHERE username = $1', [account.username])).rows[0].password_hash;
      const stored = await passwordHash();
      let res = await request(keyless.base, 'POST', '/api/auth/change-password', { body: { newPassword: generatedPassword() } });
      assert.deepEqual([res.status, res.body], [400, { success: false, error: 'Current password is required' }]);
      res = await request(keyless.base, 'POST', '/api/auth/change-password', { body: { currentPassword: account.password, newPassword: 'short' } });
      assert.equal(res.status, 400);
      assert.deepEqual(keysOf(res.body), ['error', 'errors', 'success']);
      assert.deepEqual(res.body.errors, [
        'Password must be at least 8 characters long',
        'Password must contain at least one uppercase letter',
        'Password must contain at least one number',
        'Password must contain at least one special character',
      ]);
      assert.equal(res.body.error, `${res.body.errors.join('. ')}.`);
      assert.equal(await passwordHash(), stored, 'nothing changed');
    });

    test('401 { success: false, error } when the current password is wrong; the password is unchanged', async () => {
      const passwordHash = async () => (await db.query('SELECT password_hash FROM users WHERE username = $1', [account.username])).rows[0].password_hash;
      const stored = await passwordHash();
      const res = await request(keyless.base, 'POST', '/api/auth/change-password', {
        body: { currentPassword: 'Wrong-password-1', newPassword: generatedPassword() },
      });
      assert.deepEqual([res.status, res.body], [401, { success: false, error: 'Current password is incorrect' }]);
      assert.equal(await passwordHash(), stored);
    });

    test('404 { success: false, error: "User not found" } for a session whose account no longer exists', async () => {
      const ghost = jwt.sign({ userId: 2147483000, username: 'ghost' }, env.JWT_SECRET, { expiresIn: '1h' });
      const res = await request(keyless.base, 'POST', '/api/auth/change-password', {
        as: `authToken=${ghost}`, body: { currentPassword: 'Anything-1', newPassword: generatedPassword() },
      });
      assert.deepEqual([res.status, res.body], [404, { success: false, error: 'User not found' }]);
    });
  });

  /* ------------------------------- /api/data ------------------------------- */

  route('POST /api/data/process-csv', () => {
    // The page reads (src/DataUploadManager.jsx): success, clients.length,
    // summary.totalRevenue, summary.revenueYears, summary.revenueTotals,
    // summary.sheetColumns, validation.issues and validation.warnings; for
    // Check file, dryRun and summary.totalClients
    test('200 { success, clients, validation, summary } with the summary the upload page reads', async () => {
      const name = uniqueName('Sheet Client');
      const res = await call('POST', '/api/data/process-csv', {
        csvData: [{ CLIENT: name, '2025 Contracts': '$1,000', '2026 Contracts': '$2,500', Lead: 'Kevin' }],
      });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['clients', 'success', 'summary', 'validation']);
      assert.equal(res.body.success, true);
      assert.equal(res.body.clients.length, 1);
      // changedClients from Tier 2 WP6: the stored clients the file changed
      assert.deepEqual(keysOf(res.body.summary), [
        'changedClients', 'newClients', 'revenueTotals', 'revenueYears', 'sheetColumns', 'totalClients', 'totalRevenue', 'updatedClients',
      ]);
      assert.deepEqual(res.body.summary.revenueYears, [2025, 2026]);
      assert.deepEqual(res.body.summary.revenueTotals, { 2025: 1000, 2026: 2500 });
      assert.deepEqual(res.body.summary.sheetColumns, ['Lead']);
      assert.equal(typeof res.body.summary.totalRevenue, 'number');
      assert.deepEqual([res.body.summary.newClients, res.body.summary.updatedClients, res.body.summary.changedClients, res.body.summary.totalClients], [1, 0, 0, 1]);
      assert.deepEqual(keysOf(res.body.validation), ['clientCount', 'isValid', 'issues', 'validClients', 'warnings']);
      assert.deepEqual([res.body.validation.issues, res.body.validation.warnings], [[], []]);
      const { rows } = await db.query('SELECT id FROM clients WHERE name = $1', [name]);
      assert.equal(rows.length, 1);
      assert.deepEqual(await revenueRows(rows[0].id), [{ year: 2025, amount: 1000 }, { year: 2026, amount: 2500 }]);
    });

    // Tier 3 WP13 (U43 (b)): the downloaded book sheet writes each client's
    // areas as stored, a retired name among them, and imports; a new name
    // imports too (refused by the API before WP13). Matched regardless of case
    test('200: a Practice Area cell with a retired name and new names, Check file then Upload; stored as the server spells them', async () => {
      const kevin = await seed('Kevin');
      const held = await addClient({ lead: kevin });
      await db.query("UPDATE clients SET practice_area = ARRAY['Environmental'] WHERE id::text = $1", [String(held.id)]);
      const csvData = [
        { CLIENT: held.name, '2026 Contracts': '100000', Lead: 'Kevin', 'Practice Area': 'Environmental' },
        { CLIENT: uniqueName('Tagged Client'), '2026 Contracts': '5000', Lead: 'Kevin', 'Practice Area': 'human services;Justice and Legal;non-profit' },
      ];
      const checked = await call('POST', '/api/data/process-csv', { csvData, dryRun: true });
      assert.equal(checked.status, 200, checked.text);
      assert.deepEqual([checked.body.dryRun, checked.body.summary.totalClients], [true, 2]);
      const res = await call('POST', '/api/data/process-csv', { csvData });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual([res.body.summary.updatedClients, res.body.summary.changedClients, res.body.summary.newClients], [1, 0, 1]);
      assert.deepEqual((await storedClient(held.id)).practice_area, ['Environmental'], 'the retired name, unchanged and not written');
      const { rows: [created] } = await db.query('SELECT practice_area FROM clients WHERE name = $1', [csvData[1].CLIENT]);
      assert.deepEqual(created.practice_area, ['Human Services', 'Justice and Legal', 'Non-Profit']);
    });

    test('Check file (dryRun: true): 200 { success, dryRun, validation, summary }, no clients, nothing written', async () => {
      const name = uniqueName('Checked Client');
      const before = await clientCount();
      const res = await call('POST', '/api/data/process-csv', { csvData: [{ CLIENT: name, '2026 Contracts': '$9,000' }], dryRun: true });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['dryRun', 'success', 'summary', 'validation']);
      assert.deepEqual([res.body.success, res.body.dryRun, res.body.summary.totalClients, res.body.summary.newClients], [true, true, 1, 1]);
      assert.equal(await clientCount(), before);
    });

    // Tier 2 WP6 (S9): until then every matched client was rewritten, its
    // updated_at moved, by any import; now only the clients the file changes
    // are written, and each is logged as `import`
    test('an import logs only the clients it changes or creates, as `import`, and does not write a client the file leaves as it is (updated_at unchanged)', async () => {
      const kevin = await seed('Kevin');
      const joe = await seed('Joe');
      const same = await addClient({ lead: kevin, revenues: { 2025: 1000, 2026: 2000 } });
      const changed = await addClient({ lead: kevin, revenues: { 2025: 1000, 2026: 2000 } });
      // updated_at as stored before, and what makes a no-op: '' notes and a
      // blank cadence cell against NULL, an unordered practice area
      await db.query("UPDATE clients SET notes = NULL, practice_area = ARRAY['Healthcare', 'Energy'] WHERE id::text = ANY($1)", [[String(same.id), String(changed.id)]]);
      const before = { same: await storedClient(same.id), changed: await storedClient(changed.id) };
      const created = uniqueName('Imported Client');
      const logged = await changeCount();
      const res = await call('POST', '/api/data/process-csv', { csvData: [
        { CLIENT: same.name, '2025 Contracts': '$1,000.00', '2026 Contracts': '2000', Lead: 'Kevin', 'Practice Area': 'Energy; Healthcare', Notes: '' },
        { CLIENT: changed.name, '2025 Contracts': '$1,000', '2026 Contracts': '$2,500', Lead: 'Joe', 'Practice Area': 'Energy; Healthcare', Notes: 'New note' },
        { CLIENT: created, '2025 Contracts': '', '2026 Contracts': '$700', Lead: 'Joe', 'Practice Area': '', Notes: '' },
      ] });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual([res.body.summary.updatedClients, res.body.summary.changedClients, res.body.summary.newClients], [2, 1, 1]);
      assert.deepEqual(res.body.summary.revenueTotals, { 2025: 2000, 2026: 5200 }, 'every client the file names, written or not');
      assert.deepEqual(await storedClient(same.id), before.same, 'not written: updated_at and updated_by as they were');
      assert.deepEqual(await changeRows(same.id), []);
      assert.equal(await changeCount(), logged + 2);

      const [row] = await changeRows(changed.id);
      assert.deepEqual([row.source, row.client_name, row.changed_by, row.changed_by_username], ['import', changed.name, await accountId(), account.username]);
      assert.deepEqual(row.changes, {
        lead_id: { from: { id: kevin.id, name: 'Kevin' }, to: { id: joe.id, name: 'Joe' } },
        notes: { from: null, to: 'New note' },
        revenue: { 2026: { from: 2000, to: 2500 } },
      });
      const after = await storedClient(changed.id);
      assert.notDeepEqual(after.updated_at, before.changed.updated_at);
      assert.equal(after.updated_by, await accountId());

      const { rows: [newClient] } = await db.query('SELECT * FROM clients WHERE name = $1', [created]);
      assert.equal(newClient.updated_by, await accountId());
      const [creation] = await changeRows(newClient.id);
      assert.equal(creation.source, 'import');
      assert.deepEqual(creation.changes.name, { from: null, to: created });
      assert.deepEqual(creation.changes.lead_id, { from: null, to: { id: joe.id, name: 'Joe' } });
      assert.deepEqual(creation.changes.revenue, { 2026: { from: null, to: 700 } });
      assert.equal('notes' in creation.changes, false, 'a blank note is none');
    });

    test('Check file logs nothing: the rows it would log are rolled back with its writes', async () => {
      const kevin = await seed('Kevin');
      const existing = await addClient({ lead: kevin });
      const before = { client: await storedClient(existing.id), changes: await changeCount() };
      const res = await call('POST', '/api/data/process-csv', {
        csvData: [{ CLIENT: existing.name, '2026 Contracts': '$5', Stickiness: '5' }, { CLIENT: uniqueName('Checked New'), '2026 Contracts': '$9' }],
        dryRun: true,
      });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual([res.body.summary.updatedClients, res.body.summary.changedClients, res.body.summary.newClients], [1, 1, 1]);
      assert.equal(await changeCount(), before.changes);
      assert.deepEqual(await storedClient(existing.id), before.client);
    });

    // The request check (csvValidationRules). Until Tier 2 WP2 each detail
    // lacked `field`: handleCSVValidationErrors read error.param, which
    // express-validator 7 renamed error.path (docs/plans/tier-2.md, section 3
    // item 6). The page shows details[].message (src/DataUploadManager.jsx).
    // Until Tier 3 WP2 each detail also carried `value`, for csvData the
    // whole file, notes included
    test('400 { error, details: [{ field, message }] } from the request check: no rows, a row without CLIENT, dryRun not a boolean; nothing written', async () => {
      const before = await clientCount();
      const refusals = [
        [{ csvData: [] }, 'csvData', 'CSV data must be a non-empty array'],
        [{ csvData: 'CLIENT\nx' }, 'csvData', 'CSV data must be a non-empty array'],
        [{ csvData: [{ '2026 Contracts': '$1' }] }, 'csvData', 'Row 2: CLIENT is required and must be a non-empty string'],
        [{ csvData: [{ CLIENT: 'Fine Client' }], dryRun: 'true' }, 'dryRun', 'dryRun must be true or false'],
        // An entity typed in CLIENT: decoded before the pattern until WP5 (and
        // imported as O'Brien Trust); checked as typed since, like the form
        [{ csvData: [{ CLIENT: 'O&#x27;Brien Trust' }] }, 'csvData', 'Row 2: CLIENT contains invalid characters'],
      ];
      for (const [body, field, message] of refusals) {
        const res = await call('POST', '/api/data/process-csv', body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.deepEqual(keysOf(res.body), ['details', 'error']);
        assert.equal(res.body.error, 'CSV validation failed');
        assert.ok(res.body.details.some((d) => d.field === field && d.message === message), `${JSON.stringify(body)}: ${JSON.stringify(res.body.details)}`);
        for (const detail of res.body.details) assert.deepEqual(keysOf(detail), ['field', 'message'], JSON.stringify(detail));
      }
      // A file the check refuses is not sent back: its notes stay out of the answer
      const note = `Private note ${letters(12)}`;
      const res = await call('POST', '/api/data/process-csv', { csvData: [{ CLIENT: 'Acme; Inc', Notes: note }] });
      assert.equal(res.status, 400, res.text);
      assert.ok(!res.text.includes(note), 'the file is not echoed');
      assert.equal(await clientCount(), before);
    });

    // Tier 3 WP2, candidate (w): until then the import stored an amount the
    // client form refuses, and from 10,000,000,000 up it failed in
    // client_revenues.revenue_amount, NUMERIC(12, 2): a 500
    test('400 { success: false, error, errors } for an amount over 1,000,000,000, the client form\'s limit, by row; nothing written, Check file the same; 1,000,000,000 itself imports', async () => {
      const over = uniqueName('Over Client');
      const huge = uniqueName('Huge Client');
      const before = { count: await clientCount(), changes: await changeCount() };
      const csvData = [
        { CLIENT: over, '2025 Contracts': '$1,000', '2026 Contracts': '$1,000,000,001' },
        { CLIENT: huge, '2025 Contracts': '', '2026 Contracts': '$10,000,000,000' },
      ];
      const refusal = [400, {
        success: false,
        error: 'Nothing was imported: the file has 2 problems. Fix the rows below and upload it again.',
        errors: [
          { row: 2, client: over, message: "2026 Contracts is 1,000,000,001: a year's revenue can be at most 1,000,000,000, as on the client form." },
          { row: 3, client: huge, message: "2026 Contracts is 10,000,000,000: a year's revenue can be at most 1,000,000,000, as on the client form." },
        ],
      }];
      for (const dryRun of [false, true]) {
        const res = await call('POST', '/api/data/process-csv', { csvData, dryRun });
        assert.deepEqual([res.status, res.body], refusal, `dryRun ${dryRun}`);
      }
      assert.deepEqual([await clientCount(), await changeCount()], [before.count, before.changes]);
      assert.deepEqual([...await clientsNamed(over), ...await clientsNamed(huge)], []);
      // The limit itself, as the form allows it
      const edge = uniqueName('Edge Client');
      const res = await call('POST', '/api/data/process-csv', { csvData: [{ CLIENT: edge, '2026 Contracts': '$1,000,000,000' }] });
      assert.equal(res.status, 200, res.text);
      const [stored] = await clientsNamed(edge);
      assert.deepEqual(await revenueRows(stored.id), [{ year: 2026, amount: 1e9 }]);
      // Gone again, so the book's totals are the other tests' own
      await db.query('DELETE FROM clients WHERE id::text = $1', [String(stored.id)]);
    });

    // Tier 3 WP2, candidate (g): the import creates a client for a name no
    // stored client has, and takes the client-name lock before reading the
    // stored names, as the form's POST does before its check. Until WP2
    // neither checked, and the two could each create one
    test('an import and a POST of one new name at once leave one client of that name: whichever runs second finds the first', async () => {
      const kevin = await seed('Kevin');
      for (let round = 0; round < 3; round += 1) {
        const name = uniqueName('Raced Import');
        const [imported, posted] = await Promise.all([
          call('POST', '/api/data/process-csv', { csvData: [{ CLIENT: name, '2026 Contracts': '$1,000', Lead: 'Kevin' }] }),
          call('POST', '/api/data/clients', formBody({ name: name.toUpperCase(), lead_id: kevin.id })),
        ]);
        assert.equal(imported.status, 200, imported.text);
        const stored = await clientsNamed(name);
        assert.equal(stored.length, 1, `round ${round}: ${stored.map((c) => c.name)}`);
        const { newClients, updatedClients } = imported.body.summary;
        if (posted.status === 201) {
          // The POST first: the import found it and updated it
          assert.deepEqual([newClients, updatedClients], [0, 1], `round ${round}`);
          assert.equal(String(stored[0].id), String(posted.body.client.id));
        } else {
          // The import first: the POST found its client
          assert.deepEqual([posted.status, posted.body], [400, failed(nameTakenDetail(name))], `round ${round}`);
          assert.deepEqual([newClients, updatedClients], [1, 0], `round ${round}`);
        }
      }
    });

    // Tier 3 WP10, candidate (aa): until then the import locked the stored
    // clients its file names in the table's scan order (no ORDER BY), while a
    // rename (PUT /api/people/:id) locks the clients it rewrites in id order,
    // so an import without a Lead column (which reads no person) and a rename
    // of a person seated on two of the file's clients, at the same moment,
    // deadlocked whenever the scan met the higher id first: PostgreSQL
    // aborted the import (40P01), a 500 with nothing written. The scan's order
    // is the heap's, and an update of a row moves it behind every row inserted
    // since: the test sets that trap, the lower id updated after the higher
    // was inserted, and checks it before the round, or it would prove nothing.
    // The holder is the rename, statement by statement (routes/people.cjs);
    // what the import holds while it waits is read with FOR UPDATE NOWAIT
    // (55P03 until WP10: the second client), then the rename's next lock,
    // which deadlocked. With a Lead column the import reads the People list
    // FOR SHARE first and waits there, as it always did: kept as the contract
    for (const lead of [false, true]) {
      test(`an import ${lead ? 'with' : 'without'} a Lead column while a person seated on two of its clients is being renamed waits for the rename, then writes both: 200, one \`import\` row each, nothing held while it waits`, async () => {
        const person = await addPerson('partner', 'Renamed Lead');
        const a = await addClient({ lead: person, revenues: { 2026: 100000 } });
        const b = await addClient({ lead: person, revenues: { 2026: 100000 } });
        const ids = [String(a.id), String(b.id)];
        // The rename's order is the id's; the trap is the first by id updated
        // after the second was inserted, so a read without ORDER BY meets the
        // second first (checked; a second update is tried if a page was full)
        const { rows: byId } = await db.query('SELECT id FROM clients WHERE id::text = ANY($1) ORDER BY id', [ids]);
        const [first, second] = byId.map((r) => String(r.id));
        const scanOrder = async () => (await db.query('SELECT id FROM clients WHERE LOWER(name) = ANY($1)', [[a.name, b.name].map((n) => n.toLowerCase())])).rows.map((r) => String(r.id));
        for (let attempt = 0; attempt < 3 && (await scanOrder())[0] !== second; attempt += 1) {
          await db.query("UPDATE clients SET notes = $2 WHERE id::text = $1", [first, `moved to the end of the heap ${attempt}`]);
        }
        assert.deepEqual(await scanOrder(), [second, first], 'the trap: a scan without ORDER BY meets the second id first');
        const outputBefore = api.output.length;
        const holder = await lockHolder();
        let held;
        try {
          await holder.query('BEGIN');
          await holder.query('SELECT id FROM people WHERE id = $1 FOR NO KEY UPDATE', [person.id]);
          await holder.query('SELECT id FROM clients WHERE id::text = $1 FOR UPDATE', [first]);
          const importing = call('POST', '/api/data/process-csv', {
            csvData: [a, b].map((c) => ({ CLIENT: c.name, '2026 Contracts': '$1,000', ...(lead ? { Lead: person.name } : {}) })),
          });
          await waitFor(async () => (await lockWaiters()) > 0, 'the import to wait');
          await holder.query('SAVEPOINT held');
          held = await holder.query('SELECT id FROM clients WHERE id::text = $1 FOR UPDATE NOWAIT', [second]).then(() => null, (e) => e.code);
          await holder.query('ROLLBACK TO SAVEPOINT held');
          // The rename's next lock, in id order: immediate now; the deadlock until WP10
          await holder.query('SELECT id FROM clients WHERE id::text = $1 FOR UPDATE', [second]);
          await holder.query('ROLLBACK');
          const res = await importing;
          assert.equal(res.status, 200, res.text);
          assert.deepEqual([res.body.summary.updatedClients, res.body.summary.changedClients, res.body.summary.newClients], [2, 2, 0]);
        } finally {
          await holder.query('ROLLBACK').catch(() => {});
          await holder.end();
        }
        assert.equal(held, null, 'the import holds no client while it waits (55P03 until WP10)');
        assert.ok(!api.output.slice(outputBefore).includes('40P01'), 'no deadlock logged');
        for (const c of [a, b]) {
          assert.deepEqual(await revenueRows(c.id), [{ year: 2026, amount: 1000 }]);
          assert.deepEqual((await changeRows(c.id)).map((r) => [r.source, r.changes.revenue]), [['import', { 2026: { from: 100000, to: 1000 } }]]);
        }
      });
    }

    // Until WP5 every cell arrived escaped by the request sanitizer and was
    // decoded again (decodeHTMLEntities), which also decoded an entity typed
    // in a cell (`&#169;` became ©), and CLIENT's length was checked escaped
    // (docs/plans/tier-2.md, WP5)
    test('a sheet\'s cells are stored as typed: &, \' and / in CLIENT, < and a literal entity in Notes, trimmed; a CLIENT the form allows imports up to 255 characters however many & it holds', async () => {
      const name = uniqueName("Smith & O'Brien /");
      const long = `${'&'.repeat(50)}${letters(20)}`;
      const notes = 'Copyright &#169; 2026, R&D < 5% of "budget"';
      const res = await call('POST', '/api/data/process-csv', { csvData: [
        { CLIENT: ` ${name} `, '2026 Contracts': '$1,000', Notes: `  ${notes} ` },
        { CLIENT: long, '2026 Contracts': '$500', Notes: '' },
      ] });
      assert.equal(res.status, 200, res.text);
      // Sorted here, not by ORDER BY: the database's collation decides where
      // `&` sorts (C puts it first, glibc's en_US, CI's, ignores it)
      const byName = (a, b) => (a.name < b.name ? -1 : 1);
      const { rows } = await db.query('SELECT name, notes FROM clients WHERE name = ANY($1)', [[name, long]]);
      assert.deepEqual(rows.sort(byName), [{ name: long, notes: '' }, { name, notes }].sort(byName));
    });

    // The page lists errors by row (src/DataUploadManager.jsx)
    test('400 { success: false, error, errors: [{ row, client, message }] } for a sheet with a problem; nothing written', async () => {
      const name = uniqueName('Refused Client');
      const before = await clientCount();
      const res = await call('POST', '/api/data/process-csv', { csvData: [{ CLIENT: name, '2026 Contracts': '$1', Lead: 'Nobody Here' }] });
      assert.deepEqual([res.status, res.body], [400, {
        success: false,
        error: 'Nothing was imported: the file has 1 problem. Fix the rows below and upload it again.',
        errors: [{ row: 2, client: name, message: 'Lead "Nobody Here" is not on the People list.' }],
      }]);
      assert.equal(await clientCount(), before);
    });
  });

  route('GET /api/data/clients', () => {
    // The page reads clients (src/portfolioStore.js, fetchClients), and on
    // each client the keys in CLIENT_KEYS_THE_PAGE_READS
    test('200 { success, clients }: each client with the fields the page reads, its people nested, revenue by year, no status', async () => {
      const kevin = await seed('Kevin');
      const jay = await seed('Jay');
      const created = await addClient({ lead: kevin, second: jay, originator: jay, firm: true, revenues: { 2025: 40000, 2026: 55000 } });
      const res = await call('GET', '/api/data/clients');
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['clients', 'success']);
      assert.ok(res.body.clients.length >= 1);
      for (const client of res.body.clients) {
        for (const key of CLIENT_KEYS_THE_PAGE_READS) assert.ok(key in client, `${client.name}: ${key}`);
        for (const person of [client.lead, client.secondChair, client.originator]) {
          if (person !== null) assert.deepEqual(keysOf(person), NESTED_PERSON_KEYS, client.name);
        }
        assert.equal('status' in client, false, 'contract status is retired (P13)');
      }
      const client = res.body.clients.find((c) => String(c.id) === String(created.id));
      assert.equal(typeof client.id, shape.idType === 'integer' ? 'number' : 'string');
      assert.deepEqual(client.lead, { id: kevin.id, name: 'Kevin', role: 'partner', active: true });
      assert.deepEqual(client.secondChair, { id: jay.id, name: 'Jay', role: 'emeritus', active: true });
      assert.deepEqual(client.originator, { id: jay.id, name: 'Jay', role: 'emeritus', active: true });
      assert.deepEqual([client.lead_id, client.second_chair_id, client.originator_id, client.originator_is_firm], [kevin.id, jay.id, jay.id, true]);
      assert.deepEqual([client.primary_lobbyist, client.lobbyist_team, client.client_originator], ['Kevin', ['Kevin', 'Jay'], 'Firm']);
      assert.deepEqual(client.revenues.map((r) => [r.year, Number(r.revenue_amount)]), [[2025, 40000], [2026, 55000]]);
      assert.deepEqual(client.revenue, { 2025: 40000, 2026: 55000 });
      assert.deepEqual([client.practiceArea, client.practice_area], [['Healthcare'], ['Healthcare']]);
      assert.equal(client.effort, 2, 'Monthly');
      for (const key of ['strategicValue', 'stickinessScore']) assert.equal(typeof client[key], 'number', key);
      // WP7 (S11): the succession metrics, the server's (utils/succession.cjs)
      // for every client. This one has a second chair and Stickiness 3 (5 of
      // 10): secondary; Monthly, 0.8; 2 + 1 + 0.3 = 3.3. Until Tier 3 WP13
      // (U41) its Healthcare added 1.5: 2.3 (2) and 3.6 (4)
      for (const each of res.body.clients) assert.deepEqual(metricsOf(each), succession.successionMetrics(each), each.name);
      assert.deepEqual(metricsOf(client), { relationshipType: 'secondary', transitionComplexity: 1, successionRisk: 3 });
      // WP6: updated_at to the microsecond as PostgreSQL holds it (the page
      // sends it back as expected_updated_at), and who saved last (c.*)
      assert.match(client.updated_at_exact, EXACT);
      assert.equal(client.updated_at_exact, await exactOf(created.id));
      assert.equal(client.updated_by, null, 'written by the test, not through the API');
    });

    test('a client without a lead has null people and its stored legacy text', async () => {
      const created = await addClient();
      await db.query("UPDATE clients SET primary_lobbyist = 'Old Text', lobbyist_team = ARRAY['Old Text'] WHERE id::text = $1", [String(created.id)]);
      const { body } = await call('GET', '/api/data/clients');
      const client = body.clients.find((c) => String(c.id) === String(created.id));
      assert.deepEqual([client.lead, client.secondChair, client.originator], [null, null, null]);
      assert.deepEqual([client.primary_lobbyist, client.lobbyist_team], ['Old Text', ['Old Text']]);
      // WP7 (S11 rule 1): no lead is orphaned, whatever the legacy text says
      // (until WP7 the page read primary_lobbyist and called it secondary)
      assert.equal(client.relationshipType, 'orphaned');
      assert.equal(client.successionRisk, 6, '5 + 1 (Stickiness 3) + 0.3 (complexity 1; 2, so 7, until Tier 3 WP13)');
    });
  });

  route('POST /api/data/clients', () => {
    // The page reads client (src/portfolioStore.js, addClient) and, on a 400,
    // details[].field and details[].message (src/ClientEnhancementForm.jsx,
    // through formErrors in src/utils/clientForm.js)
    test('201 { success, client }: the client as GET lists it, its people from the ids and the legacy text written from them', async () => {
      const paula = await seed('Paula');
      const jay = await seed('Jay');
      const body = formBody({ lead_id: paula.id, second_chair_id: jay.id, originator_id: paula.id, status: 'Former' });
      const res = await call('POST', '/api/data/clients', body);
      assert.equal(res.status, 201, res.text);
      assert.deepEqual(keysOf(res.body), ['client', 'success']);
      const { client } = res.body;
      assert.equal(client.name, body.name);
      assert.deepEqual([client.lead.name, client.secondChair.name, client.originator.name], ['Paula', 'Jay', 'Paula']);
      assert.deepEqual(client.revenue, { 2025: 50000, 2026: 60000 });
      assert.equal('status' in client, false);
      const listed = (await call('GET', '/api/data/clients')).body.clients.find((c) => String(c.id) === String(client.id));
      assert.deepEqual(keysOf(client), keysOf(listed), 'the same fields as GET');
      const stored = await storedClient(client.id);
      assert.deepEqual([stored.primary_lobbyist, stored.lobbyist_team, stored.client_originator], ['Paula', ['Paula', 'Jay'], 'Paula']);
      // WP6: logged once as `form`, every field it was given from none, by
      // this account, which is also its updated_by
      assert.equal(stored.updated_by, await accountId());
      assert.equal(client.updated_at_exact, await exactOf(client.id));
      const rows = await changeRows(client.id);
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].source, rows[0].client_name, rows[0].changed_by, rows[0].changed_by_username],
        ['form', body.name, await accountId(), account.username]);
      assert.deepEqual(rows[0].changes, {
        name: { from: null, to: body.name },
        lead_id: { from: null, to: { id: paula.id, name: 'Paula' } },
        second_chair_id: { from: null, to: { id: jay.id, name: 'Jay' } },
        originator_id: { from: null, to: { id: paula.id, name: 'Paula' } },
        originator_is_firm: { from: null, to: false },
        stickiness: { from: null, to: 4 },
        interaction_frequency: { from: null, to: 'Weekly' },
        high_maintenance: { from: null, to: false },
        conflict_risk: { from: null, to: 'Low' },
        practice_area: { from: null, to: ['Healthcare'] },
        notes: { from: null, to: 'A note' },
        revenue: { 2025: { from: null, to: 50000 }, 2026: { from: null, to: 60000 } },
      });
    });

    test('400 { success: false, error: "Validation failed", details: [{ field, message }] } for each rule on the people; nothing written', async () => {
      const kevin = await seed('Kevin');
      const associate = await addPerson('associate', 'Contract Associate');
      const inactive = await addPerson('associate', 'Contract Inactive');
      await db.query('UPDATE people SET active = false WHERE id = $1', [inactive.id]);
      const before = await clientCount();
      const refusals = [
        [{}, [{ field: 'lead_id', message: 'Choose a lead partner.' }]],
        [{ lead_id: associate.id }, [{ field: 'lead_id', message: 'The lead must be an active partner.' }]],
        [{ lead_id: 2147483000 }, [{ field: 'lead_id', message: 'The lead must be an active partner.' }]],
        [{ lead_id: kevin.id, second_chair_id: kevin.id }, [{ field: 'second_chair_id', message: 'The second chair cannot be the lead.' }]],
        [{ lead_id: kevin.id, second_chair_id: inactive.id }, [{ field: 'second_chair_id', message: 'The second chair must be an active person on the People list.' }]],
        [{ lead_id: kevin.id, originator_id: 2147483000 }, [{ field: 'originator_id', message: 'The originator must be on the People list.' }]],
      ];
      const logged = await changeCount();
      for (const [people, details] of refusals) {
        const res = await call('POST', '/api/data/clients', formBody(people));
        assert.deepEqual([res.status, res.body], [400, { success: false, error: 'Validation failed', details }], JSON.stringify(people));
      }
      assert.equal(await clientCount(), before);
      assert.equal(await changeCount(), logged, 'a refused write logs nothing (WP6)');
    });

    // Until Tier 2 WP4 only the people were checked (docs/plans/tier-2.md,
    // section 3 item 6): a body without a name reached the INSERT and failed
    // there (500), and every other field was stored as sent. The fields are
    // checked now (utils/clientRules.cjs), before the people.
    test('400 "Validation failed" with details for each rule on the name: missing, blank, not text, too long, outside the form\'s pattern; nothing written', async () => {
      const lead = await seed('Kevin');
      const before = await clientCount();
      for (const [what, fields, details] of FIELD_REFUSALS.name) {
        const res = await call('POST', '/api/data/clients', formBody({ lead_id: lead.id, ...fields }));
        assert.deepEqual([res.status, res.body], [400, failed(details)], what);
      }
      assert.equal(await clientCount(), before);
    });

    test('a name the form allows is stored as typed up to 255 characters, however many &, \' and / it holds (400 over 255 once escaped until WP5, 500 until WP4)', async () => {
      const lead = await seed('Kevin');
      for (const name of [`${LONG_ONCE_ESCAPED}${letters(8)}`, `${'&'.repeat(246)}${letters(9)}`]) {
        const res = await call('POST', '/api/data/clients', formBody({ name, lead_id: lead.id }));
        assert.equal(res.status, 201, res.text);
        assert.equal(res.body.client.name, name);
        assert.equal((await storedClient(res.body.client.id)).name, name);
      }
    });

    test('a name with &, \' and /, a note with < and every text field are stored exactly as typed, trimmed as before; sent escaped, as stored before WP5, the name is refused and nothing written', async () => {
      const lead = await seed('Kevin');
      const typed = `Smith & O'Brien / ${letters(8)}`;
      const note = 'R&D < 5% of "budget"; <b>not a tag</b> \\ `x`';
      let res = await call('POST', '/api/data/clients', formBody({ name: typed, notes: note, lead_id: lead.id }));
      assert.equal(res.status, 201, res.text);
      const row = await storedClient(res.body.client.id);
      assert.deepEqual([row.name, row.notes], [typed, note], 'stored as typed (escaped until WP5)');
      assert.deepEqual([res.body.client.name, res.body.client.notes], [typed, note]);
      // Every string trimmed before the checks, as the request sanitizer trimmed it
      const padded = `  ${uniqueName('Padded Client')} `;
      res = await call('POST', '/api/data/clients', formBody({
        name: padded, notes: `  ${note}\n`, lead_id: lead.id,
        practice_area: [' Healthcare '], conflict_risk: ' Low', interaction_frequency: 'Weekly ',
      }));
      assert.equal(res.status, 201, res.text);
      const trimmed = await storedClient(res.body.client.id);
      assert.deepEqual([trimmed.name, trimmed.notes, trimmed.practice_area, trimmed.conflict_risk, trimmed.interaction_frequency],
        [padded.trim(), note, ['Healthcare'], 'Low', 'Weekly']);
      // As a direct request can send it: the text as stored before WP5
      const before = await clientCount();
      const escaped = `Smith &amp; O&#x27;Brien &#x2F; ${letters(8)}`;
      res = await call('POST', '/api/data/clients', formBody({ name: escaped, lead_id: lead.id }));
      assert.deepEqual([res.status, res.body], [400, failed(detail('name', 'Client name contains invalid characters'))]);
      assert.equal(await clientCount(), before);
      // 255 characters, the most the form and the column allow
      const longest = `${letters(1).toUpperCase()}${letters(254)}`;
      res = await call('POST', '/api/data/clients', formBody({ name: longest, lead_id: lead.id }));
      assert.equal(res.status, 201, res.text);
      assert.equal((await storedClient(res.body.client.id)).name, longest);
    });

    test('400 "Validation failed" for a practice area, conflict risk, cadence, stickiness or high-maintenance outside its vocabulary; nothing written', async () => {
      const lead = await seed('Kevin');
      const before = await clientCount();
      for (const [what, fields, details] of FIELD_REFUSALS.vocabularies) {
        const res = await call('POST', '/api/data/clients', formBody({ lead_id: lead.id, ...fields }));
        assert.deepEqual([res.status, res.body], [400, failed(details)], what);
      }
      assert.equal(await clientCount(), before);
    });

    test('201 for a blank the book holds (no practice areas, no cadence, not rated) and for a field left out, stored as before', async () => {
      const lead = await seed('Kevin');
      for (const [fields, stored] of [
        [{ practice_area: [], interaction_frequency: '', stickiness: null }, { practice_area: [], interaction_frequency: '', stickiness: null, high_maintenance: false }],
        [{ practice_area: undefined, interaction_frequency: undefined, stickiness: undefined, high_maintenance: undefined, revenues: undefined },
          { practice_area: null, interaction_frequency: null, stickiness: null, high_maintenance: false }],
      ]) {
        const res = await call('POST', '/api/data/clients', formBody({ lead_id: lead.id, ...fields }));
        assert.equal(res.status, 201, res.text);
        const row = await storedClient(res.body.client.id);
        assert.deepEqual({ practice_area: row.practice_area, interaction_frequency: row.interaction_frequency, stickiness: row.stickiness, high_maintenance: row.high_maintenance }, stored);
        if (!('revenues' in fields)) assert.deepEqual(await revenueRows(res.body.client.id), [{ year: 2025, amount: 50000 }, { year: 2026, amount: 60000 }]);
        else assert.deepEqual(await revenueRows(res.body.client.id), []);
      }
    });

    test('400 "Validation failed" for a revenue year the import would not read, an amount below 0, over 1,000,000,000 or not a number, a year given twice, or revenue that is not a list; nothing written', async () => {
      const lead = await seed('Kevin');
      const before = await clientCount();
      for (const [what, fields, details] of FIELD_REFUSALS.revenue) {
        const res = await call('POST', '/api/data/clients', formBody({ lead_id: lead.id, ...fields }));
        assert.deepEqual([res.status, res.body], [400, failed(details)], what);
      }
      assert.equal(await clientCount(), before);
      // The edges are accepted: 1900 and 2099, 0 and 1,000,000,000
      const res = await call('POST', '/api/data/clients', formBody({ lead_id: lead.id, revenues: [{ year: 1900, revenue_amount: 0 }, { year: 2099, revenue_amount: 1e9 }] }));
      assert.equal(res.status, 201, res.text);
      assert.deepEqual(await revenueRows(res.body.client.id), [{ year: 1900, amount: 0 }, { year: 2099, amount: 1e9 }]);
      // Gone again, so the book's reporting year stays this one's for the other tests
      await db.query('DELETE FROM clients WHERE id::text = $1', [String(res.body.client.id)]);
    });

    test('400 "Validation failed" with the one detail `body` for a body that is not an object; nothing written', async () => {
      const before = await clientCount();
      for (const body of [undefined, [], '[{"name":"Acme"}]']) {
        const res = await call('POST', '/api/data/clients', body);
        assert.deepEqual([res.status, res.body], [400, failed(NOT_AN_OBJECT)], JSON.stringify(body));
      }
      assert.equal(await clientCount(), before);
    });

    test('the fields\' and the people\'s details come back together, the fields\' first; nothing written', async () => {
      const before = await clientCount();
      const res = await call('POST', '/api/data/clients', formBody({ name: '', practice_area: ['Tax'], stickiness: 9, lead_id: null }));
      assert.deepEqual([res.status, res.body], [400, failed([
        ...detail('name', 'Client name is required'),
        ...detail('practice_area', `Practice area "Tax" is not on the list: ${PRACTICE_AREA_LIST}.`),
        ...detail('stickiness', 'Stickiness must be a whole number from 1 to 5, or null for not rated.'),
        ...detail('lead_id', 'Choose a lead partner.'),
      ])]);
      assert.equal(await clientCount(), before);
    });

    // Until Tier 2 WP2 parseId (utils/people.cjs) took any positive integer
    // as a person id, and one above PostgreSQL's integer range failed in the
    // people query (500). It now matches nobody, as readAnswerId
    // (utils/aiAnswers.cjs) bounds its ids.
    test('a person id above PostgreSQL\'s integer range answers 400 "Validation failed", as any id not on the list; nothing written', async () => {
      const kevin = await seed('Kevin');
      const before = await clientCount();
      for (const [people, details] of [
        [{ lead_id: 99999999999 }, [{ field: 'lead_id', message: 'The lead must be an active partner.' }]],
        [{ lead_id: '99999999999' }, [{ field: 'lead_id', message: 'The lead must be an active partner.' }]],
        [{ lead_id: kevin.id, second_chair_id: 99999999999 }, [{ field: 'second_chair_id', message: 'The second chair must be an active person on the People list.' }]],
        [{ lead_id: kevin.id, originator_id: 99999999999 }, [{ field: 'originator_id', message: 'The originator must be on the People list.' }]],
      ]) {
        const res = await call('POST', '/api/data/clients', formBody(people));
        assert.deepEqual([res.status, res.body], [400, { success: false, error: 'Validation failed', details }], JSON.stringify(people));
      }
      assert.equal(await clientCount(), before);
    });

    // Tier 3 WP2, candidate (g), found in Tier 2 WP7's end-to-end run: until
    // then the form's POST took a name another client already had, in any
    // case (201), and the import then refused every sheet row naming it
    // until one was deleted. A pair stored before WP2 still refuses its row
    test('400 "Validation failed" with a detail on `name` for a name another client already has, in any case or as it was stored escaped; nothing written; a pair already stored still refuses the import\'s row', async () => {
      const kevin = await seed('Kevin');
      const existing = await addClient({ lead: kevin });
      const before = { count: await clientCount(), changes: await changeCount() };
      for (const name of [existing.name, existing.name.toUpperCase(), existing.name.toLowerCase(), `  ${existing.name} `]) {
        const res = await call('POST', '/api/data/clients', formBody({ name, lead_id: kevin.id }));
        assert.deepEqual([res.status, res.body], [400, failed(nameTakenDetail(existing.name))], name);
      }
      // A client stored escaped before Tier 2 WP5 (an old backup) has the name as typed
      const escaped = await addClient({ lead: kevin, name: `Smith &amp; Sons ${letters(8)}` });
      const res = await call('POST', '/api/data/clients', formBody({ name: escaped.name.replace('&amp;', '&'), lead_id: kevin.id }));
      assert.deepEqual([res.status, res.body], [400, failed(nameTakenDetail(escaped.name))]);
      assert.deepEqual([await clientCount(), await changeCount()], [before.count + 1, before.changes], 'only the fixture');
      // Two clients already sharing a name, as the old POST left them
      await addClient({ lead: kevin, name: existing.name.toUpperCase() });
      const check = await call('POST', '/api/data/process-csv', { csvData: [{ CLIENT: existing.name, '2026 Contracts': '$9' }], dryRun: true });
      assert.equal(check.status, 400, check.text);
      assert.deepEqual(check.body.errors.map((e) => e.message), [
        `The book has 2 clients named "${existing.name}", so the import cannot tell which one to update. On Client Details, delete the one you do not want, then upload the file again.`,
      ]);
    });

    test('the name\'s detail comes first among the fields\', the people\'s after; a name the rules refuse gets only its own detail', async () => {
      const kevin = await seed('Kevin');
      const existing = await addClient({ lead: kevin });
      const before = await clientCount();
      let res = await call('POST', '/api/data/clients', formBody({ name: existing.name.toLowerCase(), conflict_risk: 'Severe', lead_id: null }));
      assert.deepEqual([res.status, res.body], [400, failed([
        ...nameTakenDetail(existing.name),
        ...detail('conflict_risk', 'Conflict risk "Severe" must be Low, Medium or High.'),
        ...detail('lead_id', 'Choose a lead partner.'),
      ])]);
      res = await call('POST', '/api/data/clients', formBody({ name: `${existing.name};`, lead_id: kevin.id }));
      assert.deepEqual([res.status, res.body], [400, failed(detail('name', 'Client name contains invalid characters'))]);
      assert.equal(await clientCount(), before);
    });

    // Tier 3 WP2, candidate (g): every POST takes the client-name lock before
    // its check, so the second of two saves at once waits, then finds the
    // first's name
    test('two POSTs in flight with one name, in two cases: one 201, one 400 on the name, one client of that name', async () => {
      const kevin = await seed('Kevin');
      for (let round = 0; round < 3; round += 1) {
        const name = uniqueName('Racing Client');
        const [a, b] = await Promise.all([
          call('POST', '/api/data/clients', formBody({ name, lead_id: kevin.id })),
          call('POST', '/api/data/clients', formBody({ name: name.toUpperCase(), lead_id: kevin.id })),
        ]);
        assert.deepEqual([a.status, b.status].sort(), [201, 400], `round ${round}: ${a.text} ${b.text}`);
        const [created, refused] = a.status === 201 ? [a, b] : [b, a];
        assert.deepEqual(refused.body, failed(nameTakenDetail(created.body.client.name)));
        assert.deepEqual((await clientsNamed(name)).map((c) => String(c.id)), [String(created.body.client.id)]);
        assert.equal((await changeRows(created.body.client.id)).length, 1, 'the refused POST logged nothing');
      }
    });

    // Tier 2 WP7 (S11): the client form's live preview (src/utils/successionUtils.js
    // on the form's state) shows what the save then returns, a new client and
    // an edit, as POST and PUT answer them and as GET then lists them
    test('201: the succession metrics the form\'s preview showed are the ones the save returns and GET lists', async () => {
      const paula = await seed('Paula');
      const jay = await seed('Jay');
      const form = { ...clientFormData({}), name: uniqueName('Preview Client'), lead_id: String(paula.id), originator_id: String(paula.id),
        stickiness: 5, practiceArea: ['Energy'], interaction_frequency: 'Monthly', revenues: [{ year: 2026, revenue_amount: '12000' }] };
      // Energy, Monthly, pick 5: 0.8 and 3 + 0 + 0.3 (2 and 4 until Tier 3 WP13, U41)
      assert.deepEqual(previewOf(form), { relationshipType: 'primary', transitionComplexity: 1, successionRisk: 3 });
      const res = await call('POST', '/api/data/clients', formSaveBody(form));
      assert.equal(res.status, 201, res.text);
      assert.deepEqual(metricsOf(res.body.client), previewOf(form));
      assert.deepEqual(metricsOf(await listedClient(res.body.client.id)), previewOf(form));

      // An edit through clientFormData: a second chair, with Stickiness 5, makes it shared
      const edit = { ...clientFormData(await listedClient(res.body.client.id)), second_chair_id: String(jay.id) };
      assert.deepEqual(previewOf(edit), { relationshipType: 'shared', transitionComplexity: 1, successionRisk: 1 });
      const put = await call('PUT', `/api/data/clients/${res.body.client.id}`, formSaveBody(edit));
      assert.equal(put.status, 200, put.text);
      assert.deepEqual(metricsOf(put.body.client), previewOf(edit));
      assert.deepEqual(metricsOf(await listedClient(res.body.client.id)), previewOf(edit));
    });
  });

  route('PUT /api/data/clients/:id', () => {
    // The page reads client (src/portfolioStore.js, updateClient) and, on a 400,
    // details[].field and details[].message (src/ClientEnhancementForm.jsx,
    // through formErrors in src/utils/clientForm.js)
    test('200 { success, client }: the edited fields and exactly the revenue rows sent', async () => {
      const kevin = await seed('Kevin');
      const joe = await seed('Joe');
      const created = await addClient({ lead: kevin, revenues: { 2024: 1000, 2025: 2000 } });
      const body = formBody({ name: created.name, lead_id: joe.id, second_chair_id: kevin.id, notes: 'Edited', revenues: [{ year: 2026, revenue_amount: 7000 }] });
      const res = await call('PUT', `/api/data/clients/${created.id}`, body);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['client', 'success']);
      const { client } = res.body;
      assert.equal(String(client.id), String(created.id));
      assert.deepEqual([client.lead.name, client.secondChair.name, client.notes], ['Joe', 'Kevin', 'Edited']);
      assert.deepEqual(client.revenue, { 2026: 7000 });
      assert.deepEqual(await revenueRows(created.id), [{ year: 2026, amount: 7000 }]);
      const listed = (await call('GET', '/api/data/clients')).body.clients.find((c) => String(c.id) === String(created.id));
      assert.deepEqual(keysOf(client), keysOf(listed), 'the same fields as GET');
      const stored = await storedClient(created.id);
      assert.deepEqual([stored.primary_lobbyist, stored.lobbyist_team], ['Joe', ['Joe', 'Kevin']]);
    });

    test('400 { success: false, error: "Validation failed", details } for the people; nothing written', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin });
      const before = await storedClient(created.id);
      for (const [people, details] of [
        [{}, [{ field: 'lead_id', message: 'Choose a lead partner.' }]],
        [{ lead_id: kevin.id, second_chair_id: kevin.id }, [{ field: 'second_chair_id', message: 'The second chair cannot be the lead.' }]],
      ]) {
        const res = await call('PUT', `/api/data/clients/${created.id}`, formBody({ name: created.name, ...people }));
        assert.deepEqual([res.status, res.body], [400, { success: false, error: 'Validation failed', details }], JSON.stringify(people));
      }
      assert.deepEqual(await storedClient(created.id), before);
      assert.deepEqual(await revenueRows(created.id), [{ year: 2026, amount: 100000 }]);
    });

    test('404 { error: "Client not found" } for a well-formed id no client has', async () => {
      const res = await call('PUT', `/api/data/clients/${missingId}`, formBody({ lead_id: (await seed('Kevin')).id }));
      assert.deepEqual([res.status, res.body], [404, { error: 'Client not found' }]);
    });

    // Until Tier 2 WP2 the id was compared in its column's type (WHERE id =
    // $1), so an id that is not this shape's type failed in PostgreSQL (500).
    // It is compared as text now, as the second-chair route does (CLAUDE.md:
    // "Never cast a client id to a type").
    test('404 { error: "Client not found" } for a malformed id, or one of the other shape\'s type; nothing written', async () => {
      const lead = await seed('Kevin');
      const bystander = await addClient({ lead, revenues: { 2025: 1000, 2026: 2000 } });
      const before = await storedClient(bystander.id);
      const count = await clientCount();
      for (const id of [otherShapeId, 'not-an-id']) {
        const res = await call('PUT', `/api/data/clients/${id}`, formBody({ lead_id: lead.id }));
        assert.deepEqual([res.status, res.body], [404, { error: 'Client not found' }], id);
      }
      assert.equal(await clientCount(), count);
      assert.deepEqual(await storedClient(bystander.id), before);
      assert.deepEqual(await revenueRows(bystander.id), [{ year: 2025, amount: 1000 }, { year: 2026, amount: 2000 }]);
    });

    test('a person id above PostgreSQL\'s integer range answers 400 "Validation failed" (Tier 2 WP2); nothing written', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin });
      const before = await storedClient(created.id);
      const res = await call('PUT', `/api/data/clients/${created.id}`, formBody({ name: created.name, lead_id: kevin.id, second_chair_id: 99999999999 }));
      assert.deepEqual([res.status, res.body], [400, {
        success: false, error: 'Validation failed',
        details: [{ field: 'second_chair_id', message: 'The second chair must be an active person on the People list.' }],
      }]);
      assert.deepEqual(await storedClient(created.id), before);
      assert.deepEqual(await revenueRows(created.id), [{ year: 2026, amount: 100000 }]);
    });

    // Until Tier 2 WP4 a PUT without `revenues` deleted every revenue row the
    // client had (docs/plans/tier-2.md, S7): the handler defaulted it to []
    test('a PUT without revenues leaves the client\'s revenue rows as they are; with revenues: [] it clears them', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin, revenues: { 2025: 3000, 2026: 4000 } });
      let res = await call('PUT', `/api/data/clients/${created.id}`, formBody({ name: created.name, lead_id: kevin.id, notes: 'Kept', revenues: undefined }));
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(await revenueRows(created.id), [{ year: 2025, amount: 3000 }, { year: 2026, amount: 4000 }]);
      assert.deepEqual(res.body.client.revenue, { 2025: 3000, 2026: 4000 });
      assert.equal((await storedClient(created.id)).notes, 'Kept', 'the rest of the client is written');
      res = await call('PUT', `/api/data/clients/${created.id}`, formBody({ name: created.name, lead_id: kevin.id, revenues: [] }));
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(await revenueRows(created.id), []);
    });

    // Tier 3 WP13 (docs/plans/tier-3.md, section 18, U43 (b), U46 (b)): there
    // is no retag, so a retired practice area a client holds stays valid on
    // every write, and the partner removes it as any other change. A new name
    // (Human Services) is refused by the API before WP13
    test('200: a client holding a retired practice area saves for another field with it kept, then without it and with a new area; one `form` row each, naming only what changed', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin });
      await db.query("UPDATE clients SET practice_area = ARRAY['Corporate', 'Healthcare'] WHERE id::text = $1", [String(created.id)]);
      let res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { practice_area: ['Corporate', 'Healthcare'], stickiness: 4 }));
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body.client.practiceArea, ['Corporate', 'Healthcare']);
      assert.deepEqual((await storedClient(created.id)).practice_area, ['Corporate', 'Healthcare'], 'kept as it was');
      assert.deepEqual((await changeRows(created.id)).map((r) => [r.source, r.changes]), [['form', { stickiness: { from: 3, to: 4 } }]]);
      res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { practice_area: ['Healthcare', 'Human Services'], stickiness: 4 }));
      assert.equal(res.status, 200, res.text);
      assert.deepEqual((await storedClient(created.id)).practice_area, ['Healthcare', 'Human Services']);
      assert.deepEqual((await changeRows(created.id)).map((r) => [r.source, r.changes]), [
        ['form', { stickiness: { from: 3, to: 4 } }],
        ['form', { practice_area: { from: ['Corporate', 'Healthcare'], to: ['Healthcare', 'Human Services'] } }],
      ]);
      // A retired name on a new client too: accepted wherever a client's areas are written
      for (const retired of clientRules.RETIRED_PRACTICE_AREAS) {
        res = await call('POST', '/api/data/clients', formBody({ lead_id: kevin.id, practice_area: [retired, 'Justice and Legal'] }));
        assert.equal(res.status, 201, `${retired}: ${res.text}`);
        assert.deepEqual((await storedClient(res.body.client.id)).practice_area, [retired, 'Justice and Legal']);
      }
    });

    test('400 "Validation failed" for each field rule POST applies, with the same details; the client and its revenue unchanged', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin, revenues: { 2025: 3000, 2026: 4000 } });
      const before = await storedClient(created.id);
      for (const [what, fields, details] of [...FIELD_REFUSALS.name, ...FIELD_REFUSALS.vocabularies, ...FIELD_REFUSALS.revenue]) {
        const res = await call('PUT', `/api/data/clients/${created.id}`, formBody({ name: created.name, lead_id: kevin.id, ...fields }));
        assert.deepEqual([res.status, res.body], [400, failed(details)], what);
      }
      assert.deepEqual(await storedClient(created.id), before);
      assert.deepEqual(await revenueRows(created.id), [{ year: 2025, amount: 3000 }, { year: 2026, amount: 4000 }]);
    });

    test('a body the rules refuse answers 400 before the client is looked up, and one that is not an object answers its one detail; nothing written', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin });
      const before = await storedClient(created.id);
      let res = await call('PUT', `/api/data/clients/${missingId}`, formBody({ lead_id: kevin.id, conflict_risk: 'Severe' }));
      assert.deepEqual([res.status, res.body], [400, failed(detail('conflict_risk', 'Conflict risk "Severe" must be Low, Medium or High.'))]);
      for (const body of [undefined, [], '[{"name":"Acme"}]']) {
        res = await call('PUT', `/api/data/clients/${created.id}`, body);
        assert.deepEqual([res.status, res.body], [400, failed(NOT_AN_OBJECT)], JSON.stringify(body));
      }
      res = await call('PUT', `/api/data/clients/${created.id}`, formBody({ name: created.name, interaction_frequency: 'Hourly', lead_id: null }));
      assert.deepEqual([res.status, res.body], [400, failed([
        ...detail('interaction_frequency', 'Interaction frequency "Hourly" must be one of Daily, Weekly, Monthly, Quarterly, As-Needed, or blank.'),
        ...detail('lead_id', 'Choose a lead partner.'),
      ])], 'the fields\' and the people\'s details together, the fields\' first');
      assert.deepEqual(await storedClient(created.id), before);
      assert.deepEqual(await revenueRows(created.id), [{ year: 2026, amount: 100000 }]);
    });

    test('a name with &, \' and / and a note with < save as typed, and sent back as stored they save unchanged; a name as stored escaped before WP5 is refused and nothing written', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin });
      const tail = letters(8);
      const name = `Smith & O'Brien / ${tail}`;
      const note = 'R&D < 5% of "budget"';
      let res = await call('PUT', `/api/data/clients/${created.id}`, formBody({ name, notes: note, lead_id: kevin.id }));
      assert.equal(res.status, 200, res.text);
      const stored = await storedClient(created.id);
      assert.deepEqual([stored.name, stored.notes], [name, note], 'as typed (escaped until WP5)');
      res = await call('PUT', `/api/data/clients/${created.id}`, formBody({ name: stored.name, notes: stored.notes, lead_id: kevin.id }));
      assert.equal(res.status, 200, res.text);
      const again = await storedClient(created.id);
      assert.deepEqual([again.name, again.notes], [name, note], 'unchanged (escaped once more until WP5)');
      res = await call('PUT', `/api/data/clients/${created.id}`, formBody({ name: `${LONG_ONCE_ESCAPED}${tail}`, lead_id: kevin.id }));
      assert.equal(res.status, 200, res.text);
      assert.equal((await storedClient(created.id)).name, `${LONG_ONCE_ESCAPED}${tail}`, 'over 255 once escaped: stored as typed (400 until WP5)');
      // A client saved before WP5 holds its name escaped until the repair; a
      // direct request sending that back is refused (the page sends it unescaped)
      await db.query('UPDATE clients SET name = $1 WHERE id::text = $2', [`Smith &amp; O&#x27;Brien &#x2F; ${tail}`, String(created.id)]);
      const escapedRow = await storedClient(created.id);
      res = await call('PUT', `/api/data/clients/${created.id}`, formBody({ name: escapedRow.name, lead_id: kevin.id }));
      assert.deepEqual([res.status, res.body], [400, failed(detail('name', 'Client name contains invalid characters'))]);
      assert.deepEqual(await storedClient(created.id), escapedRow);
      res = await call('PUT', `/api/data/clients/${created.id}`, formBody({ name, lead_id: kevin.id }));
      assert.equal(res.status, 200, res.text);
      assert.equal((await storedClient(created.id)).name, name, 'the name as the form shows it repairs the stored text');
    });
    /* WP6: who changed what (S9), and edit conflicts (S10) */

    test('S10: a save with the updated_at_exact the page loaded is accepted and logged once as `form`, with exactly what changed and who; updated_at and updated_by move', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin, revenues: { 2025: 1000, 2026: 100000 } });
      const loaded = await listedClient(created.id);
      const res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, {
        stickiness: 4, notes: 'Called the director', revenues: [{ year: 2026, revenue_amount: 120000 }],
        expected_updated_at: loaded.updated_at_exact,
      }));
      assert.equal(res.status, 200, res.text);
      const rows = await changeRows(created.id);
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].source, rows[0].client_name, rows[0].changed_by, rows[0].changed_by_username],
        ['form', created.name, await accountId(), account.username]);
      assert.deepEqual(rows[0].changes, {
        stickiness: { from: 3, to: 4 },
        notes: { from: null, to: 'Called the director' },
        revenue: { 2025: { from: 1000, to: null }, 2026: { from: 100000, to: 120000 } },
      });
      assert.ok(rows[0].created_at instanceof Date);
      const stored = await storedClient(created.id);
      assert.equal(stored.updated_by, await accountId());
      assert.notEqual(await exactOf(created.id), loaded.updated_at_exact);
      assert.equal(res.body.client.updated_at_exact, await exactOf(created.id), 'the next save sends this one');
    });

    test('S10: 409 { success: false, error, latest_change } for a stale expected_updated_at, naming who saved last and when; nothing written, nothing logged', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin });
      const loaded = await listedClient(created.id);
      // Another partner saves first
      const other = { username: `other-${letters(6)}`, password: generatedPassword() };
      await addAccount(env, other);
      const first = await request(api.base, 'PUT', `/api/data/clients/${created.id}`, {
        as: await signIn(api.base, other), body: storedBody(created, kevin, { stickiness: 4, expected_updated_at: loaded.updated_at_exact }),
      });
      assert.equal(first.status, 200, first.text);
      const stored = await storedClient(created.id);
      const [latest] = await changeRows(created.id);

      const res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, {
        interaction_frequency: 'Weekly', notes: 'Mine', revenues: [], expected_updated_at: loaded.updated_at_exact,
      }));
      assert.equal(res.status, 409, res.text);
      assert.deepEqual(keysOf(res.body), ['error', 'latest_change', 'success']);
      assert.deepEqual(res.body, conflictOf(latest));
      assert.deepEqual(res.body.latest_change, { changed_by_username: other.username, source: 'form', created_at: latest.created_at.toISOString() });
      assert.equal(res.body.error, `This client was saved after you opened it, by ${other.username} on ${clientChanges.firmTime(latest.created_at)}. Nothing was saved.`);
      assert.deepEqual(await storedClient(created.id), stored);
      assert.deepEqual(await revenueRows(created.id), [{ year: 2026, amount: 100000 }]);
      assert.equal((await changeRows(created.id)).length, 1);
      // Loaded again, the same save is accepted
      const again = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, {
        stickiness: 4, interaction_frequency: 'Weekly', expected_updated_at: (await listedClient(created.id)).updated_at_exact,
      }));
      assert.equal(again.status, 200, again.text);
      assert.deepEqual((await changeRows(created.id)).map((r) => [r.changed_by_username, r.changes]), [
        [other.username, { stickiness: { from: 3, to: 4 } }],
        [account.username, { interaction_frequency: { from: 'Monthly', to: 'Weekly' } }],
      ]);
    });

    test('S10: two saves in flight with the same expected_updated_at: one answers 200, the other 409, and one row is logged', async () => {
      const kevin = await seed('Kevin');
      for (let round = 0; round < 3; round += 1) {
        const created = await addClient({ lead: kevin });
        const { updated_at_exact: token } = await listedClient(created.id);
        const [a, b] = await Promise.all([
          call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { stickiness: 5, expected_updated_at: token })),
          call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { interaction_frequency: 'Daily', expected_updated_at: token })),
        ]);
        assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.text} ${b.text}`);
        const rows = await changeRows(created.id);
        assert.equal(rows.length, 1);
        const stored = await storedClient(created.id);
        const winner = a.status === 200 ? { stickiness: 5, interaction_frequency: 'Monthly' } : { stickiness: 3, interaction_frequency: 'Daily' };
        assert.deepEqual({ stickiness: stored.stickiness, interaction_frequency: stored.interaction_frequency }, winner);
        assert.deepEqual((a.status === 409 ? a : b).body, conflictOf(rows[0]));
      }
    });

    test('a save without expected_updated_at (the older page, a direct request) is not checked, and is logged', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin });
      const loaded = await listedClient(created.id);
      assert.equal((await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { stickiness: 4, expected_updated_at: loaded.updated_at_exact }))).status, 200);
      const res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { stickiness: 1 }));
      assert.equal(res.status, 200, res.text);
      assert.deepEqual((await changeRows(created.id)).map((r) => r.changes), [{ stickiness: { from: 3, to: 4 } }, { stickiness: { from: 4, to: 1 } }]);
    });

    test('a save that changes nothing writes nothing: 200 with the client, updated_at and updated_by as they were, no row logged', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin });
      const before = await storedClient(created.id);
      const loaded = await listedClient(created.id);
      // As stored, and in the import's spelling of none: '' cadence stays '' against NULL...
      for (const body of [storedBody(created, kevin, { expected_updated_at: loaded.updated_at_exact }), storedBody(created, kevin, { revenues: undefined })]) {
        const res = await call('PUT', `/api/data/clients/${created.id}`, body);
        assert.equal(res.status, 200, res.text);
        assert.equal(res.body.client.updated_at_exact, loaded.updated_at_exact);
      }
      assert.deepEqual(await storedClient(created.id), before);
      assert.deepEqual(await changeRows(created.id), []);
      // ...and practice areas ticked in another order are the same set
      await db.query("UPDATE clients SET practice_area = ARRAY['Healthcare', 'Energy'] WHERE id::text = $1", [String(created.id)]);
      const reordered = await storedClient(created.id);
      const res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { practice_area: ['Energy', 'Healthcare'] }));
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(await storedClient(created.id), reordered);
      assert.deepEqual(await changeRows(created.id), []);
    });

    // WP6's candidate (a) (docs/plans/tier-2.md): the client form filled a
    // client with no cadence as As-Needed, so opening one and saving it,
    // unchanged or for another reason, wrote As-Needed and halved its effort
    // (History: "Cadence: not set → As-Needed"). Opened in the form now, it
    // stays unset, whether stored NULL (a POST without the field) or '' (the
    // import's blank cell). A page-only fix: the route stores what it is sent
    test('a client with no cadence, opened in the form and saved unchanged, writes nothing; saved with only its Stickiness changed, logs only that and keeps its effort', async () => {
      const kevin = await seed('Kevin');
      for (const cadence of [null, '']) {
        const created = await addClient({ lead: kevin });
        await db.query('UPDATE clients SET interaction_frequency = $1, high_maintenance = true, stickiness = NULL WHERE id::text = $2',
          [cadence, String(created.id)]);
        const before = await storedClient(created.id);
        const loaded = await listedClient(created.id);
        assert.deepEqual([loaded.interaction_frequency, loaded.effort], [cadence, 1.5], `${cadence}: a handful, effort 1 × 1.5`);
        const form = clientFormData(loaded);
        const expected = { expected_updated_at: loaded.updated_at_exact };
        let res = await call('PUT', `/api/data/clients/${created.id}`, { ...formSaveBody(form), ...expected });
        assert.equal(res.status, 200, res.text);
        assert.equal(res.body.client.updated_at_exact, loaded.updated_at_exact, `${cadence}: updated_at as it was`);
        assert.deepEqual(await storedClient(created.id), before, `${cadence}: nothing written`);
        assert.deepEqual(await changeRows(created.id), [], `${cadence}: nothing logged`);

        res = await call('PUT', `/api/data/clients/${created.id}`, { ...formSaveBody({ ...form, stickiness: 5 }), ...expected });
        assert.equal(res.status, 200, res.text);
        assert.deepEqual((await changeRows(created.id)).map((r) => [r.source, r.changes]), [['form', { stickiness: { from: null, to: 5 } }]], String(cadence));
        const { client } = res.body;
        assert.deepEqual([client.effort, client.transitionComplexity], [loaded.effort, loaded.transitionComplexity], `${cadence}: the effort as it was`);
        // Stored as the page sends none, which the history, the scorer and the book read as NULL
        const after = await storedClient(created.id);
        assert.deepEqual([after.interaction_frequency, after.stickiness], ['', 5], String(cadence));
        const rest = (row) => Object.fromEntries(Object.entries(row)
          .filter(([column]) => !['interaction_frequency', 'stickiness', 'updated_at', 'updated_by'].includes(column)));
        assert.deepEqual(rest(after), rest(before), `${cadence}: every other column as it was`);
      }
    });

    test('400 "Validation failed" with a detail for an expected_updated_at that is not the updated_at_exact the API sent, the Date JSON gives among them; before the client is looked up; nothing written', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin });
      const before = await storedClient(created.id);
      const token = detail('expected_updated_at', "expected_updated_at must be the client's updated_at_exact as the API sent it, or null.");
      const loaded = await listedClient(created.id);
      const asJson = new Date(before.updated_at).toISOString();
      for (const value of [asJson, loaded.updated_at_exact.slice(0, -3), 'garbage', 12345, true, {}]) {
        const res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { stickiness: 5, expected_updated_at: value }));
        assert.deepEqual([res.status, res.body], [400, failed(token)], JSON.stringify(value));
      }
      // With a missing id (and a name of its own: another client's is a
      // detail too, Tier 3 WP2), and after the fields' details
      let res = await call('PUT', `/api/data/clients/${missingId}`, storedBody(created, kevin, { name: uniqueName('Missing Client'), expected_updated_at: 'garbage' }));
      assert.deepEqual([res.status, res.body], [400, failed(token)]);
      res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { conflict_risk: 'Severe', expected_updated_at: 'garbage', lead_id: null }));
      assert.deepEqual([res.status, res.body], [400, failed([
        ...detail('conflict_risk', 'Conflict risk "Severe" must be Low, Medium or High.'),
        ...token,
        ...detail('lead_id', 'Choose a lead partner.'),
      ])]);
      assert.deepEqual(await storedClient(created.id), before);
      assert.deepEqual(await changeRows(created.id), []);
    });

    // WP4 pinned the fields' 400 before the id is looked up; WP6 pins the rest:
    // everything about the body first (fields, expected_updated_at's form, the
    // people), then the client (404, then 409). From Tier 3 WP2 a name another
    // client has is one of the fields' details, so the missing id's requests
    // carry a name of their own
    test('the order of refusals: the body\'s 400 (the people\'s included) before the client is looked up, then 404, then 409', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin });
      const stale = '2000-01-01T00:00:00.000000';
      const people = [{ field: 'second_chair_id', message: 'The second chair cannot be the lead.' }];
      const ownName = (id) => (id === missingId ? { name: uniqueName('Missing Client') } : {});
      // The people's 400 before a missing id's 404 and before a stale token's 409
      for (const id of [missingId, created.id]) {
        const res = await call('PUT', `/api/data/clients/${id}`, storedBody(created, kevin, { ...ownName(id), second_chair_id: kevin.id, expected_updated_at: stale }));
        assert.deepEqual([res.status, res.body], [400, failed(people)], String(id));
      }
      // A missing id's 404 before any token
      let res = await call('PUT', `/api/data/clients/${missingId}`, storedBody(created, kevin, { ...ownName(missingId), expected_updated_at: stale }));
      assert.deepEqual([res.status, res.body], [404, { error: 'Client not found' }]);
      res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { expected_updated_at: stale }));
      assert.deepEqual([res.status, res.body], [409, conflictOf(undefined)], 'no history row yet: nobody named');
      assert.deepEqual(await changeRows(created.id), []);
    });

    // Tier 3 WP2, candidate (g): a PUT that renames a client to a name another
    // client has, in any case, answered 200 until then
    test('400 "Validation failed" with a detail on `name` for a rename to a name another client has, in any case; nothing written', async () => {
      const kevin = await seed('Kevin');
      const other = await addClient({ lead: kevin });
      const created = await addClient({ lead: kevin });
      const before = await storedClient(created.id);
      const loaded = await listedClient(created.id);
      for (const name of [other.name, other.name.toUpperCase()]) {
        const res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, {
          name, stickiness: 5, expected_updated_at: loaded.updated_at_exact,
        }));
        assert.deepEqual([res.status, res.body], [400, failed(nameTakenDetail(other.name))], name);
      }
      assert.deepEqual(await storedClient(created.id), before);
      assert.deepEqual(await changeRows(created.id), []);
      // A name of its own is saved
      const renamed = uniqueName('Renamed Client');
      const res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { name: renamed, expected_updated_at: loaded.updated_at_exact }));
      assert.equal(res.status, 200, res.text);
      assert.deepEqual((await changeRows(created.id)).map((r) => r.changes), [{ name: { from: created.name, to: renamed } }]);
    });

    test('a PUT that keeps its client\'s name is not checked: two clients already sharing a name stay editable, a change of case included, until one is renamed', async () => {
      const kevin = await seed('Kevin');
      const first = await addClient({ lead: kevin });
      // The pair, as the old POST made it
      const second = await addClient({ lead: kevin, name: first.name.toUpperCase() });
      const sheet = { csvData: [{ CLIENT: first.name, '2026 Contracts': '$9' }], dryRun: true };
      let res = await call('PUT', `/api/data/clients/${first.id}`, storedBody(first, kevin, { stickiness: 4 }));
      assert.equal(res.status, 200, res.text);
      assert.equal((await storedClient(first.id)).stickiness, 4);
      res = await call('PUT', `/api/data/clients/${second.id}`, storedBody(second, kevin, { name: first.name.toLowerCase() }));
      assert.equal(res.status, 200, res.text);
      assert.equal((await storedClient(second.id)).name, first.name.toLowerCase(), 'a change of case keeps the name');
      assert.equal((await call('POST', '/api/data/process-csv', sheet)).status, 400, 'still a pair');
      // Renamed out of the pair: the import names the other one again
      res = await call('PUT', `/api/data/clients/${second.id}`, storedBody(second, kevin, { name: uniqueName('Resolved Client') }));
      assert.equal(res.status, 200, res.text);
      const check = await call('POST', '/api/data/process-csv', sheet);
      assert.equal(check.status, 200, check.text);
      assert.deepEqual([check.body.summary.updatedClients, check.body.summary.newClients], [1, 0]);

      // Stored escaped before WP5 (an old backup) and sent as typed: the same name, kept
      const tail = letters(8);
      const escaped = await addClient({ lead: kevin, name: `Smith &amp; Co ${tail}` });
      await addClient({ lead: kevin, name: `Smith & Co ${tail}` });
      res = await call('PUT', `/api/data/clients/${escaped.id}`, storedBody(escaped, kevin, { name: `Smith & Co ${tail}` }));
      assert.equal(res.status, 200, res.text);
      assert.equal((await storedClient(escaped.id)).name, `Smith & Co ${tail}`);
    });

    test('a name another client has is a body refusal: before the client is looked up, so a missing id with that name answers 400, and with a name of its own 404', async () => {
      const kevin = await seed('Kevin');
      const other = await addClient({ lead: kevin });
      let res = await call('PUT', `/api/data/clients/${missingId}`, formBody({ name: other.name.toLowerCase(), lead_id: kevin.id }));
      assert.deepEqual([res.status, res.body], [400, failed(nameTakenDetail(other.name))]);
      res = await call('PUT', `/api/data/clients/${missingId}`, formBody({ lead_id: kevin.id }));
      assert.deepEqual([res.status, res.body], [404, { error: 'Client not found' }]);
    });

    // Tier 3 WP2, candidate (g): every PUT takes the client-name lock first,
    // renaming or not, since only the name it reads under the lock can say
    test('two PUTs in flight renaming two clients to one name: one 200, one 400 on the name, one client of that name', async () => {
      const kevin = await seed('Kevin');
      for (let round = 0; round < 3; round += 1) {
        const [a, b] = [await addClient({ lead: kevin }), await addClient({ lead: kevin })];
        const name = uniqueName('Raced Rename');
        const [ra, rb] = await Promise.all([
          call('PUT', `/api/data/clients/${a.id}`, storedBody(a, kevin, { name })),
          call('PUT', `/api/data/clients/${b.id}`, storedBody(b, kevin, { name: name.toLowerCase() })),
        ]);
        assert.deepEqual([ra.status, rb.status].sort(), [200, 400], `round ${round}: ${ra.text} ${rb.text}`);
        const [saved, refused] = ra.status === 200 ? [ra, rb] : [rb, ra];
        assert.deepEqual(refused.body, failed(nameTakenDetail(saved.body.client.name)));
        assert.deepEqual((await clientsNamed(name)).map((c) => String(c.id)), [String(saved.body.client.id)]);
      }
    });

    test('a client whose updated_at is NULL saves with expected_updated_at null (IS NOT DISTINCT FROM), and conflicts with any other value', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin });
      await db.query('UPDATE clients SET updated_at = NULL WHERE id::text = $1', [String(created.id)]);
      const loaded = await listedClient(created.id);
      assert.equal(loaded.updated_at_exact, null);
      let res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { stickiness: 4, expected_updated_at: '2026-01-01T00:00:00.000000' }));
      assert.equal(res.status, 409, res.text);
      res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { stickiness: 4, expected_updated_at: null }));
      assert.equal(res.status, 200, res.text);
      assert.match(res.body.client.updated_at_exact, EXACT, 'written now');
      // Stale once it has one
      res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { stickiness: 2, expected_updated_at: null }));
      assert.equal(res.status, 409, res.text);
      assert.equal((await storedClient(created.id)).stickiness, 4);
      assert.equal((await changeRows(created.id)).length, 1);
    });

    // pg reads a TIMESTAMP into a JS Date in the Node process's zone, with
    // milliseconds only: compared that way, every save would answer 409. The
    // token is PostgreSQL's own text, so the zone of the server that sent it,
    // or of the one checking it, changes nothing.
    test('the check does not depend on the server process\'s time zone: a server under TZ=America/New_York loads and saves, and takes a token another server sent', async () => {
      const server = await launch({ TZ: 'America/New_York' });
      try {
        const kevin = await seed('Kevin');
        const created = await addClient({ lead: kevin });
        const session = await signIn(server.base, account);
        let loaded = await listedClient(created.id, server.base, session);
        assert.equal(loaded.updated_at_exact, await exactOf(created.id));
        assert.equal(loaded.updated_at_exact, (await listedClient(created.id)).updated_at_exact, 'the same text from a server in UTC');
        let res = await request(server.base, 'PUT', `/api/data/clients/${created.id}`, {
          as: session, body: storedBody(created, kevin, { stickiness: 4, expected_updated_at: loaded.updated_at_exact }),
        });
        assert.equal(res.status, 200, res.text);
        // Loaded from this suite's server, saved through the New York one, and back
        loaded = await listedClient(created.id);
        res = await request(server.base, 'PUT', `/api/data/clients/${created.id}`, {
          as: session, body: storedBody(created, kevin, { stickiness: 5, expected_updated_at: loaded.updated_at_exact }),
        });
        assert.equal(res.status, 200, res.text);
        res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { stickiness: 2, expected_updated_at: res.body.client.updated_at_exact }));
        assert.equal(res.status, 200, res.text);
        assert.deepEqual((await changeRows(created.id)).map((r) => r.changes.stickiness.to), [4, 5, 2]);
      } finally {
        stop(server);
      }
    });

    test('a session whose account is gone still saves: changed_by and updated_by null, the username kept', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin });
      const ghost = jwt.sign({ userId: 2147483000, username: 'ghost' }, env.JWT_SECRET, { expiresIn: '1h' });
      const res = await request(api.base, 'PUT', `/api/data/clients/${created.id}`, {
        as: `authToken=${ghost}`, body: storedBody(created, kevin, { stickiness: 4 }),
      });
      assert.equal(res.status, 200, res.text);
      const [row] = await changeRows(created.id);
      assert.deepEqual([row.changed_by, row.changed_by_username, row.source], [null, 'ghost', 'form']);
      assert.equal((await storedClient(created.id)).updated_by, null);
    });

    // S9: "a change never lands without its row"; unlike a saved answer
    // (ai_answers), which is returned even when its save fails
    test('a failed history insert fails the write: 500, the client and its revenue unchanged', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin });
      const before = await storedClient(created.id);
      const note = `Private note ${letters(12)}`;
      await db.query('ALTER TABLE client_changes ADD CONSTRAINT routes_test_refuse CHECK (false) NOT VALID');
      try {
        const res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { stickiness: 5, notes: note, revenues: [] }));
        assert.deepEqual([res.status, res.body.error], [500, 'Failed to update client']);
      } finally {
        await db.query('ALTER TABLE client_changes DROP CONSTRAINT routes_test_refuse');
      }
      assert.deepEqual(await storedClient(created.id), before);
      assert.deepEqual(await revenueRows(created.id), [{ year: 2026, amount: 100000 }]);
      // The failure is logged without the refused row: no note reaches a log
      // line. From Tier 3 WP2 as logError writes it (the fields as JSON), and
      // read once it has arrived (waitFor, constraint 8)
      assert.deepEqual(await logged(api, 'Error updating client', 'routes_test_refuse'), {
        code: '23514',
        message: 'client_changes insert failed: new row for relation "client_changes" violates check constraint "routes_test_refuse"',
        constraint: 'routes_test_refuse',
        table: 'client_changes',
      });
      assert.ok(!api.output.includes(note), 'the note is not in the log');
    });

    // Tier 3 WP2, candidate (c): until then a failed query was logged whole
    // (console.error with the error object), PostgreSQL's `detail` included,
    // which for a refused row prints the row: here, the partner's note
    test('a failed write is logged by its code, message, constraint and table (logError), never the refused row: its note stays out of the log', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin });
      const before = await storedClient(created.id);
      const note = `Private note ${letters(12)}`;
      const constraint = `routes_test_clients_${letters(6)}`;
      await db.query(`ALTER TABLE clients ADD CONSTRAINT ${constraint} CHECK (false) NOT VALID`);
      let res;
      try {
        res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { stickiness: 5, notes: note }));
      } finally {
        await db.query(`ALTER TABLE clients DROP CONSTRAINT ${constraint}`);
      }
      assert.deepEqual([res.status, res.body.error], [500, 'Failed to update client']);
      assert.deepEqual(await storedClient(created.id), before);
      assert.deepEqual(await logged(api, 'Error updating client', constraint), {
        code: '23514',
        message: `new row for relation "clients" violates check constraint "${constraint}"`,
        constraint,
        table: 'clients',
      });
      assert.ok(!api.output.includes(note), 'the note is not in the log');
      assert.ok(!api.output.includes('Failing row contains'), 'no detail at all');
    });
  });

  route('PUT /api/data/clients/:id/second-chair', () => {
    // The page reads client (src/portfolioStore.js, assignSecondChair); on a
    // refusal, details[].message for "Validation failed" and error otherwise,
    // and a 409 by its status (src/components/AssociateSplit.jsx)
    test('200 { success, client }: the seat and its legacy text change, nothing else', async () => {
      const kevin = await seed('Kevin');
      const associate = await addPerson('associate', 'Seat Associate');
      const created = await addClient({ lead: kevin });
      const before = await storedClient(created.id);
      const res = await call('PUT', `/api/data/clients/${created.id}/second-chair`, { second_chair_id: associate.id, expected_second_chair_id: null });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['client', 'success']);
      assert.deepEqual(res.body.client.secondChair, { ...associate });
      const listed = (await call('GET', '/api/data/clients')).body.clients.find((c) => String(c.id) === String(created.id));
      assert.deepEqual(keysOf(res.body.client), keysOf(listed), 'the same fields as GET');
      const after = await storedClient(created.id);
      const rest = ({ second_chair_id: _s, lobbyist_team: _t, updated_at: _u, updated_by: _b, ...other }) => other;
      assert.deepEqual(rest(after), rest(before));
      assert.deepEqual([after.second_chair_id, after.lobbyist_team], [associate.id, ['Kevin', associate.name]]);
      // WP6: logged as `second-chair`, the seat alone, and updated_by set
      assert.equal(after.updated_by, await accountId());
      const rows = await changeRows(created.id);
      assert.deepEqual(rows.map((r) => [r.source, r.changed_by_username, r.client_name, r.changes]), [
        ['second-chair', account.username, created.name, { second_chair_id: { from: null, to: { id: associate.id, name: associate.name } } }],
      ]);
    });

    test('a request that sets the seat the client already holds changes nothing: 200, updated_at as it was, no row (WP6)', async () => {
      const kevin = await seed('Kevin');
      const jay = await seed('Jay');
      for (const [second, expected] of [[jay, jay.id], [null, null]]) {
        const created = await addClient({ lead: kevin, second });
        const before = await storedClient(created.id);
        const res = await call('PUT', `/api/data/clients/${created.id}/second-chair`, { second_chair_id: expected, expected_second_chair_id: expected });
        assert.equal(res.status, 200, res.text);
        assert.deepEqual(await storedClient(created.id), before);
        assert.deepEqual(await changeRows(created.id), []);
      }
    });

    test('409 { success: false, error } when the seat changed since the page loaded, or the client has no lead; nothing written', async () => {
      const kevin = await seed('Kevin');
      const jay = await seed('Jay');
      const seated = await addClient({ lead: kevin, second: jay });
      let res = await call('PUT', `/api/data/clients/${seated.id}/second-chair`, { second_chair_id: null, expected_second_chair_id: null });
      assert.deepEqual([res.status, res.body], [409, {
        success: false, error: "This client's second chair changed since the page loaded. Reload the page and try again.",
      }]);
      assert.equal((await storedClient(seated.id)).second_chair_id, jay.id);
      const leadless = await addClient();
      res = await call('PUT', `/api/data/clients/${leadless.id}/second-chair`, { second_chair_id: jay.id, expected_second_chair_id: null });
      assert.deepEqual([res.status, res.body], [409, {
        success: false, error: 'This client has no lead yet. Give it a lead in Client Details first.',
      }]);
      assert.equal((await storedClient(leadless.id)).second_chair_id, null);
      assert.deepEqual([...await changeRows(seated.id), ...await changeRows(leadless.id)], [], 'nothing logged (WP6)');
    });

    test('400: a body without both ids, and "Validation failed" with details for the lead, an inactive or an unknown person; nothing written', async () => {
      const kevin = await seed('Kevin');
      const inactive = await addPerson('associate', 'Seat Inactive');
      await db.query('UPDATE people SET active = false WHERE id = $1', [inactive.id]);
      const created = await addClient({ lead: kevin });
      const before = await storedClient(created.id);
      const malformed = 'second_chair_id and expected_second_chair_id (a person id, or null for none) are required';
      for (const body of [{ second_chair_id: 1 }, { expected_second_chair_id: null }, { second_chair_id: 1, expected_second_chair_id: 'abc' }]) {
        const res = await call('PUT', `/api/data/clients/${created.id}/second-chair`, body);
        assert.deepEqual([res.status, res.body], [400, { success: false, error: malformed }], JSON.stringify(body));
      }
      const notActive = 'The second chair must be an active person on the People list.';
      for (const [id, message] of [[kevin.id, 'The second chair cannot be the lead.'], [inactive.id, notActive], [2147483000, notActive]]) {
        const res = await call('PUT', `/api/data/clients/${created.id}/second-chair`, { second_chair_id: id, expected_second_chair_id: null });
        assert.deepEqual([res.status, res.body], [400, { success: false, error: 'Validation failed', details: [{ field: 'second_chair_id', message }] }], String(id));
      }
      assert.deepEqual(await storedClient(created.id), before);
    });

    test('404 { success: false, error: "Client not found" } for an id no client has, of either type or none', async () => {
      for (const id of [missingId, otherShapeId, 'not-an-id']) {
        const res = await call('PUT', `/api/data/clients/${id}/second-chair`, { second_chair_id: null, expected_second_chair_id: null });
        assert.deepEqual([res.status, res.body], [404, { success: false, error: 'Client not found' }], id);
      }
    });

    // As POST /api/data/clients': until Tier 2 WP2 a person id above
    // PostgreSQL's integer range failed in the people query (500)
    test('a second chair id above PostgreSQL\'s integer range answers 400 "Validation failed", as any id not on the list; nothing written', async () => {
      const created = await addClient({ lead: await seed('Kevin') });
      const before = await storedClient(created.id);
      const res = await call('PUT', `/api/data/clients/${created.id}/second-chair`, { second_chair_id: 99999999999, expected_second_chair_id: null });
      assert.deepEqual([res.status, res.body], [400, {
        success: false, error: 'Validation failed',
        details: [{ field: 'second_chair_id', message: 'The second chair must be an active person on the People list.' }],
      }]);
      assert.deepEqual(await storedClient(created.id), before);
    });

    // Tier 2 WP9 (section 14): after the hire, a saved hire scenario's pick
    // is accepted through this route, one at a time (P9), with the seat the
    // scenario saw; until then nothing is written
    test('a hire scenario\'s pick accepted after the hire: nothing written until then, and then exactly that one seat, logged as `second-chair`; a pick whose seat changed since answers 409 and writes nothing', async () => {
      const allClients = async () => (await db.query('SELECT * FROM clients ORDER BY id::text')).rows;
      const bookBefore = await allClients();
      const body = await hireBody();
      const created = (await allClients()).filter((c) => !bookBefore.some((b) => String(b.id) === String(c.id)));
      const start = await allClients();
      assert.deepEqual(created.map((c) => String(c.id)).sort(), [String(body.open.id), String(body.held.id)].sort());
      const saved = await saveScenario(body);
      // The hire: the associate joins the People list, and a partner links the hypothetical to them
      const ria = (await call('POST', '/api/people', { name: uniqueName('Ria'), role: 'associate' })).body.person;
      const linkedState = { ...body.state, associates: [{ ...body.state.associates[0], personId: String(ria.id) }] };
      const put = await call('PUT', `/api/scenarios/${saved.id}`, { name: body.name, state: linkedState, version: 1 });
      assert.equal(put.status, 200, put.text);
      assert.deepEqual(await allClients(), start, 'saving, the hire and linking write nothing to clients');

      // The page opens the scenario and accepts one pick
      const opened = openState((await call('GET', `/api/scenarios/${saved.id}`)).body.scenario.state, {
        people: (await call('GET', '/api/people')).body.people,
        clients: (await call('GET', '/api/data/clients')).body.clients,
        reportingYear: 2026,
      });
      const modelNow = async () => hireScenarioModel({
        people: (await call('GET', '/api/people')).body.people,
        clients: (await call('GET', '/api/data/clients')).body.clients,
        revenueOf: (c) => revenueForYear(c, 2026),
        ...opened.hireScenario,
      });
      let model = await modelNow();
      const [associate] = model.associates;
      assert.deepEqual([associate.hypothetical, associate.linked.id], [false, ria.id]);
      const seat = model.seats.find((s) => s.clientId === String(body.held.id));
      const accept = acceptance(seat, associate);
      assert.deepEqual(accept, { ok: true, reason: null, expectedSecondChairId: body.paula.id });
      const changesBefore = await changeCount();
      const res = await call('PUT', `/api/data/clients/${body.held.id}/second-chair`, { second_chair_id: associate.linked.id, expected_second_chair_id: accept.expectedSecondChairId });
      assert.equal(res.status, 200, res.text);
      const after = await allClients();
      const rest = ({ second_chair_id: _s, lobbyist_team: _t, updated_at: _u, updated_by: _b, ...other }) => other;
      for (const row of start) {
        const now = after.find((c) => String(c.id) === String(row.id));
        if (String(row.id) === String(body.held.id)) assert.deepEqual(rest(now), rest(row));
        else assert.deepEqual(now, row, `client ${row.id} unchanged`);
      }
      const held = after.find((c) => String(c.id) === String(body.held.id));
      assert.deepEqual([held.second_chair_id, held.lobbyist_team], [ria.id, ['Kevin', ria.name]]);
      assert.equal(await changeCount(), changesBefore + 1);
      assert.deepEqual((await changeRows(body.held.id)).map((r) => [r.source, r.changes]), [
        ['second-chair', { second_chair_id: { from: { id: body.paula.id, name: 'Paula' }, to: { id: ria.id, name: ria.name } } }],
      ]);
      model = await modelNow();
      assert.equal(model.seats.find((s) => s.clientId === String(body.held.id)).source, 'done', 'the accepted seat is the linked person\'s');

      // Another partner fills the other pick's seat first: the pick is not
      // applied, and a request with the seat the scenario saw answers 409
      const other = await secondPartner();
      const jay = await seed('Jay');
      const theirs = await request(api.base, 'PUT', `/api/data/clients/${body.open.id}/second-chair`, { as: other.cookie, body: { second_chair_id: jay.id, expected_second_chair_id: null } });
      assert.equal(theirs.status, 200, theirs.text);
      model = await modelNow();
      const stale = model.notApplied.find((n) => n.clientId === String(body.open.id));
      assert.deepEqual([stale.stale, stale.problem], [true, 'The seat was empty when this was picked and is held by Jay now, so the pick is not applied. Pick it again or remove it.']);
      const stored = await storedClient(body.open.id);
      const refused = await call('PUT', `/api/data/clients/${body.open.id}/second-chair`, { second_chair_id: ria.id, expected_second_chair_id: null });
      assert.equal(refused.status, 409, refused.text);
      assert.deepEqual(await storedClient(body.open.id), stored);
    });

    // Tier 3 WP2, candidate (b): until then the route locked the client, then
    // read its people FOR SHARE, while a rename (PUT /api/people/:id) locks
    // the person, then the clients that name them. An Accept and a rename of
    // the client's lead at the same moment each held what the other needed,
    // and PostgreSQL aborted one (40P01): the route's 500. The holder here is
    // that rename, statement by statement, as routes/people.cjs runs it
    test('an Accept while the client\'s lead is being renamed waits for the rename, then writes the seat, the legacy text under the new name: 200, one history row', async () => {
      const lead = await addPerson('partner', 'Renaming Lead');
      const associate = await addPerson('associate', 'Waiting Associate');
      const created = await addClient({ lead });
      const renamed = uniqueName('Renamed Lead');
      const holder = await lockHolder();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT id FROM people WHERE id = $1 FOR NO KEY UPDATE', [lead.id]);
        const accept = call('PUT', `/api/data/clients/${created.id}/second-chair`, { second_chair_id: associate.id, expected_second_chair_id: null });
        await waitFor(async () => (await lockWaiters()) > 0, 'the Accept to wait for the lead');
        // The rename's next statements: the person, then the clients that name them
        await holder.query('UPDATE people SET name = $1 WHERE id = $2', [renamed, lead.id]);
        await holder.query('SELECT id FROM clients WHERE lead_id = $1 OR second_chair_id = $1 OR originator_id = $1 ORDER BY id FOR UPDATE', [lead.id]);
        await holder.query('UPDATE clients SET primary_lobbyist = $1 WHERE lead_id = $2', [renamed, lead.id]);
        await holder.query('UPDATE clients SET lobbyist_team = array_replace(lobbyist_team, $1, $2) WHERE lead_id = $3 OR second_chair_id = $3',
          [lead.name, renamed, lead.id]);
        await holder.query('COMMIT');
        const res = await accept;
        assert.equal(res.status, 200, res.text);
        assert.deepEqual([res.body.client.lead.name, res.body.client.secondChair.id], [renamed, associate.id]);
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        await holder.end();
      }
      const stored = await storedClient(created.id);
      assert.deepEqual([stored.second_chair_id, stored.primary_lobbyist, stored.lobbyist_team], [associate.id, renamed, [renamed, associate.name]]);
      assert.deepEqual((await changeRows(created.id)).map((r) => [r.source, r.changes]), [
        ['second-chair', { second_chair_id: { from: null, to: { id: associate.id, name: associate.name } } }],
      ]);
    });

    // Tier 3 WP2, candidate (b): the client is read before the people are
    // locked and locked after, so a write can land in between. The holder
    // holds the new second chair, which the Accept waits for, and changes the
    // client meanwhile
    test('409 with a message of its own when the client\'s lead or originator changed while the Accept waited for its people, and the seat\'s 409 when its seat did; nothing written', async () => {
      const kevin = await seed('Kevin');
      const joe = await seed('Joe');
      const jay = await seed('Jay');
      const associate = await addPerson('associate', 'Pausing Associate');
      const PEOPLE_CHANGED = "This client's lead or originator changed at the same moment, so nothing was written. Reload the page and try again.";
      const SEAT_CHANGED = "This client's second chair changed since the page loaded. Reload the page and try again.";
      const rounds = [
        ['its lead', 'UPDATE clients SET lead_id = $2, primary_lobbyist = $3, lobbyist_team = $4 WHERE id::text = $1', [joe.id, 'Joe', ['Joe']], PEOPLE_CHANGED],
        ['its originator', 'UPDATE clients SET originator_id = $2 WHERE id::text = $1', [jay.id], PEOPLE_CHANGED],
        ['its seat', 'UPDATE clients SET second_chair_id = $2, lobbyist_team = $3 WHERE id::text = $1', [jay.id, ['Kevin', 'Jay']], SEAT_CHANGED],
      ];
      for (const [what, sql, values, error] of rounds) {
        const created = await addClient({ lead: kevin });
        const holder = await lockHolder();
        let res;
        let changed;
        try {
          await holder.query('BEGIN');
          await holder.query('SELECT id FROM people WHERE id = $1 FOR NO KEY UPDATE', [associate.id]);
          const accept = call('PUT', `/api/data/clients/${created.id}/second-chair`, { second_chair_id: associate.id, expected_second_chair_id: null });
          await waitFor(async () => (await lockWaiters()) > 0, `the Accept to wait for the associate (${what})`);
          await holder.query(sql, [String(created.id), ...values]);
          changed = await holder.query('SELECT * FROM clients WHERE id::text = $1', [String(created.id)]);
          await holder.query('COMMIT');
          res = await accept;
        } finally {
          await holder.query('ROLLBACK').catch(() => {});
          await holder.end();
        }
        assert.deepEqual([res.status, res.body], [409, { success: false, error }], what);
        assert.deepEqual(await storedClient(created.id), changed.rows[0], `${what}: as the other write left it`);
        assert.deepEqual(await changeRows(created.id), [], `${what}: nothing logged`);
      }
    });

    // Tier 2 WP7 (S11)
    test('200: the client it answers carries the succession metrics after the seat, as GET lists it', async () => {
      const kevin = await seed('Kevin');
      const associate = await addPerson('associate', 'Metric Associate');
      const created = await addClient({ lead: kevin });
      await db.query('UPDATE clients SET stickiness = 5 WHERE id::text = $1', [String(created.id)]);
      assert.equal((await listedClient(created.id)).relationshipType, 'secondary', 'a lead, no second chair, no originator');
      const res = await call('PUT', `/api/data/clients/${created.id}/second-chair`, { second_chair_id: associate.id, expected_second_chair_id: null });
      assert.equal(res.status, 200, res.text);
      // Monthly: 0.8; 1 + 0 + 0.3 (2 and 2 with Healthcare's 1.5 until Tier 3 WP13)
      assert.deepEqual(metricsOf(res.body.client), { relationshipType: 'shared', transitionComplexity: 1, successionRisk: 1 });
      assert.deepEqual(metricsOf(res.body.client), metricsOf(await listedClient(created.id)));
    });
  });

  route('DELETE /api/data/clients/:id', () => {
    // The page reads nothing from a success (src/portfolioStore.js, deleteClient)
    test('204 with no body; the client and its revenue rows are gone', async () => {
      const created = await addClient({ lead: await seed('Kevin'), revenues: { 2025: 1, 2026: 2 } });
      const res = await call('DELETE', `/api/data/clients/${created.id}`);
      assert.deepEqual([res.status, res.text], [204, '']);
      assert.equal(await storedClient(created.id), undefined);
      assert.deepEqual(await revenueRows(created.id), []);
    });

    // WP6: no expected_updated_at on DELETE (docs/plans/tier-2.md, section 11)
    test('the delete is logged as `delete`: every field the client had and its revenue, to none, its name kept; the history outlives it', async () => {
      const kevin = await seed('Kevin');
      const jay = await seed('Jay');
      const created = await addClient({ lead: kevin, second: jay, originator: jay, firm: true, revenues: { 2025: 1500.5, 2026: 2000 } });
      const res = await call('DELETE', `/api/data/clients/${created.id}`);
      assert.equal(res.status, 204);
      const rows = await changeRows(created.id);
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].source, rows[0].client_name, rows[0].changed_by, rows[0].changed_by_username],
        ['delete', created.name, await accountId(), account.username]);
      assert.deepEqual(rows[0].changes, {
        name: { from: created.name, to: null },
        lead_id: { from: { id: kevin.id, name: 'Kevin' }, to: null },
        second_chair_id: { from: { id: jay.id, name: 'Jay' }, to: null },
        originator_id: { from: { id: jay.id, name: 'Jay' }, to: null },
        originator_is_firm: { from: true, to: null },
        stickiness: { from: 3, to: null },
        interaction_frequency: { from: 'Monthly', to: null },
        high_maintenance: { from: false, to: null },
        conflict_risk: { from: 'Low', to: null },
        practice_area: { from: ['Healthcare'], to: null },
        revenue: { 2025: { from: 1500.5, to: null }, 2026: { from: 2000, to: null } },
      });
    });

    test('404 { error: "Client not found" } for a well-formed id no client has; nothing logged', async () => {
      const logged = await changeCount();
      const res = await call('DELETE', `/api/data/clients/${missingId}`);
      assert.deepEqual([res.status, res.body], [404, { error: 'Client not found' }]);
      assert.equal(await changeCount(), logged);
    });

    // As PUT's: compared in the column's type until Tier 2 WP2 (500), as text now
    test('404 { error: "Client not found" } for a malformed id, or one of the other shape\'s type; nothing deleted', async () => {
      const bystander = await addClient({ lead: await seed('Kevin'), revenues: { 2026: 3000 } });
      const count = await clientCount();
      for (const id of [otherShapeId, 'not-an-id']) {
        const res = await call('DELETE', `/api/data/clients/${id}`);
        assert.deepEqual([res.status, res.body], [404, { error: 'Client not found' }], id);
      }
      assert.equal(await clientCount(), count);
      assert.deepEqual(await revenueRows(bystander.id), [{ year: 2026, amount: 3000 }]);
    });
  });

  route('GET /api/data/clients/:id/changes', () => {
    // The page reads changes[] and on each row id, source, changed_by_username,
    // created_at and changes (src/ClientEnhancementForm.jsx through
    // src/utils/clientHistory.js)
    test('200 { success, changes }: the client\'s history, newest first, each row with who, when, the source and what changed', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin });
      for (const stickiness of [4, 5]) {
        const res = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { stickiness }));
        assert.equal(res.status, 200, res.text);
      }
      const res = await call('GET', `/api/data/clients/${created.id}/changes`);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['changes', 'success']);
      assert.equal(res.body.changes.length, 2);
      for (const row of res.body.changes) assert.deepEqual(keysOf(row), CHANGE_KEYS);
      assert.deepEqual(res.body.changes.map((r) => r.changes.stickiness), [{ from: 4, to: 5 }, { from: 3, to: 4 }]);
      const [newest] = res.body.changes;
      assert.deepEqual([newest.client_id, newest.client_name, newest.changed_by_username, newest.source],
        [String(created.id), created.name, account.username, 'form']);
      assert.ok(!Number.isNaN(Date.parse(newest.created_at)));
      assert.ok(res.body.changes[0].id > res.body.changes[1].id);
    });

    test('a deleted client\'s history answers 200 with every row, the delete first; an id with no history, of either type or none, answers an empty list', async () => {
      const kevin = await seed('Kevin');
      const created = await addClient({ lead: kevin });
      assert.equal((await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, kevin, { stickiness: 1 }))).status, 200);
      assert.equal((await call('DELETE', `/api/data/clients/${created.id}`)).status, 204);
      const res = await call('GET', `/api/data/clients/${created.id}/changes`);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body.changes.map((r) => r.source), ['delete', 'form']);
      for (const id of [missingId, otherShapeId, 'not-an-id']) {
        const none = await call('GET', `/api/data/clients/${id}/changes`);
        assert.deepEqual([none.status, none.body], [200, { success: true, changes: [] }], id);
      }
    });
  });

  /* ------------------------------ /api/people ------------------------------ */

  route('GET /api/people', () => {
    // The page reads people[].id, name, role, active, lead_count,
    // second_chair_count and originator_count (src/PeopleDialog.jsx,
    // src/utils/people.js through src/portfolioStore.js, fetchPeople)
    test('200 { success, people }: every person with their counts, active first, then partners, emeritus, associates, by name', async () => {
      const person = await addPerson('partner', 'Counted Partner');
      const kevin = await seed('Kevin');
      await addClient({ lead: person, originator: person });
      await addClient({ lead: person });
      await addClient({ lead: kevin, second: person });
      const res = await call('GET', '/api/people');
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['people', 'success']);
      for (const p of res.body.people) assert.deepEqual(keysOf(p), PERSON_KEYS);
      const found = res.body.people.find((p) => p.id === person.id);
      assert.deepEqual([found.lead_count, found.second_chair_count, found.originator_count], [2, 1, 1]);
      for (const [name, role] of Object.entries(SEED)) {
        assert.ok(res.body.people.some((p) => p.name === name && p.role === role), name);
      }
      const rank = { partner: 0, emeritus: 1, associate: 2 };
      const order = res.body.people.map((p) => (p.active ? 0 : 3) + rank[p.role]);
      assert.deepEqual(order, [...order].sort((a, b) => a - b), 'active first, then partners, emeritus, associates');
      // By name within each group: checked on the seed partners' one-word
      // names, which every collation sorts alike (CI's database need not use C)
      const partners = res.body.people.map((p) => p.name).filter((name) => SEED[name] === 'partner');
      assert.deepEqual(partners, ['Brendan', 'Jeff', 'Joe', 'Kevin', 'Mike', 'Paula']);
    });
  });

  route('POST /api/people', () => {
    // The page reads person (src/portfolioStore.js, addPerson) and error on a
    // refusal (src/PeopleDialog.jsx)
    test('201 { success, person }: active, with zero counts; a name with an apostrophe stored as typed', async () => {
      const name = `${uniqueName('Mary')} O'Brien`;
      const res = await call('POST', '/api/people', { name: `  ${name.replace(' ', '   ')} `, role: 'associate' });
      assert.equal(res.status, 201, res.text);
      assert.deepEqual(keysOf(res.body), ['person', 'success']);
      assert.deepEqual(keysOf(res.body.person), PERSON_KEYS);
      assert.deepEqual({ ...res.body.person, id: 0 }, { id: 0, name, role: 'associate', active: true, lead_count: 0, second_chair_count: 0, originator_count: 0 });
      assert.equal((await db.query('SELECT name FROM people WHERE id = $1', [res.body.person.id])).rows[0].name, name);
    });

    test('400 { success: false, error, details: [{ field, message }] } for a missing, malformed, reserved or overlong name or an unknown role; nothing written', async () => {
      const count = async () => (await db.query('SELECT count(*)::int AS n FROM people')).rows[0].n;
      const before = await count();
      const refusals = [
        [{}, [{ field: 'name', message: 'Enter a name.' }, { field: 'role', message: 'Role must be partner, emeritus or associate.' }]],
        [{ name: 'R2 D2', role: 'partner' }, [{ field: 'name', message: 'Use letters, spaces, hyphens, apostrophes and periods only.' }]],
        [{ name: 'Firm', role: 'partner' }, [{ field: 'name', message: '"Firm" is reserved and cannot be a person\'s name.' }]],
        [{ name: 'A'.repeat(101), role: 'partner' }, [{ field: 'name', message: 'Names are at most 100 characters.' }]],
        [{ name: 'Some One', role: 'boss' }, [{ field: 'role', message: 'Role must be partner, emeritus or associate.' }]],
        [{ name: 'Some One', role: 'partner', active: 'yes' }, [{ field: 'active', message: 'Active must be true or false.' }]],
      ];
      for (const [body, details] of refusals) {
        const res = await call('POST', '/api/people', body);
        assert.deepEqual([res.status, res.body], [400, { success: false, error: details.map((d) => d.message).join(' '), details }], JSON.stringify(body).slice(0, 80));
      }
      assert.equal(await count(), before);
    });

    test('409 { success: false, error } for a name already on the list, in any case', async () => {
      const res = await call('POST', '/api/people', { name: 'KEVIN', role: 'associate' });
      assert.deepEqual([res.status, res.body], [409, { success: false, error: 'Someone named KEVIN is already on the People list.' }]);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM people WHERE lower(name) = 'kevin'")).rows[0].n, 1);
    });
  });

  route('PUT /api/people/:id', () => {
    // The page reads person (src/portfolioStore.js, updatePerson) and error on
    // a refusal, a 409's reason included (src/PeopleDialog.jsx)
    test('200 { success, person }: a role change, a deactivation and a reactivation of someone with no seat', async () => {
      const person = await addPerson('partner', 'Changing Partner');
      let res = await call('PUT', `/api/people/${person.id}`, { role: 'associate' });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['person', 'success']);
      assert.deepEqual(keysOf(res.body.person), PERSON_KEYS);
      assert.equal(res.body.person.role, 'associate');
      res = await call('PUT', `/api/people/${person.id}`, { active: false });
      assert.deepEqual([res.status, res.body.person.active], [200, false]);
      res = await call('PUT', `/api/people/${person.id}`, { active: true });
      assert.deepEqual([res.status, res.body.person.active], [200, true]);
    });

    test('a rename rewrites the legacy text that names the person: primary_lobbyist, lobbyist_team, and client_originator unless the credit is the firm\'s', async () => {
      const person = await addPerson('partner', 'Renamed Partner');
      const kevin = await seed('Kevin');
      const jay = await seed('Jay');
      const leads = await addClient({ lead: person, second: jay });
      const seconds = await addClient({ lead: kevin, second: person });
      const originated = await addClient({ lead: kevin, originator: person });
      const firmCredit = await addClient({ lead: kevin, originator: person, firm: true });
      const bystander = await addClient({ lead: kevin, second: jay, originator: kevin });
      const bystanderBefore = await storedClient(bystander.id);

      const renamed = uniqueName('Newly Named');
      const res = await call('PUT', `/api/people/${person.id}`, { name: renamed });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.person.name, renamed);
      assert.deepEqual([res.body.person.lead_count, res.body.person.second_chair_count, res.body.person.originator_count], [1, 1, 2]);

      const legacy = async (id) => {
        const row = await storedClient(id);
        return [row.primary_lobbyist, row.lobbyist_team, row.client_originator];
      };
      assert.deepEqual(await legacy(leads.id), [renamed, [renamed, 'Jay'], '']);
      assert.deepEqual(await legacy(seconds.id), ['Kevin', ['Kevin', renamed], '']);
      assert.deepEqual(await legacy(originated.id), ['Kevin', ['Kevin'], renamed]);
      assert.deepEqual(await legacy(firmCredit.id), ['Kevin', ['Kevin'], 'Firm']);
      assert.deepEqual(await storedClient(bystander.id), bystanderBefore);
      // The API's nested people carry the new name too
      const { body } = await call('GET', '/api/data/clients');
      assert.equal(body.clients.find((c) => String(c.id) === String(leads.id)).lead.name, renamed);
    });

    // WP6: a rename changes no client field (the people are ids), so it
    // writes no history and moves no updated_at: a form open on a client of
    // the person renamed still saves
    test('a rename logs nothing and leaves updated_at as it was: a client form loaded before it still saves (no 409)', async () => {
      const person = await addPerson('partner', 'History Partner');
      const created = await addClient({ lead: person });
      const loaded = await listedClient(created.id);
      const logged = await changeCount();
      const res = await call('PUT', `/api/people/${person.id}`, { name: uniqueName('History Renamed') });
      assert.equal(res.status, 200, res.text);
      assert.equal(await changeCount(), logged);
      assert.equal(await exactOf(created.id), loaded.updated_at_exact);
      const save = await call('PUT', `/api/data/clients/${created.id}`, storedBody(created, person, { stickiness: 4, expected_updated_at: loaded.updated_at_exact }));
      assert.equal(save.status, 200, save.text);
      const [row] = await changeRows(created.id);
      assert.deepEqual(row.changes, { stickiness: { from: 3, to: 4 } }, 'the lead is the same id: not a change');
    });

    // Tier 3 WP2, candidate (s): until then each of a rename's three updates
    // locked its own rows as it went. Two renames at once, of two people with
    // seats on the same two clients, then each locked one client with its
    // first update and waited for the other's with its second, and
    // PostgreSQL aborted one (40P01, a 500). The holder here keeps the first
    // rename waiting on Y until the second has started: on origin/main the
    // first then locks Y with its first update, the second holds X from its
    // own, and each waits for the other. Locked in id order first, the
    // second rename waits for the first instead
    test('two renames at once, of two people holding seats on the same two clients, wait for each other: both 200, every legacy name rewritten', async () => {
      const p = await addPerson('partner', 'Renaming First');
      const q = await addPerson('partner', 'Renaming Second');
      // X: Q leads, P seconds. Y: P leads, Q seconds
      const x = await addClient({ lead: q, second: p });
      const y = await addClient({ lead: p, second: q });
      const [pName, qName] = [uniqueName('Renamed First'), uniqueName('Renamed Second')];
      const holder = await lockHolder();
      let results;
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT id FROM clients WHERE id::text = $1 FOR UPDATE', [String(y.id)]);
        const first = call('PUT', `/api/people/${p.id}`, { name: pName });
        await waitFor(async () => (await lockWaiters()) >= 1, 'the first rename to wait for Y');
        const second = call('PUT', `/api/people/${q.id}`, { name: qName });
        await waitFor(async () => (await lockWaiters()) >= 2, 'the second rename to wait');
        await holder.query('COMMIT');
        results = await Promise.all([first, second]);
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        await holder.end();
      }
      assert.deepEqual(results.map((r) => r.status), [200, 200], results.map((r) => r.text).join(' '));
      assert.deepEqual(results.map((r) => r.body.person.name), [pName, qName]);
      const legacy = async (id) => {
        const row = await storedClient(id);
        return [row.primary_lobbyist, row.lobbyist_team];
      };
      assert.deepEqual(await legacy(x.id), [qName, [qName, pName]]);
      assert.deepEqual(await legacy(y.id), [pName, [pName, qName]]);
    });

    test('a role change and a (de)activation leave the legacy text as it is', async () => {
      const person = await addPerson('partner', 'Retitled Partner');
      const kevin = await seed('Kevin');
      const originated = await addClient({ lead: kevin, originator: person });
      const before = await storedClient(originated.id);
      assert.equal((await call('PUT', `/api/people/${person.id}`, { role: 'emeritus', active: false })).status, 200);
      assert.deepEqual(await storedClient(originated.id), before);
    });

    test('404 { success: false, error: "No such person." } for an id that is not a positive integer or not on the list', async () => {
      for (const id of ['abc', '0', '-1', '1.5', '2147483000']) {
        const res = await call('PUT', `/api/people/${id}`, { active: true });
        assert.deepEqual([res.status, res.body], [404, { success: false, error: 'No such person.' }], id);
      }
    });

    // As POST /api/data/clients': until Tier 2 WP2 parseId took an id above
    // PostgreSQL's integer range, and the query failed (500)
    test('404 { success: false, error: "No such person." } for an id above PostgreSQL\'s integer range', async () => {
      for (const id of ['2147483648', '99999999999']) {
        const res = await call('PUT', `/api/people/${id}`, { active: true });
        assert.deepEqual([res.status, res.body], [404, { success: false, error: 'No such person.' }], id);
      }
    });

    test('400 { success: false, error } for a malformed change or none', async () => {
      const person = await addPerson('associate', 'Unchanged Associate');
      let res = await call('PUT', `/api/people/${person.id}`, {});
      assert.deepEqual([res.status, res.body], [400, { success: false, error: 'Nothing to change.' }]);
      for (const [body, details] of [
        [{ name: '' }, [{ field: 'name', message: 'Enter a name.' }]],
        [{ role: 'boss' }, [{ field: 'role', message: 'Role must be partner, emeritus or associate.' }]],
        [{ active: 'no' }, [{ field: 'active', message: 'Active must be true or false.' }]],
      ]) {
        res = await call('PUT', `/api/people/${person.id}`, body);
        assert.deepEqual([res.status, res.body], [400, { success: false, error: details.map((d) => d.message).join(' '), details }], JSON.stringify(body));
      }
      assert.deepEqual((await db.query('SELECT name, role, active FROM people WHERE id = $1', [person.id])).rows[0],
        { name: person.name, role: 'associate', active: true });
    });

    // P5 (docs/plans/people-and-second-chair.md): the reasons, as the People dialog shows them
    test('409 { success: false, error } for what P5 forbids, and for a rename to a name already on the list; nothing written', async () => {
      const lead = await addPerson('partner', 'Leading Partner');
      const second = await addPerson('associate', 'Seated Associate');
      await addClient({ lead });
      await addClient({ lead, second });
      const refusals = [
        [lead, { role: 'associate' }, `${lead.name} leads 2 clients. Give them a new lead partner first.`],
        [lead, { active: false }, `${lead.name} leads 2 clients. Give them a new lead partner first.`],
        [second, { active: false }, `${second.name} is second chair on 1 client. Change it first.`],
        [lead, { name: 'kevin' }, 'Someone named kevin is already on the People list.'],
      ];
      for (const [person, change, error] of refusals) {
        const res = await call('PUT', `/api/people/${person.id}`, change);
        assert.deepEqual([res.status, res.body], [409, { success: false, error }], JSON.stringify(change));
      }
      const stored = (await db.query('SELECT id, name, role, active FROM people WHERE id = ANY($1) ORDER BY id', [[lead.id, second.id]])).rows;
      assert.deepEqual(stored, [lead, second]);
    });
  });

  /* -------------------------------- /api/ai -------------------------------- */

  route('GET /api/ai/book', () => {
    // The page reads reportingYear, clientCount, chars, estimatedTokens and
    // text (src/components/AIBookPanel.jsx)
    test('200 { success, reportingYear, clientCount, peopleCount, chars, estimatedTokens, text }; no AI rate limiter', async () => {
      const created = await addClient({ lead: await seed('Kevin') });
      const res = await call('GET', '/api/ai/book');
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['chars', 'clientCount', 'estimatedTokens', 'peopleCount', 'reportingYear', 'success', 'text']);
      assert.equal(res.body.clientCount, await clientCount());
      assert.equal(res.body.chars, res.body.text.length);
      assert.equal(res.body.estimatedTokens, Math.round(res.body.text.length / 4));
      assert.ok(Number.isInteger(res.body.reportingYear) && Number.isInteger(res.body.peopleCount));
      assert.ok(res.body.text.includes(created.name));
      assert.equal(res.headers.get('ratelimit-policy'), null, 'T16: opening the book spends no AI budget');
    });
  });

  // One streamed request, read as the page reads it (src/utils/sse.js)
  const streamPost = async (path, body, as = cookie) => {
    const res = await fetch(`${api.base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Cookie: as },
      body: JSON.stringify(body),
    });
    const events = [];
    const parser = createSseParser((event) => events.push({ type: event.type, data: eventJson(event) }));
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(value);
    }
    parser.end();
    return { status: res.status, headers: res.headers, events };
  };

  route('POST /api/ai/ask', () => {
    // The page reads (src/portfolioStore.js, askStream; src/AIAdvisor.jsx):
    // success, id, saved, kind, question, answer, truncated, refused and
    // refusalCategory; error on a refusal
    test('200 { success, id, saved, kind, question, answer, ... } through the fake Anthropic server, saved; behind the AI rate limiters', async () => {
      await addClient({ lead: await seed('Kevin') });
      const res = await call('POST', '/api/ai/ask', { question: '  Who carries the most?  ' });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), AI_ANSWER_KEYS);
      assert.deepEqual([res.body.success, res.body.saved, res.body.kind, res.body.question], [true, true, 'ask', 'Who carries the most?']);
      assert.deepEqual([res.body.truncated, res.body.refused, res.body.refusalCategory], [false, false, null]);
      assert.ok(res.body.answer.length > 0);
      assert.equal((await db.query('SELECT kind, question FROM ai_answers WHERE id = $1', [res.body.id])).rows[0].question, 'Who carries the most?');
      assert.ok(res.headers.get('ratelimit-policy'), 'T16: the AI limiters answer on POST /api/ai/ask');
    });

    // Tier 1 WP5: the page reads text events' text, and done's answerId,
    // saved, answer, truncated, refused and refusalCategory, and error events'
    // error (src/portfolioStore.js, askStream)
    test('streamed (Accept: text/event-stream): start { model }, text { text } events, then done with the JSON answer\'s fields and answerId', async () => {
      await addClient({ lead: await seed('Kevin') });
      const res = await streamPost('/api/ai/ask', { question: 'Who carries the most?' });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
      assert.equal(res.headers.get('cache-control'), 'no-cache, no-transform');
      assert.equal(res.headers.get('x-accel-buffering'), 'no');
      const types = res.events.map((e) => e.type);
      assert.equal(types[0], 'start');
      assert.equal(types.at(-1), 'done');
      assert.ok(types.slice(1, -1).length > 0 && types.slice(1, -1).every((t) => t === 'text'), types.join());
      assert.deepEqual(keysOf(res.events[0].data), ['model']);
      for (const e of res.events.filter((ev) => ev.type === 'text')) assert.deepEqual(keysOf(e.data), ['text']);
      const done = res.events.at(-1).data;
      const doneKeys = [...AI_ANSWER_KEYS.filter((k) => !['success', 'kind', 'question', 'id'].includes(k)), 'answerId'].sort();
      assert.deepEqual(keysOf(done), doneKeys);
      assert.equal(done.saved, true);
      assert.ok(Number.isInteger(done.answerId));
    });

    test('400 { success: false, error } for an empty, blank, missing or non-string question, and one over 2,000 characters', async () => {
      await addClient({ lead: await seed('Kevin') });
      for (const body of [{ question: '' }, { question: '  \n' }, {}, { question: 42 }]) {
        const res = await call('POST', '/api/ai/ask', body);
        assert.deepEqual([res.status, res.body], [400, { success: false, error: 'Type a question to ask.' }], JSON.stringify(body));
      }
      const res = await call('POST', '/api/ai/ask', { question: 'x'.repeat(2001) });
      assert.deepEqual([res.status, res.body], [400, { success: false, error: 'The question is too long: at most 2,000 characters.' }]);
    });

    // The book is emptied here, so this test needs nothing from any other
    test('400 { success: false, error: "The book has no clients yet." } on an empty book', async () => {
      await db.query('DELETE FROM clients');
      const res = await call('POST', '/api/ai/ask', { question: 'Who carries the most?' });
      assert.deepEqual([res.status, res.body], [400, { success: false, error: 'The book has no clients yet.' }]);
    });

    test('503 { success: false, error } without a key', async () => {
      await addClient({ lead: await seed('Kevin') });
      const res = await request(keyless.base, 'POST', '/api/ai/ask', { body: { question: 'Who carries the most?' } });
      assert.deepEqual([res.status, res.body], [503, NOT_CONFIGURED]);
    });

    // Tier 2 WP10 (S14): follow-ups, { question, parentId }. The page reads
    // parentId, followUp and canFollowUp (src/portfolioStore.js, askStream;
    // src/AIAdvisor.jsx). Each test's partner is its own (newPartner).
    const ask = (as, body) => request(api.base, 'POST', '/api/ai/ask', { as, body });
    const storedAnswer = async (id) => (await db.query('SELECT * FROM ai_answers WHERE id = $1', [id])).rows[0];

    test('a question, then two follow-ups: each saved with its parent and its turn, priced, counted once on the AI limiters; the fake received the book blocks byte-identical and the history appended, never edited', async () => {
      const partner = await newPartner();
      await addClient({ lead: await seed('Kevin') });
      const from = fake.requests.length;
      const first = await ask(partner.cookie, { question: 'Who carries the most?' });
      assert.equal(first.status, 200, first.text);
      const second = await ask(partner.cookie, { question: 'And after Kevin?', parentId: first.body.id });
      assert.equal(second.status, 200, second.text);
      const third = await ask(partner.cookie, { question: '  Why?  ', parentId: second.body.id });
      assert.equal(third.status, 200, third.text);
      for (const res of [first, second, third]) assert.deepEqual(keysOf(res.body), AI_ANSWER_KEYS);
      assert.deepEqual([first, second, third].map((r) => [r.body.kind, r.body.question, r.body.parentId, r.body.followUp, r.body.canFollowUp, r.body.saved]), [
        ['ask', 'Who carries the most?', null, 0, true, true],
        ['ask', 'And after Kevin?', first.body.id, 1, true, true],
        ['ask', 'Why?', second.body.id, 2, true, true],
      ]);
      // T16: each turn counted once on the AI limiters
      assert.deepEqual([aiBudgetLeft(first) - aiBudgetLeft(second), aiBudgetLeft(second) - aiBudgetLeft(third)], [1, 1]);

      // Saved as asked, with its parent and priced, and its turn as sent and returned
      const rows = [await storedAnswer(first.body.id), await storedAnswer(second.body.id), await storedAnswer(third.body.id)];
      assert.deepEqual(rows.map((r) => [r.kind, r.parent_id, r.question, r.asked_by_username, r.answer]), [
        ['ask', null, 'Who carries the most?', partner.username, first.body.answer],
        ['ask', first.body.id, 'And after Kevin?', partner.username, second.body.answer],
        ['ask', second.body.id, 'Why?', partner.username, third.body.answer],
      ]);
      for (const row of rows) {
        assert.ok(Number(row.cost_usd) > 0 && row.input_tokens > 0, 'priced');
        assert.equal(row.book_sha256, await todaysBookSha());
      }

      // What the fake received: the book blocks byte for byte, and each
      // request the one before with the answer it got (as saved) and the new question
      const sent = fake.requests.slice(from).map((r) => r.body);
      assert.equal(sent.length, 3);
      for (const body of sent) assert.equal(JSON.stringify(body.system), JSON.stringify(sent[0].system));
      assert.equal(sent[0].system[1].cache_control.type, 'ephemeral', 'the marker on the book');
      assert.deepEqual(sent.map((b) => b.messages.length), [1, 3, 5]);
      for (let i = 1; i < 3; i += 1) {
        const before = sent[i - 1].messages;
        assert.equal(JSON.stringify(sent[i].messages.slice(0, before.length)), JSON.stringify(before), `request ${i + 1} begins with request ${i}, byte for byte`);
        assert.deepEqual(sent[i].messages[before.length], rows[i - 1].content.messages[1], 'the answer as saved');
        assert.deepEqual(sent[i].messages[before.length].content[0], { type: 'thinking', thinking: '', signature: `fake-signature-${from + i}` },
          'the thinking block and its signature as the fake returned them');
        assert.deepEqual(sent[i].messages.at(-1), rows[i].content.messages[0], 'the question as sent is the turn saved');
      }
      assert.match(sent[2].messages.at(-1).content, /<question>\nWhy\?\n<\/question>$/);
      assert.deepEqual(sent.map((b) => b.cache_control ?? null), [null, { type: 'ephemeral' }, { type: 'ephemeral' }]);

      // The ai_call lines: the follow-ups are labelled follow-up
      const userId = await accountId(partner.username);
      const calls = await waitFor(() => {
        const lines = logLines(api, 'ai_call').filter((l) => l.userId === userId);
        return lines.length === 3 && lines;
      }, 'three ai_call lines');
      assert.deepEqual(calls.map((l) => l.label), ['ask', 'follow-up', 'follow-up']);
    });

    test('streamed (Accept: text/event-stream): a follow-up gives start, text events and done with parentId, followUp and canFollowUp, and is saved with its parent', async () => {
      const partner = await newPartner();
      await addClient({ lead: await seed('Kevin') });
      const first = await ask(partner.cookie, { question: 'Who carries the most?' });
      const from = fake.requests.length;
      const res = await streamPost('/api/ai/ask', { question: 'And after Kevin?', parentId: first.body.id }, partner.cookie);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
      assert.deepEqual([res.events[0].type, res.events.at(-1).type], ['start', 'done']);
      assert.ok(res.events.some((e) => e.type === 'text'));
      const done = res.events.at(-1).data;
      assert.deepEqual([done.parentId, done.followUp, done.canFollowUp, done.saved], [first.body.id, 1, true, true]);
      assert.equal((await storedAnswer(done.answerId)).parent_id, first.body.id);
      assert.equal(fake.requests.slice(from)[0].body.messages.length, 3);
    });

    test('the sixth follow-up is refused 400 before any call, and nothing is saved', async () => {
      const partner = await newPartner();
      await addClient({ lead: await seed('Kevin') });
      let last = await ask(partner.cookie, { question: 'Who carries the most?' });
      for (let n = 1; n <= 5; n += 1) {
        last = await ask(partner.cookie, { question: `Follow-up ${n}?`, parentId: last.body.id });
        assert.equal(last.status, 200, last.text);
        assert.deepEqual([last.body.followUp, last.body.canFollowUp], [n, n < 5]);
      }
      const [sent, saved] = [fake.requests.length, await answerCount()];
      const sixth = await ask(partner.cookie, { question: 'Follow-up 6?', parentId: last.body.id });
      assert.deepEqual([sixth.status, sixth.body], [400, { success: false, error: 'This thread already has its 5 follow-ups. Ask a new question.' }]);
      assert.deepEqual([fake.requests.length, await answerCount()], [sent, saved]);
    });

    test('refused before any call: a parentId that is not an answer id 400, a missing answer 404, a transition plan, an answer saved before follow-ups, a declined and a cut-off one 400; nothing sent, nothing saved', async () => {
      const partner = await newPartner();
      await addClient({ lead: await seed('Kevin') });
      const plan = await addAnswer({ kind: 'transition-plan' });
      const older = await addAnswer({ kind: 'ask' });
      const declined = await addAnswer({ kind: 'ask' });
      const cut = await addAnswer({ kind: 'ask' });
      await db.query("UPDATE ai_answers SET refused = true, answer = '', refusal_category = 'cyber' WHERE id = $1", [declined]);
      await db.query('UPDATE ai_answers SET truncated = true WHERE id = $1', [cut]);
      const [sent, saved] = [fake.requests.length, await answerCount()];
      const cases = [
        ['41', 400, 'parentId must be the id of an answer.'],
        [0, 400, 'parentId must be the id of an answer.'],
        [1.5, 400, 'parentId must be the id of an answer.'],
        [2147483000, 404, 'No such answer.'],
        [plan, 400, 'A transition plan cannot be followed up. Ask a new question.'],
        [older, 400, 'This answer was saved before follow-ups were possible, so it cannot be followed up. Ask a new question.'],
        [declined, 400, 'The AI declined this one, so it cannot be followed up. Ask a new question.'],
        [cut, 400, 'This answer was cut off, so it cannot be followed up. Ask a new, narrower question.'],
      ];
      for (const [parentId, status, error] of cases) {
        const res = await ask(partner.cookie, { question: 'And then?', parentId });
        assert.deepEqual([res.status, res.body], [status, { success: false, error }], JSON.stringify(parentId));
      }
      // The question is checked first
      const blank = await ask(partner.cookie, { question: ' ', parentId: '41' });
      assert.deepEqual([blank.status, blank.body.error], [400, 'Type a question to ask.']);
      assert.deepEqual([fake.requests.length, await answerCount()], [sent, saved]);
    });

    test('409 when the book has changed since the answer, before any call; an answer declined or cut off is saved without its turn and cannot be followed up', async () => {
      const partner = await newPartner();
      await addClient({ lead: await seed('Kevin') });
      const first = await ask(partner.cookie, { question: 'Who carries the most?' });
      assert.equal(first.body.canFollowUp, true);
      await addClient({ lead: await seed('Mike') });
      const [sent, saved] = [fake.requests.length, await answerCount()];
      const res = await ask(partner.cookie, { question: 'And after Kevin?', parentId: first.body.id });
      assert.deepEqual([res.status, res.body], [409, {
        success: false,
        error: 'The book has changed since this answer was given, so a follow-up would not read the same book. Ask a new question.',
      }]);
      assert.deepEqual([fake.requests.length, await answerCount()], [sent, saved]);

      for (const fixture of ['refusal-before-output.sse', 'max-tokens.sse']) {
        fake.enqueue(fixture);
        const answered = await ask(partner.cookie, { question: 'Who carries the most?' });
        assert.equal(answered.status, 200, answered.text);
        assert.deepEqual([answered.body.canFollowUp, answered.body.followUp], [false, 0], fixture);
        assert.equal((await storedAnswer(answered.body.id)).content, null, fixture);
      }
    });
  });

  route('POST /api/ai/brief', () => {
    // The page reads what it reads from Ask's answer (src/portfolioStore.js,
    // askStream; src/AIAdvisor.jsx); question is null
    test('200 { success, id, saved, kind: "brief", question: null, answer, ... } through the fake Anthropic server', async () => {
      await addClient({ lead: await seed('Kevin') });
      const res = await call('POST', '/api/ai/brief', {});
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), AI_ANSWER_KEYS);
      assert.deepEqual([res.body.success, res.body.saved, res.body.kind, res.body.question], [true, true, 'brief', null]);
      assert.ok(res.headers.get('ratelimit-policy'), 'T16: behind the AI limiters');
    });

    // Tier 2 WP10: a brief starts a thread as a question does
    test('the brief can be followed up: canFollowUp, and the follow-up sends the brief\'s turn as sent, then the question', async () => {
      const partner = await newPartner();
      await addClient({ lead: await seed('Kevin') });
      const brief = await request(api.base, 'POST', '/api/ai/brief', { as: partner.cookie, body: {} });
      assert.deepEqual([brief.status, brief.body.parentId, brief.body.followUp, brief.body.canFollowUp], [200, null, 0, true]);
      const from = fake.requests.length;
      const res = await request(api.base, 'POST', '/api/ai/ask', { as: partner.cookie, body: { question: 'Say more about Kevin.', parentId: brief.body.id } });
      assert.deepEqual([res.status, res.body.kind, res.body.parentId, res.body.followUp], [200, 'ask', brief.body.id, 1]);
      const [{ body }] = fake.requests.slice(from);
      assert.match(body.messages[0].content, /^Today is \d{4}-\d{2}-\d{2}\.\n\nWrite the brief:/);
      assert.deepEqual(body.messages.map((m) => m.role), ['user', 'assistant', 'user']);
    });

    test('400 { success: false, error: "The book has no clients yet." } on an empty book', async () => {
      await db.query('DELETE FROM clients');
      const res = await call('POST', '/api/ai/brief', {});
      assert.deepEqual([res.status, res.body], [400, { success: false, error: 'The book has no clients yet.' }]);
    });

    test('503 { success: false, error } without a key', async () => {
      await addClient({ lead: await seed('Kevin') });
      const res = await request(keyless.base, 'POST', '/api/ai/brief', { body: {} });
      assert.deepEqual([res.status, res.body], [503, NOT_CONFIGURED]);
    });
  });

  route('GET /api/ai/answers', () => {
    // The page reads answers[].id, kind, question, client_name,
    // asked_by_username, created_at, refused, truncated and cost_usd, and
    // hasMore (src/portfolioStore.js, fetchAiAnswers and fetchOlderAiAnswers;
    // src/AIAdvisor.jsx; src/utils/recentAnswers.js, answerTitle)
    test('200 { success, answers, hasMore }: newest first, a page of `limit` then the next with `before`; no AI rate limiter', async () => {
      for (let i = 0; i < 3; i += 1) await addAnswer({ kind: i === 1 ? 'transition-plan' : 'ask' });
      const newest = (await db.query('SELECT id FROM ai_answers ORDER BY created_at DESC, id DESC LIMIT 4')).rows.map((r) => r.id);
      const res = await call('GET', '/api/ai/answers?limit=2');
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['answers', 'hasMore', 'success']);
      for (const answer of res.body.answers) assert.deepEqual(keysOf(answer), LIST_ANSWER_KEYS);
      assert.deepEqual([res.body.answers.map((a) => a.id), res.body.hasMore], [newest.slice(0, 2), true]);
      assert.equal(res.body.answers[0].preview.length, 200);
      assert.equal(res.headers.get('ratelimit-policy'), null);
      const older = await call('GET', `/api/ai/answers?limit=2&before=${newest[1]}`);
      assert.deepEqual(older.body.answers.map((a) => a.id), newest.slice(2, 4));
      assert.equal((await call('GET', '/api/ai/answers')).body.answers.length <= 20, true, 'twenty by default');
    });

    test('400 { success: false, error } for a limit outside 1 to 50 or a before that is not an answer id', async () => {
      const limit = 'limit must be a whole number from 1 to 50.';
      const before = 'before must be the id of an answer.';
      const hidden = 'hidden must be 0 or 1.';
      for (const [query, error] of [['limit=0', limit], ['limit=51', limit], ['limit=x', limit], ['before=abc', before], ['before=0', before], ['hidden=x', hidden], ['hidden=true', hidden]]) {
        const res = await call('GET', `/api/ai/answers?${query}`);
        assert.deepEqual([res.status, res.body], [400, { success: false, error }], query);
      }
    });
    // Tier 2 WP10 (S15): the page reads earlier_book, parent_id, hidden_at and
    // hidden_by_username (src/AIAdvisor.jsx, src/utils/recentAnswers.js)
    test('a hidden answer leaves the list and hidden=1 lists the hidden ones, with who hid them; earlier_book marks an answer given on another book', async () => {
      const today = await todaysBookSha();
      const onToday = await addAnswer({ bookSha: today });
      const onEarlier = await addAnswer({ bookSha: 'b'.repeat(64) });
      const hidden = await addAnswer({ bookSha: today });
      assert.equal((await call('POST', `/api/ai/answers/${hidden}/hide`)).status, 200);
      const shown = (await call('GET', '/api/ai/answers?limit=50')).body.answers;
      const byId = Object.fromEntries(shown.map((a) => [a.id, a]));
      assert.deepEqual([byId[onToday].earlier_book, byId[onEarlier].earlier_book], [false, true]);
      assert.equal(byId[hidden], undefined, 'not in the list');
      assert.ok(shown.every((a) => a.hidden_at === null && a.hidden_by_username === null));
      assert.deepEqual(keysOf(byId[onToday]), LIST_ANSWER_KEYS);

      const res = await call('GET', '/api/ai/answers?hidden=1&limit=50');
      assert.equal(res.status, 200, res.text);
      const row = res.body.answers.find((a) => a.id === hidden);
      assert.deepEqual([row.hidden_by_username, typeof row.hidden_at, row.earlier_book], [account.username, 'string', false]);
      assert.ok(res.body.answers.every((a) => a.hidden_at !== null));
      assert.deepEqual(keysOf(row), LIST_ANSWER_KEYS);
      assert.equal(res.headers.get('ratelimit-policy'), null);
    });
  });

  route('GET /api/ai/answers/summary', () => {
    // The page reads answers, costUsd and unpriced (src/utils/recentAnswers.js,
    // monthLine, through src/portfolioStore.js, fetchAiAnswers)
    test('200 { success, timeZone, month, from, to, answers, costUsd, unpriced }: this month in America/New_York, as the table has it', async () => {
      await addAnswer({ cost: '0.5000' });
      await addAnswer({ cost: null });
      const month = aiAnswers.firmMonth(new Date());
      const res = await call('GET', '/api/ai/answers/summary');
      assert.equal(res.status, 200, res.text);
      const { rows: [sums] } = await db.query(`
        SELECT count(*)::int AS n, COALESCE(sum(cost_usd), 0)::text AS usd, (count(*) FILTER (WHERE cost_usd IS NULL))::int AS unpriced
          FROM ai_answers WHERE created_at >= $1 AND created_at < $2`, [month.from, month.to]);
      assert.deepEqual(res.body, {
        success: true, timeZone: 'America/New_York', month: month.month, from: month.from, to: month.to,
        answers: sums.n, costUsd: sums.usd, unpriced: sums.unpriced,
      });
      assert.ok(sums.unpriced >= 1);
      assert.equal(res.headers.get('ratelimit-policy'), null);
    });

    // Tier 2 WP10 (S15): a hidden answer was paid for, so it still counts
    test('a hidden answer still counts in the month', async () => {
      const id = await addAnswer({ cost: '0.2500' });
      const before = (await call('GET', '/api/ai/answers/summary')).body;
      await call('POST', `/api/ai/answers/${id}/hide`);
      const after = (await call('GET', '/api/ai/answers/summary')).body;
      assert.deepEqual([after.answers, after.costUsd, after.unpriced], [before.answers, before.costUsd, before.unpriced]);
    });
  });

  route('GET /api/ai/answers/:id', () => {
    // The page reads kind, question, answer, truncated, refused,
    // refusal_category, asked_by_username, created_at, served_by, model,
    // fell_back, input_tokens, output_tokens, cache_read_tokens,
    // cache_write_tokens, cost_usd and prices_read_on (src/AIAdvisor.jsx,
    // SavedAnswer, through src/portfolioStore.js, toggleAiAnswer)
    test('200 { success, answer }: the saved row whole, prices_read_on as YYYY-MM-DD and cost_usd as text', async () => {
      const id = await addAnswer({ kind: 'transition-plan', cost: '1.2345' });
      const res = await call('GET', `/api/ai/answers/${id}`);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['answer', 'success']);
      assert.deepEqual(keysOf(res.body.answer), ANSWER_KEYS);
      const a = res.body.answer;
      assert.deepEqual([a.id, a.kind, a.client_id, a.client_name, a.cost_usd, a.prices_read_on], [id, 'transition-plan', '42', 'A client', '1.2345', '2026-09-01']);
      assert.deepEqual([a.input_tokens, a.output_tokens, a.cache_read_tokens, a.cache_write_tokens], [10, 20, 30, 40]);
      assert.equal(res.headers.get('ratelimit-policy'), null);
    });

    test('404 { success: false, error: "No such answer." } for an id that is not a positive integer or not found', async () => {
      const { rows: [{ max }] } = await db.query('SELECT COALESCE(max(id), 0) AS max FROM ai_answers');
      for (const id of ['abc', '0', '-1', '1.5', '99999999999', String(max + 1000)]) {
        const res = await call('GET', `/api/ai/answers/${id}`);
        assert.deepEqual([res.status, res.body], [404, { success: false, error: 'No such answer.' }], id);
      }
    });

    // Tier 2 WP10: the page reads thread (each turn's question, answer,
    // kind, refused, truncated, asked_by_username and created_at),
    // follow_up, can_follow_up, earlier_book, parent_id, hidden_at and
    // hidden_by_username (src/AIAdvisor.jsx, SavedAnswer)
    test('a follow-up: its thread before it, its number, whether it can be followed up now, and no stored turn; after the book changes, earlier_book and no follow-up', async () => {
      const partner = await newPartner();
      await addClient({ lead: await seed('Kevin') });
      const first = await request(api.base, 'POST', '/api/ai/ask', { as: partner.cookie, body: { question: 'Who carries the most?' } });
      const second = await request(api.base, 'POST', '/api/ai/ask', { as: partner.cookie, body: { question: 'And after Kevin?', parentId: first.body.id } });
      let res = await call('GET', `/api/ai/answers/${second.body.id}`);
      assert.equal(res.status, 200, res.text);
      let a = res.body.answer;
      assert.deepEqual(keysOf(a), ANSWER_KEYS);
      assert.deepEqual([a.parent_id, a.follow_up, a.can_follow_up, a.earlier_book, a.hidden_at], [first.body.id, 1, true, false, null]);
      assert.equal(a.thread.length, 1);
      assert.deepEqual(keysOf(a.thread[0]), THREAD_TURN_KEYS);
      assert.deepEqual([a.thread[0].id, a.thread[0].question, a.thread[0].answer, a.thread[0].asked_by_username],
        [first.body.id, 'Who carries the most?', first.body.answer, partner.username]);
      const root = (await call('GET', `/api/ai/answers/${first.body.id}`)).body.answer;
      assert.deepEqual([root.follow_up, root.can_follow_up, root.thread], [0, true, []]);

      await addClient({ lead: await seed('Mike') });
      a = (await call('GET', `/api/ai/answers/${second.body.id}`)).body.answer;
      assert.deepEqual([a.earlier_book, a.can_follow_up], [true, false]);
      // An answer saved before follow-ups: none
      const older = (await call('GET', `/api/ai/answers/${await addAnswer({ bookSha: await todaysBookSha() })}`)).body.answer;
      assert.deepEqual([older.follow_up, older.can_follow_up, older.earlier_book, older.thread], [0, false, false, []]);
    });
  });

  // Tier 2 WP10 (S15): the page reads success and answer (id, hidden_at,
  // hidden_by_username) (src/portfolioStore.js, setAiAnswerHidden)
  route('POST /api/ai/answers/:id/hide', () => {
    test('200 { success, answer: { id, hidden_at, hidden_by_username } }: hidden from every partner\'s list, kept in the table; hiding again keeps who hid it first; no AI limiter', async () => {
      const other = await newPartner('hider');
      const id = await addAnswer();
      const count = await answerCount();
      const res = await call('POST', `/api/ai/answers/${id}/hide`);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['answer', 'success']);
      assert.deepEqual(keysOf(res.body.answer), ['hidden_at', 'hidden_by_username', 'id']);
      assert.deepEqual([res.body.answer.id, res.body.answer.hidden_by_username], [id, account.username]);
      assert.equal(res.headers.get('ratelimit-policy'), null, 'T16');
      const row = (await db.query('SELECT hidden_at, hidden_by, hidden_by_username FROM ai_answers WHERE id = $1', [id])).rows[0];
      assert.deepEqual([row.hidden_by, row.hidden_by_username, row.hidden_at.toISOString()], [await accountId(), account.username, res.body.answer.hidden_at]);
      assert.equal(await answerCount(), count, 'nothing deleted');
      // The other partner's list no longer has it; hiding it again changes nothing
      const listed = (await request(api.base, 'GET', '/api/ai/answers?limit=50', { as: other.cookie })).body.answers;
      assert.equal(listed.some((a) => a.id === id), false);
      const again = await request(api.base, 'POST', `/api/ai/answers/${id}/hide`, { as: other.cookie, body: {} });
      assert.deepEqual([again.status, again.body], [200, res.body]);
    });

    test('404 { success: false, error: "No such answer." } for an id that is not a positive integer or not found; nothing changed', async () => {
      const { rows: [{ max }] } = await db.query('SELECT COALESCE(max(id), 0) AS max FROM ai_answers');
      const hiddenBefore = (await db.query('SELECT count(*)::int AS n FROM ai_answers WHERE hidden_at IS NOT NULL')).rows[0].n;
      for (const id of ['abc', '0', '-1', '1.5', '99999999999', String(max + 1000)]) {
        const res = await call('POST', `/api/ai/answers/${id}/hide`, {});
        assert.deepEqual([res.status, res.body], [404, { success: false, error: 'No such answer.' }], id);
      }
      assert.equal((await db.query('SELECT count(*)::int AS n FROM ai_answers WHERE hidden_at IS NOT NULL')).rows[0].n, hiddenBefore);
    });
  });

  route('POST /api/ai/answers/:id/show', () => {
    test('200 { success, answer }: shown again in every partner\'s list, by any partner, who hid it cleared', async () => {
      const other = await newPartner('shower');
      const id = await addAnswer();
      await call('POST', `/api/ai/answers/${id}/hide`);
      const res = await request(api.base, 'POST', `/api/ai/answers/${id}/show`, { as: other.cookie, body: {} });
      assert.deepEqual([res.status, res.body], [200, { success: true, answer: { id, hidden_at: null, hidden_by_username: null } }]);
      assert.equal(res.headers.get('ratelimit-policy'), null, 'T16');
      assert.deepEqual((await db.query('SELECT hidden_at, hidden_by, hidden_by_username FROM ai_answers WHERE id = $1', [id])).rows[0],
        { hidden_at: null, hidden_by: null, hidden_by_username: null });
      assert.ok((await call('GET', '/api/ai/answers?limit=50')).body.answers.some((a) => a.id === id));
      // Showing an answer that is not hidden changes nothing
      assert.deepEqual((await call('POST', `/api/ai/answers/${id}/show`, {})).body, res.body);
    });

    test('404 { success: false, error: "No such answer." } for an id that is not a positive integer or not found', async () => {
      const { rows: [{ max }] } = await db.query('SELECT COALESCE(max(id), 0) AS max FROM ai_answers');
      for (const id of ['abc', '0', '-1', '1.5', '99999999999', String(max + 1000)]) {
        const res = await call('POST', `/api/ai/answers/${id}/show`, {});
        assert.deepEqual([res.status, res.body], [404, { success: false, error: 'No such answer.' }], id);
      }
    });
  });

  /* ---------------------------- /api/scenarios ----------------------------- */

  route('POST /api/scenarios/transition-plan', () => {
    // A request as Stage 2 sends one (planRequest, src/utils/transitionPlans.js):
    // one client, the partner leaving, and the roster of people staying
    const planBody = async () => {
      const mike = await seed('Mike');
      const created = await addClient({ lead: mike });
      const { rows: [row] } = await db.query('SELECT id, name FROM clients WHERE id::text = $1', [String(created.id)]);
      const zero = { count: 0, revenue: 0, effort: 0 };
      const roster = Object.entries(SEED).filter(([name]) => name !== 'Mike').map(([name, role]) => ({ name, role, lead: zero, second: zero }));
      return {
        client: { id: row.id, name: row.name },
        stage1Data: { departing: [{ name: 'Mike', role: 'partner' }], impactData: { totalRevenueAtRisk: 100000 }, reportingYear: 2026 },
        roster,
      };
    };

    // The page reads success, plan (stored whole: strategy, recommendedLead
    // and recommendedSecondChair with person, none and problem, timelineDays,
    // risks, tasks, communicationTemplate, priority, truncated) and error
    // (src/components/succession/ClientReviewInterface.jsx)
    test('200 { success, plan, answerId, saved, timestamp } through the fake Anthropic server; the recommendations resolved against the roster; behind the AI rate limiters', async () => {
      const body = await planBody();
      const res = await call('POST', '/api/scenarios/transition-plan', body);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['answerId', 'plan', 'saved', 'success', 'timestamp']);
      assert.deepEqual(keysOf(res.body.plan), [
        'clientId', 'clientName', 'communicationTemplate', 'createdAt', 'priority', 'recommendedLead',
        'recommendedSecondChair', 'refused', 'risks', 'status', 'strategy', 'tasks', 'timelineDays', 'truncated',
      ]);
      assert.deepEqual([res.body.success, res.body.saved, res.body.plan.clientId], [true, true, body.client.id]);
      for (const side of ['recommendedLead', 'recommendedSecondChair']) {
        assert.deepEqual(keysOf(res.body.plan[side]), ['none', 'person', 'problem', 'text'], side);
        assert.ok(body.roster.some((p) => p.name === res.body.plan[side].person?.name), `${side} from the roster`);
      }
      const saved = (await db.query('SELECT kind, client_id FROM ai_answers WHERE id = $1', [res.body.answerId])).rows[0];
      assert.deepEqual(saved, { kind: 'transition-plan', client_id: String(body.client.id) });
      assert.ok(res.headers.get('ratelimit-policy'), 'T16: behind the AI limiters');
    });

    test('400 { success: false, error } for a request without a client or stage1Data, or with a roster the People list refuses; none reaches the model', async () => {
      const body = await planBody();
      const reached = fake.requests.length;
      const zero = { count: 0, revenue: 0, effort: 0 };
      const refusals = [
        [{ ...body, client: undefined }, 'client.id (a string or a positive integer) and client.name (a string) are required'],
        [{ ...body, client: { ...body.client, id: -1 } }, 'client.id (a string or a positive integer) and client.name (a string) are required'],
        [{ ...body, stage1Data: [] }, 'stage1Data (object) is required'],
        [{ ...body, roster: undefined }, 'roster must list the 1 to 50 people who are staying'],
        [{ ...body, roster: [...body.roster, { name: 'Nobody', role: 'partner', lead: zero, second: zero }] }, 'Not on the People list: Nobody.'],
        [{ ...body, roster: [...body.roster, { name: 'Mike', role: 'partner', lead: zero, second: zero }] }, 'Leaving, so not on the roster: Mike.'],
      ];
      for (const [request, error] of refusals) {
        const res = await call('POST', '/api/scenarios/transition-plan', request);
        assert.equal(res.status, 400, error);
        assert.equal(res.body.success, false);
        assert.equal(res.body.error, error);
      }
      assert.equal(fake.requests.length, reached);
    });

    test('404 { success: false, error: "Client not found." } for a client not in the book, before the model', async () => {
      const body = await planBody();
      const reached = fake.requests.length;
      const res = await call('POST', '/api/scenarios/transition-plan', {
        ...body, client: { ...body.client, id: shape.idType === 'integer' ? Number(missingId) : missingId },
      });
      assert.deepEqual([res.status, res.body], [404, { success: false, error: 'Client not found.' }]);
      assert.equal(fake.requests.length, reached);
    });

    // Tier 2 WP7 (S11): the prompt's succession lines and the plan's priority
    // are the server's, from the book's entry: the figures GET lists for the
    // client, whatever the request's client carried
    test('200: the succession metrics in the prompt, and the priority, are the server\'s, not the request\'s', async () => {
      const body = await planBody();
      const listed = await listedClient(body.client.id);
      // Mike leads it, no second chair, Stickiness 3, Monthly, Healthcare, Low:
      // secondary, 1, 3 (2 and 4 until Tier 3 WP13, U41, took the area out)
      assert.deepEqual(metricsOf(listed), { relationshipType: 'secondary', transitionComplexity: 1, successionRisk: 3 });
      const res = await call('POST', '/api/scenarios/transition-plan', {
        ...body, client: { ...body.client, relationshipType: 'shared', transitionComplexity: 9, successionRisk: 10 },
      });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.plan.priority, 'low', 'from risk 3; the request\'s 10 would be critical');
      const turn = fake.requests.at(-1).body.messages[0].content;
      for (const line of ['- **Relationship Type**: secondary', '- **Succession Risk**: 3/10', '- **Transition Complexity**: 1/10']) {
        assert.ok(turn.includes(`${line}\n`), line);
      }
      assert.doesNotMatch(turn, /shared|10\/10|9\/10/);
    });

    // Tier 3 WP2, candidate (v): until then the plan's clientName and the
    // saved answer's client_name, which every partner's Recent answers shows
    // as "Transition plan: <client>", echoed the request's name. A partner of
    // the test's own: the AI limiter counts 30 an hour per partner
    test('200: the plan\'s clientName and its saved client_name are the client\'s name as the book lists it, whatever name the request carried', async () => {
      const body = await planBody();
      const partner = await newPartner('plan-name');
      const res = await request(api.base, 'POST', '/api/scenarios/transition-plan', {
        as: partner.cookie, body: { ...body, client: { ...body.client, name: 'Someone Else Entirely' } },
      });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.plan.clientName, body.client.name);
      const saved = (await db.query('SELECT client_id, client_name FROM ai_answers WHERE id = $1', [res.body.answerId])).rows[0];
      assert.deepEqual(saved, { client_id: String(body.client.id), client_name: body.client.name });
      const listed = (await call('GET', '/api/ai/answers')).body.answers.find((a) => a.id === res.body.answerId);
      assert.equal(listed.client_name, body.client.name);
      assert.ok(!fake.requests.at(-1).body.messages[0].content.includes('Someone Else Entirely'), 'the prompt had the book\'s name already');
    });

    test('503 { success: false, error } without a key', async () => {
      const res = await request(keyless.base, 'POST', '/api/scenarios/transition-plan', { body: await planBody() });
      assert.deepEqual([res.status, res.body], [503, NOT_CONFIGURED]);
    });
  });

  /* ----------------------------- /api/scenarios ---------------------------- */

  // Saved Scenarios (docs/plans/tier-2.md, S12, WP8). The page reads a
  // saved scenario's fields in src/portfolioStore.js (openScenario,
  // saveScenario) and src/utils/scenarioState.js (openState): id, name,
  // state, version, updated_by_username, updated_at; the list's fields in
  // src/components/succession/ScenarioBar.jsx: id, name, kind, current_stage,
  // leaving, associates (WP9), updated_by_username, updated_at
  const SCENARIO_KEYS = ['created_at', 'created_by_username', 'id', 'name', 'state', 'updated_at', 'updated_by_username', 'version'];
  const LIST_SCENARIO_KEYS = ['associates', 'created_at', 'created_by_username', 'current_stage', 'id', 'kind', 'leaving', 'name', 'updated_at', 'updated_by_username', 'version'];
  const SCENARIO_NOT_FOUND = { success: false, error: 'Scenario not found.' };
  // A departure scenario's state as the page saves one: Mike leaving, a pick,
  // a plan with the AI's fields and an edit, and Stage 3's records, for a
  // client this call creates
  const scenarioBody = async ({ name = uniqueName('Scenario'), state = {} } = {}) => {
    const mike = await seed('Mike');
    const created = await addClient({ lead: mike });
    const id = String(created.id);
    return {
      name,
      state: {
        kind: 'departure',
        currentStage: 'implementation',
        departingIds: [String(mike.id)],
        choices: { [id]: { secondChairId: null } },
        plans: {
          [id]: {
            answerId: null,
            ai: {
              strategy: 'Two meetings, then a letter.',
              recommendedLead: { person: { id: (await seed('Jeff')).id, name: 'Jeff', role: 'partner' }, none: false, text: 'Jeff', problem: null },
              recommendedSecondChair: { person: null, none: true, text: 'None', problem: null },
              timelineDays: 45,
              risks: 'The client may follow Mike.',
              tasks: ['Call the client', 'Send the letter'],
              communicationTemplate: 'Dear client,',
              priority: 'medium',
              truncated: false,
              refused: false,
            },
            edits: { strategy: 'One meeting, then a letter.' },
            status: 'approved',
            updatedAt: '2026-09-29T14:00:00.000Z',
          },
        },
        execution: { [id]: { startDate: '2026-09-29', status: 'at-risk' } },
        tasks: [{ id: `${id}-0`, title: 'Call the client', description: '', assignee: 'Jeff', dueDate: '', priority: 'medium', status: 'pending', clientId: id, category: 'transition' }],
        communications: [{ id: 'comm-1', type: 'call', subject: 'First call', content: 'They took it well.', date: '2026-09-29', outcome: 'positive', clientId: id, timestamp: '2026-09-29T15:00:00.000Z' }],
        ...state,
      },
      clientId: id,
      mike,
    };
  };
  const saveScenario = async (body, as = cookie) => {
    const res = await request(api.base, 'POST', '/api/scenarios', { as, body: { name: body.name, state: body.state } });
    assert.equal(res.status, 201, res.text);
    return res.body.scenario;
  };
  const scenarioRow = async (id) => (await db.query('SELECT * FROM scenarios WHERE id = $1', [id])).rows[0];
  const scenarioCount = async () => (await db.query('SELECT count(*)::int AS n FROM scenarios')).rows[0].n;
  // A second partner, signed in on the same server, made once per shape
  let second = null;
  const secondPartner = async () => {
    if (!second) {
      const partner = { username: `second-${letters(6)}`, password: generatedPassword() };
      await addAccount(env, partner);
      second = { ...partner, cookie: await signIn(api.base, partner) };
    }
    return second;
  };
  // The firm's AI budget left, from the limiters' RateLimit header (the
  // daily limiter answers last, so the header is its count)
  const budgetLeft = (res) => Number(/remaining=(\d+)/.exec(res.headers.get('ratelimit') || '')?.[1]);
  // A transition-plan request for a client this call creates, as Stage 2 sends one
  const aiPlanBody = async () => {
    const mike = await seed('Mike');
    const created = await addClient({ lead: mike });
    const zero = { count: 0, revenue: 0, effort: 0 };
    return {
      client: { id: created.id, name: created.name },
      stage1Data: { departing: [{ name: 'Mike', role: 'partner' }], impactData: { totalRevenueAtRisk: 100000 }, reportingYear: 2026 },
      roster: Object.entries(SEED).filter(([name]) => name !== 'Mike').map(([name, role]) => ({ name, role, lead: zero, second: zero })),
    };
  };

  // A hire scenario (WP9) as the page saves one, for two partner-led
  // clients this call creates (one with an empty seat, one Paula seconds):
  // one hypothetical associate with a Healthcare focus, both clients picked
  // with the seat as the scenario saw it, and the toggle on. The state is
  // built by the page's own helpers from this API's clients and People list.
  const hireBody = async ({ name = uniqueName('Hire Scenario') } = {}) => {
    const kevin = await seed('Kevin');
    const paula = await seed('Paula');
    const open = await addClient({ lead: kevin });
    const held = await addClient({ lead: kevin, second: paula });
    const clients = (await call('GET', '/api/data/clients')).body.clients;
    const people = (await call('GET', '/api/people')).body.people;
    const listed = (id) => clients.find((c) => String(c.id) === String(id));
    const associates = [{ ...newAssociate([], { people, clients }), focus: ['Healthcare'], target: { kind: 'count', count: 0 } }];
    const picks = withPick(withPick({}, listed(open.id), 'h1'), listed(held.id), 'h1');
    const state = stateFromStore({ scenarioKind: 'hire', hireScenario: { associates, picks, relief: true } });
    return { name, state, open, held, kevin, paula };
  };

  route('GET /api/scenarios', () => {
    test('200 { success, scenarios }: newest save first, each with who saved last and when and the people leaving by name (null for an id not on the People list); no AI limiter', async () => {
      const first = await saveScenario(await scenarioBody());
      const body = await scenarioBody();
      const later = await saveScenario({ ...body, state: { ...body.state, departingIds: [String(body.mike.id), '2147483000'] } });
      const res = await call('GET', '/api/scenarios');
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['scenarios', 'success']);
      assert.equal(res.headers.get('ratelimit-policy'), null, 'T16: the saved scenarios spend no AI budget');
      const ids = res.body.scenarios.map((s) => s.id);
      assert.ok(ids.indexOf(later.id) >= 0 && ids.indexOf(later.id) < ids.indexOf(first.id), 'newest save first');
      const listed = res.body.scenarios.find((s) => s.id === later.id);
      assert.deepEqual(keysOf(listed), LIST_SCENARIO_KEYS);
      assert.deepEqual(
        [listed.name, listed.kind, listed.current_stage, listed.version, listed.created_by_username, listed.updated_by_username],
        [body.name, 'departure', 'implementation', 1, account.username, account.username],
      );
      assert.deepEqual(listed.leaving, [{ id: String(body.mike.id), name: 'Mike' }, { id: '2147483000', name: null }]);
      assert.deepEqual(listed.associates, [], 'a departure has no associates');
      assert.ok(!('state' in listed), 'the list does not carry the states');
      assert.equal(Date.parse(listed.updated_at), Date.parse(later.updated_at));
    });

    // WP9: the list shows a hire scenario by its kind and its associates
    test('200: a hire scenario is listed with kind "hire", no stage, nobody leaving, and its associates with the person each is linked to now (null for none)', async () => {
      const body = await hireBody();
      const ria = await addPerson('associate', 'Ria');
      const state = {
        ...body.state,
        associates: [
          { ...body.state.associates[0], personId: String(ria.id) },
          { id: 'h2', label: 'Energy hire', focus: ['Energy'], target: { kind: 'average' }, personId: null },
        ],
      };
      const saved = await saveScenario({ name: body.name, state });
      const listed = (await call('GET', '/api/scenarios')).body.scenarios.find((s) => s.id === saved.id);
      assert.deepEqual(keysOf(listed), LIST_SCENARIO_KEYS);
      assert.deepEqual([listed.kind, listed.current_stage, listed.leaving], ['hire', null, []]);
      assert.deepEqual(listed.associates, [
        { id: 'h1', label: 'New associate', person: ria.name },
        { id: 'h2', label: 'Energy hire', person: null },
      ]);
    });
  });

  route('GET /api/scenarios/:id', () => {
    test('200 { success, scenario }: the state as saved, with its version and who saved it; no AI limiter', async () => {
      const body = await scenarioBody();
      const saved = await saveScenario(body);
      const res = await call('GET', `/api/scenarios/${saved.id}`);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['scenario', 'success']);
      assert.deepEqual(keysOf(res.body.scenario), SCENARIO_KEYS);
      assert.deepEqual(res.body.scenario.state, body.state);
      assert.deepEqual([res.body.scenario.name, res.body.scenario.version, res.body.scenario.updated_by_username], [body.name, 1, account.username]);
      assert.equal(res.headers.get('ratelimit-policy'), null);
    });

    // The page's side (src/utils/scenarioState.js) on this shape's ids:
    // Stage 2's real plan for a client, an edit, an approval and Stage 3,
    // saved and read back as the page built it, and opened on the same book
    // with nothing dropped
    test('200: a scenario the page builds from this API\'s clients, People list and plan comes back as saved and opens on the same book with nothing dropped', async () => {
      const mike = await seed('Mike');
      const created = await addClient({ lead: mike, second: await seed('Jay') });
      const id = String(created.id);
      const clients = (await call('GET', '/api/data/clients')).body.clients;
      const people = (await call('GET', '/api/people')).body.people;
      const revenueOf = (client) => revenueForYear(client, 2026);
      const departingIds = [mike.id];
      let departure = departureModel({ people, clients, departingIds, revenueOf, choices: {} });
      const decision = departure.decisions.find((d) => String(d.client.id) === id);
      const answer = await call('POST', '/api/scenarios/transition-plan', planRequest(decision, departure, 2026));
      assert.equal(answer.status, 200, answer.text);
      let plan = withEdits(withAiPlan(undefined, answer.body), { strategy: 'Ours, not the AI\'s.' });
      assert.equal(plan.answerId, answer.body.answerId);
      plan = { ...plan, status: 'approved' };
      const choices = withChoice({}, id, pinnedChoice(decision));
      departure = departureModel({ people, clients, departingIds, revenueOf, choices });
      const today = new Date().toISOString().split('T')[0];
      const { transitions, tasks } = syncTransitions({ decisions: departure.decisions, plans: planViews({ [id]: plan }), transitions: [], tasks: [], today });
      const state = stateFromStore({
        successionWorkflow: { currentStage: 'implementation', departingIds, choices },
        transitionPlans: { [id]: plan },
        activeTransitions: transitions,
        heldTransitions: [],
        transitionTasks: tasks,
        communicationLog: [],
      });
      assert.equal(Object.keys(state.execution).length, 1);

      const saved = await saveScenario({ name: uniqueName('Page Scenario'), state });
      const res = await call('GET', `/api/scenarios/${saved.id}`);
      assert.equal(res.status, 200, res.text);
      assert.equal(stateJson(res.body.scenario.state), stateJson(state));
      assert.deepEqual(res.body.scenario.state.plans[id].ai.recommendedLead, answer.body.plan.recommendedLead);
      const opened = openState(res.body.scenario.state, { people, clients, reportingYear: 2026, today });
      assert.deepEqual(opened.notices, []);
      assert.equal(stateJson(stateFromStore(opened)), stateJson(state));
      assert.deepEqual(opened.activeTransitions, transitions);
    });

    // WP9: a hire scenario, built by the page from this shape's ids
    test('200: a hire scenario the page builds from this API\'s clients and People list comes back as saved and opens on the same book with nothing dropped', async () => {
      const body = await hireBody();
      const saved = await saveScenario(body);
      const res = await call('GET', `/api/scenarios/${saved.id}`);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body.scenario.state, body.state);
      assert.equal(stateJson(res.body.scenario.state), stateJson(body.state));
      assert.deepEqual(body.state.picks[String(body.held.id)], { associateId: 'h1', seenSecondChairId: String(body.paula.id) });
      const clients = (await call('GET', '/api/data/clients')).body.clients;
      const people = (await call('GET', '/api/people')).body.people;
      const opened = openState(res.body.scenario.state, { people, clients, reportingYear: 2026, today: new Date().toISOString().split('T')[0] });
      assert.deepEqual([opened.scenarioKind, opened.notices], ['hire', []]);
      assert.equal(stateJson(stateFromStore(opened)), stateJson(body.state));
      const model = hireScenarioModel({ people, clients, revenueOf: (c) => revenueForYear(c, 2026), ...opened.hireScenario });
      assert.deepEqual(model.seats.filter((s) => s.source === 'pick').map((s) => s.clientId).sort(), [String(body.open.id), String(body.held.id)].sort());
    });

    test('404 { success: false, error: "Scenario not found." } for an id no scenario has, or one that is not a positive integer in PostgreSQL\'s integer range', async () => {
      for (const id of ['2147483000', '0', '-1', 'abc', '1.5', '2147483648', '99999999999']) {
        const res = await call('GET', `/api/scenarios/${id}`);
        assert.deepEqual([res.status, res.body], [404, SCENARIO_NOT_FOUND], id);
      }
    });
  });

  route('POST /api/scenarios', () => {
    test('201 { success, scenario } at version 1: stored exactly as sent, by the signed-in partner (created_by and updated_by, the username copied); no AI limiter, and none of the AI budget spent', async () => {
      const plan = await call('POST', '/api/scenarios/transition-plan', await aiPlanBody());
      assert.equal(plan.status, 200, plan.text);
      const before = budgetLeft(plan);
      assert.ok(Number.isInteger(before), plan.headers.get('ratelimit'));

      const body = await scenarioBody({ name: `${'Ω'.repeat(60)}${'😀'.repeat(60)}` });
      const res = await call('POST', '/api/scenarios', { name: body.name, state: body.state });
      assert.equal(res.status, 201, res.text);
      assert.deepEqual(keysOf(res.body), ['scenario', 'success']);
      assert.deepEqual(keysOf(res.body.scenario), SCENARIO_KEYS);
      assert.equal(res.headers.get('ratelimit-policy'), null);
      const row = await scenarioRow(res.body.scenario.id);
      assert.deepEqual(row.state, body.state);
      assert.deepEqual(
        [row.name, row.version, row.created_by, row.created_by_username, row.updated_by, row.updated_by_username],
        [body.name, 1, await accountId(), account.username, await accountId(), account.username],
        'a 120-character name is stored, however many bytes',
      );
      // Four more scenario requests, then a plan: the budget moved by that plan alone
      await call('GET', '/api/scenarios');
      await call('GET', `/api/scenarios/${row.id}`);
      await call('PUT', `/api/scenarios/${row.id}`, { name: body.name, state: body.state, version: 1 });
      await call('DELETE', `/api/scenarios/${row.id}`);
      const next = await call('POST', '/api/scenarios/transition-plan', await aiPlanBody());
      assert.equal(next.status, 200, next.text);
      assert.equal(budgetLeft(next), before - 1, 'T16: only the plans count');
    });

    // Trap 3: trimRequestBody trims every string in the body, the state's
    // text included; the page trims the same way before it saves or compares
    // (src/utils/scenarioState.js), so nothing it holds differs from what is stored
    test('201: every string in the name and the state is stored trimmed, as trimRequestBody passes it on', async () => {
      const body = await scenarioBody();
      const id = body.clientId;
      const padded = {
        ...body.state,
        departingIds: [` ${body.state.departingIds[0]} `],
        plans: { [id]: { ...body.state.plans[id], edits: { strategy: '  One meeting.\n\n' } } },
        communications: [{ ...body.state.communications[0], content: '\tThey took it well. ' }],
      };
      const saved = await saveScenario({ name: `  ${body.name}  `, state: padded });
      const row = await scenarioRow(saved.id);
      assert.equal(row.name, body.name);
      assert.deepEqual(row.state.departingIds, body.state.departingIds);
      assert.equal(row.state.plans[id].edits.strategy, 'One meeting.');
      assert.equal(row.state.communications[0].content, 'They took it well.');
    });

    test('400 { success: false, error: "Validation failed", details: [{ field, message }] } for a name or a state checkScenario refuses; nothing written', async () => {
      const body = await scenarioBody();
      const id = body.clientId;
      const plan = body.state.plans[id];
      const withState = (state) => ({ name: body.name, state: { ...body.state, ...state } });
      const refusals = [
        ['a body that is not an object', [body], [{ field: 'body', message: 'The request body must be a JSON object: { name, state }.' }]],
        ['no name', { state: body.state }, [{ field: 'name', message: 'The scenario needs a name.' }]],
        ['a blank name', { name: '   ', state: body.state }, [{ field: 'name', message: 'The scenario needs a name.' }]],
        ['a name over 120 characters', { name: 'x'.repeat(121), state: body.state }, [{ field: 'name', message: 'The name is 121 characters; it can be at most 120.' }]],
        ['no state', { name: body.name }, [{ field: 'state', message: 'The scenario\'s state must be a JSON object.' }]],
        // WP9 added 'hire'; until then this row sent kind 'hire' and answered "must be one of departure."
        ['another kind', withState({ kind: 'growth' }), [{ field: 'state.kind', message: 'state.kind must be one of departure, hire.' }]],
        ['a hire key in a departure', withState({ relief: true }), [{ field: 'state.relief', message: 'state cannot hold "relief"; it holds only kind, currentStage, departingIds, choices, plans, execution, tasks, communications.' }]],
        ['a hypothetical associate\'s id as someone leaving', withState({ departingIds: ['h1'] }), [{ field: 'state.departingIds.0', message: 'state.departingIds.0 must be a person\'s id as text.' }]],
        ['a stage the page has not', withState({ currentStage: 'done' }), [{ field: 'state.currentStage', message: 'state.currentStage must be one of impact, mitigation, implementation.' }]],
        ['a person\'s id as a number', withState({ departingIds: [Number(body.mike.id)] }), [{ field: 'state.departingIds.0', message: 'state.departingIds.0 must be a person\'s id as text.' }]],
        ['a load the engine derives', withState({ before: { rows: [] } }), [{ field: 'state.before', message: 'state cannot hold "before"; it holds only kind, currentStage, departingIds, choices, plans, execution, tasks, communications.' }]],
        ['a client\'s name in a plan', withState({ plans: { [id]: { ...plan, clientName: 'Acme' } } }),
          [{ field: `state.plans.${id}.clientName`, message: `state.plans.${id} cannot hold "clientName"; it holds only answerId, ai, edits, status, updatedAt.` }]],
        ['a plan status the page has not', withState({ plans: { [id]: { ...plan, status: 'done' } } }),
          [{ field: `state.plans.${id}.status`, message: `state.plans.${id}.status must be one of pending, planned, approved, rejected.` }]],
        ['an edited timeline of 0 days', withState({ plans: { [id]: { ...plan, edits: { timelineDays: 0 } } } }),
          [{ field: `state.plans.${id}.edits.timelineDays`, message: `state.plans.${id}.edits.timelineDays must be a whole number of days from 1 to 36500, or null.` }]],
        ['an AI strategy that is not text', withState({ plans: { [id]: { ...plan, ai: { ...plan.ai, strategy: 42 } } } }),
          [{ field: `state.plans.${id}.ai.strategy`, message: `state.plans.${id}.ai.strategy must be text or null.` }]],
        ['a client id that is neither shape\'s', withState({ choices: { abc: { leadId: '1' } } }), [{ field: 'state.choices.abc', message: '"abc" is not a client id.' }]],
        ['a Stage 3 start that is not a date', withState({ execution: { [id]: { startDate: 'soon', status: 'in-progress' } } }),
          [{ field: `state.execution.${id}.startDate`, message: `state.execution.${id}.startDate must be a date, YYYY-MM-DD.` }]],
        ['a task without an id', withState({ tasks: [{ title: 'Call the client' }] }), [{ field: 'state.tasks.0.id', message: 'state.tasks.0.id is required.' }]],
        ['more plans than the bound', withState({ plans: Object.fromEntries(Array.from({ length: 501 }, (_, n) => [String(n + 1), plan])) }),
          [{ field: 'state.plans', message: 'state.plans holds 501 clients; it can hold at most 500.' }]],
        ['a state over 1,000,000 bytes', withState({ communications: [{ id: 'c', content: 'x'.repeat(1000001) }] }),
          [{ field: 'state', message: `The scenario is ${Buffer.byteLength(JSON.stringify({ ...body.state, communications: [{ id: 'c', content: 'x'.repeat(1000001) }] })).toLocaleString('en-US')} bytes; it can be at most 1,000,000.` }]],
      ];
      // WP9: a hire scenario holds only its own keys, and a hypothetical id never passes for a person's
      const hired = await hireBody();
      const withHire = (state) => ({ name: hired.name, state: { ...hired.state, ...state } });
      const [associate] = hired.state.associates;
      const pickOf = String(hired.open.id);
      refusals.push(
        ['a departure key in a hire', withHire({ departingIds: [] }), [{ field: 'state.departingIds', message: 'state cannot hold "departingIds"; it holds only kind, associates, picks, relief.' }]],
        ['a load in a hire', withHire({ seats: [] }), [{ field: 'state.seats', message: 'state cannot hold "seats"; it holds only kind, associates, picks, relief.' }]],
        ['a People list id as an associate\'s', withHire({ associates: [{ ...associate, id: '7' }] }),
          [{ field: 'state.associates.0.id', message: 'state.associates.0.id must be a scenario-local id: h1, h2 and so on.' },
            { field: `state.picks.${pickOf}.associateId`, message: `state.picks.${pickOf}.associateId must be the id of one of this scenario's associates, or null.` },
            { field: `state.picks.${hired.held.id}.associateId`, message: `state.picks.${hired.held.id}.associateId must be the id of one of this scenario's associates, or null.` }]],
        ['a hypothetical id as the seat the scenario saw', withHire({ picks: { [pickOf]: { associateId: 'h1', seenSecondChairId: 'h1' } } }),
          [{ field: `state.picks.${pickOf}.seenSecondChairId`, message: `state.picks.${pickOf}.seenSecondChairId must be a person's id as text, or null.` }]],
        ['a focus off the form\'s list', withHire({ associates: [{ ...associate, focus: ['Financial services'] }] }),
          [{ field: 'state.associates.0.focus.0', message: `state.associates.0.focus.0 must be one of ${PRACTICE_AREA_LIST}.` }]],
        // Tier 3 WP13 (U43 (b)): the focus is not client data, so a retired name is refused
        ['a retired practice area as a focus', withHire({ associates: [{ ...associate, focus: ['Environmental'] }] }),
          [{ field: 'state.associates.0.focus.0', message: `state.associates.0.focus.0 must be one of ${PRACTICE_AREA_LIST}.` }]],
        ['a toggle that is not true or false', withHire({ relief: 'on' }), [{ field: 'state.relief', message: 'state.relief must be true or false.' }]],
      );
      const before = await scenarioCount();
      for (const [what, request, details] of refusals) {
        const res = await call('POST', '/api/scenarios', request);
        assert.equal(res.status, 400, what);
        assert.deepEqual(res.body, { success: false, error: 'Validation failed', details }, what);
        assert.equal(res.headers.get('ratelimit-policy'), null, what);
      }
      assert.equal(await scenarioCount(), before);
    });

    test('201: a session whose account is gone saves with created_by and updated_by null and the username kept', async () => {
      const gone = { username: `gone-${letters(6)}`, password: generatedPassword() };
      await addAccount(env, gone);
      const goneCookie = await signIn(api.base, gone);
      await db.query('DELETE FROM users WHERE username = $1', [gone.username]);
      const saved = await saveScenario(await scenarioBody(), goneCookie);
      const row = await scenarioRow(saved.id);
      assert.deepEqual([row.created_by, row.created_by_username, row.updated_by, row.updated_by_username], [null, gone.username, null, gone.username]);
    });
  });

  route('PUT /api/scenarios/:id', () => {
    test('200 { success, scenario } at the next version: the name and the state replaced, saved by the partner who saved (another partner here), created_by as it was; no AI limiter', async () => {
      const body = await scenarioBody();
      const saved = await saveScenario(body);
      const other = await secondPartner();
      const state = { ...body.state, currentStage: 'mitigation', execution: {}, tasks: [], communications: [] };
      const res = await request(api.base, 'PUT', `/api/scenarios/${saved.id}`, { as: other.cookie, body: { name: `${body.name} again`, state, version: 1 } });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), ['scenario', 'success']);
      assert.deepEqual(keysOf(res.body.scenario), SCENARIO_KEYS);
      assert.equal(res.headers.get('ratelimit-policy'), null);
      const row = await scenarioRow(saved.id);
      assert.deepEqual(row.state, state);
      assert.deepEqual(
        [row.name, row.version, row.created_by_username, row.updated_by_username, res.body.scenario.version],
        [`${body.name} again`, 2, account.username, other.username, 2],
      );
      assert.equal(row.created_by, await accountId());
      assert.equal(row.updated_by, await accountId(other.username));
      assert.ok(row.updated_at > row.created_at);
    });

    test('409 { success: false, error, latest_save } when another save came first: who saved last and when, in America/New_York; nothing written', async () => {
      const body = await scenarioBody();
      const saved = await saveScenario(body);
      const other = await secondPartner();
      const theirs = await request(api.base, 'PUT', `/api/scenarios/${saved.id}`, { as: other.cookie, body: { name: body.name, state: { ...body.state, currentStage: 'impact' }, version: 1 } });
      assert.equal(theirs.status, 200, theirs.text);
      const stored = await scenarioRow(saved.id);

      const mine = await call('PUT', `/api/scenarios/${saved.id}`, { name: 'Mine', state: body.state, version: 1 });
      assert.equal(mine.status, 409, mine.text);
      const latest = { version: 2, updated_by_username: other.username, updated_at: stored.updated_at };
      assert.deepEqual(mine.body, JSON.parse(JSON.stringify(scenarioState.conflictBody(latest))));
      assert.match(mine.body.error, new RegExp(`^This scenario was saved after you opened it, by ${other.username} on [A-Z][a-z]{2} \\d{1,2}, \\d{4}, \\d{1,2}:\\d{2} [AP]M\\. Nothing was saved\\.$`));
      assert.deepEqual(await scenarioRow(saved.id), stored);
    });

    test('two saves in flight with one version: one 200 and one 409, and the version moves once', async () => {
      const body = await scenarioBody();
      const saved = await saveScenario(body);
      const other = await secondPartner();
      const results = await Promise.all([
        call('PUT', `/api/scenarios/${saved.id}`, { name: 'Mine', state: body.state, version: 1 }),
        request(api.base, 'PUT', `/api/scenarios/${saved.id}`, { as: other.cookie, body: { name: 'Theirs', state: body.state, version: 1 } }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const row = await scenarioRow(saved.id);
      assert.equal(row.version, 2);
      assert.equal(row.name, results[0].status === 200 ? 'Mine' : 'Theirs');
    });

    test('400 before the id is looked up, then 404: a body checkScenario refuses, or a version that is not a positive integer, answers 400 for any id; a well-formed body answers 404 for an id no scenario has; nothing written', async () => {
      const body = await scenarioBody();
      const saved = await saveScenario(body);
      const stored = await scenarioRow(saved.id);
      const versionDetail = [{ field: 'version', message: 'version must be the whole number the scenario was opened at.' }];
      for (const version of [undefined, 0, -1, '1', 1.5, null]) {
        for (const id of [saved.id, '2147483000', 'abc']) {
          const res = await call('PUT', `/api/scenarios/${id}`, { name: body.name, state: body.state, version });
          assert.deepEqual([res.status, res.body], [400, { success: false, error: 'Validation failed', details: versionDetail }], `${version} on ${id}`);
        }
      }
      const blank = await call('PUT', '/api/scenarios/2147483000', { name: '', state: body.state, version: 1 });
      assert.deepEqual([blank.status, blank.body.details], [400, [{ field: 'name', message: 'The scenario needs a name.' }]]);
      const notObject = await call('PUT', '/api/scenarios/2147483000', []);
      assert.deepEqual([notObject.status, notObject.body.details], [400, [{ field: 'body', message: 'The request body must be a JSON object: { name, state, version }.' }]]);
      for (const id of ['2147483000', '0', 'abc', '2147483648']) {
        const res = await call('PUT', `/api/scenarios/${id}`, { name: body.name, state: body.state, version: 1 });
        assert.deepEqual([res.status, res.body], [404, SCENARIO_NOT_FOUND], id);
      }
      assert.deepEqual(await scenarioRow(saved.id), stored);
    });
  });

  route('DELETE /api/scenarios/:id', () => {
    test('200 { success: true } for any partner (P2), after which it answers 404 to GET, PUT and DELETE; no AI limiter', async () => {
      const body = await scenarioBody();
      const saved = await saveScenario(body);
      const other = await secondPartner();
      const res = await request(api.base, 'DELETE', `/api/scenarios/${saved.id}`, { as: other.cookie });
      assert.deepEqual([res.status, res.body], [200, { success: true }]);
      assert.equal(res.headers.get('ratelimit-policy'), null);
      assert.equal(await scenarioRow(saved.id), undefined);
      assert.deepEqual([(await call('GET', `/api/scenarios/${saved.id}`)).status, (await call('DELETE', `/api/scenarios/${saved.id}`)).status], [404, 404]);
      const put = await call('PUT', `/api/scenarios/${saved.id}`, { name: body.name, state: body.state, version: 1 });
      assert.deepEqual([put.status, put.body], [404, SCENARIO_NOT_FOUND]);
    });

    test('404 { success: false, error: "Scenario not found." } for an id no scenario has or a malformed one; nothing deleted', async () => {
      await saveScenario(await scenarioBody());
      const before = await scenarioCount();
      for (const id of ['2147483000', '0', 'abc', '2147483648']) {
        const res = await call('DELETE', `/api/scenarios/${id}`);
        assert.deepEqual([res.status, res.body], [404, SCENARIO_NOT_FOUND], id);
      }
      assert.equal(await scenarioCount(), before);
    });
  });

  /* ------------------------------ /api/health ------------------------------ */

  route('GET /api/health', () => {
    // The page reads features (src/DataUploadManager.jsx, src/components/AIBookPanel.jsx,
    // src/AIAdvisor.jsx, src/components/AssociateSplit.jsx,
    // src/components/succession/ClientReviewInterface.jsx); the uptime
    // monitor reads status (deploy/README.md, section 11)
    const HEALTH_KEYS = ['environment', 'features', 'services', 'status', 'timestamp', 'uptimeSeconds'];

    test('200 without sign-in: status OK with the database connected and a key; the features the page asks for', async () => {
      const res = await request(api.base, 'GET', '/api/health', { as: '' });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(keysOf(res.body), HEALTH_KEYS);
      assert.equal(res.body.status, 'OK');
      // effort: null while AI_EFFORT is unset, the API's default (Tier 3 WP1, U3 (b))
      assert.deepEqual(res.body.services, { database: 'connected', anthropic: 'configured', model: 'claude-opus-5', effort: null });
      assert.deepEqual(res.body.features, FEATURES);
      assert.equal(res.body.environment, 'development');
      assert.ok(Number.isInteger(res.body.uptimeSeconds) && !Number.isNaN(Date.parse(res.body.timestamp)));
    });

    test('200 with status DEGRADED and anthropic "not configured" without a key', async () => {
      const res = await request(keyless.base, 'GET', '/api/health', { as: '' });
      assert.equal(res.status, 200);
      assert.deepEqual([res.body.status, res.body.services], ['DEGRADED', { database: 'connected', anthropic: 'not configured', model: 'claude-opus-5', effort: null }]);
    });

    // Tier 3 WP1: Render's two settings for the model Jeff chose. The health
    // check names both (U3 (b)); an Ask sends the model with the fallback and
    // the effort, logs both in its ai_call line, and is priced and saved
    test('with AI_MODEL claude-sonnet-5-5 and AI_EFFORT medium: both in services, and an Ask sends them with the fallback, priced', async () => {
      const server = await launch({ ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: fake.url, AI_MODEL: 'claude-sonnet-5-5', AI_EFFORT: 'medium' });
      try {
        const health = await request(server.base, 'GET', '/api/health', { as: '' });
        assert.equal(health.status, 200);
        assert.deepEqual([health.body.status, health.body.services], ['OK', { database: 'connected', anthropic: 'configured', model: 'claude-sonnet-5-5', effort: 'medium' }]);

        await addClient({ lead: await seed('Kevin') });
        const from = fake.requests.length;
        const res = await request(server.base, 'POST', '/api/ai/ask', { body: { question: 'Who carries the most?' } });
        assert.equal(res.status, 200, res.text);
        assert.deepEqual([res.body.saved, res.body.model, res.body.servedBy], [true, 'claude-sonnet-5-5', 'claude-sonnet-5-5']);
        assert.ok(res.body.costUsd > 0, 'priced');
        const [sent] = fake.requests.slice(from);
        assert.deepEqual(
          [sent.body.model, sent.body.fallbacks, sent.body.output_config, sent.headers['anthropic-beta'], 'thinking' in sent.body],
          ['claude-sonnet-5-5', 'default', { effort: 'medium' }, 'server-side-fallback-2026-07-01', false],
        );
        const call = await waitFor(() => logLines(server, 'ai_call').at(-1), 'the ai_call line');
        assert.deepEqual([call.model, call.effort, call.servedBy, call.costUsd > 0], ['claude-sonnet-5-5', 'medium', 'claude-sonnet-5-5', true]);
        const saved = (await db.query('SELECT model, served_by, cost_usd FROM ai_answers WHERE id = $1', [res.body.id])).rows[0];
        assert.deepEqual([saved.model, saved.served_by, Number(saved.cost_usd) > 0], ['claude-sonnet-5-5', 'claude-sonnet-5-5', true]);
      } finally {
        stop(server);
      }
    });

    test('200 with status DEGRADED and database "disconnected" when the database cannot be reached', async () => {
      const server = await launch({ DATABASE_URL: urlFor(`${dbName}_missing`), ANTHROPIC_API_KEY: 'test' }, { database: false });
      try {
        const res = await request(server.base, 'GET', '/api/health', { as: '' });
        assert.equal(res.status, 200);
        assert.deepEqual(keysOf(res.body), HEALTH_KEYS);
        assert.deepEqual([res.body.status, res.body.services.database, res.body.services.anthropic], ['DEGRADED', 'disconnected', 'configured']);
      } finally {
        stop(server);
      }
    });
  });

  /* --------------------------- Before every route -------------------------- */

  // server.cjs's own middleware, ahead of every route (CLAUDE.md, "Auth,
  // sessions and rate limits"), and the routes deleted earlier
  describe('before any route', () => {
    test('a write from a foreign browser origin answers 403 and changes nothing; an allowed origin passes', async () => {
      const name = uniqueName('Origin Person');
      const refused = await call('POST', '/api/people', { name, role: 'associate' }, { headers: { Origin: 'https://example.com' } });
      assert.deepEqual([refused.status, refused.body], [403, { success: false, error: 'Cross-origin request refused' }]);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM people WHERE name = $1', [name])).rows[0].n, 0);
      // The line, once it has arrived (waitFor, constraint 8)
      await waitFor(() => logLines(api, 'origin_refused').some((l) => l.origin === 'https://example.com' && l.path === '/api/people'),
        'the origin_refused line');
      const allowed = await call('POST', '/api/people', { name, role: 'associate' }, { headers: { Origin: 'http://localhost:5173' } });
      assert.equal(allowed.status, 201, allowed.text);
    });

    test('malformed JSON answers 400 and a body over 5 MB answers 413, each { error, message }', async () => {
      const malformed = await call('POST', '/api/people', '{"name": ');
      assert.equal(malformed.status, 400);
      assert.deepEqual(keysOf(malformed.body), ['error', 'message']);
      assert.equal(malformed.body.error, 'Bad request');
      const large = await call('POST', '/api/data/process-csv', { csvData: [{ CLIENT: 'x'.repeat(5 * 1024 * 1024) }] });
      assert.equal(large.status, 413);
      assert.deepEqual(keysOf(large.body), ['error', 'message']);
      assert.equal(large.body.error, 'Request body too large (5 MB limit)');
    });

    test('the routes deleted earlier answer 404', async () => {
      for (const key of REMOVED) {
        const [method, path] = key.split(' ');
        const res = await call(method, path, {});
        assert.equal(res.status, 404, key);
      }
    });
  });

  /* -------------------------------- Start-up ------------------------------- */

  // server.cjs listens only once its start-up, the connection test and
  // init-db.sql, has finished (Tier 3 WP3, candidate (o)); until then it
  // listened at once, and a request could reach a route before init-db.sql had
  // run. On one table shape: the order does not depend on it, and production's
  // older tables are Render's (docs/plans/tier-3.md section 7). Its
  // development path without a database, which still listens, is
  // /api/health's DEGRADED test above.
  if (shape.tables) describe('start-up', () => {
    test('nothing listens while init-db.sql waits for a lock it needs; once it has run the server listens, its lines in the order deploy/README.md 9.2 gives', async () => {
      // init-db.sql's ALTER TABLE clients takes ACCESS EXCLUSIVE, which waits
      // for this ACCESS SHARE until the holder's transaction ends
      const holder = await lockHolder();
      const port = await freePort();
      const base = `http://127.0.0.1:${port}`;
      const answer = () => fetch(`${base}/api/health`).then((res) => res.status, (error) => error.cause?.code ?? error.message);
      let server;
      try {
        await holder.query('BEGIN');
        await holder.query('LOCK TABLE clients IN ACCESS SHARE MODE');
        server = startServer({ ...env, PORT: String(port) });
        servers.push(server);
        server.ready.catch(() => {});
        await waitFor(async () => (await lockWaiters()) > 0, 'init-db.sql to wait for the lock');
        assert.equal(await answer(), 'ECONNREFUSED', 'the port answers nothing while init-db.sql waits');
        assert.ok(!server.output.includes('Server running on port'), server.output);
        await holder.query('COMMIT');
        await server.ready;
        await waitFor(() => server.output.includes('Environment: '), 'the last start-up line');
        assert.deepEqual(server.output.trim().split('\n').map((line) => line.replace(/^\W+/, '')), [
          'Testing database connection...',
          'PostgreSQL connection OK',
          'Initializing database tables...',
          'Database tables initialized',
          `Server running on port ${port}`,
          'Environment: development',
        ]);
        assert.equal(await answer(), 200, 'and answers once it listens');
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        await holder.end();
        if (server) stop(server);
      }
    });
  });
});
