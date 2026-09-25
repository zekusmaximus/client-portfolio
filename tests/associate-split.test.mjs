// The associate split (docs/plans/people-and-second-chair.md, Phase 6, P9):
// src/utils/associateSplit.js proposes a second chair from the associates for
// each client with a lead and none, by Phase 5's ranking (practice-area fit,
// then the lighter total load), respecting P3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { associateSplitModel } from '../src/utils/associateSplit.js';
import { revenueForYear } from '../src/utils/revenue.js';
import { SECOND_CHAIR_EFFORT_SHARE } from '../src/utils/load.js';

const person = (id, name, role, active = true) => ({ id, name, role, active });
const PEOPLE = [
  person(1, 'Kevin', 'partner'), person(2, 'Paula', 'partner'), person(3, 'Jay', 'emeritus'),
  person(4, 'Anna', 'associate'), person(5, 'Ben', 'associate'), person(6, 'Cara', 'associate'),
  person(7, 'Dan', 'associate', false), person(8, 'Steve', 'partner', false),
];
const at = new Map(PEOPLE.map((p) => [p.name, p]));
const client = (id, lead, second, area, effort, amount) => ({
  id, name: `Client ${id}`, lead: at.get(lead) || null, secondChair: second ? at.get(second) : null,
  practiceArea: area ? [area] : [], effort,
  revenues: [{ year: 2026, revenue_amount: String(amount) }],
});
const CLIENTS = [
  client('a1', 'Kevin', 'Anna', 'Healthcare', 3, 60000),
  client('a2', 'Paula', null, 'Healthcare', 4.5, 50000),
  client('a3', 'Kevin', null, 'Energy', 2, 30000),
  client('a4', 'Paula', null, 'Municipal', 1, 10000),
  client('a5', 'Kevin', 'Ben', 'Energy', 2, 20000),
  client('a6', 'Steve', null, null, 1, 5000),      // saved before P5: an inactive lead
  client('a7', 'Paula', 'Jay', 'Education', 0.5, 1000),
];
const revenueOf = (c) => revenueForYear(c, 2026);
const split = (picks = {}, people = PEOPLE, clients = CLIENTS) => associateSplitModel({ people, clients, revenueOf, picks });
const row = (m, id) => m.proposals.find((p) => p.client.id === id);
const names = (candidates) => candidates.map((c) => c.person.name);
const nameOf = (p) => (p ? p.name : null);

test('the clients with a lead and no second chair, heaviest first, each with an associate proposed', () => {
  const m = split();
  assert.deepEqual(m.proposals.map((p) => p.client.id), ['a2', 'a3', 'a4', 'a6']);
  // a2 (Healthcare): Anna seconds a Healthcare client
  assert.equal(nameOf(row(m, 'a2').proposal), 'Anna');
  // a3 (Energy): Ben seconds an Energy client
  assert.equal(nameOf(row(m, 'a3').proposal), 'Ben');
  // a4 (Municipal): nobody fits, so the lightest total load: Cara, who holds nothing
  assert.equal(nameOf(row(m, 'a4').proposal), 'Cara');
  assert.deepEqual(m.proposals.map((p) => nameOf(p.after)), ['Anna', 'Ben', 'Cara', null]);
  assert.deepEqual(m.totals, { open: 4, proposed: 3, revenue: 95000, associates: 3 });
});

test('the picker: the associates in rank order, then everyone else P3 allows; never the lead or anyone inactive', () => {
  const a2 = row(split(), 'a2');
  // Anna (fit), then Cara and Ben by total load; then Kevin (a Healthcare lead book) and Jay
  assert.deepEqual(names(a2.candidates), ['Anna', 'Cara', 'Ben', 'Kevin', 'Jay']);
  for (const p of split().proposals) {
    assert.ok(!names(p.candidates).includes(p.lead.name), 'never the lead');
    assert.ok(!names(p.candidates).some((n) => ['Dan', 'Steve'].includes(n)), 'never someone inactive');
  }
});

test('proposals spread: each one adds to its associate\'s load before the next client is ranked', () => {
  const clients = [
    client('x', 'Kevin', null, null, 3, 100),
    client('y', 'Kevin', null, null, 2, 100),
    client('z', 'Kevin', null, null, 1, 100),
  ];
  const m = split({}, PEOPLE, clients);
  assert.deepEqual(m.proposals.map((p) => [p.client.id, nameOf(p.proposal)]), [['x', 'Anna'], ['y', 'Ben'], ['z', 'Cara']]);
  // y is ranked after x went to Anna, so Anna is now the heaviest associate
  assert.deepEqual(names(row(m, 'y').candidates).slice(0, 3), ['Ben', 'Cara', 'Anna']);
});

