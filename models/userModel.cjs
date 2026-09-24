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
exports.findWithPasswordById = async (id) => {
  const { rows } = await db.query(
    'SELECT id, username, password_hash FROM users WHERE id = $1',
    [id]
  );
  return rows[0];
};

// Returns the number of rows updated (0 or 1).
exports.updatePasswordHash = async (id, passwordHash) => {
  const { rowCount } = await db.query(
    'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [passwordHash, id]
  );
  return rowCount;
};
