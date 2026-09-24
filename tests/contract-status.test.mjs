// deriveContractStatus takes `now` so the answer does not drift with the clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import analyzer from '../clientAnalyzer.cjs';

const { deriveContractStatus } = analyzer;
const NOW = new Date('2026-09-23T12:00:00');

test('a period that contains today is In Force', () => {
  assert.equal(deriveContractStatus('1/1/26-12/31/26', NOW), 'IF');
});

test('a period that ended before today is Done', () => {
  assert.equal(deriveContractStatus('1/1/25-12/31/25', NOW), 'D');
});

test('a period that starts after today is a Proposal', () => {
  assert.equal(deriveContractStatus('1/1/27-12/31/27', NOW), 'P');
});

test('"expires" with a future date is In Force; "Expired" is Done', () => {
  assert.equal(deriveContractStatus('expires 12/31/26', NOW), 'IF');
  assert.equal(deriveContractStatus('expires 6/30/26', NOW), 'D');
  assert.equal(deriveContractStatus('Expired 12/31/25', NOW), 'D');
});

test('unparseable input is Hold', () => {
  assert.equal(deriveContractStatus('garbage', NOW), 'H');
  assert.equal(deriveContractStatus('', NOW), 'H');
  assert.equal(deriveContractStatus(null, NOW), 'H');
});

test('now defaults to today', () => {
  const year = new Date().getFullYear();
  assert.equal(deriveContractStatus(`1/1/${year - 3}-12/31/${year - 3}`), 'D');
  assert.equal(deriveContractStatus(`1/1/${year + 3}-12/31/${year + 3}`), 'P');
});
