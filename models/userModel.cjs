const db = require('../db.cjs');

exports.findByUsername = async (username) => {
  const { rows } = await db.query(
    'SELECT id, username, password_hash FROM users WHERE username = $1',
    [username]
  );
  return rows[0];
};

exports.findById = async (id) => {
  const { rows } = await db.query(
    'SELECT id, username FROM users WHERE id = $1',
    [id]
  );
  return rows[0];
};