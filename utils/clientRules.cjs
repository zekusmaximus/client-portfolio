// The rules a client's fields keep, whichever way they are written: the
// vocabularies the import enforces (utils/csvImport.cjs) and the client form's
// name rules (src/utils/validation.js), as data, and checkClient, which
// POST and PUT /api/data/clients apply before the people check
// (docs/plans/tier-2.md, S7, WP4).
//
// Pure: no db.cjs import, so tests can load it. The page keeps its own copy of
// the lists and the name pattern (src/utils/validation.js; the page never
// imports server modules), held equal by tests/client-rules.test.mjs.

const { EFFORT_BY_CADENCE } = require('./strategic.cjs');

// The vocabularies. Cadence is the scorer's own list; the practice areas are
// the client form's twelve.
const PRACTICE_AREAS = [
  'Healthcare', 'Municipal', 'Corporate', 'Energy', 'Financial', 'Education',
  'Transportation', 'Environmental', 'Technology', 'Real Estate', 'Non-Profit', 'Other',
];
const CADENCES = Object.keys(EFFORT_BY_CADENCE);
const CONFLICT_RISKS = ['Low', 'Medium', 'High'];
const STICKINESS = [1, 2, 3, 4, 5];

// The client form's name rules and messages (VALIDATION_RULES.name). A name is
// checked as it arrives, which since WP5 is as the partner typed it (trimmed,
// not escaped) and is what clients.name stores. The pattern has no `;`, so a
// name holding an HTML entity (`Barnes &amp; Noble`, as a client saved before
// WP5 was stored until scripts/unescape-book.cjs repaired the book) is
// refused, as the form refuses it.
const NAME_MAX = 255;
const NAME_PATTERN = /^[a-zA-Z0-9\s\-.,&'()/]+$/;
const NAME_MESSAGES = {
  required: 'Client name is required',
  maxLength: 'Client name must not exceed 255 characters',
  pattern: 'Client name contains invalid characters',
};

// A revenue row's year: one the import reads as a `YYYY Contracts` column
// (utils/csvImport.cjs builds REVENUE_HEADER from this), 1900 to 2099.
const REVENUE_YEAR = '(?:19|20)\\d{2}';
const REVENUE_YEAR_ONLY = new RegExp(`^${REVENUE_YEAR}$`);
// The client form's limit. client_revenues.revenue_amount is NUMERIC(12, 2),
// so anything from 1e10 up would fail in PostgreSQL.
const REVENUE_AMOUNT_MAX = 1e9;

const isObjectBody = (body) => body !== null && typeof body === 'object' && !Array.isArray(body);
const isRevenueYear = (year) => Number.isInteger(year) && REVENUE_YEAR_ONLY.test(String(year));
const isAmount = (amount) => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && amount <= REVENUE_AMOUNT_MAX;
const blank = (value) => value === undefined || value === null;
// A value as a message quotes it: text as it arrived
const shown = (value) => (typeof value === 'string' ? `"${value}"` : JSON.stringify(value));

// clients.name is VARCHAR(255) and holds the name as it arrives, trimmed
// (middleware/validation.cjs), so the form's 255 is also the column's. Until
// WP5 the name was stored escaped, each &, ' and / as 5 or 6 characters, and
// a second rule refused a name the form allows that was over 255 once escaped.
function checkName(name) {
  if (blank(name)) return NAME_MESSAGES.required;
  if (typeof name !== 'string') return 'Client name must be text';
  const typed = name.trim();
  if (typed === '') return NAME_MESSAGES.required;
  if (typed.length > NAME_MAX) return NAME_MESSAGES.maxLength;
  if (!NAME_PATTERN.test(typed)) return NAME_MESSAGES.pattern;
  return null;
}

function checkPracticeAreas(areas) {
  if (blank(areas)) return null;
  if (!Array.isArray(areas)) return `Practice areas must be a list from: ${PRACTICE_AREAS.join(', ')}.`;
  const unknown = areas.filter((area) => !PRACTICE_AREAS.includes(area));
  if (unknown.length === 0) return null;
  const one = unknown.length === 1;
  return `Practice area${one ? '' : 's'} ${unknown.map(shown).join(', ')} ${one ? 'is' : 'are'} not on the list: ${PRACTICE_AREAS.join(', ')}.`;
}

function checkRevenues(revenues) {
  if (!Array.isArray(revenues)) {
    return [{ field: 'revenues', message: 'Revenue must be a list of { year, revenue_amount } entries.' }];
  }
  const details = [];
  const seen = new Set();
  revenues.forEach((entry, index) => {
    // The client form's key for its row (ClientEnhancementForm.jsx), which
    // src/utils/clientForm.js maps back past the empty rows the form drops
    const field = `revenue_${index}`;
    if (!isObjectBody(entry)) {
      details.push({ field, message: `Revenue entry ${index + 1} must be { year, revenue_amount }.` });
      return;
    }
    const { year, revenue_amount: amount } = entry;
    const goodYear = isRevenueYear(year);
    if (!goodYear) {
      details.push({ field, message: `Revenue year ${shown(year)} must be a whole year from 1900 to 2099.` });
    } else if (seen.has(year)) {
      details.push({ field, message: `${year} is given more than once; give each year once.` });
    }
    if (goodYear) seen.add(year);
    if (!isAmount(amount)) {
      details.push({ field, message: `The amount for ${goodYear ? year : `revenue entry ${index + 1}`} must be a number from 0 to 1,000,000,000.` });
    }
  });
  return details;
}

/**
 * Check a client body for POST or PUT /api/data/clients. Returns
 * `[{ field, message }]`, empty when every field keeps its rule, in the body's
 * order (the store's formatClientForAPI); the route adds the people's
 * details (validateAssignment, utils/people.cjs) after these.
 *
 * A field left out takes the route's default, as before: no revenue on POST
 * and the stored revenue kept on PUT, stickiness not rated, high_maintenance
 * false, and NULL for practice_area and interaction_frequency. Name and
 * conflict risk are required. Blank is allowed where the book can hold it, as
 * the import writes it: no practice areas (`[]`), no cadence (`''`), not rated
 * (`null`). A body that is not an object gets one detail, `body`.
 */
function checkClient(body) {
  if (!isObjectBody(body)) {
    return [{ field: 'body', message: "The request body must be a JSON object of the client's fields." }];
  }
  const details = [];
  const add = (field, message) => {
    if (message) details.push({ field, message });
  };

  add('name', checkName(body.name));
  add('practice_area', checkPracticeAreas(body.practice_area));

  const risk = body.conflict_risk;
  if (!CONFLICT_RISKS.includes(risk)) {
    add('conflict_risk', `Conflict risk${blank(risk) || risk === '' ? '' : ` ${shown(risk)}`} must be Low, Medium or High.`);
  }

  const cadence = body.interaction_frequency;
  if (!blank(cadence) && cadence !== '' && !CADENCES.includes(cadence)) {
    add('interaction_frequency', `Interaction frequency ${shown(cadence)} must be one of ${CADENCES.join(', ')}, or blank.`);
  }

  const { stickiness } = body;
  if (!blank(stickiness) && !STICKINESS.includes(stickiness)) {
    add('stickiness', 'Stickiness must be a whole number from 1 to 5, or null for not rated.');
  }

  const handful = body.high_maintenance;
  if (handful !== undefined && typeof handful !== 'boolean') {
    add('high_maintenance', 'High-maintenance must be true or false.');
  }

  if (body.revenues !== undefined) details.push(...checkRevenues(body.revenues));
  return details;
}

module.exports = {
  PRACTICE_AREAS,
  CADENCES,
  CONFLICT_RISKS,
  STICKINESS,
  NAME_MAX,
  NAME_PATTERN,
  NAME_MESSAGES,
  REVENUE_YEAR,
  REVENUE_AMOUNT_MAX,
  isObjectBody,
  isRevenueYear,
  checkClient,
};
