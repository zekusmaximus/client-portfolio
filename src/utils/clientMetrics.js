/**
 * Frontend client-metric resolvers — the browser-side mirror of the axis
 * helpers in `utils/strategic.cjs` (`getStickiness` / `getEffort`) and, from
 * Tier 3 WP6, of the score itself (`calculateStrategicValue`:
 * resolveStrategicValue, below).
 *
 * Why this exists: most frontend code reads SCORED client objects straight from
 * the API/store, which already carry `stickinessScore` (0–10), `effort`
 * (relative work units) and `strategicValue`. But the live Succession preview
 * in `ClientEnhancementForm` feeds in RAW form state, which only has the raw
 * `stickiness` (1–5 pick), `high_maintenance` flag, and `interaction_frequency`
 * cadence — NOT the server-computed scores; and so does Scenarios' "A new
 * client" sandbox (src/utils/clientFit.js), whose hypothetical client never
 * reaches the API. These resolvers accept EITHER shape so the figures are
 * identical whether they're computed from a saved client or from what a
 * partner is still typing. (Since Tier 2 WP7 the succession rules read
 * stickiness from the raw pick on both sides, never the rounded
 * stickinessScore: src/utils/successionUtils.js.)
 *
 * Keep the cadence weights, the stickiness mapping and the score's weights in
 * sync with `utils/strategic.cjs` (the single source of truth for the saved
 * score): tests/strategic.test.mjs and tests/load.test.mjs fail when they
 * differ.
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

// Mirror of the score's weights and the conflict penalty in
// utils/strategic.cjs (REVENUE_WEIGHT, STICKINESS_WEIGHT, CONFLICT_PENALTY;
// Tier 3 WP6, U21 (a)). tests/strategic.test.mjs holds resolveStrategicValue
// equal to calculateStrategicValue on the fixture books and 3,000 random
// clients, so a weight moved on one side alone fails `npm test`.
export const REVENUE_WEIGHT = 0.5;
export const STICKINESS_WEIGHT = 0.5;
export const REVENUE_PER_POINT = 50000; // $500k → 10
export const CONFLICT_PENALTY = { High: 3, Medium: 1, Low: 0 };

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

// The stickiness from the raw pick alone, as getStickiness in
// utils/strategic.cjs reads it: never the API's rounded stickinessScore, which
// resolveStickinessScore prefers, since the score is computed from the exact
// figure on the server (docs/plans/tier-3.md, 14.2)
const rawStickiness = (client) => {
  const explicit = num(client?.stickiness);
  if (explicit !== null) return Math.max(0, Math.min(10, ((explicit - 1) / 4) * 10));
  return UNRATED_STICKINESS;
};

/**
 * The client's own latest revenue year's amount (docs/plans/tier-0.md, D6):
 * mirror of getMostRecentRevenue in utils/strategic.cjs, accepting either a
 * `revenues` array (the API's rows; `revenues` given explicitly wins) or a
 * `revenue` object ({ [year]: amount }); 0 with neither. The latest year is
 * the first row of the largest year, as the scorer reads it, and a null row
 * (what jsonb_agg yields for a client with no revenue) reads as year 0.
 */
export const mostRecentRevenue = (client, revenues) => {
  const revArray = Array.isArray(revenues)
    ? revenues
    : Array.isArray(client?.revenues)
      ? client.revenues
      : null;

  if (revArray && revArray.length > 0) {
    const latest = revArray.reduce((a, b) => (Number(b.year) > Number(a.year) ? b : a));
    return parseFloat(latest.revenue_amount) || 0;
  }

  if (client?.revenue && typeof client.revenue === 'object') {
    const years = Object.keys(client.revenue)
      .map(Number)
      .filter((y) => !Number.isNaN(y));
    if (years.length > 0) {
      const latestYear = Math.max(...years);
      return parseFloat(client.revenue[latestYear]) || 0;
    }
  }

  return 0;
};

/**
 * The strategic value's parts, from the raw picks and the client's own latest
 * revenue year (calculateStrategicValue in utils/strategic.cjs, step by step):
 * { revenue, revenueScore, stickiness, rated, conflictRisk, penalty, value },
 * `value` clamped to 0–10 and not rounded (the API rounds it to two decimals:
 * calculateStrategicScores). `stickiness` is the exact figure, 40 / 9 for a
 * client nobody has rated (`rated` false). An unknown conflict label scores as
 * Medium, as it does on the server.
 */
export const strategicValueParts = (client, revenues) => {
  const revenue = mostRecentRevenue(client, revenues);
  const revenueScore = Math.min(10, (parseFloat(revenue) || 0) / REVENUE_PER_POINT);
  const stickiness = rawStickiness(client);
  const rated = num(client?.stickiness) !== null;
  const conflictRisk = client?.conflict_risk ?? client?.conflictRisk ?? 'Medium';
  const penalty = CONFLICT_PENALTY[conflictRisk] ?? CONFLICT_PENALTY.Medium;
  const value = Math.max(0, Math.min(10, revenueScore * REVENUE_WEIGHT + stickiness * STICKINESS_WEIGHT - penalty));
  return { revenue, revenueScore, stickiness, rated, conflictRisk, penalty, value };
};

/**
 * Strategic value (0–10): Value + Stickiness − Conflict.
 * Prefers the server-computed `strategicValue` (rounded to two decimals, as
 * the API sends it); otherwise mirrors calculateStrategicValue from the raw
 * pick and the client's own latest revenue year, unrounded (Tier 3 WP6,
 * U21 (a); held equal by tests/strategic.test.mjs).
 */
export const resolveStrategicValue = (client, revenues) => {
  if (!client) return 0;

  const precomputed = num(client.strategicValue);
  if (precomputed !== null) return precomputed;

  return strategicValueParts(client, revenues).value;
};
