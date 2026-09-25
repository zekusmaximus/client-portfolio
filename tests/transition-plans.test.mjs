// src/utils/transitionPlans.js (docs/plans/people-and-second-chair.md, Phase
// 5b): the roster a transition-plan request carries, the accepted plan as an
// import sheet of CLIENT, Lead and Second Chair, and Stage 3's transitions,
// which hold only what the plans and the partner hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
import { departureModel } from '../src/utils/departure.js';
import { revenueForYear } from '../src/utils/revenue.js';
import {
  rosterFor,
  planRequest,
  pinnedChoice,
  approvalBlocker,
  sheetCell,
  buildTransitionSheet,
  seatsLeftAfterSheet,
  syncTransitions,
  executionSummary,
} from '../src/utils/transitionPlans.js';

const person = (id, name, role, active = true) => ({ id, name, role, active });
const PEOPLE = [
  person(1, 'Joe', 'partner'), person(2, 'Kevin', 'partner'), person(3, 'Paula', 'partner'),
  person(4, 'Jay', 'emeritus'), person(5, 'Anna', 'associate'), person(6, 'Ben', 'associate'),
  person(7, 'Steve', 'partner', false),
];
const at = new Map(PEOPLE.map((p) => [p.name, p]));
const client = (id, name, lead, second, effort, amount, extra = {}) => ({
  id, name, lead: at.get(lead) || null, secondChair: second ? at.get(second) : null,
  practiceArea: [], effort, successionRisk: 5,
  revenues: [{ year: 2026, revenue_amount: String(amount) }], ...extra,
});
const CLIENTS = [
  client(11, 'Health, "Network" & Co', 'Kevin', 'Anna', 3, 60000),
  client(12, 'Energy Coalition', 'Kevin', 'Paula', 2, 40000),
  client(13, 'Muni League', 'Paula', 'Kevin', 1, 20000),
  client(14, 'Quiet Client', 'Joe', 'Ben', 1, 10000),
];
const revenueOf = (c) => revenueForYear(c, 2026);
const model = (departingIds, choices = {}) => departureModel({ people: PEOPLE, clients: CLIENTS, departingIds, revenueOf, choices });
const approved = (...ids) => Object.fromEntries(ids.map((id) => [String(id), { status: 'approved', timelineDays: null, tasks: [] }]));

test('rosterFor: the active people staying, with the Partnership tab\'s loads', () => {
  const m = model([2]);
  const roster = rosterFor(m);
  assert.deepEqual(roster.map((r) => r.name), ['Joe', 'Paula', 'Jay', 'Anna', 'Ben']);
  const paula = roster.find((r) => r.name === 'Paula');
  assert.deepEqual(paula, {
    name: 'Paula', role: 'partner',
    lead: { count: 1, revenue: 20000, effort: 1 },
    second: { count: 1, revenue: 40000, effort: 0.4 },
  });
  assert.ok(!roster.some((r) => r.name === 'Steve'), 'nobody inactive');
  assert.ok(!roster.some((r) => r.name === 'Kevin'), 'nobody leaving');

  const body = planRequest(m.decisions[0], m, 2026);
  assert.equal(body.client, m.decisions[0].client);
  assert.deepEqual(body.stage1Data, { departing: [{ name: 'Kevin', role: 'partner' }], impactData: { totalRevenueAtRisk: 120000 }, reportingYear: 2026 });
  assert.deepEqual(body.roster, roster);
});

