// Rate limits (docs/plans/tier-0.md, D11). One instance of each limiter for the
// whole process: the AI limiters are mounted on routes/ai.cjs's POST routes
// (Ask the book and the brief) and on every route of routes/scenarios.cjs, so
// the per-user and daily budgets cover every AI endpoint together. Counters
// live in memory and reset on restart (a Render redeploy), which is
// acceptable for six partners on one process.
//
// Behind Render's proxy `req.ip` is only the client's address when
// TRUST_PROXY_HOPS is set (server.cjs); without it every partner would share
// the proxy's address and one bucket.
//
// express-rate-limit v8 logs ERR_ERL_KEY_GEN_IPV6 for a custom keyGenerator
// whose source mentions the request IP without ipKeyGenerator, so the IP
// fallbacks below go through ipKeyGenerator (IPv6 addresses collapse to their
// /56, as the default key does).
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const TOO_MANY = 'Too many requests. Try again later.';

function limiter(name, options) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, _next, optionsUsed) => {
      console.warn(JSON.stringify({
        event: 'rate_limited',
        limiter: name,
        key: req.rateLimit?.key,
        limit: optionsUsed.limit,
        path: req.originalUrl,
      }));
      res.status(429).json({ success: false, error: TOO_MANY });
    },
    ...options,
  });
}

// Login and change-password, per client IP: loose, because six partners may
// share one office address. Uses the library's default key (the IP, with its
// proxy-configuration checks).
const loginIpLimiter = limiter('login_ip', {
  windowMs: 15 * MINUTE,
  limit: 20,
});

// Failed logins per username: what actually protects a password. Successful
// logins are not counted, so a partner who types it right is never blocked by
// an earlier typo. The key is case-folded so 'Jeff' and 'jeff' share a budget.
const loginUserLimiter = limiter('login_user', {
  windowMs: 15 * MINUTE,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    return username ? `user:${username}` : `ip:${ipKeyGenerator(req.ip)}`;
  },
});

// AI calls per signed-in partner. Mounted after authenticateToken, so
// req.user is always set; the IP fallback is defensive only.
const aiUserLimiter = limiter('ai_user', {
  windowMs: HOUR,
  limit: 30,
  keyGenerator: (req) =>
    req.user?.userId != null ? `user:${req.user.userId}` : `ip:${ipKeyGenerator(req.ip)}`,
});

// AI calls for the whole firm per day, whatever the UI does.
const aiGlobalLimiter = limiter('ai_global', {
  windowMs: DAY,
  limit: 300,
  keyGenerator: () => 'global',
});

module.exports = {
  TOO_MANY,
  loginIpLimiter,
  loginUserLimiter,
  aiUserLimiter,
  aiGlobalLimiter,
};
