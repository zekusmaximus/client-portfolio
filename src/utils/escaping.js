// The page's copy of unescapeStored in utils/escaping.cjs (the page never
// imports the server's modules; tests/escaping.test.mjs holds the two equal).
//
// Until Tier 2 WP5 the API's request sanitizer HTML-escaped every string a
// client write sent, so a client saved through the form was stored as
// `Barnes &amp; Noble Education Fund` (review 4.9). Text sent back as it was
// stored was escaped again, and so was text the form's DOMPurify pass had
// already escaped (it serialized any text holding a `<`, turning `&` into
// `&amp;`), so a stored value can hold several levels. New writes are stored
// as typed; the text stored before stays escaped until the repair
// (scripts/unescape-book.cjs). unescapeStored undoes every level: the text as
// the partner typed it, and plain text as it is. The form fills its fields with it, so a save sends that text and
// the stored value stops gaining a level per save; the transition sheet writes
// client names with it, so the import reads them as a partner would type them.

// validator.escape's replacements (validator 13), `&amp;` last
export const ESCAPES = [
  ['&#x27;', "'"],
  ['&quot;', '"'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&#x2F;', '/'],
  ['&#x5C;', '\\'],
  ['&#96;', '`'],
  ['&amp;', '&'],
];

// Every escape after the first only adds `amp;` after an `&`
const REPEATED_AMP = /&(amp;)+/g;

/** Undo validator.escape however many times it was applied: `O&amp;#x27;Brien &amp;amp; Co` -> `O'Brien & Co`. */
export function unescapeStored(text) {
  if (typeof text !== 'string') return text;
  return ESCAPES.reduce(
    (out, [entity, char]) => out.split(entity).join(char),
    text.replace(REPEATED_AMP, '&')
  );
}
