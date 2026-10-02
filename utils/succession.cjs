// Succession metrics on the server (docs/plans/tier-2.md, S11, WP7): each
// client's relationship type, transition complexity and succession risk,
// computed from its nested people and the scorer's figures. Every client
// response carries them (data.cjs), as it carries strategicValue and effort,
// and the transition plan computes them from the book's entry for its client
// (utils/transitionPlan.cjs), whatever the page sent.
//
// Pure: no db.cjs import, so tests can load it. The page's copy is
// src/utils/successionUtils.js, kept only for the client form's live preview
// (and for a page served by an API older than WP7); tests/succession.test.mjs
// holds the two equal on the fixture books and on seeded random books, figure
// for figure. Change one side, change the other, with each sum in the same
// order: the scores are rounded, and a sum at x.5 rounds one way or the other
// by its last bit.
//
// The rules are the page's as they were until WP7, with S11's four changes
// (approved by Jeff on 2026-09-27) and, from Tier 3 WP13, no practice area
// in the complexity (below), and nothing else:
//   1. The relationship type reads the people by id, not the legacy text:
//      orphaned without a lead; primary when the lead is the recorded
//      originator and there is no second chair, whatever originator_is_firm
//      says (P4: the person stays recorded), so a firm credit with no
//      originator recorded is not primary; shared when there is a second chair
//      and stickiness is 7 or more of 10 (picks 4 and 5); otherwise secondary.
//      A client without a lead is orphaned even when it keeps its stored
//      legacy text (P6).
//   2. Cadence counts once, through effort: the separate cadence term is gone.
//   3. Practice areas are read from practiceArea or practice_area, so the
//      form's preview (which holds practiceArea) reads them too; since Tier 3
//      WP13 no rule uses them (below).
//   4. An unrated client's stickiness term uses UNRATED_STICKINESS, exactly
//      40 / 9, the scorer's stand-in, not a rating. Both sides compute the
//      0 to 10 figure from the raw pick (getStickiness), never from the API's
//      stickinessScore, which calculateStrategicScores rounds to 4.44; no
//      integer result differs between the two, and tests/succession.test.mjs
//      checks that too.
//
// Kept as they were: the weights, the 0.3 factors, the rounding and the cap
// of 10. No practice area moves a figure since Tier 3 WP13 (U41 (a), Jeff,
// 2026-10-02: "sometimes an arts client could be as complicated as a banking
// client"): complexity is effort and the High point only, 0 to 4. Until then
// a practice area whose name held 'healthcare', 'energy' or 'financial', in
// any case, added 1.5 (the third was 'financial services' until Tier 3 WP2,
// U6 (b)); the area was a proxy for difficulty that the partners' own picks
// (cadence, the handful, conflict risk) already carry.

const { getStickiness, EFFORT_BY_CADENCE, HANDFUL_MULTIPLIER } = require('./strategic.cjs');
const { clientEffort } = require('./book.cjs');

// The largest effort one client can reach (Daily, a handful): effort is put
// on a 0 to 10 scale against it
const MAX_EFFORT = EFFORT_BY_CADENCE.Daily * HANDFUL_MULTIPLIER;

const TYPE_RISK = { primary: 3, secondary: 2, shared: 1, orphaned: 5 };
const RELATIONSHIP_TYPES = Object.keys(TYPE_RISK);

// A person's id as text, or null: the nested person's (the API's lead,
// secondChair and originator, and the book's entries), else the id column
// (a stored row, or the client form's select value, '' for none)
function personId(nested, id) {
  const value = nested && typeof nested === 'object' && nested.id !== null && nested.id !== undefined ? nested.id : id;
  return value === null || value === undefined || value === '' ? null : String(value);
}

/** A client's practice areas, from practiceArea or practice_area (rule 3): a list of text, or one text. */
function practiceAreasOf(client) {
  const areas = client?.practiceArea ?? client?.practice_area;
  if (Array.isArray(areas)) return areas.filter((area) => area && typeof area === 'string');
  if (typeof areas === 'string' && areas) return [areas];
  return [];
}

/**
 * What the rules read from a client: as the API sends it, as the database
 * stores it (people as ids), or as the client form holds it. Stickiness is
 * the scorer's (utils/strategic.cjs): 0 to 10 from the raw pick, 40 / 9 when
 * there is none. Effort is the client's `effort` when it carries one (the
 * scorer's, on every client the API sends), else the scorer's from the
 * cadence and the handful flag: clientEffort, the book's port of the page's
 * resolveEffort, so the book, the page and this module read it alike.
 */
