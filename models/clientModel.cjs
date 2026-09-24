const db = require('../db.cjs');
const { calculateStrategicScores, revenueObjectFromRows } = require('../utils/strategic.cjs');

/* List all clients, each with nested revenues array */
exports.listWithRevenues = async () => {
  const { rows } = await db.query(
    `SELECT c.*, jsonb_agg(
         jsonb_build_object(
           'id', r.id,
           'year', r.year,
           'revenue_amount', r.revenue_amount,
           'contract_end_date', r.contract_end_date
         ) ORDER BY r.year
       ) AS revenues
     FROM clients c
     LEFT JOIN client_revenues r ON r.client_id = c.id
     GROUP BY c.id
     ORDER BY c.created_at DESC`
  );
  return rows;
};

/* Get single client with revenues */
exports.get = async (clientId) => {
  const { rows } = await db.query(
    `SELECT c.*, jsonb_agg(
         jsonb_build_object(
           'id', r.id,
           'year', r.year,
           'revenue_amount', r.revenue_amount,
           'contract_end_date', r.contract_end_date
         ) ORDER BY r.year
       ) AS revenues
     FROM clients c
     LEFT JOIN client_revenues r ON r.client_id = c.id
     WHERE c.id = $1
     GROUP BY c.id`,
    [clientId]
  );
  return rows[0];
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

/**
 * Get single client with calculated metrics
 * @param {number|string} clientId
 * @returns {Promise<Object|null>}
 */
exports.getWithMetrics = async (clientId) => {
 const client = await exports.get(clientId);
 if (!client) return null;

 const scored = calculateStrategicScores([
   {
     ...client,
     revenue: revenueObjectFromRows(client.revenues),
     timeCommitment: client.time_commitment || 40,
     relationshipStrength: client.relationship_strength || 5,
     conflictRisk: client.conflict_risk || 'Medium',
     renewalProbability: client.renewal_probability || 0.7,
     strategicFitScore: client.strategic_fit_score || 5,
     practiceArea: client.practice_area || [],
   },
 ]);

 return scored[0];
};