const db = require('../db.cjs');
const { calculateStrategicScores, revenueObjectFromRows } = require('../utils/strategic.cjs');
const {
  CLIENT_PEOPLE_COLUMNS,
  CLIENT_PEOPLE_JOINS,
  CLIENT_PEOPLE_GROUP_BY,
  withPeopleFields,
} = require('../utils/people.cjs');

/* List all clients, each with nested revenues array and its people (lead,
   second chair, originator; the legacy people fields filled from them).
   The revenue rows read only columns production's older client_revenues has
   (no contract_end_date: see CLAUDE.md, File Structure, and
   tests/import-db.test.mjs), so the AI routes work on both table shapes. */
exports.listWithRevenues = async () => {
  const { rows } = await db.query(
    `SELECT c.*, jsonb_agg(
         jsonb_build_object(
           'id', r.id,
           'year', r.year,
           'revenue_amount', r.revenue_amount
         ) ORDER BY r.year
       ) AS revenues,
       ${CLIENT_PEOPLE_COLUMNS}
     FROM clients c
     LEFT JOIN client_revenues r ON r.client_id = c.id
     ${CLIENT_PEOPLE_JOINS}
     GROUP BY c.id, ${CLIENT_PEOPLE_GROUP_BY}
     ORDER BY c.created_at DESC`
  );
  return rows.map(withPeopleFields);
};

/* ---------- Stage 4: Metrics helpers ---------- */

/**
 * List clients with calculated strategic metrics
 * @returns {Promise<Array>}
 */
exports.listWithMetrics = async () => {
 const clients = await exports.listWithRevenues();

 const enriched = clients.map((c) => {
   // Revenue by year for every row on file (year-agnostic)
   const revenue = revenueObjectFromRows(c.revenues);

   return {
     ...c,
     revenue,
     // Defaults expected by scoring util
     timeCommitment: c.time_commitment || 40,
     relationshipStrength: c.relationship_strength || 5,
     conflictRisk: c.conflict_risk || 'Medium',
     renewalProbability: c.renewal_probability || 0.7,
     strategicFitScore: c.strategic_fit_score || 5,
     practiceArea: c.practice_area || [],
   };
 });

 return calculateStrategicScores(enriched);
};