function successionInputs(client = {}) {
  return {
    leadId: personId(client.lead, client.lead_id),
    secondChairId: personId(client.secondChair, client.second_chair_id),
    originatorId: personId(client.originator, client.originator_id),
    stickiness: getStickiness(client),
    effort: clientEffort(client),
    practiceAreas: practiceAreasOf(client),
    conflictRisk: client.conflict_risk ?? client.conflictRisk,
  };
}

/**
 * The same, from a client's entry in the book (bookModel in utils/book.cjs):
 * its people nested, its Stickiness pick (null when not rated), the effort
 * the book shows and its practice areas. For every value a write allows
 * (a pick of 1 to 5 or none) it gives what successionInputs gives for the
 * client the entry was built from, so a transition plan shows the figures the
 * client's response carries.
 */
function bookEntryInputs(entry = {}) {
  return {
    leadId: personId(entry.lead),
    secondChairId: personId(entry.secondChair),
    originatorId: personId(entry.originator),
    stickiness: getStickiness({ stickiness: entry.stickiness }),
    effort: Number(entry.effort),
    practiceAreas: practiceAreasOf({ practiceArea: entry.practiceAreas }),
    conflictRisk: entry.conflictRisk,
  };
}

const conflictLabel = (risk) => (typeof risk === 'string' ? risk.trim().toLowerCase() : '');

/** Rule 1: 'orphaned', 'shared', 'primary' or 'secondary'. */
function relationshipTypeOf(inputs) {
  if (inputs.leadId === null) return 'orphaned';
  if (inputs.secondChairId !== null && inputs.stickiness >= 7) return 'shared';
  if (inputs.originatorId !== null && inputs.originatorId === inputs.leadId && inputs.secondChairId === null) return 'primary';
  return 'secondary';
}

/** Transition complexity, 0 to 4: effort (rule 2) and High conflict risk; no practice area (Tier 3 WP13, U41). */
function transitionComplexityOf(inputs) {
  let complexity = 0;

  // Engagement: effort on a 0 to 10 scale, weighted 0.3. The cadence is in
  // effort already; until WP7 it was also added on its own (0 to 3)
  const engagement = Math.min(10, (inputs.effort / MAX_EFFORT) * 10);
  complexity += engagement * 0.3;

  if (conflictLabel(inputs.conflictRisk) === 'high') {
    complexity += 1;
  }

  return Math.min(Math.round(complexity), 10);
}

/** Succession risk, 1 to 10: the relationship type, low stickiness (rule 4) and the complexity. */
function successionRiskOf(inputs, type = relationshipTypeOf(inputs), complexity = transitionComplexityOf(inputs)) {
  let risk = 0;
  risk += TYPE_RISK[type] || 2;
  if (inputs.stickiness < 6) {
    risk += (6 - inputs.stickiness);
  }
  risk += complexity * 0.3;
  return Math.min(Math.round(risk), 10);
}

/** The three metrics from what the rules read. */
function metricsOf(inputs) {
  const relationshipType = relationshipTypeOf(inputs);
  const transitionComplexity = transitionComplexityOf(inputs);
  return {
    relationshipType,
    transitionComplexity,
    successionRisk: successionRiskOf(inputs, relationshipType, transitionComplexity),
  };
}

/** A client's { relationshipType, transitionComplexity, successionRisk }. */
const successionMetrics = (client) => metricsOf(successionInputs(client));

/** The same for a client's entry in the book. */
const bookEntryMetrics = (entry) => metricsOf(bookEntryInputs(entry));

/** Clients as the API answers them: each with its three metrics added. */
const withSuccessionMetrics = (clients = []) => clients.map((client) => ({ ...client, ...successionMetrics(client) }));

module.exports = {
  MAX_EFFORT,
  TYPE_RISK,
  RELATIONSHIP_TYPES,
  practiceAreasOf,
  successionInputs,
  bookEntryInputs,
  relationshipTypeOf,
  transitionComplexityOf,
  successionRiskOf,
  metricsOf,
  successionMetrics,
  bookEntryMetrics,
  withSuccessionMetrics,
};
