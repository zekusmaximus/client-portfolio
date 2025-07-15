const db = require('../db');

/* Add or update (upsert) a yearly revenue record */
exports.upsert = async (clientId, year, amount, endDate) => {
  const { rows: [rev] } = await db.query(
    `INSERT INTO client_revenues (client_id, year, revenue_amount, contract_end_date)
       VALUES ($1,$2,$3,$4)
     ON CONFLICT (client_id, year)
     DO UPDATE SET revenue_amount = EXCLUDED.revenue_amount,
                   contract_end_date = EXCLUDED.contract_end_date
     RETURNING *`,
    [clientId, year, amount, endDate]
  );
  return rev;
};

exports.update = async (revId, patch) => {
  const keys = Object.keys(patch);
  if (!keys.length) return null;
  const cols = keys.map((k, i) => `"${k}" = $${i + 2}`).join(', ');
  const values = keys.map((k) => patch[k]);

  const { rows: [rev] } = await db.query(
    `UPDATE client_revenues SET ${cols}
     WHERE id = $1
     RETURNING *`,
    [revId, ...values]
  );
  return rev;
};

exports.remove = (revId) =>
  db.query('DELETE FROM client_revenues WHERE id = $1', [revId]);