// The departure engine (docs/plans/people-and-second-chair.md, Phase 5):
// src/utils/departure.js, which Stage 1 of Scenarios reads and Phase 6 reuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  departureModel,
  rankCandidates,
  assignmentProblems,
  candidateReason,
  createLedger,
  areaIndex,
  leadPool,
  secondChairPool,
  toggleId,
  withChoice,
} from '../src/utils/departure.js';
import { partnershipModel, SECOND_CHAIR_EFFORT_SHARE } from '../src/utils/load.js';
import { revenueForYear } from '../src/utils/revenue.js';

const person = (id, name, role, active = true) => ({ id, name, role, active });
const PEOPLE = [
  person(1, 'Brendan', 'partner'), person(2, 'Jeff', 'partner'), person(3, 'Joe', 'partner'),
  person(4, 'Kevin', 'partner'), person(5, 'Mike', 'partner'), person(6, 'Paula', 'partner'),
  person(7, 'Jay', 'emeritus'), person(8, 'Anna', 'associate'), person(9, 'Ben', 'associate'),
  person(10, 'Steve', 'partner', false),
];
const byName = new Map(PEOPLE.map((p) => [p.name, p]));
const id = (name) => byName.get(name).id;

// A client as the API sends it: lead and secondChair nested, effort computed
const client = (cid, lead, second, area, effort, amount) => ({
  id: cid,
  name: `Client ${cid}`,
  lead: lead ? byName.get(lead) : null,
  secondChair: second ? byName.get(second) : null,
  practiceArea: area ? [].concat(area) : [],
  effort,
  revenues: amount ? [{ year: 2026, revenue_amount: String(amount) }] : [],
});

const CLIENTS = [
  client('c1', 'Kevin', 'Jay', 'Healthcare', 3, 60000),
  client('c2', 'Kevin', 'Paula', 'Energy', 4.5, 40000),
  client('c3', 'Kevin', 'Anna', 'Municipal', 2, 30000),
  client('c4', 'Kevin', null, 'Healthcare', 2, 10000),
  client('c5', 'Paula', 'Anna', 'Energy', 2, 50000),
  client('c6', 'Joe', 'Ben', 'Healthcare', 1, 20000),
  client('c7', 'Mike', 'Kevin', 'Municipal', 3, 25000),
  client('c8', 'Brendan', 'Anna', 'Education', 0.5, 5000),
];
const revenueOf = (c) => revenueForYear(c, 2026);
const model = (departing, choices = {}, people = PEOPLE, clients = CLIENTS) =>
  departureModel({ people, clients, departingIds: departing.map(id), revenueOf, choices });

