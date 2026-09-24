// One session length for the JWT and the auth cookie (docs/plans/tier-0.md,
// D10): a token must not outlive the cookie that carries it. SESSION_TTL takes
// a whole number with a d, h or m suffix ('7d', '12h', '30m'); anything else
// falls back to the 7-day default for both, with a warning at startup.

const DEFAULT_TTL = '7d';

const UNIT_MS = {
  d: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
  m: 60 * 1000,
};

// Milliseconds for a TTL string, or null when it is not `<positive int><d|h|m>`.
function parseTtl(value) {
  const match = /^([1-9]\d*)([dhm])$/.exec(String(value ?? '').trim());
  if (!match) return null;
  return Number(match[1]) * UNIT_MS[match[2]];
}

// The TTL to use for a raw env value: `{ ttl, ms, valid }`, where `ttl` is the
// string jsonwebtoken gets and `ms` is the cookie maxAge; both describe the same
// span, so the token and the cookie expire together.
function resolveTtl(value) {
  const ms = parseTtl(value);
  if (ms !== null) return { ttl: String(value).trim(), ms, valid: true };
  return { ttl: DEFAULT_TTL, ms: parseTtl(DEFAULT_TTL), valid: value === undefined || value === '' };
}

const resolved = resolveTtl(process.env.SESSION_TTL);
if (!resolved.valid) {
  console.warn(
    `SESSION_TTL=${JSON.stringify(process.env.SESSION_TTL)} is not <number><d|h|m>; using ${DEFAULT_TTL}.`
  );
}

module.exports = {
  DEFAULT_TTL,
  SESSION_TTL: resolved.ttl,
  SESSION_TTL_MS: resolved.ms,
  parseTtl,
  resolveTtl,
};