test('the accepted plan as an import sheet: CLIENT, Lead, Second Chair, approved clients only, kept second chairs written out', () => {
  const m = model([2]);
  // Kevin leads 11 and 12 and seconds 13; Paula, 12's second chair, is promoted
  const sheet = buildTransitionSheet(m.decisions, { ...approved(11, 12, 13), 14: { status: 'approved' } });
  const parsed = Papa.parse(sheet.csv, { header: true, skipEmptyLines: true });
  assert.deepEqual(parsed.meta.fields, ['CLIENT', 'Lead', 'Second Chair']);
  const byClient = Object.fromEntries(parsed.data.map((r) => [r.CLIENT, [r.Lead, r['Second Chair']]]));
  assert.deepEqual(Object.keys(byClient), ['Energy Coalition', 'Health, "Network" & Co', 'Muni League'], 'by name; an unaffected client is never in it');
  const d = (id) => m.decisions.find((x) => x.client.id === id);
  assert.deepEqual(byClient['Energy Coalition'], ['Paula', d(12).secondChair.after.name]);
  assert.deepEqual(byClient['Health, "Network" & Co'], [d(11).lead.after.name, 'Anna'], 'the kept second chair, not a blank that would clear it');
  assert.deepEqual(byClient['Muni League'], ['Paula', d(13).secondChair.after.name]);
  assert.match(sheet.csv, /^CLIENT,Lead,Second Chair\r\n/);
  assert.ok(sheet.csv.includes('"Health, ""Network"" & Co"'), 'quoted as CSV, and nothing else: the import must read the name exactly');
  assert.ok(!sheet.csv.startsWith('﻿'));

  // Only approved plans
  const one = buildTransitionSheet(m.decisions, approved(12));
  assert.deepEqual(one.rows.map((r) => r.client.id), [12]);
  assert.deepEqual(buildTransitionSheet(m.decisions, {}).rows, []);
  // An empty seat by choice is a blank cell
  const empty = model([2], { 13: { secondChairId: null } });
  assert.match(buildTransitionSheet(empty.decisions, approved(13)).csv, /\r\nMuni League,Paula,\r\n$/);

  assert.equal(sheetCell('=SUM(A1)'), '=SUM(A1)', 'no formula guard: the name must round-trip');
  assert.equal(sheetCell('a"b'), '"a""b"');
  assert.equal(sheetCell(null), '');
});

test('the sheet leaves out an approved plan the model can no longer apply, and says why', () => {
  // Every partner leaves: nobody can lead Kevin's clients
  const none = model([1, 2, 3]);
  const sheet = buildTransitionSheet(none.decisions, approved(11));
  assert.deepEqual(sheet.rows, []);
  assert.deepEqual(sheet.skipped.map((s) => [s.client.id, s.reason]), [[11, 'No active partner who is staying can lead this client.']]);

  // A pinned pick that is now leaving
  const pinned = model([2, 1], { 11: { leadId: 1 } });
  const blocked = buildTransitionSheet(pinned.decisions, approved(11));
  assert.deepEqual(blocked.skipped.map((s) => s.reason), ['The lead you picked was not applied: Joe is leaving.']);
  assert.equal(approvalBlocker(pinned.decisions.find((d) => d.client.id === 11)), 'The lead you picked was not applied: Joe is leaving.');
});

test('pinnedChoice freezes the seats as they stand; seatsLeftAfterSheet names who still holds a seat', () => {
  const m = model([2]);
  const d12 = m.decisions.find((d) => d.client.id === 12);
  assert.deepEqual(pinnedChoice(d12), { leadId: 3, secondChairId: d12.secondChair.after.id });
  const d13 = m.decisions.find((d) => d.client.id === 13);
  assert.deepEqual(pinnedChoice(d13), { secondChairId: d13.secondChair.after.id }, 'no lead pick where the lead stays');

  // Pinning every seat changes nothing
  const choices = Object.fromEntries(m.decisions.map((d) => [d.client.id, pinnedChoice(d)]));
  const again = model([2], choices);
  assert.deepEqual(again.decisions.map((d) => [d.lead.after?.id, d.secondChair.after?.id]), m.decisions.map((d) => [d.lead.after?.id, d.secondChair.after?.id]));

  const partial = buildTransitionSheet(m.decisions, approved(11, 12)).rows;
  assert.deepEqual(seatsLeftAfterSheet(m, partial).map((e) => [e.person.name, e.clients.map((c) => c.id)]), [['Kevin', [13]]]);
  assert.deepEqual(seatsLeftAfterSheet(m, buildTransitionSheet(m.decisions, approved(11, 12, 13)).rows), []);
});