const decision = (m, cid) => m.decisions.find((d) => d.client.id === cid);
const names = (candidates) => candidates.map((c) => c.person.name);
const nameOf = (p) => (p ? p.name : null);
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message || ''} expected ${expected}, got ${actual}`);

// P3 after every decision: the lead an active partner who is staying (or no
// lead, only when no candidate existed), the second chair empty or an active
// person who is staying and is not the lead
function assertP3(m, people, departingIds) {
  const byId = new Map(people.map((p) => [String(p.id), p]));
  const departing = new Set(departingIds.map(String));
  for (const d of m.decisions) {
    const lead = d.lead.after;
    if (lead) {
      const p = byId.get(String(lead.id));
      assert.ok(p && p.active && p.role === 'partner', `${d.client.id}: lead ${lead.name} is an active partner`);
      assert.ok(!departing.has(String(lead.id)), `${d.client.id}: lead ${lead.name} is staying`);
    } else {
      assert.ok(d.lead.needed && d.lead.noCandidate && d.lead.candidates.length === 0,
        `${d.client.id}: no lead only when no partner can take it`);
      assert.ok(m.unresolved.includes(d));
    }
    const second = d.secondChair.after;
    if (second) {
      const p = byId.get(String(second.id));
      assert.ok(p && p.active, `${d.client.id}: second chair ${second.name} is active`);
      assert.ok(!departing.has(String(second.id)), `${d.client.id}: second chair ${second.name} is staying`);
      assert.ok(!lead || String(second.id) !== String(lead.id), `${d.client.id}: second chair is not the lead`);
    }
  }
  // Departing people end at zero, and no client in the book after names them
  for (const pid of departingIds) {
    const row = m.after.rows.find((r) => String(r.person.id) === String(pid));
    if (row) assert.deepEqual([row.lead.count, row.second.count], [0, 0], `departing ${row.person.name} holds nothing after`);
  }
}

test('a partner leaves: every client they lead needs a new lead, every seat they hold becomes empty', () => {
  const m = model(['Kevin']);
  assert.deepEqual(m.departing.map((p) => p.name), ['Kevin']);
  // Kevin leads c1-c4 and seconds c7; settled heaviest effort first
  assert.deepEqual(m.decisions.map((d) => d.client.id), ['c2', 'c1', 'c7', 'c3', 'c4']);
  assert.deepEqual(m.decisions.filter((d) => d.lead.needed).map((d) => d.client.id), ['c2', 'c1', 'c3', 'c4']);
  assert.ok(m.decisions.filter((d) => d.lead.needed).every((d) => d.lead.why === 'leaves'));
  const c7 = decision(m, 'c7');
  assert.equal(c7.lead.needed, false, 'Mike still leads c7');
  assert.equal(nameOf(c7.lead.after), 'Mike');
  assert.deepEqual([c7.secondChair.vacated, c7.secondChair.why], [true, 'leaves']);
  assert.equal(decision(m, 'c5'), undefined, 'a client the departure does not touch needs no decision');
  assertP3(m, PEOPLE, [id('Kevin')]);
});

test('lead candidates: the second chair first when a partner, then practice-area fit, then lighter lead load', () => {
  const m = model(['Kevin']);
  // c2: Paula, a partner, is the second chair
  const c2 = decision(m, 'c2');
  assert.equal(c2.lead.candidates[0].person.name, 'Paula');
  assert.equal(c2.lead.candidates[0].preferred, true);
  assert.equal(candidateReason(c2.lead.candidates[0]), 'the second chair');
  assert.ok(!names(c2.lead.candidates).includes('Kevin'), 'never a departing person');
  assert.ok(!names(c2.lead.candidates).includes('Steve'), 'never an inactive partner');
  assert.ok(names(c2.lead.candidates).every((n) => byName.get(n).role === 'partner'), 'only partners lead');
  // c1 (Healthcare): Joe leads a Healthcare client; then the lighter lead
  // loads: Jeff leads nothing, Brendan 0.5, Mike 3, Paula 2 + c2's 4.5
  const c1 = decision(m, 'c1');
  assert.deepEqual(names(c1.lead.candidates), ['Joe', 'Jeff', 'Brendan', 'Mike', 'Paula']);
  assert.deepEqual(c1.lead.candidates[0].sharedAreas, ['Healthcare']);
  assert.equal(candidateReason(c1.lead.candidates[0]), 'shares Healthcare');
  assert.equal(candidateReason(c1.lead.candidates[1]), 'lighter lead load');
  // c3 (Municipal): Mike leads a Municipal client; Joe now carries c1
  const c3 = decision(m, 'c3');
  assert.deepEqual(names(c3.lead.candidates), ['Mike', 'Jeff', 'Brendan', 'Joe', 'Paula']);
  // The loads candidates were ranked on count what this scenario gave them
  assert.deepEqual(c3.lead.candidates.find((c) => c.person.name === 'Joe').load, { count: 2, revenue: 80000, effort: 4 });
});

test('a second chair promoted to lead leaves the seat empty, and it gets candidates', () => {
  const c2 = decision(model(['Kevin']), 'c2');
  assert.equal(nameOf(c2.lead.after), 'Paula');
  assert.deepEqual([c2.secondChair.vacated, c2.secondChair.why], [true, 'promoted']);
  // Everyone active and staying but the new lead; Anna seconds an Energy
  // client, then the lighter second-chair loads, by name on a tie
  assert.deepEqual(names(c2.secondChair.candidates), ['Anna', 'Brendan', 'Jeff', 'Joe', 'Mike', 'Ben', 'Jay']);
  assert.equal(nameOf(c2.secondChair.after), 'Anna');
  assert.equal(candidateReason(c2.secondChair.candidates[0], 'second'), 'shares Energy');
  assert.equal(candidateReason(c2.secondChair.candidates[1], 'second'), 'lighter second-chair load');
});

test('a kept second chair stays; a client without one keeps none', () => {
  const m = model(['Kevin']);
  const c1 = decision(m, 'c1');
  assert.deepEqual([c1.secondChair.vacated, nameOf(c1.secondChair.after)], [false, 'Jay']);
  assert.equal(nameOf(c1.lead.after), 'Joe');
  const c4 = decision(m, 'c4');
  assert.deepEqual([c4.secondChair.vacated, c4.secondChair.after, c4.secondChair.noCandidate], [false, null, false]);
  // Candidates are there for a picker all the same, never the lead
  assert.ok(!names(c4.secondChair.candidates).includes(nameOf(c4.lead.after)));
});

test('second-chair candidates rank by fit, then the lighter second-chair load with the 20% share', () => {
  const c7 = decision(model(['Kevin']), 'c7');
  // Mike leads c7 and is left out; Anna seconds a Municipal client
  assert.deepEqual(names(c7.secondChair.candidates), ['Anna', 'Brendan', 'Jeff', 'Joe', 'Paula', 'Ben', 'Jay']);
  // Ben's one seat on a client of effort 1 counts 0.2; Jay's on c1 (effort 3) 0.6
  close(c7.secondChair.candidates.find((c) => c.person.name === 'Ben').load.effort, 1 * SECOND_CHAIR_EFFORT_SHARE);
  close(c7.secondChair.candidates.find((c) => c.person.name === 'Jay').load.effort, 3 * SECOND_CHAIR_EFFORT_SHARE);
  // Paula gave up c2's seat when promoted, so she is at zero
  assert.deepEqual(c7.secondChair.candidates.find((c) => c.person.name === 'Paula').load, { count: 0, revenue: 0, effort: 0 });
});

test('before and after: each person\'s lead and second-chair load; the departing end at zero', () => {
  const m = model(['Kevin']);
  const row = (name) => m.groups.flatMap((g) => g.rows).find((r) => r.person.name === name);
  const kevin = row('Kevin');
  assert.equal(kevin.departing, true);
  assert.deepEqual([kevin.before.lead.count, kevin.before.lead.revenue, kevin.before.lead.effort], [4, 140000, 11.5]);
  assert.deepEqual([kevin.before.second.count, kevin.before.second.revenue], [1, 25000]);
  close(kevin.before.second.effort, 3 * SECOND_CHAIR_EFFORT_SHARE);
  assert.deepEqual([kevin.after.lead.count, kevin.after.second.count, kevin.after.lead.effort], [0, 0, 0]);

  // Joe gains c1 and c4 (Healthcare), Mike c3, Paula c2; Anna fills c2 and c7
  assert.deepEqual([row('Joe').before.lead.count, row('Joe').after.lead.count], [1, 3]);
  assert.deepEqual([row('Joe').after.lead.revenue, row('Joe').after.lead.effort], [90000, 6]);
  assert.deepEqual([row('Mike').after.lead.count, row('Paula').after.lead.count, row('Jeff').after.lead.count], [2, 2, 0]);
  assert.deepEqual([row('Anna').before.second.count, row('Anna').after.second.count], [3, 5]);
  assert.equal(row('Anna').after.second.revenue, 150000);
  close(row('Anna').after.second.effort, (4.5 + 2 + 2 + 3 + 0.5) * SECOND_CHAIR_EFFORT_SHARE);
  assert.deepEqual([row('Paula').before.second.count, row('Paula').after.second.count], [1, 0]);

  // before is the Partnership tab's model; after counts the staying people only
  assert.deepEqual(m.before, partnershipModel(PEOPLE, CLIENTS, revenueOf));
  assert.equal(m.before.averages.partner.members, 6);
  assert.equal(m.after.averages.partner.members, 5, 'Kevin leaves the partners\' average');
  assert.equal(m.after.averages.partner.lead.count, 8 / 5);
  // Groups by role, the departing first; Steve (inactive, no seat) is left out
  assert.deepEqual(m.groups.map((g) => [g.label, g.rows.map((r) => r.person.name)]), [
    ['Partners', ['Kevin', 'Brendan', 'Jeff', 'Joe', 'Mike', 'Paula']],
    ['Emeritus', ['Jay']],
    ['Associates', ['Anna', 'Ben']],
  ]);
  assert.deepEqual(m.totals, {
    clients: 5, revenue: 165000, newLeads: 4, seatsToFill: 2, noLeadCandidate: 0, noSecondChairCandidate: 0,
  });
});

test('clients the departure does not touch keep their people', () => {
  const m = model(['Kevin']);
  const after = new Map([...m.after.rows].flatMap((r) => [
    ...r.lead.clients.map((c) => [c.id, { lead: r.person.name }]),
  ]));
  for (const cid of ['c5', 'c6', 'c8']) {
    const original = CLIENTS.find((c) => c.id === cid);
    assert.equal(after.get(cid).lead, original.lead.name);
  }
  const c6 = m.after.rows.find((r) => r.person.name === 'Ben').second.clients.map((c) => c.id);
  assert.deepEqual(c6, ['c6']);
});

test('an associate leaves: their seats become empty and are filled from everyone else', () => {
  const m = model(['Anna']);
  assert.deepEqual(m.decisions.map((d) => d.client.id).sort(), ['c3', 'c5', 'c8']);
  for (const d of m.decisions) {
    assert.equal(d.lead.needed, false, 'the lead stays');
    assert.equal(nameOf(d.lead.after), d.client.lead.name);
    assert.deepEqual([d.secondChair.vacated, d.secondChair.why], [true, 'leaves']);
    assert.ok(!names(d.secondChair.candidates).includes('Anna'));
    assert.ok(!names(d.secondChair.candidates).includes(d.client.lead.name));
    assert.ok(d.secondChair.after);
  }
  assertP3(m, PEOPLE, [id('Anna')]);
  assert.equal(m.totals.newLeads, 0);
  assert.equal(m.totals.seatsToFill, 3);
});

test('the emeritus leaves', () => {
  const m = model(['Jay']);
  assert.deepEqual(m.decisions.map((d) => d.client.id), ['c1']);
  const c1 = decision(m, 'c1');
  assert.equal(nameOf(c1.lead.after), 'Kevin');
  assert.deepEqual([c1.secondChair.why, c1.secondChair.vacated], ['leaves', true]);
  // Healthcare: Joe leads one and Ben seconds one; Joe has no seat, Ben 0.2
  assert.deepEqual(names(c1.secondChair.candidates).slice(0, 2), ['Joe', 'Ben']);
  assertP3(m, PEOPLE, [id('Jay')]);
  const jay = m.groups.find((g) => g.role === 'emeritus').rows[0];
  assert.deepEqual([jay.departing, jay.before.second.count, jay.after.second.count], [true, 1, 0]);
});

test('lead and second chair both leave: the client needs both, from the people who stay', () => {
  const m = model(['Kevin', 'Paula']);
  const c2 = decision(m, 'c2');
  assert.deepEqual([c2.lead.needed, c2.secondChair.vacated, c2.secondChair.why], [true, true, 'leaves']);
  assert.equal(c2.lead.candidates.some((c) => c.preferred), false, 'a departing second chair is not preferred');
  assert.ok(!['Kevin', 'Paula'].includes(nameOf(c2.lead.after)));
  assert.ok(!['Kevin', 'Paula', nameOf(c2.lead.after)].includes(nameOf(c2.secondChair.after)));
  // Paula's own client needs a new lead too; Anna stays as its second chair
  const c5 = decision(m, 'c5');
  assert.equal(c5.lead.needed, true);
  assert.equal(nameOf(c5.secondChair.after), 'Anna');
  assertP3(m, PEOPLE, [id('Kevin'), id('Paula')]);
});

test('several people leave at once: every seat they hold is decided, and they end at zero', () => {
  const departing = ['Kevin', 'Anna', 'Jay'];
  const m = model(departing);
  const touched = CLIENTS.filter((c) => departing.includes(c.lead?.name) || departing.includes(c.secondChair?.name));
  assert.deepEqual(m.decisions.map((d) => d.client.id).sort(), touched.map((c) => c.id).sort());
  assert.deepEqual(m.departing.map((p) => p.name), ['Kevin', 'Jay', 'Anna'], 'by role, then name');
  assertP3(m, PEOPLE, departing.map(id));
  for (const name of departing) {
    const r = m.groups.flatMap((g) => g.rows).find((x) => x.person.name === name);
    assert.deepEqual([r.departing, r.after.lead.count, r.after.second.count], [true, 0, 0]);
  }
});

test('the defaults spread a departing book instead of piling onto the lightest partner', () => {
  const people = [person(1, 'Ann', 'partner'), person(2, 'Bob', 'partner'), person(3, 'Cy', 'partner'), person(4, 'Dee', 'partner')];
  const at = new Map(people.map((p) => [p.name, p]));
  const plain = (cid, effort) => ({ id: cid, name: cid, lead: at.get('Dee'), secondChair: null, practiceArea: [], effort, revenues: [] });
  const clients = [plain('x', 3), plain('y', 2), plain('z', 1)];
  const m = departureModel({ people, clients, departingIds: [4], revenueOf: () => 0 });
  assert.deepEqual(m.decisions.map((d) => [d.client.id, nameOf(d.lead.after)]), [['x', 'Ann'], ['y', 'Bob'], ['z', 'Cy']]);
  // Settling x made Ann the heaviest, so y ranks her last
  assert.deepEqual(names(decision(m, 'y').lead.candidates), ['Bob', 'Cy', 'Ann']);
});

test('no candidate is a valid outcome: the seat stays empty and the model says so', () => {
  const people = [person(1, 'Kevin', 'partner'), person(2, 'Anna', 'associate'), person(3, 'Jay', 'emeritus')];
  const at = new Map(people.map((p) => [p.name, p]));
  const clients = [{ id: 'k', name: 'K', lead: at.get('Kevin'), secondChair: at.get('Anna'), practiceArea: [], effort: 2, revenues: [] }];

  // The only partner leaves: nobody can lead
  const noLead = departureModel({ people, clients, departingIds: [1], revenueOf: () => 0 });
  const d = noLead.decisions[0];
  assert.deepEqual([d.lead.needed, d.lead.candidates.length, d.lead.after, d.lead.noCandidate], [true, 0, null, true]);
  assert.deepEqual(noLead.unresolved, [d]);
  assert.equal(noLead.totals.noLeadCandidate, 1);
  assert.equal(nameOf(d.secondChair.after), 'Anna', 'the second chair stays');
  assert.equal(noLead.after.unled.length, 1);
  assertP3(noLead, people, [1]);

  // Everyone but the lead leaves: nobody can second-chair
  const noSecond = departureModel({ people, clients, departingIds: [2, 3], revenueOf: () => 0 });
  const s = noSecond.decisions[0];
  assert.deepEqual([s.secondChair.vacated, s.secondChair.candidates.length, s.secondChair.after, s.secondChair.noCandidate], [true, 0, null, true]);
  assert.equal(noSecond.totals.noSecondChairCandidate, 1);
  assert.deepEqual(noSecond.unresolved, []);
  assertP3(noSecond, people, [2, 3]);
});

test('choices are applied; one P3 or the departures forbid is refused with its reason and the default stands', () => {
  const choices = {
    c1: { leadId: id('Jeff') },                                  // a staying partner: applied
    c2: { leadId: id('Kevin') },                                 // leaving
    c3: { leadId: id('Anna'), secondChairId: id('Mike') },       // not a partner; Mike is the default lead
    c4: { leadId: id('Steve'), secondChairId: id('Ben') },       // inactive; Ben applied
    c7: { secondChairId: null },                                 // leave the seat empty
  };
  const m = model(['Kevin'], choices);
  const c1 = decision(m, 'c1');
  assert.deepEqual([nameOf(c1.lead.after), c1.lead.problem, c1.lead.choice], ['Jeff', null, id('Jeff')]);
  const c2 = decision(m, 'c2');
  assert.deepEqual([nameOf(c2.lead.after), c2.lead.problem], ['Paula', 'Kevin is leaving.']);
  const c3 = decision(m, 'c3');
  assert.equal(c3.lead.problem, 'Anna is not a partner; the lead must be an active partner.');
  assert.equal(nameOf(c3.lead.after), 'Mike');
  assert.equal(c3.secondChair.problem, 'Mike is the lead; the second chair must be someone else.');
  assert.equal(nameOf(c3.secondChair.after), 'Anna', 'the kept second chair stands');
  const c4 = decision(m, 'c4');
  assert.deepEqual([c4.lead.problem, nameOf(c4.secondChair.after), c4.secondChair.problem], ['Steve is inactive.', 'Ben', null]);
  const c7 = decision(m, 'c7');
  assert.deepEqual([c7.secondChair.after, c7.secondChair.noCandidate, c7.secondChair.problem], [null, false, null]);
  assertP3(m, PEOPLE, [id('Kevin')]);

  // Picking the promoted second chair's replacement, and keeping the second
  // chair by choosing a different lead
  const kept = model(['Kevin'], { c2: { leadId: id('Brendan') } });
  const k2 = decision(kept, 'c2');
  assert.deepEqual([nameOf(k2.lead.after), k2.secondChair.vacated, nameOf(k2.secondChair.after)], ['Brendan', false, 'Paula']);
  const unknown = model(['Kevin'], { c1: { leadId: 999, secondChairId: 998 } });
  assert.equal(decision(unknown, 'c1').lead.problem, 'This person is not on the People list.');
  assert.equal(decision(unknown, 'c1').secondChair.problem, 'This person is not on the People list.');
  // A select's string value works as well as a number
  assert.equal(nameOf(decision(model(['Kevin'], { c1: { leadId: String(id('Jeff')) } }), 'c1').lead.after), 'Jeff');
  // A lead choice on a client whose lead is staying is not a departure decision
  assert.equal(nameOf(decision(model(['Kevin'], { c7: { leadId: id('Jeff') } }), 'c7').lead.after), 'Mike');
});

test('accepting a default never moves another client\'s default', () => {
  const plain = model(['Kevin', 'Anna']);
  const choices = {};
  for (const d of plain.decisions) {
    choices[d.client.id] = { leadId: d.lead.after?.id, secondChairId: d.secondChair.after?.id ?? null };
    const again = model(['Kevin', 'Anna'], choices);
    assert.deepEqual(
      again.decisions.map((x) => [x.client.id, nameOf(x.lead.after), nameOf(x.secondChair.after)]),
      plain.decisions.map((x) => [x.client.id, nameOf(x.lead.after), nameOf(x.secondChair.after)]),
    );
  }
});

test('a lead on record who is not an active partner is replaced on a client the departure touches', () => {
  const people = [...PEOPLE];
  const legacy = { id: 'L', name: 'Legacy', lead: byName.get('Steve'), secondChair: byName.get('Anna'), practiceArea: [], effort: 1, revenues: [] };
  const m = departureModel({ people, clients: [legacy], departingIds: [id('Anna')], revenueOf: () => 0 });
  const d = m.decisions[0];
  assert.deepEqual([d.lead.needed, d.lead.why], [true, 'missing']);
  assert.ok(d.lead.after && d.lead.after.active && d.lead.after.role === 'partner');
  assertP3(m, people, [id('Anna')]);
});

test('P3 holds after every departure and every choice, on random books', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const areas = ['Healthcare', 'Energy', 'Municipal', 'Education', 'Financial'];
  for (let round = 0; round < 200; round++) {
    const people = PEOPLE.map((p) => ({ ...p, active: p.name === 'Steve' ? false : random() > 0.05 }));
    const partners = people.filter((p) => p.active && p.role === 'partner');
    if (partners.length === 0) continue;
    const clients = Array.from({ length: 12 }, (_, i) => {
      const lead = pick(partners);
      const others = people.filter((p) => p.active && p.id !== lead.id);
      return {
        id: i + 1,
        name: `R${i}`,
        lead,
        secondChair: random() > 0.3 ? pick(others) : null,
        practiceArea: random() > 0.2 ? [pick(areas)] : [],
        effort: pick([0.5, 1, 2, 3, 4.5, 5, 7.5]),
        revenues: [{ year: 2026, revenue_amount: String(Math.round(random() * 100000)) }],
      };
    });
    const departingIds = people.filter(() => random() > 0.75).map((p) => p.id);
    const choices = {};
    for (const c of clients) {
      if (random() > 0.6) choices[c.id] = { leadId: pick(people).id, secondChairId: random() > 0.5 ? pick(people).id : null };
    }
    const m = departureModel({ people, clients, departingIds, revenueOf, choices });
    assertP3(m, people, departingIds);
    // Every client with a departing person in a seat is decided, and only those
    const touched = clients.filter((c) => departingIds.includes(c.lead.id) || departingIds.includes(c.secondChair?.id));
    assert.equal(m.decisions.length, touched.length);
    // A refused choice never lands in a seat
    for (const d of m.decisions) {
      if (d.lead.problem) assert.notEqual(String(d.lead.after?.id), String(d.lead.choice));
      if (d.secondChair.problem) assert.notEqual(String(d.secondChair.after?.id), String(d.secondChair.choice));
    }
  }
});

test('assignmentProblems: the reasons Stage 2 shows', () => {
  const departing = [id('Kevin')];
  const check = (choice) => assignmentProblems(PEOPLE, departing, choice);
  assert.deepEqual(check({ leadId: id('Joe'), secondChairId: id('Anna') }), { lead: null, secondChair: null });
  assert.deepEqual(check({ leadId: id('Joe'), secondChairId: null }), { lead: null, secondChair: null });
  assert.equal(check({ leadId: null }).lead, 'Every client needs a lead: choose an active partner who is staying.');
  assert.equal(check({ leadId: id('Kevin') }).lead, 'Kevin is leaving.');
  assert.equal(check({ leadId: id('Jay') }).lead, 'Jay is not a partner; the lead must be an active partner.');
  assert.equal(check({ leadId: id('Steve') }).lead, 'Steve is inactive.');
  assert.equal(check({ leadId: id('Joe'), secondChairId: id('Joe') }).secondChair, 'Joe is the lead; the second chair must be someone else.');
  assert.equal(check({ leadId: id('Joe'), secondChairId: id('Kevin') }).secondChair, 'Kevin is leaving.');
  assert.equal(check({ leadId: id('Joe'), secondChairId: id('Steve') }).secondChair, 'Steve is inactive.');
  assert.equal(check({ secondChairId: 12345 }).secondChair, 'This person is not on the People list.');
});

test('the building blocks Phase 6 reuses: pools, the ledger, the area index and the ranking', () => {
  const departing = new Set([String(id('Kevin'))]);
  assert.deepEqual(leadPool(PEOPLE, departing).map((p) => p.name), ['Brendan', 'Jeff', 'Joe', 'Mike', 'Paula']);
  assert.deepEqual(secondChairPool(PEOPLE, departing, id('Joe')).map((p) => p.name),
    ['Brendan', 'Jeff', 'Mike', 'Paula', 'Jay', 'Anna', 'Ben']);

  const ledger = createLedger();
  ledger.add(1, 'lead', 1000, 3);
  ledger.add(1, 'second', 500, 3);
  assert.deepEqual(ledger.load(1).lead, { count: 1, revenue: 1000, effort: 3 });
  close(ledger.load(1).second.effort, 3 * SECOND_CHAIR_EFFORT_SHARE, 'a seat adds the share');
  ledger.remove(1, 'second', 500, 3);
  close(ledger.load(1).second.effort, 0);
  assert.deepEqual(ledger.load('1'), ledger.load(1), 'ids compare as text');

  const index = areaIndex(CLIENTS);
  assert.deepEqual([...index.lead(id('Paula'))], ['Energy']);
  assert.deepEqual([...index.any(id('Anna'))].sort(), ['Education', 'Energy', 'Municipal']);
  assert.deepEqual([...index.lead(id('Anna'))], []);

  // An associate split (Phase 6): the associates for a client with no second chair
  const associates = PEOPLE.filter((p) => p.role === 'associate');
  const ranked = rankCandidates(CLIENTS[3], associates, { areasOf: (p) => index.any(p.id), loadOf: () => ({ count: 0, revenue: 0, effort: 0 }) });
  assert.deepEqual(names(ranked), ['Ben', 'Anna'], 'Ben seconds a Healthcare client');
});

test('the store\'s scenario helpers: toggling who leaves, merging and forgetting a pick', () => {
  assert.deepEqual(toggleId([], 4), [4]);
  assert.deepEqual(toggleId([4, 8], 4), [8]);
  assert.deepEqual(toggleId([4, 8], '8'), [4], 'ids compare as text');
  const once = withChoice({}, 'c1', { leadId: 2 });
  assert.deepEqual(once, { c1: { leadId: 2 } });
  const twice = withChoice(once, 'c1', { secondChairId: null });
  assert.deepEqual(twice, { c1: { leadId: 2, secondChairId: null } });
  assert.deepEqual(withChoice(twice, 7, { leadId: 3 }), { c1: { leadId: 2, secondChairId: null }, 7: { leadId: 3 } });
  assert.deepEqual(withChoice(twice, 'c1', null), {});
  assert.deepEqual(once, { c1: { leadId: 2 } }, 'never mutates');
});
