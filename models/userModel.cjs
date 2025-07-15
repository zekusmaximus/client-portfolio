const db = require('../db.cjs');

exports.findByUsername = async (username) => {
  const { rows } = await db.query(
    'SELECT id, username, password_hash FROM users WHERE username = $1',
    [username]
  );
  return rows[0];
};