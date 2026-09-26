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
 * every code path produces identical numbers for the same client. They are also
 * backward-tolerant: if the explicit `stickiness` / `high_maintenance` fields
 * are absent, stickiness is derived from the legacy retention fields
 * (relationship_intensity → relationship_strength + renewal_probability) so the
 * score keeps working before/after the data migration.
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
 *  - explicit `stickiness` (1–5 scale) takes precedence;
 *  - else derived from legacy `relationship_intensity` (1–10, the roommate↔cold
 *    scale this field always meant);
 *  - else blended from `relationship_strength` (1–10) and `renewal_probability`
 *    (0–1);
 *  - else neutral 5.
 */
function getStickiness(client) {
  // Raw stickiness input is the 1–5 roommate↔cold scale.
  const explicit = num(client.stickiness);
  if (explicit !== null) {
    // 1–5 scale → 0–10  (Personal bond 5 → 10 … Cold 1 → 0)
    return Math.max(0, Math.min(10, ((explicit - 1) / 4) * 10));
  }

  const intensity = num(client.relationship_intensity ?? client.relationshipIntensity);
  if (intensity !== null) {
    // 1–10 scale → 0–10
    return Math.max(0, Math.min(10, ((intensity - 1) / 9) * 10));
  }

  const strength = num(client.relationship_strength ?? client.relationshipStrength);
  const renewal = num(client.renewal_probability ?? client.renewalProbability);
  if (strength !== null || renewal !== null) {
    const sStrength = strength !== null ? ((strength - 1) / 9) * 10 : 5;
    const sRenewal = renewal !== null ? renewal * 10 : 5;
    return Math.max(0, Math.min(10, (sStrength + sRenewal) / 2));
  }

  return 5;
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
  getMostRecentRevenue,
  revenueObjectFromRows,
  getEffort,
  getStickiness,
  calculateStrategicValue,
  calculateStrategicScores,
};
