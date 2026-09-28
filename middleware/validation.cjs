// Trims every string in the request body, on /api/data (data.cjs) and
// /api/scenarios (routes/scenarios.cjs), and changes nothing else: text is
// stored as the partner typed it (docs/plans/tier-2.md, S8, WP5).
//
// Until WP5 these two routers ran sanitizeRequestBody, which trimmed and then
// HTML-escaped every string with validator.escape, so text saved through the
// client form was stored as `Barnes &amp; Noble` (review 4.9). This keeps its
// trim, byte for byte, so each route and each check (checkClient,
// utils/clientRules.cjs, which compares the vocabularies exactly; the
// transition plan's request check) sees what it saw before, but for the
// escaping. The text stored escaped before WP5 is repaired by
// scripts/unescape-book.cjs. routes/people.cjs and routes/ai.cjs never had
// either pass and need none: their own checks trim what they keep.

/** Every string in `value` trimmed, in arrays and objects at any depth; anything else as it is. */
function trimStrings(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(trimStrings);
  if (value && typeof value === 'object') {
    const trimmed = {};
    for (const [key, item] of Object.entries(value)) {
      trimmed[key] = trimStrings(item);
    }
    return trimmed;
  }
  return value;
}

const trimRequestBody = (req, res, next) => {
  if (req.body) {
    req.body = trimStrings(req.body);
  }
  next();
};

module.exports = {
  trimStrings,
  trimRequestBody
};
