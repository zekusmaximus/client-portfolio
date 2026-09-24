#!/usr/bin/env node

/**
 * Reset a partner's password.
 *
 * Usage: node scripts/reset-password.cjs <username> <newPassword>
 *    or: npm run reset:password -- <username> <newPassword>
 *
 * Validates the new password with utils/passwordPolicy.cjs, hashes it with
 * utils/hash.cjs and updates the user by username through db.cjs
 * (DATABASE_URL, DATABASE_SSL). Prints "Updated 1 user" and exits 0, or
 * "No such user" and exits 1.
 *
 * Where to run it:
 * - Render: the web service's Shell tab, which already has the service's
 *   environment (DATABASE_URL, DATABASE_SSL).
 * - Locally against the Render database: set DATABASE_URL to the database's
 *   External Database URL and DATABASE_SSL=no-verify.
 *
 * Sessions the partner already has stay valid until they expire; rotating
 * JWT_SECRET signs everyone out.
 */

require('dotenv').config();
const { hash } = require('../utils/hash.cjs');
const { validatePassword } = require('../utils/passwordPolicy.cjs');

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error('Usage: node scripts/reset-password.cjs <username> <newPassword>');
    return 1;
  }
  const [username, newPassword] = args;

  const policy = validatePassword(newPassword);
  if (!policy.isValid) {
    console.error('Password rejected:');
    policy.errors.forEach((error) => console.error(`  - ${error}`));
    return 1;
  }

  // Required after the argument checks so a usage error does not need a database.
  const db = require('../db.cjs');
  try {
    const { rowCount } = await db.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE username = $2',
      [await hash(newPassword), username]
    );
    if (rowCount === 0) {
      console.error('No such user');
      return 1;
    }
    console.log(`Updated ${rowCount} user`);
    return 0;
  } finally {
    await db.pool.end();
  }
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error('Password reset failed:', error.message);
    process.exitCode = 1;
  });
