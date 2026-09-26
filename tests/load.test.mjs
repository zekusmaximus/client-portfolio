// Who's carrying what (docs/plans/people-and-second-chair.md, Phase 4, P10):
// src/utils/load.js, the lead books and second-chair loads the Partnership tab,
// the Dashboard card and the exports read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  partnershipModel,
  heaviestLeadBook,
  ratio,
  formatRatio,
  bookYears,
  revenueByYear,
  SECOND_CHAIR_EFFORT_SHARE,
  secondChairEffort,
} from '../src/utils/load.js';
import { revenueForYear } from '../src/utils/revenue.js';
import { resolveEffort } from '../src/utils/clientMetrics.js';
import strategic from '../utils/strategic.cjs';

// The fixture book: ten people, six clients (also held against the server's
// port in tests/book.test.mjs)
import { PEOPLE, CLIENTS, client } from './fixtures/books.mjs';

const revenueOf = (c) => revenueForYear(c, 2026);

test('each person\'s lead book and second-chair load: clients, reporting-year revenue, effort', () => {
  const model = partnershipModel(PEOPLE, CLIENTS, revenueOf);
  const row = (name) => model.rows.find((r) => r.person.name === name);

  assert.deepEqual([row('Kevin').lead.count, row('Kevin').lead.revenue, row('Kevin').lead.effort], [2, 100000, 7.5]);
  // A second chair carries 20% of each client's effort (P10 as amended); counts and revenue are whole
  assert.deepEqual([row('Kevin').second.count, row('Kevin').second.revenue, row('Kevin').second.effort], [1, 20000, 0.4]);
  assert.deepEqual([row('Paula').lead.count, row('Paula').lead.revenue, row('Paula').lead.effort], [2, 40000, 3]);
  assert.deepEqual([row('Anna').second.count, row('Anna').second.revenue, row('Anna').second.effort], [2, 70000, 1.3]);
  assert.deepEqual([row('Jay').second.count, row('Jay').lead.count], [1, 0]);
  assert.equal(row('Joe').lead.count, 0);
  assert.deepEqual(row('Kevin').lead.clients.map((c) => c.id), [CLIENTS[0].id, CLIENTS[1].id]);

  assert.deepEqual(model.unled.map((c) => c.id), [CLIENTS[5].id]);
  assert.deepEqual(model.noSecondChair.map((c) => c.id), [CLIENTS[3].id]);
  assert.deepEqual(model.totals, { clients: 6, revenue: 165000, effort: 13.5 });
});

test('P10 as amended: the lead carries a client\'s full effort, the second chair 20% of it', () => {
  assert.equal(SECOND_CHAIR_EFFORT_SHARE, 0.2);
  assert.equal(secondChairEffort(3), 3 * 0.2);
  assert.equal(secondChairEffort(undefined), 0);
  const model = partnershipModel(PEOPLE, CLIENTS, revenueOf);
  const row = (name) => model.rows.find((r) => r.person.name === name);
  // Jay seconds one client of effort 3: 0.6 of effort, the whole client and all its revenue
  assert.equal(row('Jay').second.effort, 3 * SECOND_CHAIR_EFFORT_SHARE);
  assert.deepEqual([row('Jay').second.count, row('Jay').second.revenue], [1, 60000]);
  // Kevin leads the same client and carries its full effort
  assert.equal(row('Kevin').lead.clients[0].effort, 3, 'the client\'s own effort does not change');
  // The second-chair average and ratios use the share: Anna 1.3, Ben 0
  assert.equal(model.averages.associate.second.effort, 1.3 / 2);
  assert.equal(row('Anna').secondRatio.effort, 2);
  // The partners' second-chair average: Kevin's one seat on a client of effort 2
  assert.equal(model.averages.partner.second.effort, (2 * SECOND_CHAIR_EFFORT_SHARE) / 6);
  // The book's total effort counts each client once, in full
  assert.equal(model.totals.effort, 13.5);
});

test('averages are over the active people in the role, those with no clients included', () => {
  const { averages } = partnershipModel(PEOPLE, CLIENTS, revenueOf);
  // Six active partners (Steve is inactive): 5 led clients, $160,000 led
  assert.equal(averages.partner.members, 6);
  assert.equal(averages.partner.lead.count, 5 / 6);
  assert.equal(averages.partner.lead.revenue, 160000 / 6);
  assert.equal(averages.partner.second.count, 1 / 6);
  // Two associates: Anna 2 seats, Ben none
  assert.equal(averages.associate.members, 2);
  assert.equal(averages.associate.second.count, 1);
  assert.equal(averages.emeritus.members, 1);
});

test('ratios compare with the role average; a role of one has no comparison', () => {
  const model = partnershipModel(PEOPLE, CLIENTS, revenueOf);
  const row = (name) => model.rows.find((r) => r.person.name === name);
  assert.equal(row('Kevin').leadRatio.revenue, 100000 / (160000 / 6));
  assert.equal(row('Joe').leadRatio.count, 0);
  assert.equal(row('Anna').secondRatio.count, 2);
  assert.equal(row('Ben').secondRatio.count, 0);
  assert.equal(row('Jay').secondRatio.count, null, 'the only emeritus has no peer to compare with');
  assert.equal(row('Jay').leadRatio.count, null, 'someone who cannot lead has no lead-book comparison');
  assert.equal(row('Anna').leadRatio.revenue, null);

  assert.equal(ratio(3, 1.5), 2);
  assert.equal(ratio(3, 0), null);
  assert.equal(ratio(3, 1.5, 1), null);
  assert.equal(formatRatio(100000 / (160000 / 6)), '3.8×');
  assert.equal(formatRatio(null), '—');
  assert.equal(formatRatio(Infinity), '—');
  assert.equal(formatRatio(0.044), '<0.1×', 'a small load never reads as nothing');
  assert.equal(formatRatio(0), '0.0×');
  assert.equal(formatRatio(0.05), '0.1×');
});

