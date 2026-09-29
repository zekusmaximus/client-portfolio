// An associate in Scenarios (docs/plans/tier-2.md, section 14, S18 and S19):
// src/utils/hireScenario.js proposes second-chair seats for hypothetical
// associates from the partners' books, heaviest partner first, and gives
// everyone's load before and after, with S19's reading beside P10's when the
// toggle is on. The saved state is in tests/scenario-state.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  acceptance,
  defaultTarget,
  hireScenarioModel,
  newAssociate,
  nextAssociateId,
  reliefFigures,
  RELIEVED_LEAD_SHARE,
  targetText,
  withoutAssociatePicks,
  withPick,
} from '../src/utils/hireScenario.js';
import { partnershipModel, SECOND_CHAIR_EFFORT_SHARE } from '../src/utils/load.js';
import { revenueForYear } from '../src/utils/revenue.js';

const person = (id, name, role, active = true) => ({ id, name, role, active });
const PEOPLE = [
  person(1, 'Kevin', 'partner'), person(2, 'Paula', 'partner'), person(3, 'Mike', 'partner'), person(4, 'Jeff', 'partner'),
  person(5, 'Jay', 'emeritus'), person(6, 'Anna', 'associate'), person(7, 'Ben', 'associate'), person(8, 'Steve', 'partner', false),
];
const at = new Map(PEOPLE.map((p) => [p.name, p]));
const client = (id, lead, second, area, effort, amount) => ({
  id, name: `Client ${id}`, lead: at.get(lead) || null, secondChair: second ? at.get(second) : null,
  practiceArea: area ? [area] : [], effort,
  revenues: [{ year: 2026, revenue_amount: String(amount) }],
});
// Kevin far above the partners' average; Paula a little above; Mike and Jeff below
const CLIENTS = [
  client('k1', 'Kevin', null, 'Healthcare', 5, 100000),
  client('k2', 'Kevin', 'Paula', 'Energy', 3, 80000),
  client('k3', 'Kevin', 'Anna', 'Healthcare', 3, 70000),
  client('k4', 'Kevin', null, 'Municipal', 3, 60000),
  client('k5', 'Kevin', 'Jay', 'Education', 2, 50000),
  client('k6', 'Kevin', null, 'Healthcare', 2, 40000),
  client('p1', 'Paula', null, 'Healthcare', 3, 30000),
  client('p2', 'Paula', 'Kevin', 'Energy', 2, 20000),
  client('p3', 'Paula', 'Ben', 'Other', 2, 10000),
  client('m1', 'Mike', null, 'Corporate', 1, 5000),
  client('j1', 'Jeff', 'Mike', 'Healthcare', 1, 5000),
  client('o1', null, null, null, 1, 1000),          // no lead (saved before the People list)
  client('s1', 'Steve', null, null, 1, 1000),       // an inactive lead (saved before P5)
];
const revenueOf = (c) => revenueForYear(c, 2026);
const hire = (associates, { picks = {}, relief = false, people = PEOPLE, clients = CLIENTS } = {}) =>
  hireScenarioModel({ people, clients, revenueOf, associates, picks, relief });
