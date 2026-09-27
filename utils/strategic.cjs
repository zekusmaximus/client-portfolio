/**
 * Strategic scoring & client metrics — single source of truth.
 *
 * Consumed by:
 *   - data.cjs            (via clientAnalyzer.cjs re-export) — dashboard CRUD path
 *   - models/clientModel  (listWithMetrics) — the AI's book (utils/book.cjs)
 *
 * Every client reduces to three axes plus a risk flag (see PRODUCT_BRIEF.md):
 *   - Value      → most-recent-year revenue
 *   - Stickiness → how locked-in the relationship is (flight risk), 0–10
 *   - Effort     → how much work the client takes (cadence + "handful" flag)
 *   - Conflict   → Low / Medium / High penalty
 *
 * Strategic value (the legible label, clamped 0–10):
 *   strategicValue = revenueScore*0.50 + stickiness*0.50  −  conflictPenalty
 *   revenueScore   = min(10, mostRecentRevenue / 50000)   // $500k → 10
 *   conflictPenalty: High=3, Medium=1, Low=0
 *
 * These weights and the cadence/stickiness mappings are intentionally simple
 * and centralized here as the only place to tune them.
 *
 * The helpers tolerate both snake_case (DB) and camelCase (frontend) field
 * names, and both revenue shapes (a `revenues` array or a `revenue` object), so
 * every code path produces identical numbers for the same client. A client
 * with no Stickiness pick scores with a fixed stand-in (UNRATED_STICKINESS),
 * not a rating; the retired columns (relationship_intensity,
 * relationship_strength, renewal_probability, strategic_fit_score) are not
 * read (docs/plans/tier-2.md, S4).
 *
 * No year is hard-coded here. The score reads each client's own latest
 * revenue year (docs/plans/tier-0.md, D6); the frontend's book-wide reporting
 * year (D4) can differ for a client with no row in that year.
 */

// Relative effort per client by contact cadence. Tunable.
const EFFORT_BY_CADENCE = {
  Daily: 5,
  Weekly: 3,
  Monthly: 2,
  Quarterly: 1,
  'As-Needed': 0.5,
};
const DEFAULT_CADENCE_EFFORT = 1; // unknown / unset cadence
const HANDFUL_MULTIPLIER = 1.5;   // "this one's a handful" flag

// The stickiness (0–10) of a client nobody has rated: a stand-in, not a
// rating. It is the value the retired relationship_intensity gave at 5, its
// column default, ((5 - 1) / 9) × 10 = 40 / 9 ≈ 4.44, which every client on
// production had when the scorer stopped reading it (docs/plans/tier-2.md,
// S4, Jeff's count on 2026-09-27), so no score moved. The page's copy is in
// src/utils/clientMetrics.js; tests/strategic.test.mjs holds them equal.
const UNRATED_STICKINESS = 40 / 9;

const REVENUE_WEIGHT = 0.5;
const STICKINESS_WEIGHT = 0.5;
const CONFLICT_PENALTY = { High: 3, Medium: 1, Low: 0 };

const num = (v) => {
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
};

/**
 * Resolve the most recent year's revenue, accepting either a `revenues` array
 * (DB shape) or a `revenue` object (frontend shape).
 */
function getMostRecentRevenue(client, revenues) {
  const revArray = Array.isArray(revenues)
    ? revenues
    : Array.isArray(client.revenues)
      ? client.revenues
      : null;

  if (revArray && revArray.length > 0) {
    const latest = revArray.reduce((a, b) => (Number(b.year) > Number(a.year) ? b : a));
    return parseFloat(latest.revenue_amount) || 0;
  }

  if (client.revenue && typeof client.revenue === 'object') {
    const years = Object.keys(client.revenue)
      .map(Number)
      .filter((y) => !Number.isNaN(y));
    if (years.length > 0) {
      const latestYear = Math.max(...years);
      return parseFloat(client.revenue[latestYear]) || 0;
    }
  }

  return 0;
}

/**
 * Revenue rows (DB shape) → `{ [year]: amount }` for every year on file.
 * Skips the null row that `jsonb_agg` without a FILTER yields for a client
 * with no revenue. Year-agnostic: nothing here knows which years exist.
 */
