const fs = require('fs');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable not set');
}

// TLS to Postgres, from DATABASE_SSL (independent of NODE_ENV):
//   unset / 'false'  no TLS (Postgres on the same host or private network)
//   'no-verify'      TLS without certificate verification (Render today)
//   'verify'         TLS with verification; DATABASE_SSL_CA names a CA file
//                    when the server's certificate is not publicly trusted
// An `sslmode` parameter in DATABASE_URL overrides this (pg reads it last).
function sslConfig(mode = process.env.DATABASE_SSL) {
  switch ((mode || 'false').trim().toLowerCase()) {
    case 'false':
      return false;
    case 'no-verify':
      return { rejectUnauthorized: false };
    case 'verify':
      return {
        rejectUnauthorized: true,
        ca: process.env.DATABASE_SSL_CA ? fs.readFileSync(process.env.DATABASE_SSL_CA, 'utf8') : undefined,
      };
    default:
      throw new Error(`DATABASE_SSL must be false, no-verify or verify (got ${JSON.stringify(mode)})`);
  }
}

const pool = new Pool({
  connectionString,
  ssl: sslConfig(),
});

// An idle client that loses its connection (Postgres restart, failover,
// pg_terminate_backend) emits 'error' here. The pool has already discarded it
// and opens a new connection for the next query, so log and carry on; exiting
// would take the whole server down for one dropped connection.
pool.on('error', (err) => {
  console.error(JSON.stringify({ event: 'pg_pool_error', code: err.code, message: err.message }));
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
