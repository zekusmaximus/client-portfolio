// One name per client (docs/plans/tier-3.md, WP2, candidate (g)):
// utils/clientNames.cjs, the rule POST and PUT /api/data/clients apply before
// a client gets a name another client has, and the lock every client-name
// write takes. The name is compared as the import compares it, regardless of
// case and unescaped: the same key as indexStoredClients (utils/csvImport.cjs)
// and the repair's sharedNames (utils/unescapeBook.cjs). The routes' side,
// on PostgreSQL, is tests/routes.test.mjs.
// Pure: never import db.cjs, data.cjs, models/*, a route file or utils/jwt.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import clientNames from '../utils/clientNames.cjs';
import csvImport from '../utils/csvImport.cjs';
import escaping from '../utils/escaping.cjs';
import unescapeBook from '../utils/unescapeBook.cjs';

const {
  CLIENT_NAME_LOCK, CLIENT_NAME_LOCK_SQL, nameKey, givesNewName, SAME_NAME_SQL, sameNameParams, duplicateNameDetail,
} = clientNames;

test('the lock: one transaction-level advisory lock, one constant for every client-name write', () => {
  assert.ok(Number.isSafeInteger(CLIENT_NAME_LOCK) && CLIENT_NAME_LOCK > 0);
  // Held until the transaction ends, so a ROLLBACK or COMMIT releases it; a
  // session-level lock would outlive a failed request on a pooled connection
  assert.equal(CLIENT_NAME_LOCK_SQL, `SELECT pg_advisory_xact_lock(${CLIENT_NAME_LOCK})`);
});

test('nameKey: the import\'s key, unescaped and in lower case, the one indexStoredClients and the repair use', () => {
  const names = [
    'Acme', 'ACME', 'acme', 'Barnes & Noble Education Fund', 'Barnes &amp; Noble Education Fund',
    'Barnes &amp;amp; Noble Education Fund', "O'Brien Trust", 'O&#x27;Brien Trust', 'O&amp;#x27;Brien Trust',
    'Smith / Jones (Holdings), Inc.', 'R&D Partners',
  ];
  for (const name of names) {
    assert.equal(nameKey(name), escaping.unescapeStored(name).toLowerCase(), name);
    const { byName } = csvImport.indexStoredClients([{ id: 1, name }]);
    assert.deepEqual([...byName.keys()], [nameKey(name)], `indexStoredClients: ${name}`);
  }
  assert.equal(nameKey('Barnes &amp;amp; Noble Education Fund'), 'barnes & noble education fund');
  assert.equal(nameKey("O&amp;#x27;Brien Trust"), "o'brien trust");
  // The repair's list of names two clients share is the same rule
  const shared = unescapeBook.sharedNames([{ id: 1, name: 'Acme' }, { id: 2, name: 'ACME' }, { id: 3, name: 'Barnes &amp; Noble' }, { id: 4, name: 'Barnes & Noble' }]);
  assert.deepEqual(shared.map((s) => nameKey(s.name)), ['acme', 'barnes & noble']);
});

test('givesNewName: a new client, or a stored name with another key; a change of case or of escaping keeps the name', () => {
  assert.equal(givesNewName(undefined, 'Acme'), true, 'no client with that id: its name is new');
  assert.equal(givesNewName(null, 'Acme'), true);
  assert.equal(givesNewName('Acme', 'Acme'), false);
  assert.equal(givesNewName('Acme', 'ACME'), false, 'case alone');
  assert.equal(givesNewName('Barnes &amp; Noble', 'Barnes & Noble'), false, 'as stored before WP5, sent as typed');
  assert.equal(givesNewName('Acme', 'Acme Corp'), true);
  assert.equal(givesNewName('Acme Corp', 'Acme'), true);
});

test('SAME_NAME_SQL: the import\'s comparison, the client written left out by its id as text, never a cast id', () => {
  assert.ok(SAME_NAME_SQL.includes(`LOWER(${escaping.unescapeStoredSql('name')}) = $1`));
  assert.match(SAME_NAME_SQL, /id::text IS DISTINCT FROM \$2/);
  assert.doesNotMatch(SAME_NAME_SQL, /::(uuid|int|integer|bigint)\b/);
  assert.deepEqual(sameNameParams('Acme Corp'), ['acme corp', null], 'a new client');
  assert.deepEqual(sameNameParams('ACME Corp', null), ['acme corp', null]);
  assert.deepEqual(sameNameParams('Acme Corp', 42), ['acme corp', '42'], 'production\'s integer id, as text');
  assert.deepEqual(sameNameParams('Acme Corp', '0f8fad5b-d9cb-469f-a165-70867728950e'), ['acme corp', '0f8fad5b-d9cb-469f-a165-70867728950e']);
});

test('duplicateNameDetail: a detail on `name`, naming the other client as stored', () => {
  assert.deepEqual(duplicateNameDetail({ id: 7, name: 'Acme Corp' }), {
    field: 'name',
    message: 'Another client is already named "Acme Corp" (names are compared regardless of case). Give this client a different name.',
  });
});
