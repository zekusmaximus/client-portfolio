// What a failed request logs (docs/plans/tier-3.md, WP2, candidate (c)).
//
// PostgreSQL's error carries `detail`, which for a refused row prints the
// whole row ("Failing row contains (...)", a client's note included), and
// `where`, which can quote the statement. console.error(label, error) printed
// both, with every other property of the error object. Every route's failure
// is logged here instead, by what Jeff reads to act on it: the error's `code`
// (PostgreSQL's SQLSTATE, or Node's), its `message`, and, where PostgreSQL
// sets them, the `constraint`, `table` and `column` it names. Nothing else:
// never `detail`, `where`, the query or the error object, so no stack trace
// either (the error object printed with its stack carries `detail` too).
//
// Pure: no db.cjs import, so tests can load it.

const LOGGED_FIELDS = ['code', 'message', 'constraint', 'table', 'column'];

// A field is logged only as text or a number: anything else on an error
// (an object, a function) could carry a row
const loggable = (value) => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

/**
 * The fields of a failure that may be logged, as a plain object: `code`,
 * `message`, `constraint`, `table` and `column`, each only when it is set.
 * A thrown value that is not an object logs as its text.
 */
function errorFields(error) {
  if (error === null || typeof error !== 'object') return { message: String(error) };
  const fields = {};
  for (const key of LOGGED_FIELDS) {
    if (loggable(error[key])) fields[key] = error[key];
  }
  return fields;
}

/**
 * Log a failure on one line: `<label>: {"code":...,"message":...}`. `label`
 * says what failed ("Error updating client"); `log` is console.error unless a
 * test passes its own.
 */
function logError(label, error, log = console.error) {
  log(`${label}:`, JSON.stringify(errorFields(error)));
}

module.exports = {
  LOGGED_FIELDS,
  errorFields,
  logError,
};
