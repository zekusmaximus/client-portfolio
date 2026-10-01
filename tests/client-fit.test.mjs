// Where a new client fits (docs/plans/tier-3.md, section 14, WP6):
// src/utils/clientFit.js, Scenarios' "A new client" sandbox. The lead is held
// to Stage 1's engine by construction (a new client is a client whose lead is
// leaving before they ever had one: departureModel with the client added
// under a ghost partner marked as leaving gives, as its one decision, the same
// candidates, reasons, loads, fate for the choice and seat), the second chair
// to the associate split with every other open seat "not now" (U23 (a)), and
// the loads to partnershipModel; P3 on every book; the rank lines and the
// band; purity; and the importers (the hypothetical client never reaches
// another module, and the server never loads the page's code, T3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  BAND_TEXT,
  CADENCES,
  CONFLICT_RISKS,
  DEFAULT_NAME,
  HYPOTHETICAL_CLIENT_ID,
  PRACTICE_AREAS,
  clientDraft,
  clientFitModel,
  clientLines,
  emptyPicks,
  emptySandbox,
  hypotheticalClient,
  ordinal,
  sandboxEntered,
} from '../src/utils/clientFit.js';
import { departureModel, candidateReason } from '../src/utils/departure.js';
import { associateSplitModel } from '../src/utils/associateSplit.js';
import { partnershipModel, SECOND_CHAIR_EFFORT_SHARE } from '../src/utils/load.js';
import { resolveEffort, resolveStrategicValue, UNRATED_STICKINESS } from '../src/utils/clientMetrics.js';
import { revenueForYear } from '../src/utils/revenue.js';
import { scenarioSavable, unsavedChanges, KINDS } from '../src/utils/scenarioState.js';
import { clientFormData } from '../src/utils/clientForm.js';
import clientRules from '../utils/clientRules.cjs';
import strategic from '../utils/strategic.cjs';
import { PEOPLE as FIXTURE_PEOPLE, CLIENTS as FIXTURE_CLIENTS } from './fixtures/books.mjs';

