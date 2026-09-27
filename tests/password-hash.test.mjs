// utils/hash.cjs on bcrypt 6 (Tier 2 WP3, S6). Every password hash in
// production was written by bcrypt 5.1.1 through this module (create-admin,
// reset-password, change-password; cost 12). tests/fixtures/bcrypt5-hashes.json
// holds made-up passwords hashed the same way before the upgrade, with what
// bcrypt 5's compare() answered for each probe; the bcrypt installed now must
// verify every hash and answer every probe the same. These tests pass on
// bcrypt 5 too, by construction: they are what the upgrade must not change.
// Only the version test tells the two apart. Pure: utils/hash.cjs requires
// only bcrypt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// utils/hash.cjs reads BCRYPT_SALT_ROUNDS when it is loaded: clear it first, so
// the default cost (12) is the one tested.
delete process.env.BCRYPT_SALT_ROUNDS;
const { hash, compare } = (await import('../utils/hash.cjs')).default;

const fixture = JSON.parse(readFileSync(new URL('./fixtures/bcrypt5-hashes.json', import.meta.url), 'utf8'));
const byLabel = new Map(fixture.hashes.map((entry) => [entry.label, entry]));
const probe = (label, note) => byLabel.get(label).probes.find((p) => p.note === note);

// The bcrypt package utils/hash.cjs loads, found from that file as Node does.
function bcryptPackage() {
  const fromHash = createRequire(new URL('../utils/hash.cjs', import.meta.url));
  let dir = dirname(fromHash.resolve('bcrypt'));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (pkg.name === 'bcrypt') return pkg;
    } catch {
      // no package.json here; look one level up
    }
    const up = dirname(dir);
    if (up === dir) throw new Error('bcrypt package.json not found');
    dir = up;
  }
}

const BCRYPT_ALPHABET = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const changeCharAt = (text, index) => {
  const next = BCRYPT_ALPHABET[(BCRYPT_ALPHABET.indexOf(text[index]) + 1) % BCRYPT_ALPHABET.length];
  return text.slice(0, index) + next + text.slice(index + 1);
};

test('the fixture was made by bcrypt 5 through utils/hash.cjs, in production\'s format', () => {
  assert.equal(fixture.madeBy.bcrypt.split('.')[0], '5', 'regenerating the fixture on bcrypt 6 would prove nothing');
  assert.ok(fixture.hashes.length >= 5);
  for (const entry of fixture.hashes) {
    assert.match(entry.hash, new RegExp(`^\\$2b\\$${String(entry.cost).padStart(2, '0')}\\$[./A-Za-z0-9]{53}$`), entry.label);
  }
  assert.ok(fixture.hashes.filter((e) => e.cost === 12).length >= 4, 'most at the default cost');
  assert.ok(fixture.hashes.some((e) => e.cost < 12), 'one at a lower cost');
  assert.ok(fixture.hashes.some((e) => /[^\x00-\x7f]/.test(e.plain)), 'a non-ASCII password');
  assert.ok(fixture.hashes.some((e) => Buffer.byteLength(e.plain) > 72), 'one longer than 72 bytes');
});

test('every bcrypt 5 hash verifies with its password', async () => {
  const results = await Promise.all(fixture.hashes.map((e) => compare(e.plain, e.hash)));
  assert.deepEqual(results, fixture.hashes.map(() => true));
});

for (const entry of fixture.hashes) {
  test(`every probe answers as bcrypt 5 did: ${entry.label}`, async () => {
    const answered = await Promise.all(entry.probes.map((p) => compare(p.plain, entry.hash)));
    assert.deepEqual(
      entry.probes.map((p, i) => ({ note: p.note, verified: answered[i] })),
      entry.probes.map((p) => ({ note: p.note, verified: p.verified })),
    );
  });
}

test('a wrong password does not verify', async () => {
  const short = fixture.hashes.filter((e) => Buffer.byteLength(e.plain) < 72);
  assert.ok(short.length >= 4);
  const lastChanged = (plain) => plain.slice(0, -1) + (plain.endsWith('#') ? '%' : '#');
  const answered = await Promise.all(short.flatMap((e, i) => [
    compare(lastChanged(e.plain), e.hash),
    compare(`${e.plain}#`, e.hash),
    compare(short[(i + 1) % short.length].plain, e.hash),
  ]));
  assert.deepEqual(answered, answered.map(() => false));
});

test('a changed hash does not verify', async () => {
  const changes = fixture.hashes.flatMap((e) => [
    changeCharAt(e.hash, 10), // salt
    changeCharAt(e.hash, 40), // checksum
    e.hash.slice(0, 4) + String(e.cost - 1).padStart(2, '0') + e.hash.slice(6), // cost
  ].map((changed) => ({ entry: e, changed })));
  for (const { entry, changed } of changes) assert.notEqual(changed, entry.hash);
  const answered = await Promise.all(changes.map(({ entry, changed }) => compare(entry.plain, changed)));
  assert.deepEqual(answered, answered.map(() => false));
});

test('a password over 72 bytes is read as its first 72 bytes, as under bcrypt 5', async () => {
  const long = byLabel.get('longer than 72 bytes');
  const bytes = Buffer.from(long.plain);
  assert.ok(bytes.length > 72);
  const first72 = bytes.subarray(0, 72).toString();
  assert.equal(await compare(first72, long.hash), true);
  assert.equal(await compare(`${first72}and other text`, long.hash), true);
  assert.equal(await compare(bytes.subarray(0, 71).toString(), long.hash), false);
  // bcrypt 5 answered the same (the fixture's probes)
  assert.equal(probe('longer than 72 bytes', 'the first 72 bytes').verified, true);
  assert.equal(probe('longer than 72 bytes', 'the first 71 bytes').verified, false);
  assert.equal(probe('longer than 72 bytes', 'byte 72 changed').verified, false);
  // byte 72 is the first byte of a two-byte character: only that byte counts
  assert.equal(probe('a two-byte character across byte 72', '71 bytes and ê, whose first byte (0xC3) is é\'s').verified, true);
  assert.equal(probe('a two-byte character across byte 72', 'the first 71 bytes').verified, false);
  // over 255 bytes: still the first 72
  assert.equal(probe('longer than 255 bytes', 'the first 72 bytes').verified, true);
});

test('a new hash starts with $2b$12$ by default and verifies', async () => {
  const plain = 'New-Hash-Default-Cost-6!';
  const hashed = await hash(plain);
  assert.match(hashed, /^\$2b\$12\$[./A-Za-z0-9]{53}$/);
  assert.equal(await compare(plain, hashed), true);
  assert.equal(await compare(`${plain}?`, hashed), false);
  assert.notEqual(await hash(plain), hashed, 'a new salt each time');
});

test('the installed bcrypt is major 6, without node-pre-gyp', () => {
  const pkg = bcryptPackage();
  assert.equal(pkg.version.split('.')[0], '6', `bcrypt ${pkg.version}`);
  assert.equal(Object.hasOwn(pkg.dependencies || {}, '@mapbox/node-pre-gyp'), false);
});
