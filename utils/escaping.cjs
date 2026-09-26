// utils/escaping.cjs
//
// sanitizeRequestBody (middleware/validation.cjs) HTML-escapes every string in
// a request body with validator.escape before the route sees it, so a client
// saved through the client form is stored as `Barnes &amp; Noble Education
// Fund` or `O&#x27;Brien Trust` (review 4.9). Removing the sanitizer is Tier 2
// (docs/plans/tier-0.md section 11); until then, and for the text it has
// already stored, these undo it. Pure: no I/O and no env, so tests can import
// it.

// validator.escape's replacements (validator 13), in the order unescapeText
// undoes them: `&amp;` last, so one call undoes exactly one escape.
const ESCAPES = [
  ['&#x27;', "'"],
  ['&quot;', '"'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&#x2F;', '/'],
  ['&#x5C;', '\\'],
  ['&#96;', '`'],
  ['&amp;', '&'],
];

/** Undo one validator.escape: `O&#x27;Brien &amp; Co` -> `O'Brien & Co`, `&amp;lt;` -> `&lt;`. */
function unescapeText(text) {
  if (typeof text !== 'string') return text;
  return ESCAPES.reduce((out, [entity, char]) => out.split(entity).join(char), text);
}

// Text sent back as it is stored is escaped again: `&amp;amp;` where it had
// `&`, `&amp;#x27;` where it had `'`. The client form shows a stored name that
// way, though its name pattern refuses the `;` until the partner retypes it; a
// direct request, or a field without that pattern, has no such check. Every
// escape after the first only adds `amp;` after an `&`, so collapsing an `&`
// and every `amp;` after it to `&` undoes those (and the first escape of an
// `&`); unescapeText then undoes the first escape of everything else.
const REPEATED_AMP = '&(amp;)+';

/** Undo validator.escape however many times it was applied: the name as the sheet spells it. */
function unescapeStored(text) {
  if (typeof text !== 'string') return text;
  return unescapeText(text.replace(new RegExp(REPEATED_AMP, 'g'), '&'));
}

/**
 * unescapeStored as a PostgreSQL expression over `column`, built from the same
 * replacements in the same order, so a query can match stored text the way
 * JavaScript keys it (tests/import-db.test.mjs checks the two agree). Each
 * character is written as chr(n), so the SQL needs no quoting.
 */
function unescapeStoredSql(column) {
  return ESCAPES.reduce(
    (sql, [entity, char]) => `replace(${sql}, '${entity}', chr(${char.charCodeAt(0)}))`,
    `regexp_replace(${column}, '${REPEATED_AMP}', '&', 'g')`
  );
}

module.exports = { ESCAPES, unescapeText, unescapeStored, unescapeStoredSql };