const key = (id) => (id === null || id === undefined ? '' : String(id));
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} against ${b}`);

/* ------------------------------------------------------------------------ */
/*                                  Books                                    */
/* ------------------------------------------------------------------------ */

const person = (id, name, role, active = true) => ({ id, name, role, active });
// The hire suite's book (tests/hire-scenario.test.mjs), which has practice areas
const HIRE_PEOPLE = [
  person(1, 'Kevin', 'partner'), person(2, 'Paula', 'partner'), person(3, 'Mike', 'partner'), person(4, 'Jeff', 'partner'),
  person(5, 'Jay', 'emeritus'), person(6, 'Anna', 'associate'), person(7, 'Ben', 'associate'), person(8, 'Steve', 'partner', false),
];
const at = new Map(HIRE_PEOPLE.map((p) => [p.name, p]));
// Each client's effort through its cadence, so the API's scoring (below)
// computes the hire suite's efforts
const CADENCE_OF = { 5: 'Daily', 3: 'Weekly', 2: 'Monthly', 1: 'Quarterly' };
const hireClient = (id, lead, second, area, effort, amount, stickiness = 3) => ({
  id, name: `Client ${id}`, lead: at.get(lead) || null, secondChair: second ? at.get(second) : null,
  practiceArea: area ? [area] : [], interaction_frequency: CADENCE_OF[effort], stickiness, conflict_risk: 'Medium',
  revenues: [{ year: 2026, revenue_amount: String(amount) }],
});
const HIRE_CLIENTS = [
  hireClient('k1', 'Kevin', null, 'Healthcare', 5, 100000, 5),
  hireClient('k2', 'Kevin', 'Paula', 'Energy', 3, 80000, 1),
  hireClient('k3', 'Kevin', 'Anna', 'Healthcare', 3, 70000, null),
  hireClient('k4', 'Kevin', null, 'Municipal', 3, 60000, 4),
  hireClient('k5', 'Kevin', 'Jay', 'Education', 2, 50000, 2),
  hireClient('k6', 'Kevin', null, 'Healthcare', 2, 40000, 3),
  hireClient('p1', 'Paula', null, 'Healthcare', 3, 30000, 4),
  hireClient('p2', 'Paula', 'Kevin', 'Energy', 2, 20000, 3),
  hireClient('p3', 'Paula', 'Ben', 'Other', 2, 10000, null),
  hireClient('m1', 'Mike', null, 'Corporate', 1, 5000, 5),
  hireClient('j1', 'Jeff', 'Mike', 'Healthcare', 1, 5000, 2),
  hireClient('o1', null, null, null, 1, 1000, 3),          // no lead (saved before the People list)
  hireClient('s1', 'Steve', null, null, 1, 1000, 1),       // an inactive lead (saved before P5)
].map((c) => strategic.calculateStrategicScores([c])[0]);

const YEAR = 2026;
const revenueOf = (c) => revenueForYear(c, YEAR);
const fit = (picks = {}, choice = {}, { people = HIRE_PEOPLE, clients = HIRE_CLIENTS, reportingYear = YEAR } = {}) =>
  clientFitModel({ people, clients, revenueOf, reportingYear, picks, choice });
const HEMLOCK = { name: 'Hemlock Health', revenue: '300000', practiceArea: ['Healthcare'], interaction_frequency: 'Monthly', high_maintenance: false, stickiness: null, conflict_risk: 'Medium' };

// The ghost departure: the client added under a partner who is leaving before
// they ever had one, so Stage 1's engine makes one decision about it
const GHOST = person('ghost', 'Ghost', 'partner');
const ghostDeparture = (m, choice, people, clients) => departureModel({
  people: [...people, GHOST],
  clients: [...clients, { ...m.client, lead: GHOST, secondChair: null }],
  departingIds: [GHOST.id],
  revenueOf,
  choices: { [HYPOTHETICAL_CLIENT_ID]: choice },
});
// The associate split over the book with the client added under its lead and
// every other open seat "not now"
const splitFor = (m, choice, people, clients) => {
  const picks = {};
  for (const c of clients) if (c.lead?.id != null && c.secondChair?.id == null) picks[key(c.id)] = null;
  if (choice.secondChairId !== undefined) picks[HYPOTHETICAL_CLIENT_ID] = choice.secondChairId;
  return associateSplitModel({
    people,
    clients: [...clients, { ...m.client, lead: m.lead.after, secondChair: null }],
    revenueOf,
    picks,
  });
};
const candidateView = (c) => [key(c.person.id), candidateReason(c), c.load.effort, c.load.revenue, [...c.sharedAreas]];
const rowView = (r) => ({
  id: key(r.person.id),
  lead: { count: r.lead.count, revenue: r.lead.revenue, effort: r.lead.effort, clients: r.lead.clients.map((c) => key(c.id)) },
  second: { count: r.second.count, revenue: r.second.revenue, effort: r.second.effort, clients: r.second.clients.map((c) => key(c.id)) },
  leadRatio: r.leadRatio,
  secondRatio: r.secondRatio,
});

// P3 on a model: the lead an active partner (or none only when no partner
// can take it), the second chair empty or an active person who is not the
// lead, and nobody but the two seats' holders moving
function assertP3(m, people, where) {
  const byId = new Map(people.map((p) => [key(p.id), p]));
  const lead = m.lead.after;
  if (lead) {
    const p = byId.get(key(lead.id));
    assert.ok(p && p.active && p.role === 'partner', `${where}: lead ${lead.name} is an active partner`);
    assert.equal(m.lead.noCandidate, false, where);
  } else {
    assert.ok(m.lead.noCandidate && m.lead.candidates.length === 0, `${where}: no lead only when no partner can take it`);
    assert.ok(!people.some((p) => p.active && p.role === 'partner'), `${where}: the book has no active partner`);
    assert.deepEqual([m.secondChair.candidates, m.secondChair.after, m.secondChair.proposal], [[], null, null], `${where}: no second chair without a lead`);
  }
  const second = m.secondChair.after;
  if (second) {
    const p = byId.get(key(second.id));
    assert.ok(p && p.active, `${where}: second chair ${second.name} is active`);
    assert.ok(lead && key(second.id) !== key(lead.id), `${where}: the second chair is not the lead`);
  }
  const before = new Map(m.before.rows.map((r) => [key(r.person.id), r]));
  for (const r of m.after.rows) {
    const b = before.get(key(r.person.id));
    assert.ok(b, `${where}: ${r.person.name} was in the book before`);
    if (key(r.person.id) === key(lead?.id)) {
      assert.equal(r.lead.count, b.lead.count + 1, `${where}: the lead gains one client`);
      near(r.lead.effort, b.lead.effort + m.effort, `${where}: the lead gains the full effort`);
      near(r.lead.revenue, b.lead.revenue + m.revenue, `${where}: the lead gains the revenue`);
      assert.deepEqual([r.second.count, r.second.effort], [b.second.count, b.second.effort], `${where}: the lead's seats as second chair do not move`);
    } else if (key(r.person.id) === key(second?.id)) {
      assert.equal(r.second.count, b.second.count + 1, `${where}: the second chair gains one seat`);
      near(r.second.effort, b.second.effort + m.effort * SECOND_CHAIR_EFFORT_SHARE, `${where}: the second chair gains the share`);
      assert.deepEqual([r.lead.count, r.lead.effort], [b.lead.count, b.lead.effort], `${where}: the second chair's lead book does not move`);
    } else {
      assert.deepEqual([r.lead.count, r.lead.effort, r.lead.revenue, r.second.count, r.second.effort, r.second.revenue],
        [b.lead.count, b.lead.effort, b.lead.revenue, b.second.count, b.second.effort, b.second.revenue], `${where}: ${r.person.name} does not move`);
    }
  }
  // The partners' average moves by the client's share over the active partners, and only when a partner leads it
  const avgBefore = m.averages.before.partner;
  const avgAfter = m.averages.after.partner;
  assert.equal(avgAfter.members, avgBefore.members, where);
  if (lead && avgBefore.members > 0) {
    near(avgAfter.lead.effort - avgBefore.lead.effort, m.effort / avgBefore.members, `${where}: the average lead effort moves by the effort over the active partners`);
    near(avgAfter.lead.revenue - avgBefore.lead.revenue, m.revenue / avgBefore.members, `${where}: the average lead revenue`);
    near(avgAfter.lead.count - avgBefore.lead.count, 1 / avgBefore.members, `${where}: the average lead count`);
  } else {
    assert.deepEqual(avgAfter.lead, avgBefore.lead, `${where}: no lead, the average does not move`);
  }
  // The after is the book with the client in its seats, nothing else
  const placed = { ...m.client, lead, secondChair: second };
  assert.deepEqual(m.after, partnershipModel(people, [...m.before.rows.flatMap(() => []), ...m.clientsIn, placed], revenueOf), `${where}: after is partnershipModel with the client`);
}

