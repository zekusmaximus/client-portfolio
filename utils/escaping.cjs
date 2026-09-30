// utils/escaping.cjs
//
// Until Tier 2 WP5 (docs/plans/tier-2.md, S8) a request sanitizer
// HTML-escaped every string in a client write with validator.escape before the
// route saw it, so a client saved through the client form was stored as
// `Barnes &amp; Noble Education Fund` or `O&#x27;Brien Trust` (review 4.9).
// New writes are stored as typed, and scripts/unescape-book.cjs repairs text
// stored before (on 2026-09-28 it found none on production). What remains
// here is a guard where a stored name is compared or saved: the import's
// matching (unescapeStoredSql, and indexStoredClients in utils/csvImport.cjs),
// the client form's one-name-per-client check (utils/clientNames.cjs, Tier 3
// WP2), a transition plan's saved client name (answerRow) and the repair
// itself.
// Nothing shows or sends text through it any more (WP5's second PR removed the
// display decoders). Pure: no I/O and no env, so tests can import it.

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

/** Undo one validator.escape: `O&#x27;Brien &amp; Co` -> `O'Brien & Co`, `&amp;lt;` -> `&lt;`. unescapeStored's second half. */
function unescapeText(text) {
  if (typeof text !== 'string') return text;
  return ESCAPES.reduce((out, [entity, char]) => out.split(entity).join(char), text);
}

// Until WP5, text sent back as it was stored was escaped again: `&amp;amp;`
// where it had `&`, `&amp;#x27;` where it had `'`. The client form did that to
// notes until it filled its fields unescaped (Tier 1, until WP5's second PR
// made that unnecessary), a direct request could, and the form's DOMPurify pass escaped any text holding
// a `<` before the server escaped it again. Every
// escape after the first only adds `amp;` after an `&`, so collapsing an `&`
// and every `amp;` after it to `&` undoes those (and the first escape of an
// `&`); unescapeText then undoes the first escape of everything else.
const REPEATED_AMP = '&(amp;)+';

/**
 * Undo validator.escape however many times it was applied: the name as the
 * sheet spells it. Idempotent: its output holds no `&amp;` (the collapse
 * leaves none) and no other entity of ESCAPES (each replacement yields one
 * character that cannot start or complete an entity), so a second call
 * changes nothing; scripts/unescape-book.cjs relies on it.
 */
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

module.exports = { ESCAPES, unescapeStored, unescapeStoredSql };
