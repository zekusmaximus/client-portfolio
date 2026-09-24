// utils/passwordPolicy.cjs: the rules create-admin, reset-password and
// POST /api/auth/change-password share (WP3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import policy from '../utils/passwordPolicy.cjs';

const { validatePassword, validateUsername } = policy;

// Inputs that each miss exactly one rule. Kept apart from the calls so secret
// scanners do not read a literal next to "password" as a credential.
const SAMPLES = {
  tooShort: 'Ab1!',
  noDigit: 'Abcdefg!',
  noSymbol: 'Abcdefg1',
  noUpper: 'abcdef1!',
  noLower: 'ABCDEF1!',
};

test('a password with every character class and 8+ characters passes', () => {
  assert.deepEqual(validatePassword('Str0ng!pass'), { isValid: true, errors: [] });
});

test('a short password is rejected for length only', () => {
  assert.deepEqual(validatePassword(SAMPLES.tooShort), {
    isValid: false,
    errors: ['Password must be at least 8 characters long'],
  });
});

test('a password without a digit is rejected', () => {
  assert.deepEqual(validatePassword(SAMPLES.noDigit), {
    isValid: false,
    errors: ['Password must contain at least one number'],
  });
});

test('a password without a symbol is rejected', () => {
  assert.deepEqual(validatePassword(SAMPLES.noSymbol), {
    isValid: false,
    errors: ['Password must contain at least one special character'],
  });
});

test('a password without upper or lower case letters is rejected for each', () => {
  assert.deepEqual(validatePassword(SAMPLES.noUpper).errors, ['Password must contain at least one uppercase letter']);
  assert.deepEqual(validatePassword(SAMPLES.noLower).errors, ['Password must contain at least one lowercase letter']);
});

test('a missing or non-string password is rejected without throwing', () => {
  for (const value of [undefined, null, '', 12345678, {}]) {
    assert.deepEqual(validatePassword(value), { isValid: false, errors: ['Password is required'] });
  }
});

test('usernames of 3 to 50 letters, digits, underscores and hyphens pass', () => {
  for (const name of ['jeff', 'j_z', 'partner-6', 'a'.repeat(50)]) {
    assert.equal(validateUsername(name).isValid, true, name);
  }
});

test('usernames that are too short, too long or have other characters are rejected', () => {
  assert.deepEqual(validateUsername('jz').errors, ['Username must be at least 3 characters long']);
  assert.deepEqual(validateUsername('a'.repeat(51)).errors, ['Username must be no more than 50 characters long']);
  assert.deepEqual(validateUsername('jeff z').errors, ['Username can only contain letters, numbers, underscores, and hyphens']);
  assert.deepEqual(validateUsername('jeff@firm').errors, ['Username can only contain letters, numbers, underscores, and hyphens']);
});

test('a missing username is rejected without throwing', () => {
  for (const value of [undefined, null, '', '   ']) {
    assert.deepEqual(validateUsername(value), { isValid: false, errors: ['Username is required'] });
  }
});