// The engine's and the split's answers for a model, compared seat by seat
function assertEqualToEngines(m, choice, people, clients, where) {
  const d = ghostDeparture(m, choice, people, clients).decisions;
  assert.equal(d.length, 1, `${where}: one decision`);
  const [decision] = d;
  assert.equal(decision.lead.needed, true, where);
  assert.deepEqual(m.lead.candidates.map(candidateView), decision.lead.candidates.map(candidateView), `${where}: the lead's candidates, reasons and loads`);
  assert.equal(key(m.lead.proposal?.id), key(decision.lead.candidates[0]?.person.id), `${where}: the proposal`);
  assert.equal(m.lead.choice, decision.lead.choice, `${where}: the choice as given`);
  assert.equal(m.lead.problem, decision.lead.problem, `${where}: the choice's fate`);
  assert.equal(key(m.lead.after?.id), key(decision.lead.after?.id), `${where}: the seat`);
  assert.equal(m.lead.noCandidate, decision.lead.noCandidate, `${where}: noCandidate`);

  const split = splitFor(m, choice, people, clients);
  const proposal = split.proposals.find((p) => key(p.client.id) === HYPOTHETICAL_CLIENT_ID);
  if (!m.lead.after) {
    assert.equal(proposal, undefined, `${where}: no lead, the split has no seat to fill`);
  } else {
    assert.ok(proposal, `${where}: the split proposes for the client`);
    assert.equal(proposal.blocker, null, where);
    assert.deepEqual(m.secondChair.candidates.map(candidateView), proposal.candidates.map(candidateView), `${where}: the second chair's candidates`);
    assert.equal(key(m.secondChair.proposal?.id), key(proposal.proposal?.id), `${where}: the second chair proposed`);
    assert.equal(m.secondChair.problem, proposal.problem, `${where}: the pick's fate`);
    assert.equal(key(m.secondChair.after?.id), key(proposal.after?.id), `${where}: the seat`);
    // Every other open seat stayed "not now"
    for (const p of split.proposals) if (p !== proposal) assert.equal(p.after, null, where);
  }

  // The loads after equal the engine's given the same seats (the ghost's row aside)
  const same = ghostDeparture(m, { leadId: m.lead.after ? m.lead.after.id : null, secondChairId: m.secondChair.after ? m.secondChair.after.id : null }, people, clients);
  assert.equal(key(same.decisions[0].lead.after?.id), key(m.lead.after?.id), where);
  assert.equal(key(same.decisions[0].secondChair.after?.id), key(m.secondChair.after?.id), where);
  const engineRows = same.after.rows.filter((r) => key(r.person.id) !== key(GHOST.id)).map(rowView);
  assert.deepEqual(m.after.rows.map(rowView), engineRows, `${where}: the loads after`);
  assert.deepEqual(m.after.averages, same.after.averages, `${where}: the averages after`);
}

/* ------------------------------------------------------------------------ */
/*                           The hypothetical client                         */
/* ------------------------------------------------------------------------ */

test('hypotheticalClient: each pick in the form\'s vocabulary or its default, one row for the reporting year when an amount is typed, effort and value as the API computes them', () => {
  const blank = hypotheticalClient(emptyPicks(), YEAR);
  assert.equal(blank.id, HYPOTHETICAL_CLIENT_ID);
  assert.deepEqual([blank.name, blank.named, blank.hypothetical], [DEFAULT_NAME, false, true]);
  assert.deepEqual([blank.practiceArea, blank.interaction_frequency, blank.high_maintenance, blank.stickiness, blank.conflict_risk, blank.revenues], [[], '', false, null, 'Medium', []]);
  assert.deepEqual([blank.lead, blank.secondChair, blank.originator], [null, null, null]);
  assert.equal(blank.effort, strategic.getEffort(blank));
  assert.equal(blank.strategicValue, Math.round(strategic.calculateStrategicValue(blank) * 100) / 100);
  assert.equal(blank.stickinessScore, Math.round(UNRATED_STICKINESS * 100) / 100);

  const typed = hypotheticalClient({ ...HEMLOCK, name: '  Hemlock Health  ', high_maintenance: true, stickiness: '4', conflict_risk: 'High' }, YEAR);
  assert.deepEqual([typed.name, typed.named], ['Hemlock Health', true]);
  assert.deepEqual(typed.revenues, [{ year: YEAR, revenue_amount: 300000 }]);
  assert.deepEqual([typed.stickiness, typed.conflict_risk, typed.interaction_frequency, typed.high_maintenance], [4, 'High', 'Monthly', true]);
  assert.equal(typed.effort, 3, 'Monthly with a handful');
  assert.equal(typed.effort, strategic.getEffort(typed));
  assert.equal(typed.strategicValue, Math.round(strategic.calculateStrategicValue(typed) * 100) / 100);
  assert.equal(typed.strategicValue, Math.round((6 * 0.5 + 7.5 * 0.5 - 3) * 100) / 100);

  // A bad cadence, conflict risk or pick reads as the default; an area off the list is dropped
  const odd = hypotheticalClient({ interaction_frequency: 'Hourly', conflict_risk: 'Severe', stickiness: 2.5, practiceArea: ['Healthcare', 'Astrology', 'Energy'] }, YEAR);
  assert.deepEqual([odd.interaction_frequency, odd.conflict_risk, odd.stickiness, odd.practiceArea], ['', 'Medium', null, ['Healthcare', 'Energy']]);
  for (const pick of [0, 6, '', 'x', undefined]) assert.equal(hypotheticalClient({ stickiness: pick }, YEAR).stickiness, null, String(pick));
  for (const pick of [1, 2, 3, 4, 5, '3', ' 5 ']) assert.equal(hypotheticalClient({ stickiness: pick }, YEAR).stickiness, Number(pick), String(pick));
  // A blank or bad amount is no row; 0, a decimal and text digits are rows
  for (const amount of ['', ' ', 'abc', '-5', null, undefined, '1,000']) {
    assert.deepEqual(hypotheticalClient({ revenue: amount }, YEAR).revenues, [], String(amount));
  }
  assert.deepEqual(hypotheticalClient({ revenue: '0' }, YEAR).revenues, [{ year: YEAR, revenue_amount: 0 }]);
  assert.deepEqual(hypotheticalClient({ revenue: ' 1234.5 ' }, YEAR).revenues, [{ year: YEAR, revenue_amount: 1234.5 }]);
  assert.deepEqual(hypotheticalClient({ revenue: 5000 }, YEAR).revenues, [{ year: YEAR, revenue_amount: 5000 }]);
  assert.deepEqual(hypotheticalClient({ revenue: '5000' }, undefined).revenues, [], 'no reporting year, no row');
  // Every cadence's effort is the scorer's, with and without the handful
  for (const cadence of [...CADENCES, '']) {
    for (const handful of [true, false]) {
      const c = hypotheticalClient({ interaction_frequency: cadence, high_maintenance: handful }, YEAR);
      assert.equal(c.effort, strategic.getEffort(c), `${cadence} ${handful}`);
      assert.equal(c.effort, resolveEffort({ interaction_frequency: cadence, high_maintenance: handful }), `${cadence} ${handful}`);
    }
  }
  // The vocabularies are the form's, which are the server's
  assert.deepEqual(PRACTICE_AREAS, clientRules.PRACTICE_AREAS);
  assert.deepEqual(CADENCES, clientRules.CADENCES);
  assert.deepEqual(CONFLICT_RISKS, clientRules.CONFLICT_RISKS);
});

