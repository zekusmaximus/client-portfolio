// Reporting year (docs/plans/tier-0.md, D4): the latest year in which any
// client has a revenue row with amount > 0; fallback, the current calendar year.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReportingYear, revenueForYear } from '../src/utils/revenue.js';

test('mixed years: the max year with amount > 0 wins', () => {
  const clients = [
    { revenues: [{ year: 2024, revenue_amount: '10' }, { year: 2025, revenue_amount: '20' }] },
    { revenues: [{ year: '2026', revenue_amount: 5 }] },
    { revenues: [] },
  ];
  assert.equal(computeReportingYear(clients), 2026);
});

test('a lone zero-amount 2027 row is ignored', () => {
  const clients = [
    { revenues: [{ year: 2026, revenue_amount: 5 }, { year: 2027, revenue_amount: 0 }] },
    { revenues: [{ year: 2027, revenue_amount: '0.00' }] },
  ];
  assert.equal(computeReportingYear(clients), 2026);
});

test('no data: the current calendar year', () => {
  assert.equal(computeReportingYear([], new Date('2031-03-01T12:00:00')), 2031);
  assert.equal(computeReportingYear([]), new Date().getFullYear());
  assert.equal(computeReportingYear(undefined), new Date().getFullYear());
  assert.equal(
    computeReportingYear([{ revenues: null }, { revenues: [null, { year: null, revenue_amount: null }] }]),
    new Date().getFullYear()
  );
});

test('revenueForYear reads client.revenues for the asked year only', () => {
  const client = {
    revenues: [{ year: 2025, revenue_amount: '75000.00' }, { year: 2026, revenue_amount: 100000 }],
  };
  assert.equal(revenueForYear(client, 2026), 100000);
  assert.equal(revenueForYear(client, '2025'), 75000);
  assert.equal(revenueForYear(client, 2024), 0);
  assert.equal(revenueForYear(client, null), 0);
  assert.equal(revenueForYear({ revenue: { 2026: 1 } }, 2026), 0);
  assert.equal(revenueForYear(undefined, 2026), 0);
});
