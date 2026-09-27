const validator = require('validator');

// Trims and HTML-escapes every string in the request body, on /api/data
// (data.cjs) and /api/scenarios (routes/scenarios.cjs). Stored text is
// therefore escaped; utils/escaping.cjs undoes it where text is compared or
// sent to the AI. docs/plans/tier-2.md, S8 (WP5), removes it.
const sanitizeRequestBody = (req, res, next) => {
  if (req.body) {
    // Recursively sanitize all string values in the request body
    const sanitize = (obj) => {
      if (typeof obj === 'string') {
        return validator.escape(obj.trim());
      } else if (Array.isArray(obj)) {
        return obj.map(sanitize);
      } else if (obj && typeof obj === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
          sanitized[key] = sanitize(value);
        }
        return sanitized;
      }
      return obj;
    };

    req.body = sanitize(req.body);
  }

  next();
};

module.exports = {
  sanitizeRequestBody
};