/* ------------------------------------------------------------------------ */
/*                         The seats, on the fixture books                   */
/* ------------------------------------------------------------------------ */

test('the lead is Stage 1\'s: fit before load (a partner who leads one client in the area ranks above an idle partner without it), then the lighter total load', () => {
  const m = fit(HEMLOCK);
  // Jeff, Paula and Kevin lead a Healthcare client; Mike does not, whatever his load
  assert.deepEqual(m.lead.candidates.map((c) => [c.person.name, candidateReason(c), c.load.effort]), [
    ['Jeff', 'shares Healthcare', 1], ['Paula', 'shares Healthcare', 7.6], ['Kevin', 'shares Healthcare', 18.4], ['Mike', 'lighter total load', 1.2],
  ]);
  assert.equal(m.lead.proposal.name, 'Jeff');
  assert.equal(m.lead.after.name, 'Jeff');
  assert.deepEqual([m.lead.choice, m.lead.problem, m.lead.noCandidate], [undefined, null, false]);
  assertEqualToEngines(m, {}, HIRE_PEOPLE, HIRE_CLIENTS, 'Hemlock');
  // An Energy client: Kevin and Paula lead Energy clients, Kevin's load far above; Paula first
  const energy = fit({ ...HEMLOCK, name: 'Elm Energy', practiceArea: ['Energy'], revenue: '50000', interaction_frequency: 'Daily', high_maintenance: true, stickiness: 2, conflict_risk: 'High' });
  assert.deepEqual(energy.lead.candidates.map((c) => c.person.name), ['Paula', 'Kevin', 'Jeff', 'Mike']);
  assert.equal(energy.lead.proposal.name, 'Paula');
  assert.equal(energy.effort, 7.5);
  assertEqualToEngines(energy, {}, HIRE_PEOPLE, HIRE_CLIENTS, 'Elm');
  // No area: the lighter total load, then revenue, then the name
  const plain = fit({ stickiness: 4, conflict_risk: 'Low' });
  assert.deepEqual(plain.lead.candidates.map((c) => [c.person.name, candidateReason(c)]), [
    ['Jeff', 'lighter total load'], ['Mike', 'lighter total load'], ['Paula', 'lighter total load'], ['Kevin', 'lighter total load'],
  ]);
  assertEqualToEngines(plain, {}, HIRE_PEOPLE, HIRE_CLIENTS, 'plain');
  // Ties rank by name (14.8, trap 2): the fixture book has no practice areas and three idle partners
  const idle = fit({ revenue: '1000' }, {}, { people: FIXTURE_PEOPLE, clients: FIXTURE_CLIENTS });
  assert.deepEqual(idle.lead.candidates.slice(0, 3).map((c) => [c.person.name, c.load.effort, c.load.revenue]), [['Jeff', 0, 0], ['Joe', 0, 0], ['Mike', 0, 0]]);
  assert.equal(idle.lead.proposal.name, 'Jeff');
  assertEqualToEngines(idle, {}, FIXTURE_PEOPLE, FIXTURE_CLIENTS, 'fixture');
});

test('the partner\'s lead pick is applied, or refused with its reason and the proposal stands, as Stage 1 does', () => {
  const kevin = fit(HEMLOCK, { leadId: '1' });
  assert.deepEqual([kevin.lead.choice, kevin.lead.problem, kevin.lead.after.name, kevin.lead.proposal.name], ['1', null, 'Kevin', 'Jeff']);
  assertEqualToEngines(kevin, { leadId: '1' }, HIRE_PEOPLE, HIRE_CLIENTS, 'Kevin picked');
  for (const [choice, problem] of [
    [{ leadId: '6' }, 'Anna is not a partner; the lead must be an active partner.'],
    [{ leadId: '5' }, 'Jay is not a partner; the lead must be an active partner.'],
    [{ leadId: '8' }, 'Steve is inactive.'],
    [{ leadId: '99' }, 'This person is not on the People list.'],
    [{ leadId: null }, 'Every client needs a lead: choose an active partner who is staying.'],
    [{ leadId: '' }, 'Every client needs a lead: choose an active partner who is staying.'],
  ]) {
    const m = fit(HEMLOCK, choice);
    assert.equal(m.lead.problem, problem, JSON.stringify(choice));
    assert.equal(m.lead.after.name, 'Jeff', 'the proposal stands');
    assertEqualToEngines(m, choice, HIRE_PEOPLE, HIRE_CLIENTS, JSON.stringify(choice));
  }
});

