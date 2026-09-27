/**
 * Frontend client-metric resolvers — the browser-side mirror of the two axis
 * helpers in `utils/strategic.cjs` (`getStickiness` / `getEffort`).
 *
 * Why this exists: most frontend code reads SCORED client objects straight from
 * the API/store, which already carry `stickinessScore` (0–10) and `effort`
 * (relative work units). But the live Succession preview in
 * `ClientEnhancementForm` feeds in RAW form state, which only has the raw
 * `stickiness` (1–5 pick), `high_maintenance` flag, and `interaction_frequency`
 * cadence — NOT the server-computed scores. These resolvers accept EITHER
 * shape so succession metrics are identical whether they're computed from a
 * saved client or from a form a partner is still editing.
 *
 * Keep the cadence weights / stickiness mapping in sync with
 * `utils/strategic.cjs` (the single source of truth for the saved score).
 */

// Mirror of EFFORT_BY_CADENCE in utils/strategic.cjs.
const EFFORT_BY_CADENCE = {
  Daily: 5,
  Weekly: 3,
  Monthly: 2,
  Quarterly: 1,
  'As-Needed': 0.5,
};
const DEFAULT_CADENCE_EFFORT = 1; // unknown / unset cadence
const HANDFUL_MULTIPLIER = 1.5;   // "this one's a handful" flag

// Mirror of UNRATED_STICKINESS in utils/strategic.cjs: the stickiness (0–10)
// of a client nobody has rated, a fixed stand-in and not a rating (40 / 9,
// what the retired relationship_intensity gave at its default of 5;
// docs/plans/tier-2.md, S4). tests/strategic.test.mjs holds the two equal.
export const UNRATED_STICKINESS = 40 / 9;

// Largest effort a single client can reach (Daily cadence × handful). Used to
// normalize effort onto a 0–10 scale where succession math expects it.
export const MAX_EFFORT = EFFORT_BY_CADENCE.Daily * HANDFUL_MULTIPLIER; // 7.5

const num = (v) => {
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
};

/** Truthiness for the "handful" flag across the names it may arrive under. */
const isHandful = (client) => {
  const v = client.high_maintenance ?? client.highMaintenance ?? client.handful;
  return v === true || v === 'true' || v === 1 || v === '1';
};

/**
 * Effort load (relative work units) for a client.
 * Prefers the server-computed `effort`; otherwise derives it from cadence +
 * the handful flag, exactly like the backend.
 */
export const resolveEffort = (client) => {
  if (!client) return DEFAULT_CADENCE_EFFORT;

  const precomputed = num(client.effort);
  if (precomputed !== null) return precomputed;

  const cadence = client.interaction_frequency ?? client.interactionFrequency;
  const base = EFFORT_BY_CADENCE[cadence] ?? DEFAULT_CADENCE_EFFORT;
  const effort = isHandful(client) ? base * HANDFUL_MULTIPLIER : base;
  return Math.round(effort * 100) / 100;
};

/**
 * Stickiness (0–10): how locked-in the relationship is.
 * Prefers the server-computed `stickinessScore`; otherwise derives it from the
 * raw 1–5 `stickiness` pick, or UNRATED_STICKINESS when there is none
 * (mirrors getStickiness in strategic.cjs).
 */
export const resolveStickinessScore = (client) => {
  if (!client) return UNRATED_STICKINESS;

  const precomputed = num(client.stickinessScore);
  if (precomputed !== null) return precomputed;

  // Raw stickiness input is the 1–5 roommate↔cold scale.
  const explicit = num(client.stickiness);
  if (explicit !== null) {
    return Math.max(0, Math.min(10, ((explicit - 1) / 4) * 10));
  }
  return UNRATED_STICKINESS;
};

/**
 * Resolve both axes at once. Convenience for callers (e.g. succession utils)
 * that need stickiness and effort together.
 * @returns {{ stickinessScore: number, effort: number }}
 */
export const resolveClientAxes = (client) => ({
  stickinessScore: resolveStickinessScore(client),
  effort: resolveEffort(client),
});
