#!/usr/bin/env node

/**
 * Check that deleting a user cannot delete clients.
 *
 * Usage: node scripts/check-schema.cjs
 *    or: npm run check:schema
 *
 * Read-only. Prints every foreign key that references users with its ON DELETE
 * action (utils/schemaCheck.cjs) and how many clients each account created.
 * Then prints "OK: ..." and exits 0, or "FAIL: ..." and exits 1 when any key
 * cascades.
 *
 * Where to run it: as scripts/reset-password.cjs (the Render Shell, or locally
 * with DATABASE_URL set to the External Database URL and DATABASE_SSL=no-verify;
 * deploy/README.md section 7). The API applies init-db.sql when it starts, so
 * after a deploy this confirms the change reached the live database.
 */

require('dotenv').config();
const { USER_FOREIGN_KEYS_SQL, CLIENTS_BY_ACCOUNT_SQL, checkUserForeignKeys } = require('../utils/schemaCheck.cjs');

async function main() {
  const db = require('../db.cjs');
  try {
    const { rows: keys } = await db.query(USER_FOREIGN_KEYS_SQL);
    const { ok, lines } = checkUserForeignKeys(keys);
    lines.forEach((line) => console.log(line));

    const { rows: accounts } = await db.query(CLIENTS_BY_ACCOUNT_SQL);
    console.log('Clients by the account that created them:');
    accounts.forEach((a) => console.log(`  ${a.username ?? '(no account recorded)'}: ${a.clients}`));

    if (!ok) {
      console.log('FAIL: deleting a user deletes the clients it created, and their revenue rows. Do not delete users.');
      return 1;
    }
    console.log('OK: no foreign key to users cascades; deleting a user keeps every client.');
    return 0;
  } finally {
    await db.pool.end();
  }
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error('Schema check failed:', error.message);
    process.exitCode = 1;
  });