test('the second chair is the associate split\'s: the associates first by fit then load, the best-ranked active associate proposed, None and everyone P3 allows pickable', () => {
  const m = fit(HEMLOCK);
  // Anna seconds two Healthcare clients; Ben none; then everyone else but the lead (Jeff)
  assert.deepEqual(m.secondChair.candidates.map((c) => [c.person.name, candidateReason(c)]), [
    ['Anna', 'shares Healthcare'], ['Ben', 'lighter total load'],
    ['Mike', 'shares Healthcare'], ['Paula', 'shares Healthcare'], ['Kevin', 'shares Healthcare'], ['Jay', 'lighter total load'],
  ]);
  assert.equal(m.secondChair.proposal.name, 'Anna');
  assert.equal(m.secondChair.after.name, 'Anna');
  assert.equal(m.secondChair.noCandidate, false);
  // Picks: a partner, the emeritus, None, the lead (refused), someone inactive (refused), a stranger (refused)
  for (const [choice, after, problem] of [
    [{ secondChairId: '1' }, 'Kevin', null],
    [{ secondChairId: '5' }, 'Jay', null],
    [{ secondChairId: null }, null, null],
    [{ secondChairId: '' }, null, null],
    [{ secondChairId: '4' }, 'Anna', 'Jeff is the lead; the second chair must be someone else.'],
    [{ secondChairId: '8' }, 'Anna', 'Steve is inactive.'],
    [{ secondChairId: '99' }, 'Anna', 'This person is not on the People list.'],
  ]) {
    const picked = fit(HEMLOCK, choice);
    assert.equal(picked.secondChair.after?.name ?? null, after, JSON.stringify(choice));
    assert.equal(picked.secondChair.problem, problem, JSON.stringify(choice));
    assert.equal(picked.secondChair.choice, choice.secondChairId);
    assertEqualToEngines(picked, choice, HIRE_PEOPLE, HIRE_CLIENTS, JSON.stringify(choice));
  }
  // A second chair picked before the lead changed to that person: refused, the proposal stands
  const both = fit(HEMLOCK, { leadId: '1', secondChairId: '1' });
  assert.deepEqual([both.lead.after.name, both.secondChair.problem, both.secondChair.after.name], ['Kevin', 'Kevin is the lead; the second chair must be someone else.', 'Anna']);
  assertEqualToEngines(both, { leadId: '1', secondChairId: '1' }, HIRE_PEOPLE, HIRE_CLIENTS, 'both');
  // No active associate: nothing proposed, the seat empty, the picker still offers everyone
  const noAssociates = HIRE_PEOPLE.map((p) => (p.role === 'associate' ? { ...p, active: false } : p));
  const none = fit(HEMLOCK, {}, { people: noAssociates });
  assert.equal(none.secondChair.proposal, null);
  assert.equal(none.secondChair.after, null);
  assert.deepEqual(none.secondChair.candidates.map((c) => c.person.name), ['Mike', 'Paula', 'Kevin', 'Jay']);
  assertEqualToEngines(none, {}, noAssociates, HIRE_CLIENTS, 'no associates');
  const picked = fit(HEMLOCK, { secondChairId: '3' }, { people: noAssociates });
  assert.equal(picked.secondChair.after.name, 'Mike');
  assertEqualToEngines(picked, { secondChairId: '3' }, noAssociates, HIRE_CLIENTS, 'no associates, Mike picked');
});

test('the loads: the lead gains the full effort, the second chair the share, nothing else moves, and the partners\' average moves by the effort over the active partners', () => {
  const m = fit(HEMLOCK);
  assertP3({ ...m, clientsIn: HIRE_CLIENTS }, HIRE_PEOPLE, 'Hemlock');
  const row = (model, name) => model.groups.flatMap((g) => g.rows).find((r) => r.person.name === name);
  const jeff = row(m, 'Jeff');
  assert.deepEqual([jeff.seat, jeff.before.lead.count, jeff.after.lead.count, jeff.before.lead.effort, jeff.after.lead.effort, jeff.after.lead.revenue], ['lead', 1, 2, 1, 3, 305000]);
  const anna = row(m, 'Anna');
  assert.equal(anna.seat, 'second');
  near(anna.after.second.effort - anna.before.second.effort, 2 * SECOND_CHAIR_EFFORT_SHARE, 'Anna gains the share');
  assert.equal(anna.after.second.count, anna.before.second.count + 1);
  for (const name of ['Kevin', 'Paula', 'Mike', 'Jay', 'Ben', 'Steve']) {
    const r = row(m, name);
    assert.deepEqual([r.seat, r.after.lead.effort, r.after.second.effort], [null, r.before.lead.effort, r.before.second.effort], name);
  }
  // The partners' average moves (14.8, trap 3): 4 active partners, effort 2
  near(m.averages.after.partner.lead.effort - m.averages.before.partner.lead.effort, 2 / 4, 'average lead effort');
  near(m.averages.after.partner.lead.revenue - m.averages.before.partner.lead.revenue, 300000 / 4, 'average lead revenue');
  near(m.averages.after.partner.lead.count - m.averages.before.partner.lead.count, 1 / 4, 'average lead count');
  // The lead's ratio rises and every other partner's falls a notch
  assert.ok(jeff.after.leadRatio.effort > jeff.before.leadRatio.effort);
  for (const name of ['Kevin', 'Paula', 'Mike']) assert.ok(row(m, name).after.leadRatio.effort < row(m, name).before.leadRatio.effort, name);
  // The table's rows: everyone active or holding a seat, the partners heaviest first, the others by name
  assert.deepEqual(m.groups.map((g) => [g.label, g.rows.map((r) => r.person.name)]), [
    ['Partners', ['Kevin', 'Paula', 'Mike', 'Jeff', 'Steve']],
    ['Emeritus', ['Jay']],
    ['Associates', ['Anna', 'Ben']],
  ]);
  // The before figures are the Partnership tab's
  assert.deepEqual(m.before, partnershipModel(HIRE_PEOPLE, HIRE_CLIENTS, revenueOf));
});

test('a book with no active partner proposes nothing and says so; the load table still shows the book', () => {
  const people = HIRE_PEOPLE.map((p) => (p.role === 'partner' ? { ...p, active: false } : p));
  const m = fit(HEMLOCK, { leadId: '1', secondChairId: '6' }, { people });
  assert.deepEqual([m.lead.candidates, m.lead.proposal, m.lead.after, m.lead.noCandidate], [[], null, null, true]);
  assert.equal(m.lead.problem, 'Kevin is inactive.');
  assert.deepEqual([m.secondChair.candidates, m.secondChair.proposal, m.secondChair.after, m.secondChair.problem], [[], null, null, null]);
  assert.equal(m.secondChair.choice, '6', 'the pick is kept for the picker');
  assertP3({ ...m, clientsIn: HIRE_CLIENTS }, people, 'no partner');
  assertEqualToEngines(m, { leadId: '1', secondChairId: '6' }, people, HIRE_CLIENTS, 'no partner');
  assert.ok(m.groups.length > 0 && m.after.rows.length === m.before.rows.length);
  assert.equal(m.after.unled.length, m.before.unled.length + 1, 'the client is in the book after, without a lead');
  // An empty People list and an empty book
  const empty = fit(HEMLOCK, {}, { people: [], clients: [] });
  assert.deepEqual([empty.lead.noCandidate, empty.lead.after, empty.groups, empty.rank.strategicValue], [true, null, [], { place: 1, of: 1 }]);
});

