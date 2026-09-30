// One name per client (docs/plans/tier-3.md, WP2, candidate (g); U5).
//
// The import matches a sheet's CLIENT to a stored client by name, regardless
// of case and unescaped (utils/csvImport.cjs, indexStoredClients, and
// unescapeStoredSql in data.cjs), and refuses every row naming a name two
// stored clients share. Until WP2 the client form's POST, and a PUT that
// renamed a client, took a name another client had, so the next import
// refused that name's row. They now refuse it: a 400 detail on `name`, beside
// the form's name field. A PUT that keeps its client's name is not checked,
// so a pair already stored stays editable until a partner renames or deletes
// one of them.
//
// No unique index: init-db.sql runs at every start as one transaction, and a
// pair already stored would fail it and stop the production server
// (constraint 11). Instead every write that can give a client a name it did
// not have takes one transaction-level advisory lock before it reads any
// name: POST, PUT and the import (each takes it whether or not it turns out
// to change a name, since only the names it reads under the lock can say).
// Two such writes at once then run one after the other, and the second finds
// the first's name committed.
//
// Pure: no db.cjs import, so tests can load it. data.cjs runs the SQL.

const { unescapeStored, unescapeStoredSql } = require('./escaping.cjs');

// The advisory lock's key, one constant for every client-name write. Nothing
// else in this database takes an advisory lock. pg_advisory_xact_lock holds
// it until the transaction commits or rolls back.
const CLIENT_NAME_LOCK = 6247310;
const CLIENT_NAME_LOCK_SQL = `SELECT pg_advisory_xact_lock(${CLIENT_NAME_LOCK})`;

/** A client's name as the import matches it: unescaped (a guard for text stored before Tier 2 WP5) and in lower case. */
const nameKey = (name) => unescapeStored(String(name)).toLowerCase();

/**
 * Whether a write gives a client a name it did not have: a new client
 * (`storedName` null or undefined), or a stored name with another key. A
 * change of case alone, or of escaping, keeps the key, as the import reads it.
 */
const givesNewName = (storedName, name) => typeof storedName !== 'string' || nameKey(storedName) !== nameKey(name);

// Another client holding a name's key: $1 the key (nameKey), $2 the id of the
// client being written, as text, or null for a new one. The id is compared as
// text: production's ids are integers and init-db.sql's uuids.
const SAME_NAME_SQL = `
  SELECT id, name
    FROM clients
   WHERE LOWER(${unescapeStoredSql('name')}) = $1
     AND id::text IS DISTINCT FROM $2
   ORDER BY id::text
   LIMIT 1`;

/** SAME_NAME_SQL's values for `name` written to the client whose id is `clientId` (null for a new client). */
const sameNameParams = (name, clientId = null) => [nameKey(name), clientId === null || clientId === undefined ? null : String(clientId)];

/** The 400 detail for a name `other`, a stored client, already has. */
const duplicateNameDetail = (other) => ({
  field: 'name',
  message: `Another client is already named "${other.name}" (names are compared regardless of case). Give this client a different name.`,
});

module.exports = {
  CLIENT_NAME_LOCK,
  CLIENT_NAME_LOCK_SQL,
  nameKey,
  givesNewName,
  SAME_NAME_SQL,
  sameNameParams,
  duplicateNameDetail,
};
