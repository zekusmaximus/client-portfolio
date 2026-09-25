// CSV year rule (docs/plans/tier-0.md, D5): the file is authoritative for
// exactly the years its header names. Pure modules only; never import
// db.cjs, data.cjs, models/*, or utils/jwt.cjs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import csvImport from '../utils/csvImport.cjs';
import analyzer from '../clientAnalyzer.cjs';

const { extractRevenueYears, parseAmount, planRevenueWrites, revenueTotals } = csvImport;

test('extractRevenueYears: YYYY Contracts headers, any case, stray whitespace, sorted', () => {
  assert.deepEqual(
    extractRevenueYears(['CLIENT', '2024 Contracts', '2026 contracts ', 'Notes']),
    [2024, 2026]
  );
  assert.deepEqual(extractRevenueYears(['2026 Contracts', '2025 Contract', '2026 Contracts']), [2025, 2026]);
  assert.deepEqual(extractRevenueYears(['CLIENT', 'Contracts', 'Revenue 2026', '20260 Contracts']), []);
  assert.deepEqual(extractRevenueYears(undefined), []);
});

test('parseAmount: currency formatting, blank, parentheses, junk', () => {
  assert.equal(parseAmount('$72,000.00'), 72000);
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('(1,000)'), -1000);
  assert.equal(parseAmount('n/a'), 0);
  assert.equal(parseAmount(undefined), 0);
  assert.equal(parseAmount(' $ 1 500 '), 1500);
  assert.equal(parseAmount(30000), 30000);
});

test('planRevenueWrites: present-positive upserts, present-zero deletes, absent years untouched', () => {
  const clients = [
    { id: 'a', revenue: { 2025: 50000, 2026: 0 } },
    { id: 'b', revenue: { 2025: '', 2026: 12000, 2024: 99999 } },
    { id: 'c', revenue: { 2026: '$8,000' } },
  ];
  const { upserts, deletes } = planRevenueWrites(clients, [2025, 2026]);

  assert.deepEqual(upserts, [
    ['a', 2025, 50000],
    ['b', 2026, 12000],
    ['c', 2026, 8000],
  ]);
  // a blank 2025 cell for b and a 2025 column missing from c's row both clear 2025
  assert.deepEqual(deletes, [
    ['a', 2026],
    ['b', 2025],
    ['c', 2025],
  ]);
  // 2024 is not in the file's header: no write of either kind
  assert.equal(upserts.some(([, year]) => year === 2024), false);
  assert.equal(deletes.some(([, year]) => year === 2024), false);
});

test('revenueTotals: the written amounts summed by year, to the cent; a year with none is 0', () => {
  const clients = [
    { id: 'a', revenue: { 2024: '$60,000', 2025: '66000.10', 2026: 72000 } },
    { id: 'b', revenue: { 2024: '', 2025: '$40,000.20', 2026: '$85,000' } },
    { id: 'c', revenue: { 2024: '0', 2025: '', 2026: '$0.70' } },
  ];
  const { upserts } = planRevenueWrites(clients, [2024, 2025, 2026, 2027]);
  assert.deepEqual(revenueTotals(upserts, [2024, 2025, 2026, 2027]), {
    2024: 60000, 2025: 106000.3, 2026: 157000.7, 2027: 0,
  });
  assert.deepEqual(revenueTotals([], []), {});
});

test('planRevenueWrites: no year columns means no writes at all', () => {
  assert.deepEqual(planRevenueWrites([{ id: 'a', revenue: { 2025: 1 } }], []), { upserts: [], deletes: [] });
});

test('processCSVData: a 2026-only header yields a one-key revenue object', () => {
  const clients = analyzer.processCSVData([
    { CLIENT: 'Acme Corp', '2026 Contracts': '$100,000' },
    { CLIENT: 'Beta LLC', '2026 Contracts': '' },
  ]);
  assert.equal(clients.length, 2);
  assert.deepEqual(clients[0].revenue, { 2026: 100000 });
  assert.deepEqual(clients[0].revenueYears, [2026]);
  assert.deepEqual(clients[1].revenue, { 2026: 0 });
});

test('processCSVData: the header decides the years, not a fixed list', () => {
  const [client] = analyzer.processCSVData([
    { CLIENT: 'Acme Corp', '2024 Contracts': '$10', '2027 Contracts': '$30' },
  ]);
  assert.deepEqual(client.revenue, { 2024: 10, 2027: 30 });
  assert.deepEqual(client.revenueYears, [2024, 2027]);
});

test('validateClientData: zero revenue is judged across the imported years only', () => {
  const clients = analyzer.processCSVData([
    { CLIENT: 'Acme Corp', '2026 Contracts': '' },
    { CLIENT: 'Beta LLC', '2026 Contracts': '$5' },
  ]);
  const { warnings, isValid } = analyzer.validateClientData(clients);
  assert.equal(isValid, true);
  assert.deepEqual(warnings, ['Client "Acme Corp" has zero revenue across all imported years']);

  const noYears = analyzer.processCSVData([{ CLIENT: 'Acme Corp' }]);
  assert.deepEqual(analyzer.validateClientData(noYears).warnings, []);
});

// Contract status is retired (docs/plans/people-and-second-chair.md, P13): the
// import neither reads Contract Period nor derives a status from it.
test('processCSVData: no status or contract period, and a Contract Period column changes nothing', () => {
  const without = analyzer.processCSVData([
    { CLIENT: 'Acme Corp', '2026 Contracts': '$100,000' },
    { CLIENT: 'Beta LLC', '2026 Contracts': '$5' },
    { CLIENT: 'Gamma Inc', '2026 Contracts': '$7' },
  ]);
  const withColumn = analyzer.processCSVData([
    { CLIENT: 'Acme Corp', 'Contract Period': '1/1/26-12/31/26', '2026 Contracts': '$100,000' },
    { CLIENT: 'Beta LLC', 'Contract Period': '', '2026 Contracts': '$5' },
    { CLIENT: 'Gamma Inc', 'Contract Period': 'DONE', '2026 Contracts': '$7' },
  ]);
  const comparable = (clients) => clients.map(({ id: _id, ...client }) => client);
  assert.deepEqual(comparable(withColumn), comparable(without));
  // No status, contract period or anything else derived from the column
  for (const client of withColumn) {
    assert.deepEqual(Object.keys(client).filter((key) => /status|contract/i.test(key)), [], client.name);
  }
});

test('validateClientData: a blank or garbage Contract Period is not an issue', () => {
  const clients = analyzer.processCSVData([
    { CLIENT: 'Acme Corp', 'Contract Period': '', '2026 Contracts': '$1' },
    { CLIENT: 'Beta LLC', 'Contract Period': 'garbage', '2026 Contracts': '$1' },
    { CLIENT: 'Gamma Inc', '2026 Contracts': '$1' },
  ]);
  const { issues, warnings, isValid } = analyzer.validateClientData(clients);
  assert.deepEqual(issues, []);
  assert.deepEqual(warnings, []);
  assert.equal(isValid, true);
});