/* ------------------------------------------------------------------------ */
/*                        The client's figures in words                      */
/* ------------------------------------------------------------------------ */

test('the rank lines and the band (U24 (a), U25 (a)): the effort, the score with its parts, the client\'s place among the book\'s clients, the stand-in named as one', () => {
  const m = fit(HEMLOCK);
  assert.equal(m.revenue, 300000);
  assert.equal(m.effort, 2);
  assert.deepEqual([m.score.revenueScore, m.score.stickiness, m.score.rated, m.score.penalty, m.score.high, m.score.value], [6, UNRATED_STICKINESS, false, 1, false, 4.22]);
  assert.equal(m.score.value, m.client.strategicValue);
  assert.equal(m.band, 'unrated');
  // Among the 13 clients: the largest revenue, one score above (k1 at 5.0), 5 heavier clients
  assert.deepEqual(m.rank, { strategicValue: { place: 2, of: 14 }, effort: { place: 6, of: 14 }, revenue: { place: 1, of: 14 } });
  assert.deepEqual(m.lines, {
    facts: 'Hemlock Health: $300,000 in 2026, Healthcare, Monthly, Stickiness not rated, conflict risk Medium',
    effort: 'Effort 2 (6th of 14 clients by effort).',
    score: 'Strategic value 4.2 = revenue 6.0 × 0.5 + stickiness 4.44 × 0.5 − conflict 1 (2nd of 14 by strategic value; 1st of 14 by revenue in 2026).',
    standIn: 'Not rated: 4.44 is the stand-in every unrated client scores with, not a rating.',
    exposure: 'Exposure: not rated (unknown, never safe).',
  });
  // Ranks compare the API's rounded figures (14.8, trap 12): the book's scores are two-decimal
  const book = HIRE_CLIENTS.map((c) => Math.round(resolveStrategicValue(c) * 100) / 100);
  assert.equal(m.rank.strategicValue.place, 1 + book.filter((v) => v > m.score.value).length);
  assert.equal(m.rank.effort.place, 1 + HIRE_CLIENTS.filter((c) => resolveEffort(c) > 2).length);

  // A thin, High-conflict client with a handful: the penalty flagged, the score kept at 0
  const thin = fit({ name: 'Elm Energy', revenue: '50000', practiceArea: ['Energy'], interaction_frequency: 'Daily', high_maintenance: true, stickiness: 2, conflict_risk: 'High' });
  assert.deepEqual([thin.effort, thin.band, thin.score.high, thin.score.penalty, thin.score.value, thin.score.unclamped], [7.5, 'thin', true, 3, 0, 1 * 0.5 + 2.5 * 0.5 - 3]);
  assert.equal(thin.lines.facts, 'Elm Energy: $50,000 in 2026, Energy, Daily, a handful, Stickiness 2 New / still shallow, conflict risk High');
  assert.equal(thin.lines.effort, 'Effort 7.5 (1st of 14 clients by effort).');
  // Two of the book's clients score 0 too (k2, s1) and tie with it; $50,000 ties k5
  assert.equal(thin.lines.score, 'Strategic value 0.0 = revenue 1.0 × 0.5 + stickiness 2.5 × 0.5 − conflict 3, kept within 0 to 10 (12th of 14 by strategic value; 5th of 14 by revenue in 2026).');
  assert.equal(thin.lines.standIn, null);
  assert.equal(thin.lines.exposure, 'Exposure: rated 1 or 2 (thin).');

  // No area, no cadence, no revenue, rated 4, Low: effort 1, 3.75, "rated 3 to 5"; k1 (5.0) and m1 (4.05) above
  const bare = fit({ stickiness: 4, conflict_risk: 'Low' });
  assert.deepEqual([bare.effort, bare.revenue, bare.band, bare.score.value, bare.score.rated], [1, 0, 'solid', 3.75, true]);
  assert.equal(bare.lines.facts, 'New client: no revenue in 2026, no practice area, cadence not set, Stickiness 4 Strong, established, conflict risk Low');
  assert.equal(bare.lines.score, 'Strategic value 3.8 = revenue 0.0 × 0.5 + stickiness 7.5 × 0.5 − conflict 0 (3rd of 14 by strategic value; 14th of 14 by revenue in 2026).');
  assert.equal(bare.lines.effort, 'Effort 1 (10th of 14 clients by effort).');
  assert.equal(bare.lines.exposure, 'Exposure: rated 3 to 5.');
  assert.equal(bare.lines.standIn, null);
  // A $0 amount is a row at $0, which the facts show
  assert.equal(fit({ revenue: '0' }).lines.facts, 'New client: $0 in 2026, no practice area, cadence not set, Stickiness not rated, conflict risk Medium');
  assert.deepEqual(BAND_TEXT, { thin: 'rated 1 or 2 (thin)', unrated: 'not rated (unknown, never safe)', solid: 'rated 3 to 5' });
  // Every unrated client scores the stand-in and lands in its own band, never "rated 3 to 5"
  for (const pick of [null, 0, 6, 2.5, 'x']) {
    const u = fit({ stickiness: pick });
    assert.deepEqual([u.band, u.score.stickiness, u.score.rated], ['unrated', 40 / 9, false], String(pick));
    assert.match(u.lines.standIn, /stand-in/);
  }
  for (const pick of [3, 4, 5]) assert.equal(fit({ stickiness: pick }).band, 'solid', String(pick));
  for (const pick of [1, 2]) assert.equal(fit({ stickiness: pick }).band, 'thin', String(pick));
  // The lines, from the figures alone
  assert.deepEqual(clientLines({ client: m.client, revenue: m.revenue, effort: m.effort, score: m.score, band: m.band, rank: m.rank, reportingYear: YEAR }), m.lines);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 14, 21, 22, 23, 101, 111, 112].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '14th', '21st', '22nd', '23rd', '101st', '111th', '112th']);
});