function revenueObjectFromRows(revenues) {
  const revenue = {};
  if (!Array.isArray(revenues)) return revenue;
  for (const row of revenues) {
    if (!row || row.year === null || row.year === undefined || row.year === '') continue;
    const year = Number(row.year);
    if (!Number.isInteger(year) || year <= 0) continue;
    revenue[year] = parseFloat(row.revenue_amount) || 0;
  }
  return revenue;
}

/**
 * Truthiness for the "handful" flag across the names it may arrive under.
 */
function isHandful(client) {
  const v = client.high_maintenance ?? client.highMaintenance ?? client.handful;
  return v === true || v === 'true' || v === 1 || v === '1';
}

/**
 * Effort load for a single client (relative work units).
 * Cadence weight, bumped by the "handful" flag.
 */
function getEffort(client) {
  const cadence = client.interaction_frequency ?? client.interactionFrequency;
  const base = EFFORT_BY_CADENCE[cadence] ?? DEFAULT_CADENCE_EFFORT;
  const effort = isHandful(client) ? base * HANDFUL_MULTIPLIER : base;
  return Math.round(effort * 100) / 100;
}

/**
 * Stickiness (0–10): how locked-in the relationship is.
 *  - the `stickiness` pick (1–5 scale), when there is one;
 *  - else UNRATED_STICKINESS, a fixed stand-in (not a rating).
 */
function getStickiness(client) {
  // Raw stickiness input is the 1–5 roommate↔cold scale.
  const explicit = num(client.stickiness);
  if (explicit !== null) {
    // 1–5 scale → 0–10  (Personal bond 5 → 10 … Cold 1 → 0)
    return Math.max(0, Math.min(10, ((explicit - 1) / 4) * 10));
  }
  return UNRATED_STICKINESS;
}

/**
 * Strategic value (0–10) for a single client: Value + Stickiness − Conflict.
 * `revenues` is optional: when omitted, `client.revenues` (then the
 * `client.revenue` object) is read, so the one-argument call scores the
 * same as `calculateStrategicScores`.
 */
function calculateStrategicValue(client, revenues) {
  const mostRecentRevenue = getMostRecentRevenue(client, revenues);
  const revenueScore = Math.min(10, (parseFloat(mostRecentRevenue) || 0) / 50000);
  const stickiness = getStickiness(client);

  const conflictRisk = client.conflict_risk ?? client.conflictRisk ?? 'Medium';
  const conflictPenalty = CONFLICT_PENALTY[conflictRisk] ?? CONFLICT_PENALTY.Medium;

  const strategicValue =
    revenueScore * REVENUE_WEIGHT +
    stickiness * STICKINESS_WEIGHT -
    conflictPenalty;

  return Math.max(0, Math.min(10, strategicValue));
}

/**
 * Calculate metrics for a list of clients. Adds `strategicValue`,
 * `averageRevenue` (most-recent-year revenue, kept under the historical name),
 * `stickinessScore` (0–10 derived; the raw 1–5 `stickiness` input is preserved),
 * and `effort` (relative work units).
 */
function calculateStrategicScores(clients) {
  if (!clients || clients.length === 0) {
    return [];
  }

  return clients.map((client) => ({
    ...client,
    averageRevenue: Math.round(getMostRecentRevenue(client, client.revenues)),
    // Raw `stickiness` (1–5 input) is preserved via ...client; this is the
    // derived 0–10 value used for display/scoring, under a distinct name.
    stickinessScore: Math.round(getStickiness(client) * 100) / 100,
    effort: getEffort(client),
    strategicValue: Math.round(calculateStrategicValue(client, client.revenues) * 100) / 100,
  }));
}

module.exports = {
  EFFORT_BY_CADENCE,
  HANDFUL_MULTIPLIER,
  UNRATED_STICKINESS,
  getMostRecentRevenue,
  revenueObjectFromRows,
  getEffort,
  getStickiness,
  calculateStrategicValue,
  calculateStrategicScores,
};