test('a partner\'s pick replaces the proposal; one P3 forbids is refused with the reason; null leaves the seat empty', () => {
  const m = split({ a2: 1, a3: 2, a4: null });
  assert.deepEqual([nameOf(row(m, 'a2').after), row(m, 'a2').problem], ['Kevin', null], 'anyone P3 allows, a partner too');
  assert.deepEqual([nameOf(row(m, 'a3').after), row(m, 'a3').problem], ['Paula', null], 'Kevin leads a3, so Paula may second it');
  assert.equal(row(m, 'a4').after, null);

  const refused = split({ a2: 2, a3: 7, a4: 99 });
  assert.equal(row(refused, 'a2').problem, 'Paula is the lead; the second chair must be someone else.');
  assert.equal(nameOf(row(refused, 'a2').after), 'Anna', 'the proposal stands');
  assert.equal(row(refused, 'a3').problem, 'Dan is inactive.');
  assert.equal(row(refused, 'a4').problem, 'This person is not on the People list.');
  // A select's string value works as well as a number
  assert.equal(nameOf(row(split({ a2: '5' }), 'a2').after), 'Ben');
});

test('a client whose lead is not an active partner is shown but not proposed for', () => {
  const a6 = row(split(), 'a6');
  assert.equal(a6.after, null);
  assert.deepEqual(a6.candidates, []);
  assert.match(a6.blocker, /^Steve, the lead, is not an active partner/);
  assert.equal(row(split({ a6: 4 }), 'a6').after, null, 'a pick cannot get round it');
});

test('each associate\'s second-chair load before and after, against the associates\' average', () => {
  const m = split();
  const a = (name) => m.associates.find((r) => r.person.name === name);
  assert.deepEqual(m.associates.map((r) => r.person.name), ['Anna', 'Ben', 'Cara'], 'active associates only, busiest after first');
  assert.deepEqual([a('Anna').before.second.count, a('Anna').after.second.count], [1, 2]);
  assert.deepEqual([a('Ben').before.second.revenue, a('Ben').after.second.revenue], [20000, 50000]);
  assert.ok(Math.abs(a('Cara').after.second.effort - 1 * SECOND_CHAIR_EFFORT_SHARE) < 1e-9);
  assert.equal(m.averages.before.members, 3, 'Dan is inactive and out of the average');
  assert.equal(m.averages.before.second.count, 2 / 3);
  assert.equal(m.averages.after.second.count, 5 / 3);
  assert.equal(a('Cara').before.secondRatio.count, 0);
  assert.equal(a('Anna').after.secondRatio.count, 2 / (5 / 3));
});

test('P3 on every proposal and pick: the seat goes to an active person who is not the lead, or stays empty', () => {
  let seed = 11;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (list) => list[Math.floor(random() * list.length)];
  for (let round = 0; round < 150; round++) {
    const people = PEOPLE.map((p) => ({ ...p, active: ['Dan', 'Steve'].includes(p.name) ? false : random() > 0.1 }));
    const partners = people.filter((p) => p.active && p.role === 'partner');
    if (!partners.length) continue;
    const clients = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1, name: `R${i}`, lead: pick(partners),
      secondChair: random() > 0.5 ? pick(people.filter((p) => p.active)) : null,
      practiceArea: [pick(['Healthcare', 'Energy', 'Municipal'])], effort: pick([0.5, 1, 2, 3, 4.5]),
      revenues: [{ year: 2026, revenue_amount: '1000' }],
    })).map((c) => (c.secondChair && c.secondChair.id === c.lead.id ? { ...c, secondChair: null } : c));
    const picks = {};
    for (const c of clients) if (random() > 0.6) picks[c.id] = random() > 0.2 ? pick(people).id : null;
    const m = associateSplitModel({ people, clients, revenueOf, picks });
    for (const p of m.proposals) {
      if (p.after) {
        const holder = people.find((x) => x.id === p.after.id);
        assert.ok(holder.active, 'active');
        assert.notEqual(holder.id, p.lead.id, 'not the lead');
      }
      if (p.proposal) assert.equal(p.proposal.role, 'associate', 'the proposal is an associate');
      if (p.problem) assert.notEqual(String(p.after?.id), String(p.pick));
    }
  }
});

test('with no active associates, nothing is proposed, and the picker still offers everyone P3 allows', () => {
  const people = PEOPLE.map((p) => (p.role === 'associate' ? { ...p, active: false } : p));
  const m = split({}, people);
  assert.ok(m.proposals.every((p) => p.proposal === null && p.after === null));
  assert.deepEqual(names(row(m, 'a2').candidates), ['Kevin', 'Jay']);
  assert.deepEqual(m.associates, []);
  assert.equal(m.totals.proposed, 0);
});
