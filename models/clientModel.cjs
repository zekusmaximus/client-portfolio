const db = require('../db.cjs');
const { calculateStrategicScores } = require('../utils/strategic.cjs');

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

/* Create a new client */
exports.create = async (data) => {
  const {
    name,
    status = 'Prospect',
    practice_area,
    relationship_strength,
    conflict_risk,
    renewal_probability,
    strategic_fit_score,
    notes,
    primary_lobbyist,
    client_originator,
    lobbyist_team,
    interaction_frequency,
    relationship_intensity,
  } = data;

  const { rows: [client] } = await db.query(
    `INSERT INTO clients
     (user_id, name, status, practice_area, relationship_strength,
      conflict_risk, renewal_probability, strategic_fit_score, notes,
      primary_lobbyist, client_originator, lobbyist_team,
      interaction_frequency, relationship_intensity)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      name, status, practice_area, relationship_strength,
      conflict_risk, renewal_probability, strategic_fit_score, notes,
      primary_lobbyist, client_originator, lobbyist_team,
      interaction_frequency, relationship_intensity,
    ]
  );
  client.revenues = [];
  return client;
};

/* Update existing client (partial update) */
exports.update = async (clientId, patch) => {
  // Build dynamic SET clause
  const keys = Object.keys(patch);
  if (!keys.length) return null;

  const cols = keys.map((k, i) => `"${k}" = $${i + 2}`).join(', ');
  const values = keys.map((k) => patch[k]);

  const { rows: [client] } = await db.query(
    `UPDATE clients SET ${cols}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [clientId, ...values]
  );
  return client;
};

/* Delete client (cascade removes revenues) */
exports.remove = (clientId) =>
  db.query('DELETE FROM clients WHERE id = $1', [clientId]);

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
   // Build revenue object for 2023-2025
   const revenue = { '2023': 0, '2024': 0, '2025': 0 };
   if (Array.isArray(c.revenues)) {
     c.revenues.forEach((r) => {
       if (['2023', '2024', '2025'].includes(String(r.year))) {
         revenue[r.year] = parseFloat(r.revenue_amount) || 0;
       }
     });
   }

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
     revenue: client.revenues?.reduce((acc, r) => {
       acc[r.year] = parseFloat(r.revenue_amount) || 0;
       return acc;
     }, { '2023': 0, '2024': 0, '2025': 0 }),
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