test('lead books: every active partner, heaviest revenue first, and nobody inactive without clients', () => {
  const model = partnershipModel(PEOPLE, CLIENTS, revenueOf);
  assert.deepEqual(model.leadBooks.map((r) => r.person.name),
    ['Kevin', 'Paula', 'Brendan', 'Jeff', 'Joe', 'Mike']);
  assert.ok(!model.leadBooks.some((r) => r.person.name === 'Steve'));
  assert.ok(!model.leadBooks.some((r) => r.person.role !== 'partner'));
});

test('second chairs: grouped by role, busiest first; an inactive person appears only while holding a seat', () => {
  const model = partnershipModel(PEOPLE, CLIENTS, revenueOf);
  assert.deepEqual(model.secondChairs.map((g) => [g.label, g.rows.map((r) => r.person.name)]), [
    ['Partners', ['Kevin', 'Brendan', 'Jeff', 'Joe', 'Mike', 'Paula']],
    ['Emeritus', ['Jay']],
    ['Associates', ['Anna', 'Ben']],
  ]);

  const legacy = [...CLIENTS, client(4, 10, { 2026: 1000 })];
  const withSteve = partnershipModel(PEOPLE, legacy, revenueOf);
  const partners = withSteve.secondChairs.find((g) => g.role === 'partner').rows.map((r) => r.person.name);
  assert.ok(partners.includes('Steve'));
  assert.equal(withSteve.averages.partner.members, 6, 'an inactive person never counts toward the average');
});

test('a client whose lead is missing from the People list still counts, under the nested person', () => {
  const stranger = { id: 99, name: 'Zed', role: 'partner', active: true };
  const model = partnershipModel(PEOPLE, [{ id: 'x', lead: stranger, secondChair: null, effort: 1, revenues: [] }], revenueOf);
  assert.equal(model.rows.find((r) => r.person.id === 99).lead.count, 1);
});

test('an empty book and an empty People list', () => {
  const empty = partnershipModel([], [], revenueOf);
  assert.deepEqual([empty.rows, empty.leadBooks, empty.secondChairs, empty.unled], [[], [], [], []]);
  assert.equal(heaviestLeadBook(empty), null);
  const noClients = partnershipModel(PEOPLE, [], revenueOf);
  assert.equal(noClients.leadBooks.length, 6);
  assert.equal(heaviestLeadBook(noClients), null);
});

test('heaviestLeadBook: the partner leading the most revenue, against the partner average', () => {
  const top = heaviestLeadBook(partnershipModel(PEOPLE, CLIENTS, revenueOf));
  assert.equal(top.person.name, 'Kevin');
  assert.equal(top.count, 2);
  assert.equal(top.revenue, 100000);
  assert.equal(formatRatio(top.ratio), '3.8×');
});

test('bookYears and revenueByYear: the history of the clients someone leads now', () => {
  assert.deepEqual(bookYears(CLIENTS), [2025, 2026]);
  assert.deepEqual(bookYears([{ revenues: [{ year: 2024, revenue_amount: '0' }] }]), []);
  const kevin = partnershipModel(PEOPLE, CLIENTS, revenueOf).rows.find((r) => r.person.name === 'Kevin');
  assert.deepEqual(revenueByYear(kevin.lead.clients, [2025, 2026], revenueForYear), [
    { year: 2025, revenue: 50000 },
    { year: 2026, revenue: 100000 },
  ]);
});

test('effort on the page is the server\'s getEffort, for every cadence with and without Handful', () => {
  for (const cadence of ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'As-Needed', '', undefined]) {
    for (const high_maintenance of [false, true]) {
      const raw = { interaction_frequency: cadence, high_maintenance };
      assert.equal(resolveEffort(raw), strategic.getEffort(raw), `${cadence} ${high_maintenance}`);
    }
  }
  // The API's own value wins when present
  assert.equal(resolveEffort({ effort: 4.5, interaction_frequency: 'Daily' }), 4.5);
});

test('practiceAreaBreakdown and the formatters', async () => {
  const { practiceAreaBreakdown, formatMoney, formatEffort } = await import('../src/utils/load.js');
  const clients = [
    { practiceArea: ['Energy', 'Environmental'], revenues: [{ year: 2026, revenue_amount: '100' }] },
    { practice_area: ['Energy'], revenues: [{ year: 2026, revenue_amount: '50' }] },
    { practiceArea: [], revenues: [] },
  ];
  assert.deepEqual(practiceAreaBreakdown(clients, revenueOf), [
    { area: 'Energy', count: 2, revenue: 150 },
    { area: 'Environmental', count: 1, revenue: 100 },
    { area: 'Not specified', count: 1, revenue: 0 },
  ]);
  assert.equal(formatMoney(1234567.4), '$1,234,567');
  assert.equal(formatMoney(undefined), '$0');
  assert.equal(formatEffort(7.4999), '7.5');
  assert.equal(formatEffort(0), '0');
});
