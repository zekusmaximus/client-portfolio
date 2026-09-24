// CSV year rule (docs/plans/tier-0.md, D5): the file is authoritative for
// exactly the years its header names. Pure modules only; never import
// db.cjs, data.cjs, models/*, or utils/jwt.cjs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import csvImport from '../utils/csvImport.cjs';
import analyzer from '../clientAnalyzer.cjs';

const { extractRevenueYears, parseAmount, planRevenueWrites } = csvImport;

test('extractRevenueYears: YYYY Contracts headers, any case, stray whitespace, sorted', () => {
  assert.deepEqual(
    extractRevenueYears(['CLIENT', 'Contract Period', '2024 Contracts', '2026 contracts ', 'Notes']),
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

test('planRevenueWrites: no year columns means no writes at all', () => {
  assert.deepEqual(planRevenueWrites([{ id: 'a', revenue: { 2025: 1 } }], []), { upserts: [], deletes: [] });
});

test('processCSVData: a 2026-only header yields a one-key revenue object', () => {
  const clients = analyzer.processCSVData([
    { CLIENT: 'Acme Corp', 'Contract Period': '1/1/26-12/31/26', '2026 Contracts': '$100,000' },
    { CLIENT: 'Beta LLC', 'Contract Period': '1/1/26-12/31/26', '2026 Contracts': '' },
  ]);
  assert.equal(clients.length, 2);
  assert.deepEqual(clients[0].revenue, { 2026: 100000 });
  assert.deepEqual(clients[0].revenueYears, [2026]);
  assert.deepEqual(clients[1].revenue, { 2026: 0 });
});

test('processCSVData: the header decides the years, not a fixed list', () => {
  const [client] = analyzer.processCSVData([
    { CLIENT: 'Acme Corp', 'Contract Period': '1/1/27-12/31/27', '2024 Contracts': '$10', '2027 Contracts': '$30' },
  ]);
  assert.deepEqual(client.revenue, { 2024: 10, 2027: 30 });
  assert.deepEqual(client.revenueYears, [2024, 2027]);
});

test('validateClientData: zero revenue is judged across the imported years only', () => {
  const clients = analyzer.processCSVData([
    { CLIENT: 'Acme Corp', 'Contract Period': '1/1/26-12/31/26', '2026 Contracts': '' },
    { CLIENT: 'Beta LLC', 'Contract Period': '1/1/26-12/31/26', '2026 Contracts': '$5' },
  ]);
  const { warnings, isValid } = analyzer.validateClientData(clients);
  assert.equal(isValid, true);
  assert.deepEqual(warnings, ['Client "Acme Corp" has zero revenue across all imported years']);

  const noYears = analyzer.processCSVData([{ CLIENT: 'Acme Corp', 'Contract Period': '1/1/26-12/31/26' }]);
  assert.deepEqual(analyzer.validateClientData(noYears).warnings, []);
});