/* ------------------------------------------------------------------------ */
/*                      The store's slice and the draft                       */
/* ------------------------------------------------------------------------ */

test('sandboxEntered: the defaults are nothing entered; any pick off them, or a choice, is', () => {
  assert.equal(sandboxEntered(emptySandbox()), false);
  assert.equal(sandboxEntered({}), false);
  assert.equal(sandboxEntered({ picks: { ...emptyPicks(), name: ' ' } }), false, 'blanks are nothing');
  for (const picks of [
    { name: 'x' }, { revenue: '1' }, { revenue: '0' }, { practiceArea: ['Energy'] }, { interaction_frequency: 'Daily' },
    { high_maintenance: true }, { stickiness: 3 }, { stickiness: '3' }, { conflict_risk: 'Low' },
  ]) assert.equal(sandboxEntered({ picks: { ...emptyPicks(), ...picks } }), true, JSON.stringify(picks));
  assert.equal(sandboxEntered({ picks: emptyPicks(), choice: { leadId: '1' } }), true);
  assert.equal(sandboxEntered({ picks: emptyPicks(), choice: { secondChairId: null } }), true, 'None is a choice');
  assert.equal(sandboxEntered({ picks: emptyPicks(), choice: { leadId: undefined } }), false);
  // The picks' keys are the client form's field names
  assert.deepEqual(Object.keys(emptyPicks()).sort(), ['conflict_risk', 'high_maintenance', 'interaction_frequency', 'name', 'practiceArea', 'revenue', 'stickiness'].sort());
});

test('the kind is not a saved kind (U22 (a)): KINDS are untouched, and nothing can save or ask about a sandbox', () => {
  assert.deepEqual(KINDS, ['departure', 'hire']);
  const store = { scenarioFeature: true, hireFeature: true, scenarioKind: 'client', savedStateJson: '', successionWorkflow: { currentStage: 'impact', departingIds: [], choices: {} }, transitionPlans: {} };
  assert.equal(scenarioSavable(store), false);
  assert.equal(unsavedChanges(store), false);
  assert.equal(scenarioSavable({ ...store, scenarioKind: 'departure' }), true);
  assert.equal(scenarioSavable({ ...store, scenarioKind: 'hire' }), true);
});

test('the draft for Client Details (U26 (b)): the picks as typed, the reporting year\'s row, the lead and the second chair as the form\'s select values, nothing else', () => {
  const m = fit(HEMLOCK, { secondChairId: '5' });
  const draft = clientDraft(m, YEAR);
  assert.deepEqual(draft, {
    name: 'Hemlock Health',
    practiceArea: ['Healthcare'],
    conflict_risk: 'Medium',
    lead_id: '4',
    second_chair_id: '5',
    originator_id: '',
    originator_is_firm: false,
    interaction_frequency: 'Monthly',
    stickiness: null,
    high_maintenance: false,
    notes: '',
    revenues: [{ year: YEAR, revenue_amount: '300000' }],
  });
  // The same keys as the form's state for a stored client
  assert.deepEqual(Object.keys(draft).sort(), Object.keys(clientFormData({ name: 'x', revenues: [] })).sort());
  // Nothing typed: no name (the form asks for one), a blank amount, no seats when none can be filled
  const blank = clientDraft(fit({}, { secondChairId: null }), YEAR);
  assert.deepEqual([blank.name, blank.revenues, blank.lead_id, blank.second_chair_id, blank.stickiness, blank.interaction_frequency], ['', [{ year: YEAR, revenue_amount: '' }], '4', '', null, '']);
  const nobody = clientDraft(fit(HEMLOCK, {}, { people: [] }), YEAR);
  assert.deepEqual([nobody.lead_id, nobody.second_chair_id], ['', '']);
  assert.deepEqual(clientDraft(fit({ revenue: '0', stickiness: 2, high_maintenance: true, interaction_frequency: 'Daily' }), YEAR).revenues, [{ year: YEAR, revenue_amount: '0' }]);
});

/* ------------------------------------------------------------------------ */
/*                         Random books, purity, importers                   */
/* ------------------------------------------------------------------------ */

test('purity: the inputs are not changed, and the hypothetical id matches no stored id', () => {
  const people = JSON.parse(JSON.stringify(HIRE_PEOPLE));
  const clients = JSON.parse(JSON.stringify(HIRE_CLIENTS));
  const picks = { ...HEMLOCK, practiceArea: ['Healthcare', 'Energy'] };
  const choice = { leadId: '1', secondChairId: '6' };
  const copies = JSON.stringify([people, clients, picks, choice]);
  const m = clientFitModel({ people, clients, revenueOf, reportingYear: YEAR, picks, choice });
  assert.equal(JSON.stringify([people, clients, picks, choice]), copies);
  assert.ok(!clients.some((c) => String(c.id) === HYPOTHETICAL_CLIENT_ID));
  assert.ok(!/^\d+$/.test(HYPOTHETICAL_CLIENT_ID) && !/^[0-9a-f-]{36}$/i.test(HYPOTHETICAL_CLIENT_ID), 'neither an integer nor a uuid');
  assert.ok(!m.before.rows.some((r) => r.lead.clients.some((c) => c.id === HYPOTHETICAL_CLIENT_ID)), 'not in the book before');
});

