// config/session.cjs: one lifetime for the JWT and the cookie (D10, WP3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import session from '../config/session.cjs';

const { parseTtl, resolveTtl, DEFAULT_TTL } = session;
const SEVEN_DAYS_MS = 604_800_000;

test("'7d' is 604,800,000 ms (cookie Max-Age=604800)", () => {
  assert.equal(parseTtl('7d'), SEVEN_DAYS_MS);
});

test("'12h' and '30m' parse", () => {
  assert.equal(parseTtl('12h'), 12 * 60 * 60 * 1000);
  assert.equal(parseTtl('30m'), 30 * 60 * 1000);
});

test('values that are not <positive integer><d|h|m> do not parse', () => {
  for (const value of ['', '7', 'd', '0d', '-1d', '1.5d', '7 days', '30s', '1w', 'abc', undefined, null]) {
    assert.equal(parseTtl(value), null, String(value));
  }
});

test('an invalid value falls back to the 7-day default for both the JWT and the cookie', () => {
  assert.deepEqual(resolveTtl('7 days'), { ttl: DEFAULT_TTL, ms: SEVEN_DAYS_MS, valid: false });
  assert.deepEqual(resolveTtl('30s'), { ttl: DEFAULT_TTL, ms: SEVEN_DAYS_MS, valid: false });
});

test('unset means the default, without a warning', () => {
  assert.deepEqual(resolveTtl(undefined), { ttl: '7d', ms: SEVEN_DAYS_MS, valid: true });
  assert.deepEqual(resolveTtl(''), { ttl: '7d', ms: SEVEN_DAYS_MS, valid: true });
});

test('a valid value is passed through for the JWT with the matching cookie span', () => {
  assert.deepEqual(resolveTtl(' 12h '), { ttl: '12h', ms: 43_200_000, valid: true });
});

test('the module defaults to 7 days when SESSION_TTL is not set', { skip: process.env.SESSION_TTL !== undefined }, () => {
  assert.equal(session.SESSION_TTL, '7d');
  assert.equal(session.SESSION_TTL_MS, SEVEN_DAYS_MS);
});
