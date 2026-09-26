// utils/escaping.cjs: undoing sanitizeRequestBody's validator.escape, once
// (unescapeText) or however many times a stored text was escaped
// (unescapeStored), and the same as a PostgreSQL expression
// (unescapeStoredSql; tests/import-db.test.mjs runs it against a real server).
// The page's copy, src/utils/escaping.js, is held equal to the server's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import validator from 'validator';
import escaping from '../utils/escaping.cjs';
import transitionPlan from '../utils/transitionPlan.cjs';
import * as page from '../src/utils/escaping.js';

const { ESCAPES, unescapeText, unescapeStored, unescapeStoredSql } = escaping;

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
  assert.equal(transitionPlan.unescapeText, unescapeText, 'the transition plan uses the same function');
});

test('unescapeText undoes one escape', () => {
  assert.equal(unescapeText('O&#x27;Brien &amp; &lt;Co&gt; &quot;x&quot; a&#x2F;b &#x5C; &#96;'), `O'Brien & <Co> "x" a/b \\ \``);
  assert.equal(unescapeText('&amp;lt;'), '&lt;', 'one level only');
  assert.equal(unescapeText('Barnes &amp;amp; Noble'), 'Barnes &amp; Noble');
  assert.equal(unescapeText(null), null);
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

test('the page\'s unescapeStored (src/utils/escaping.js) equals the server\'s, on any text', () => {
  assert.deepEqual(page.ESCAPES, ESCAPES);
  const fixed = [
    'Barnes &amp; Noble Education Fund', 'O&amp;#x27;Brien Trust', '&amp;amp;lt;', 'R&D; Q&A;', '&;&amp&amp;;',
    '&#x27&#x27;', 'plain', '', null, undefined, 42,
  ];
  for (const text of fixed) assert.equal(page.unescapeStored(text), unescapeStored(text), JSON.stringify(text));
  // With semicolons too: the two must agree whatever is stored, not only on round trips
  const alphabet = `a Z&;'"<>/\\\`#x27amplgtquot`;
  const next = random(9);
  for (let i = 0; i < 3000; i += 1) {
    const length = Math.floor(next() * 30);
    const text = Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
    assert.equal(page.unescapeStored(text), unescapeStored(text), JSON.stringify(text));
  }
});