test('P3, the engines and the loads on 300 seeded random books with random picks and choices', () => {
  // A seeded generator (mulberry32, as tests/book.test.mjs), so every run builds the same books
  let a = 20261001 >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const ROLES = ['partner', 'partner', 'partner', 'emeritus', 'associate'];
  const counts = { noPartner: 0, refusedLead: 0, refusedSecond: 0, noAssociate: 0, noneChosen: 0, fitOverLoad: 0, heaviestProposed: 0 };
  for (let run = 0; run < 300; run += 1) {
    const people = Array.from({ length: 2 + Math.floor(random() * 11) }, (_, i) => person(i + 1, `${pick(['Ann', 'bob', 'Cy', "O'Neil", 'Dee', 'eve'])} ${i + 1}`, pick(ROLES), random() > 0.15));
    const partners = people.filter((p) => p.role === 'partner');
    const clients = Array.from({ length: Math.floor(random() * 41) }, (_, i) => {
      const lead = random() < 0.1 || partners.length === 0 ? null : pick(partners);
      const others = people.filter((p) => p.id !== lead?.id);
      const second = random() < 0.35 || others.length === 0 ? null : pick(others);
      const revenues = [];
      for (const year of [2024, 2025, 2026]) {
        if (random() < 0.4) continue;
        revenues.push({ year: random() < 0.3 ? String(year) : year, revenue_amount: random() < 0.5 ? String(Math.round(random() * 40000000) / 100) : Math.round(random() * 400000) });
      }
      const raw = {
        id: random() > 0.5 ? 1000 + i : `c${i}`,
        name: `${pick(['Alpha', 'beta', 'Smith & Co', 'Gamma'])} ${i}`,
        lead,
        secondChair: second,
        interaction_frequency: pick([...CADENCES, '', null]),
        high_maintenance: random() < 0.3,
        stickiness: pick([null, 1, 2, 3, 4, 5, '4']),
        conflict_risk: pick(CONFLICT_RISKS),
        practiceArea: PRACTICE_AREAS.filter(() => random() < 0.15),
        revenues,
      };
      return random() < 0.5 ? strategic.calculateStrategicScores([raw])[0] : raw;
    });
    const picks = {
      name: random() < 0.5 ? `Prospect ${run}` : '',
      revenue: pick(['', '0', 'abc', '-1', '1e5', String(Math.round(random() * 500000)), Math.round(random() * 100000)]),
      practiceArea: PRACTICE_AREAS.filter(() => random() < 0.2),
      interaction_frequency: pick([...CADENCES, '', 'Hourly']),
      high_maintenance: random() < 0.3,
      stickiness: pick([null, 1, 2, 3, 4, 5, '3', 0, 6, 2.5]),
      conflict_risk: pick([...CONFLICT_RISKS, 'Unknown']),
    };
    const anyone = () => String(pick(people).id);
    const choice = {};
    if (random() < 0.5) choice.leadId = random() < 0.1 ? pick([null, '', '999']) : anyone();
    if (random() < 0.5) choice.secondChairId = random() < 0.2 ? pick([null, '', '999']) : anyone();
    const where = `run ${run}`;
    const m = clientFitModel({ people, clients, revenueOf, reportingYear: YEAR, picks, choice });
    assertP3({ ...m, clientsIn: clients }, people, where);
    assertEqualToEngines(m, choice, people, clients, where);
    // The client as the API would send it, placed with the figures the lines read
    assert.equal(m.client.effort, strategic.getEffort(m.client), where);
    assert.equal(m.score.value, Math.round(strategic.calculateStrategicValue(m.client) * 100) / 100, where);
    assert.equal(m.rank.strategicValue.of, clients.length + 1, where);
    assert.ok(m.rank.effort.place >= 1 && m.rank.effort.place <= clients.length + 1, where);
    assert.equal(m.lines.exposure, `Exposure: ${BAND_TEXT[m.band]}.`, where);
    if (m.lead.noCandidate) counts.noPartner += 1;
    if (m.lead.problem) counts.refusedLead += 1;
    if (m.secondChair.problem) counts.refusedSecond += 1;
    if (m.lead.after && !m.secondChair.proposal) counts.noAssociate += 1;
    if (m.secondChair.choice === null || m.secondChair.choice === '') counts.noneChosen += 1;
    if (m.lead.candidates.length > 1) {
      const lightest = [...m.lead.candidates].sort((a, b) => a.load.effort - b.load.effort)[0];
      if (lightest.person.id !== m.lead.proposal.id) counts.fitOverLoad += 1;
      const heaviest = [...m.lead.candidates].sort((a, b) => b.load.effort - a.load.effort)[0];
      if (heaviest.person.id === m.lead.proposal.id && heaviest.load.effort > lightest.load.effort) counts.heaviestProposed += 1;
    }
  }
  // The random books reached each case (the figures are the generator's, not pinned)
  for (const [what, n] of Object.entries(counts)) assert.ok(n > 0, `${what} happened: ${n}`);
});

test('the page\'s other models never see the hypothetical client: only the Scenarios tab and the store import the sandbox, and the server never loads the page (T3)', () => {
  // The code only: comments may name the sandbox
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  // The view runs the model; the kind chooser and the bar read sandboxEntered
  // (whether to ask before clearing it) and the store emptySandbox
  const importers = ['src/components/succession/ClientSandbox.jsx', 'src/components/succession/SuccessionScenario.tsx', 'src/components/succession/ScenarioBar.jsx', 'src/portfolioStore.js'];
  for (const file of importers) assert.ok(read(file).includes('utils/clientFit'), file);
  assert.ok(read('src/components/succession/ClientSandbox.jsx').includes('clientFitModel('), 'the view runs the model');
  for (const file of importers.slice(1)) {
    assert.ok(!read(file).includes('clientFitModel'), `${file} does not run the model`);
  }
  for (const file of [
    'src/utils/load.js', 'src/utils/departure.js', 'src/utils/associateSplit.js', 'src/utils/hireScenario.js', 'src/utils/exposure.js',
    'src/utils/scenarioState.js', 'src/utils/clientForm.js', 'src/utils/clientMetrics.js', 'utils/book.cjs', 'utils/strategic.cjs',
    'src/PartnershipAnalytics.jsx', 'src/DashboardView.jsx', 'src/ClientListView.jsx', 'src/ClientEnhancementForm.jsx', 'src/components/AIBookPanel.jsx', 'src/AIAdvisor.jsx',
  ]) {
    assert.ok(!read(file).includes('clientFit'), file);
  }
  // T3: nothing on the server requires the page's code
  for (const name of readdirSync(new URL('../utils', import.meta.url))) {
    assert.doesNotMatch(read(`utils/${name}`), /require\(['"][^'"]*src\//, `utils/${name}`);
  }
});