test('Stage 3: transitions and tasks from the approved plans only, with no invented dates or rates', () => {
  const m = model([2]);
  const plans = {
    11: { status: 'approved', timelineDays: 60, tasks: ['Introduce the new lead', 'Transfer files'] },
    12: { status: 'approved', timelineDays: null, tasks: [] },
    13: { status: 'planned', timelineDays: 30, tasks: ['Not yet'] },
  };
  const first = syncTransitions({ decisions: m.decisions, plans, today: '2026-09-25' });
  assert.deepEqual(first.transitions.map((t) => t.clientId), ['11', '12']);
  const t11 = first.transitions.find((t) => t.clientId === '11');
  assert.equal(t11.lead, m.decisions.find((d) => d.client.id === 11).lead.after.name);
  assert.equal(t11.secondChair, 'Anna');
  assert.equal(t11.leadBefore, 'Kevin (Partner)');
  assert.equal(t11.secondChairBefore, null, 'Anna keeps the seat, so no earlier holder is shown');
  const t12 = first.transitions.find((t) => t.clientId === '12');
  assert.deepEqual([t12.leadBefore, t12.secondChairBefore], ['Kevin (Partner)', 'Paula (Partner)'], 'Paula moves up; her seat changes hands');
  assert.deepEqual([t11.startDate, t11.endDate, t11.timelineDays, t11.status], ['2026-09-25', '2026-11-24', 60, 'in-progress']);
  assert.deepEqual([t12.timelineDays, t12.endDate], [null, null], 'no timeline in the plan, none shown');
  assert.deepEqual(first.tasks.map((t) => [t.clientId, t.title, t.assignee, t.dueDate]), [
    ['11', 'Introduce the new lead', t11.lead, ''],
    ['11', 'Transfer files', t11.lead, ''],
  ]);
  for (const t of first.transitions) {
    assert.deepEqual(Object.keys(t).filter((k) => /retention|progress|successorPartner/i.test(k)), []);
  }

  // Later: 11 is under way with a task done, 12 is withdrawn, 13 approved
  const done = first.tasks.map((t, i) => (i === 0 ? { ...t, status: 'completed' } : t));
  const under = first.transitions.map((t) => (t.clientId === '11' ? { ...t, status: 'completed', startDate: '2026-09-01' } : t));
  const second = syncTransitions({
    decisions: m.decisions,
    plans: { ...plans, 12: { status: 'rejected' }, 13: { status: 'approved', timelineDays: 30, tasks: ['Call the client'] } },
    transitions: under,
    tasks: [...done, { id: 'x', title: 'Firm-wide', clientId: '' }],
    today: '2026-10-01',
  });
  assert.deepEqual(second.transitions.map((t) => [t.clientId, t.status, t.startDate]), [['11', 'completed', '2026-09-01'], ['13', 'in-progress', '2026-10-01']]);
  assert.equal(second.transitions[0].endDate, '2026-10-31', 'the kept start date and the plan\'s timeline');
  assert.deepEqual(second.tasks.map((t) => [t.clientId, t.title, t.status]), [
    ['11', 'Introduce the new lead', 'completed'],
    ['11', 'Transfer files', 'pending'],
    ['', 'Firm-wide', undefined],
    ['13', 'Call the client', 'pending'],
  ]);

  assert.deepEqual(executionSummary(second.transitions, [...second.tasks, { status: 'pending', dueDate: '2026-09-30' }], '2026-10-01'), {
    totalTransitions: 2, completedTransitions: 1, inProgressTransitions: 1, atRiskTransitions: 0, delayedTransitions: 0,
    totalTasks: 5, completedTasks: 1, overdueTasks: 1,
  });
});
