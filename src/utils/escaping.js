// The page's copy of unescapeStored in utils/escaping.cjs (the page never
// imports the server's modules; tests/escaping.test.mjs holds the two equal).
//
// sanitizeRequestBody HTML-escapes every string a client write sends, so a
// client saved through the form is stored as `Barnes &amp; Noble Education
// Fund` (review 4.9). Text sent back as it is stored is escaped again, and so
// is text the form's DOMPurify pass has already escaped (it serializes any
// text holding a `<`, turning `&` into `&amp;`), so a stored value can hold
// several levels. unescapeStored undoes them all: the text as the partner
// typed it. The form fills its fields with it, so a save sends that text and
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
