// utils/escaping.cjs: undoing the validator.escape the request sanitizer
// applied to client text until Tier 2 WP5 (S8), however many times a stored
// text was escaped (unescapeStored), and the same as a PostgreSQL expression
// (unescapeStoredSql; tests/import-db.test.mjs runs it against a real server).
// What remains after WP5's second PR is a guard for the import's name matching,
// a transition plan's saved client name and the repair script: nothing on the
// page or in the AI's book decodes text any more, and the page has no copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'validator';
import escaping from '../utils/escaping.cjs';

const { ESCAPES, unescapeStored, unescapeStoredSql } = escaping;

const escapeTimes = (text, times) => Array.from({ length: times }).reduce((out) => validator.escape(out), text);

// Deterministic pseudo-random strings (mulberry32), so a failure reproduces
function random(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('ESCAPES is validator.escape\'s set, with &amp; last', () => {
  const specials = ESCAPES.map(([, char]) => char).join('');
  assert.equal(validator.escape(specials), ESCAPES.map(([entity]) => entity).join(''));
  assert.equal(ESCAPES.at(-1)[0], '&amp;');
  assert.deepEqual(Object.keys(escaping).sort(), ['ESCAPES', 'unescapeStored', 'unescapeStoredSql']);
});

test('unescapeStored undoes every escape a stored name went through', () => {
  assert.equal(unescapeStored('Barnes &amp; Noble Education Fund'), 'Barnes & Noble Education Fund');
  assert.equal(unescapeStored('Barnes &amp;amp;amp; Noble Education Fund'), 'Barnes & Noble Education Fund');
  assert.equal(unescapeStored('O&#x27;Brien Trust'), "O'Brien Trust");
  assert.equal(unescapeStored('O&amp;#x27;Brien Trust'), "O'Brien Trust");
  assert.equal(unescapeStored('Barnes & Noble Education Fund'), 'Barnes & Noble Education Fund', 'a plain name is left as it is');
  assert.equal(unescapeStored(''), '');
  assert.equal(unescapeStored(undefined), undefined);
});

test('unescapeStored inverts validator.escape applied 0 to 4 times, for any text without a semicolon', () => {
  // A client name cannot hold `;` (the CSV import's and the form's pattern);
  // with one, text that already looks like an entity could not be told apart
  const alphabet = `ab Z9&'"<>/\\\`.,-()#x`;
  const next = random(20260926);
  for (let i = 0; i < 2000; i += 1) {
    const length = 1 + Math.floor(next() * 24);
    const text = Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
    for (let times = 0; times <= 4; times += 1) {
      assert.equal(unescapeStored(escapeTimes(text, times)), text, JSON.stringify({ text, times }));
    }
  }
});

test('unescapeStoredSql applies the same replacements in the same order, with no quoting to get wrong', () => {
  const sql = unescapeStoredSql('name');
  assert.equal(sql.startsWith(`replace(`.repeat(ESCAPES.length) + `regexp_replace(name, '&(amp;)+', '&', 'g')`), true, sql);
  const steps = [...sql.matchAll(/, '([^']+)', chr\((\d+)\)\)/g)].map(([, entity, code]) => [entity, String.fromCharCode(Number(code))]);
  assert.deepEqual(steps, ESCAPES);
  assert.equal((sql.match(/'/g) || []).length % 2, 0);
});

// Tier 2 WP5's second PR: the page shows and sends text as stored
test('the page decodes and unescapes nothing: no copy of unescapeStored, no decodeHtmlEntities, no innerHTML', () => {
  const src = fileURLToPath(new URL('../src', import.meta.url));
  assert.equal(existsSync(join(src, 'utils', 'escaping.js')), false);
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(jsx?|tsx?)$/.test(name)) files.push(path);
    }
  };
  walk(src);
  assert.ok(files.length > 50, 'the page\'s sources were read');
  for (const file of files) {
    // The code only: comments may name what was removed
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(text, /unescapeStored|unescapeText|decodeHtmlEntities|decodeHTMLEntities|\.innerHTML\s*=|dangerouslySetInnerHTML/, file);
  }
});