const associate = (overrides = {}) => ({ id: 'h1', label: 'New associate', focus: [], target: { kind: 'count', count: 4 }, personId: null, ...overrides });
const ids = (seats) => seats.map((s) => s.clientId);
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} against ${b}`);
const row = (m, name) => m.groups.flatMap((g) => g.rows).find((r) => r.person.name === name);
// The book with a model's seats applied, as a partner would read it
const bookAfter = (m, people = PEOPLE, clients = CLIENTS) => {
  const bySeat = new Map(m.seats.filter((s) => s.source !== 'done').map((s) => [s.clientId, m.associates.find((a) => a.id === s.associateId).person]));
  const hypotheticals = m.associates.filter((a) => a.hypothetical).map((a) => a.person);
  return {
    people: [...people, ...hypotheticals],
    clients: clients.map((c) => (bySeat.has(String(c.id)) ? { ...c, secondChair: bySeat.get(String(c.id)) } : c)),
  };
};

test('the open seats: empty ones and partners\' ones on an active partner\'s book; never an associate\'s or the emeritus\'s seat, a client without a lead or with an inactive one', () => {
  const m = hire([associate()]);
  assert.deepEqual(ids(m.open).sort(), ['j1', 'k1', 'k2', 'k4', 'k6', 'm1', 'p1', 'p2']);
  for (const seat of m.open) assert.ok(!seat.holder || seat.holder.role === 'partner', seat.clientId);
});

test('proposals come from the heaviest partner\'s book first, the heaviest client first, and stop at the target', () => {
  const m = hire([associate()]);
  assert.deepEqual(m.partners.map((p) => p.person.name), ['Kevin', 'Paula', 'Mike', 'Jeff'], 'heaviest total load first');
  near(m.partners[0].excess, 18.4 - (18.4 + 7.6 + 1.2 + 1) / 4, 'Kevin above the partners\' average');
  // Kevin is far above everyone: all four seats are his, heaviest first
  assert.deepEqual(ids(m.seats), ['k1', 'k2', 'k4', 'k6']);
  assert.ok(m.seats.every((s) => s.source === 'proposal' && s.lead.name === 'Kevin'));
  assert.deepEqual(m.totals, { seats: 4, done: 0, picked: 0, proposed: 4, revenue: 280000, effort: 13, notApplied: 0 });
  assert.equal(m.associates[0].reached, true);
  assert.deepEqual(ids(hire([associate({ target: { kind: 'count', count: 0 } })]).seats), [], 'a target of 0: nothing proposed');
  assert.equal(ids(hire([associate({ target: { kind: 'count', count: 50 } })]).seats).length, 8, 'no more than the open seats');
});

test('proposals spread: each seat counts as relief for its partner before the next is ranked, so two heavy partners alternate', () => {
  const clients = [
    client('x1', 'Kevin', null, null, 2, 300), client('x2', 'Kevin', null, null, 2, 200), client('x3', 'Kevin', null, null, 2, 100),
    client('y1', 'Paula', null, null, 2, 300), client('y2', 'Paula', null, null, 2, 200), client('y3', 'Paula', null, null, 1.8, 100),
    client('z1', 'Mike', null, null, 1, 100),
  ];
  const m = hire([associate()], { clients });
  // Kevin 6, Paula 5.8: x1 relieves Kevin to 5.6, so y1 is next, and so on
  assert.deepEqual(ids(m.seats), ['x1', 'y1', 'x2', 'y2']);
  // The relief is a ranking device: under P10 no lead's figure falls
  assert.equal(row(m, 'Kevin').after.lead.effort, row(m, 'Kevin').before.lead.effort);
  // The toggle changes figures, never proposals
  assert.deepEqual(ids(hire([associate()], { clients, relief: true }).seats), ids(m.seats));
});

test('practice-area fit with the associate\'s focus breaks ties in effort, and only ties', () => {
  const clients = [
    client('c1', 'Kevin', null, 'Energy', 2, 100), client('c2', 'Kevin', null, 'Healthcare', 2, 100),
    client('c3', 'Kevin', null, 'Energy', 3, 50), client('c4', 'Mike', null, null, 1, 100),
  ];
  const first = (focus) => ids(hire([associate({ focus, target: { kind: 'count', count: 2 } })], { clients }).seats);
  assert.deepEqual(first(['Healthcare']), ['c3', 'c2'], 'c3 is heavier, so first whatever the focus; then Healthcare breaks the tie');
  assert.deepEqual(first(['Energy']), ['c3', 'c1']);
  assert.deepEqual(first([]), ['c3', 'c1'], 'no focus: revenue, then the name');
  const seat = hire([associate({ focus: ['Healthcare', 'Energy'] })], { clients }).seats.find((s) => s.clientId === 'c2');
  assert.deepEqual(seat.sharedAreas, ['Healthcare']);
});

test('a partner\'s second-chair seat taken: that partner\'s load falls by the 20% share, the associate\'s rises by it, and no lead moves', () => {
  const m = hire([associate({ target: { kind: 'count', count: 2 } })]);
  assert.deepEqual(ids(m.seats), ['k1', 'k2']);
  const paula = row(m, 'Paula');
  near(paula.before.second.effort - paula.after.second.effort, 3 * SECOND_CHAIR_EFFORT_SHARE, 'Paula freed of k2\'s share');
  assert.deepEqual([paula.before.second.count, paula.after.second.count], [1, 0]);
  const hypothetical = row(m, 'New associate');
  assert.equal(hypothetical.hypothetical, true);
  near(hypothetical.after.second.effort, (5 + 3) * SECOND_CHAIR_EFFORT_SHARE, 'the associate carries the share');
  assert.deepEqual([hypothetical.before.second.count, hypothetical.after.second.count], [0, 2]);
  for (const r of m.groups.flatMap((g) => g.rows)) {
    assert.equal(r.after.lead.count, r.before.lead.count, `${r.person.name}: no lead changes`);
  }
});

test('the target: a number of clients, or the active associates\' average second-chair effort; the defaults', () => {
  // Anna 0.6, Ben 0.4: an average of 0.5; k1 alone (1.0) reaches it
  const average = hire([associate({ target: { kind: 'average' } })]);
  assert.deepEqual(average.associates[0].goal, { kind: 'average', effort: 0.5, members: 2 });
  assert.deepEqual(ids(average.seats), ['k1']);
  assert.equal(average.associates[0].reached, true);
  // No active associate: no average to reach, and a number of clients by default
  const noAssociates = PEOPLE.filter((p) => p.role !== 'associate');
  const clients = CLIENTS.map((c) => (c.secondChair?.role === 'associate' ? { ...c, secondChair: null } : c));
  const none = hire([associate({ target: { kind: 'average' } })], { people: noAssociates, clients });
  assert.match(none.associates[0].goalProblem, /no active associate to average/);
  assert.deepEqual(none.seats, []);
  // Associates who second nothing: an average of 0, said so
  const idle = hire([associate({ target: { kind: 'average' } })], { clients });
  assert.match(idle.associates[0].goalProblem, /their average is 0/);
  assert.deepEqual(defaultTarget(PEOPLE, CLIENTS), { kind: 'average' });
  // The active partners' average number of second-chair seats, rounded, at least 1: Kevin p2, Paula k2, Mike j1
  assert.deepEqual(defaultTarget(noAssociates, clients), { kind: 'count', count: 1 });
  assert.deepEqual(newAssociate([{ id: 'h1' }, { id: 'h3' }], { people: PEOPLE, clients: CLIENTS }),
    { id: 'h4', label: 'New associate', focus: [], target: { kind: 'average' }, personId: null });
  assert.deepEqual([nextAssociateId([]), nextAssociateId([{ id: 'h9' }])], ['h1', 'h10']);
  assert.equal(targetText({ kind: 'count', count: 1 }), '1 client');
  assert.equal(targetText({ kind: 'average', effort: 0.5 }), 'the associates\' average second-chair effort (0.5)');
});

test('picks: added first and counted toward the target; a removed proposal is refilled; a pick the seat rules refuse shows why and is not applied', () => {
  const picks = withPick(withPick({}, CLIENTS.find((c) => c.id === 'p1'), 'h1'), CLIENTS.find((c) => c.id === 'k1'), null);
  assert.deepEqual(picks, { p1: { associateId: 'h1', seenSecondChairId: null }, k1: { associateId: null, seenSecondChairId: null } });
  const m = hire([associate()], { picks });
  assert.deepEqual(m.seats.map((s) => [s.clientId, s.source]), [['p1', 'pick'], ['k2', 'proposal'], ['k4', 'proposal'], ['k6', 'proposal']]);
  assert.deepEqual(ids(m.removed), ['k1']);
  // Forgetting a pick gives the client back to the proposals
  assert.deepEqual(withPick(picks, { id: 'k1' }, undefined), { p1: picks.p1 });

  const refused = hire([associate()], {
    picks: {
      k3: { associateId: 'h1', seenSecondChairId: '6' },   // Anna, an associate
      k5: { associateId: 'h1', seenSecondChairId: '5' },   // Jay, the emeritus
      o1: { associateId: 'h1', seenSecondChairId: null },  // no lead
      s1: { associateId: 'h1', seenSecondChairId: null },  // an inactive lead
      p1: { associateId: 'h9', seenSecondChairId: null },  // no such associate
    },
  });
  const why = Object.fromEntries(refused.notApplied.map((n) => [n.clientId, n.problem]));
  assert.deepEqual(why, {
    k3: 'Anna, an associate, holds this seat; a hire scenario takes only empty seats and partners\' seats.',
    k5: 'Jay, the emeritus, holds this seat; a hire scenario takes only empty seats and partners\' seats.',
    o1: 'The client has no lead; give it one in Client Details first.',
    s1: 'Steve, the lead, is not an active partner; give the client a lead in Client Details first.',
    p1: 'This pick names an associate no longer in the scenario.',
  });
  // Not applied: the proposals stand as without them
  assert.deepEqual(ids(refused.seats), ids(hire([associate()]).seats));
});

test('a pick whose seat has changed since it was made shows why and is not applied; picking it again records the seat as it is now', () => {
  const k2 = CLIENTS.find((c) => c.id === 'k2');
  const picks = withPick({}, k2, 'h1');
  assert.deepEqual(picks.k2, { associateId: 'h1', seenSecondChairId: '2' });
  const moved = CLIENTS.map((c) => (c.id === 'k2' ? { ...c, secondChair: at.get('Mike') } : c));
  const m = hire([associate()], { picks, clients: moved });
  assert.deepEqual(m.notApplied.map((n) => [n.clientId, n.stale, n.problem]), [
    ['k2', true, 'The seat was held by Paula when this was picked and is held by Mike now, so the pick is not applied. Pick it again or remove it.'],
  ]);
  assert.ok(!m.seats.some((s) => s.source === 'pick'));
  const again = hire([associate()], { picks: withPick(picks, moved.find((c) => c.id === 'k2'), 'h1'), clients: moved });
  assert.deepEqual(again.seats[0].clientId, 'k2');
  assert.deepEqual([again.seats[0].source, again.seats[0].seenSecondChairId, again.notApplied], ['pick', '3', []]);
});

test('two hypothetical associates: each seat to the one whose focus fits, then the lighter; each stops at its own target', () => {
  const m = hire([
    associate({ id: 'h1', label: 'Healthcare hire', focus: ['Healthcare'], target: { kind: 'count', count: 2 } }),
    associate({ id: 'h2', label: 'Energy hire', focus: ['Energy'], target: { kind: 'count', count: 2 } }),
  ]);
  const of = (id) => m.seats.filter((s) => s.associateId === id).map((s) => s.clientId);
  assert.deepEqual(of('h1'), ['k1', 'k6']);
  assert.deepEqual(of('h2'), ['k2', 'k4']);
  assert.equal(new Set(ids(m.seats)).size, m.seats.length, 'no client twice');
  assert.deepEqual(withoutAssociatePicks({ a: { associateId: 'h1' }, b: { associateId: 'h2' }, c: { associateId: null } }, 'h1'),
    { b: { associateId: 'h2' }, c: { associateId: null } });
});

test('with the toggle off, every real person\'s figures equal partnershipModel\'s on the same picks', () => {
  const m = hire([associate({ focus: ['Healthcare'] })], { picks: withPick({}, CLIENTS.find((c) => c.id === 'p2'), 'h1') });
  assert.equal(m.relief, null);
  const { people, clients } = bookAfter(m);
  const expected = partnershipModel(people, clients, revenueOf);
  assert.deepEqual(m.after, expected);
  assert.deepEqual(m.before, partnershipModel(PEOPLE, CLIENTS, revenueOf));
  for (const r of m.groups.flatMap((g) => g.rows)) {
    assert.deepEqual(r.after, expected.rows.find((x) => x.person.id === r.person.id), r.person.name);
  }
});

test('with the toggle on (S19), each lead an associate seconds carries 80% of that client\'s effort, before and after; nothing else changes', () => {
  const off = hire([associate({ focus: ['Healthcare'] })]);
  const on = hire([associate({ focus: ['Healthcare'] })], { relief: true });
  assert.equal(RELIEVED_LEAD_SHARE, 1 - SECOND_CHAIR_EFFORT_SHARE);
  assert.deepEqual(ids(on.seats), ids(off.seats));
  assert.deepEqual([on.before, on.after], [off.before, off.after], 'P10\'s figures unchanged beside S19\'s');
  const { people, clients } = bookAfter(on);
  const roles = new Map(people.map((p) => [p.id, p.role]));
  const s19 = (books, name) => books.filter((c) => c.lead?.name === name)
    .reduce((sum, c) => sum + c.effort * (c.secondChair && roles.get(c.secondChair.id) === 'associate' ? 0.8 : 1), 0);
  for (const name of ['Kevin', 'Paula', 'Mike', 'Jeff']) {
    const r = row(on, name);
    near(r.relief.before.leadEffort, s19(CLIENTS, name), `${name} before`);
    near(r.relief.after.leadEffort, s19(clients, name), `${name} after`);
    near(r.relief.after.totalEffort, r.relief.after.leadEffort + r.after.second.effort, `${name} total`);
  }
  // Kevin: k3 (Anna) relieved before; k1, k2, k4 and k6 too after
  near(row(on, 'Kevin').relief.before.leadEffort, 18 - 3 * 0.2, 'Kevin before');
  near(row(on, 'Kevin').relief.after.leadEffort, 18 - (3 + 5 + 3 + 3 + 2) * 0.2, 'Kevin after');
  near(on.relief.after.averages.partner.leadEffort, [...on.relief.after.rows.values()].filter((r) => r.person.active && r.person.role === 'partner').reduce((s, r) => s + r.leadEffort, 0) / 4, 'the partners\' average under S19');
  // reliefFigures alone, on a model without associates, is P10's lead effort
  const plain = partnershipModel(PEOPLE, CLIENTS.map((c) => ({ ...c, secondChair: null })), revenueOf);
  for (const r of reliefFigures(plain, (p) => p.role).rows.values()) {
    near(r.leadEffort, plain.rows.find((x) => x.person.id === r.person.id).lead.effort, r.person.name);
  }
});

test('after the hire: linked to an associate on the People list, the hypothetical is that person, its seats held already are accepted, and each other seat can be accepted with the seat as the scenario saw it', () => {
  const ria = person(9, 'Ria', 'associate');
  const people = [...PEOPLE, ria];
  const clients = CLIENTS.map((c) => (c.id === 'k1' ? { ...c, secondChair: ria } : c));
  const picks = withPick({}, CLIENTS.find((c) => c.id === 'k1'), 'h1');
  const m = hire([associate({ personId: '9' })], { people, clients, picks });
  const a = m.associates[0];
  assert.deepEqual([a.hypothetical, a.linked?.name, a.person.id], [false, 'Ria', 9]);
  assert.deepEqual(m.seats.map((s) => [s.clientId, s.source]), [['k1', 'done'], ['k2', 'proposal'], ['k4', 'proposal'], ['k6', 'proposal']]);
  assert.ok(!m.groups.flatMap((g) => g.rows).some((r) => r.hypothetical), 'no hypothetical row once linked');
  assert.deepEqual(acceptance(m.seats[0], a), { ok: false, reason: 'Ria is its second chair.' });
  assert.deepEqual(acceptance(m.seats[1], a), { ok: true, reason: null, expectedSecondChairId: 2 });
  assert.deepEqual(acceptance(m.seats[2], a), { ok: true, reason: null, expectedSecondChairId: null });
  assert.deepEqual(acceptance(hire([associate()]).seats[0], hire([associate()]).associates[0]).reason, 'Link this associate to a person on the People list first.');

  // A link that no longer holds is not used, and says why
  const gone = hire([associate({ personId: '99' })]);
  assert.deepEqual([gone.associates[0].hypothetical, gone.associates[0].linkProblem], [true, 'The person this associate was linked to is no longer on the People list; the link is not used.']);
  const promoted = hire([associate({ personId: '1' })]);
  assert.equal(promoted.associates[0].linkProblem, 'Kevin is no longer an active associate on the People list; the link is not used.');
  const twice = hire([associate({ personId: '9' }), associate({ id: 'h2', label: 'Second hire', personId: '9' })], { people });
  assert.equal(twice.associates[1].linkProblem, 'Ria is already linked to New associate; the link is not used.');
});

test('pure: the inputs are not changed, and a hypothetical id is never a People list id', () => {
  const people = JSON.parse(JSON.stringify(PEOPLE));
  const clients = JSON.parse(JSON.stringify(CLIENTS));
  const associates = [associate({ focus: ['Healthcare'] })];
  const picks = { p1: { associateId: 'h1', seenSecondChairId: null } };
  const copies = JSON.stringify([people, clients, associates, picks]);
  hireScenarioModel({ people, clients, revenueOf, associates, picks, relief: true });
  assert.equal(JSON.stringify([people, clients, associates, picks]), copies);
  assert.ok(!people.some((p) => String(p.id) === 'h1'));
});

test('the page\'s other models never see a hypothetical person: only the Scenarios tab imports the hire model', () => {
  const importers = ['src/components/succession/HireScenario.jsx', 'src/portfolioStore.js', 'src/utils/scenarioState.js'];
  for (const file of ['src/utils/load.js', 'src/utils/departure.js', 'src/utils/associateSplit.js', 'utils/book.cjs', 'src/PartnershipAnalytics.jsx', 'src/DashboardView.jsx', 'src/components/AIBookPanel.jsx']) {
    assert.ok(!readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').includes('hireScenario'), file);
  }
  for (const file of importers) assert.ok(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').includes('hireScenario'), file);
});

// P3 on seeded random books: a hypothetical person never leads, never
// seconds a client they would lead, and never takes an existing associate's
// or the emeritus's seat; no client is seated twice; and the toggle-off
// figures are partnershipModel's
test('P3 on 300 seeded random books, focuses, targets, picks and links', () => {
  let seed = 20260929;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const AREAS = ['Healthcare', 'Energy', 'Municipal', 'Corporate', 'Other'];
  for (let run = 0; run < 300; run += 1) {
    const people = [
      ...PEOPLE.map((p) => ({ ...p, active: p.name === 'Steve' ? false : random() > 0.08 })),
      ...(random() > 0.5 ? [person(9, 'Ria', 'associate')] : []),
    ];
    const listed = new Map(people.map((p) => [p.id, p]));
    const partners = people.filter((p) => p.role === 'partner');
    const clients = Array.from({ length: 4 + Math.floor(random() * 16) }, (_, n) => {
      const lead = random() > 0.08 ? pick(partners) : null;
      const second = random() > 0.45 ? pick(people) : null;
      return {
        id: random() > 0.5 ? n + 1 : `c${n}`,
        name: `R${n}`,
        lead,
        secondChair: second && lead && second.id === lead.id ? null : second,
        practiceArea: random() > 0.2 ? [pick(AREAS)] : [],
        effort: [0.5, 0.75, 1, 1.5, 2, 3, 4.5, 5, 7.5][Math.floor(random() * 9)],
        revenues: [{ year: 2026, revenue_amount: String(Math.round(random() * 100000)) }],
      };
    });
    const associates = Array.from({ length: 1 + Math.floor(random() * 3) }, (_, n) => ({
      id: `h${n + 1}`,
      label: `Hire ${n + 1}`,
      focus: AREAS.filter(() => random() > 0.7),
      target: random() > 0.5 ? { kind: 'average' } : { kind: 'count', count: Math.floor(random() * 6) },
      personId: random() > 0.8 ? pick(['9', '6', '1', '99']) : null,
    }));
    let picks = {};
    for (const c of clients) {
      if (random() > 0.8) picks = withPick(picks, c, random() > 0.3 ? pick([...associates.map((a) => a.id), 'h9']) : null);
    }
    const relief = random() > 0.5;
    const m = hireScenarioModel({ people, clients, revenueOf, associates, picks, relief });
    const where = `run ${run}`;
    const seen = new Set();
    for (const seat of m.seats) {
      const a = m.associates.find((x) => x.id === seat.associateId);
      assert.ok(!seen.has(seat.clientId), `${where}: ${seat.clientId} seated twice`);
      seen.add(seat.clientId);
      const lead = listed.get(seat.client.lead?.id);
      assert.notEqual(String(lead?.id), String(a.person.id), `${where}: never the lead in both seats`);
      if (seat.source === 'done') {
        // A seat the linked person holds already, as the book has it
        assert.equal(String(seat.holder.id), String(a.person.id), where);
      } else {
        assert.ok(lead && lead.active && lead.role === 'partner', `${where}: ${seat.clientId} has an active partner as lead`);
        const holder = seat.holder ? listed.get(seat.holder.id) : null;
        assert.ok(!holder || holder.role === 'partner', `${where}: ${seat.clientId} held by ${holder?.name}, not a partner`);
      }
      if (a.hypothetical) assert.ok(!listed.has(a.person.id) && /^h\d+$/.test(a.person.id), where);
    }
    for (const a of m.associates) {
      const own = m.seats.filter((s) => s.associateId === a.id);
      const proposed = own.filter((s) => s.source === 'proposal').length;
      if (a.goal.kind === 'count') assert.ok(proposed <= Math.max(0, a.goal.count - (own.length - proposed)), `${where}: ${a.id} past its target`);
      if (a.goalProblem) assert.equal(proposed, 0, where);
    }
    const hypotheticals = m.associates.filter((a) => a.hypothetical).map((a) => a.person.id);
    for (const r of m.after.rows) {
      if (hypotheticals.includes(r.person.id)) assert.equal(r.lead.count, 0, `${where}: a hypothetical person never leads`);
      else assert.equal(r.lead.count, m.before.rows.find((x) => x.person.id === r.person.id).lead.count, `${where}: no lead moves`);
    }
    const book = bookAfter(m, people, clients);
    assert.deepEqual(m.after, partnershipModel(book.people, book.clients, revenueOf), where);
    assert.deepEqual(ids(hireScenarioModel({ people, clients, revenueOf, associates, picks, relief: !relief }).seats), ids(m.seats), `${where}: the toggle moves no proposal`);
  }
});
