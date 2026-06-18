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
 * raw 1–5 `stickiness` pick, falling back to the legacy retention fields so
 * un-migrated rows still produce a number (mirrors strategic.cjs).
 */
export const resolveStickinessScore = (client) => {
  if (!client) return 5;

  const precomputed = num(client.stickinessScore);
  if (precomputed !== null) return precomputed;

  // Raw stickiness input is the 1–5 roommate↔cold scale.
  const explicit = num(client.stickiness);
  if (explicit !== null) {
    return Math.max(0, Math.min(10, ((explicit - 1) / 4) * 10));
  }

  const intensity = num(client.relationship_intensity ?? client.relationshipIntensity);
  if (intensity !== null) {
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
