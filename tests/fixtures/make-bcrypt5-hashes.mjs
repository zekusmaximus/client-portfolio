// Writes tests/fixtures/bcrypt5-hashes.json: made-up passwords (never a
// partner's) hashed by utils/hash.cjs, with what bcrypt.compare answered for
// each probe, on the bcrypt that is installed. It was run once, on bcrypt
// 5.1.1 at d2e49e7, before Tier 2 WP3's upgrade to bcrypt 6, because only
// hashes bcrypt 5 wrote prove that production's stored hashes still verify.
// Running it again on bcrypt 6 would record bcrypt 6's hashes, and
// tests/password-hash.test.mjs fails on a fixture not made by bcrypt 5.
//
//   node tests/fixtures/make-bcrypt5-hashes.mjs
//
// utils/hash.cjs reads BCRYPT_SALT_ROUNDS when it is loaded, so each cost is
// hashed in a child process of its own with that variable set.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const longAscii = (length) => 'Seventy-Two-Byte-Window-9!'.repeat(20).slice(0, length);
const OVER_72 = longAscii(100);
const OVER_255 = longAscii(300);
const BEFORE_72 = longAscii(71);

// Each entry: the password, the cost, and the strings compare() is asked
// about. The password itself is always the first probe.
const ENTRIES = [
  {
    label: 'ascii',
    cost: 12,
    plain: 'Tr1dent-Lantern-Ochre!',
    probes: [
      ['Tr1dent-Lantern-Ochre?', 'last character changed'],
      ['tr1dent-lantern-ochre!', 'lower case'],
      ['', 'empty'],
    ],
  },
  {
    label: 'ascii at a lower cost',
    cost: 10,
    plain: 'Low-Cost-Harbor-42?',
    probes: [['Low-Cost-Harbor-42', 'last character dropped']],
  },
  {
    label: 'UTF-8, two-byte characters',
    cost: 12,
    plain: 'Pässwörd-Ünïcødé-9!',
    probes: [
      ['Pässwörd-Ünïcødé-9!'.normalize('NFD'), 'the same text decomposed (NFD): other bytes'],
      ['Password-Unicode-9!', 'accents dropped'],
    ],
  },
  {
    label: 'UTF-8, three- and four-byte characters',
    cost: 12,
    plain: '密码-Kestrel-🔐-2026',
    probes: [['密码-Kestrel-🔒-2026', 'another emoji']],
  },
  {
    label: 'longer than 72 bytes',
    cost: 12,
    plain: OVER_72,
    probes: [
      [OVER_72.slice(0, 72), 'the first 72 bytes'],
      [OVER_72.slice(0, 71), 'the first 71 bytes'],
      [`${OVER_72.slice(0, 72)}anything after byte 72`, 'the first 72 bytes, then other text'],
      [`${OVER_72.slice(0, 71)}#${OVER_72.slice(72)}`, 'byte 72 changed'],
    ],
  },
  {
    label: 'a two-byte character across byte 72',
    cost: 12,
    plain: `${BEFORE_72}é-tail`,
    probes: [
      [`${BEFORE_72}é`, '71 bytes and the é'],
      [`${BEFORE_72}ê`, '71 bytes and ê, whose first byte (0xC3) is é\'s'],
      [`${BEFORE_72}a`, '71 bytes and a'],
      [BEFORE_72, 'the first 71 bytes'],
    ],
  },
  {
    label: 'longer than 255 bytes',
    cost: 12,
    plain: OVER_255,
    probes: [
      [OVER_255.slice(0, 72), 'the first 72 bytes'],
      [OVER_255.slice(0, 300 - 256), 'the first 44 bytes (300 - 256; bcrypt 5.0.0 fixed a wrap-around at 255 bytes and more)'],
    ],
  },
  {
    label: 'a NUL byte inside',
    cost: 12,
    plain: 'Before\u0000After-7!',
    probes: [
      ['Before', 'the text before the NUL (bcrypt 5.0.0 fixed a NUL bug)'],
      ['Before\u0000After-8!', 'last character after the NUL changed'],
    ],
  },
];

async function hashInChild() {
  const require = createRequire(HERE);
  const { hash, compare } = require('../../utils/hash.cjs');
  const entries = JSON.parse(readFileSync(0, 'utf8'));
  const out = [];
  for (const entry of entries) {
    const hashed = await hash(entry.plain);
    const probes = [];
    for (const [plain, note] of [[entry.plain, 'the password'], ...entry.probes]) {
      probes.push({ plain, note, verified: await compare(plain, hashed) });
    }
    out.push({ label: entry.label, cost: entry.cost, plain: entry.plain, hash: hashed, probes });
  }
  process.stdout.write(JSON.stringify(out));
}

function main() {
  const require = createRequire(HERE);
  const bcryptVersion = require('bcrypt/package.json').version;
  const hashed = new Map();
  for (const cost of [...new Set(ENTRIES.map((e) => e.cost))]) {
    const group = ENTRIES.filter((e) => e.cost === cost);
    const out = execFileSync(process.execPath, [HERE, '--child'], {
      input: JSON.stringify(group),
      env: { ...process.env, BCRYPT_SALT_ROUNDS: String(cost) },
      encoding: 'utf8',
    });
    for (const entry of JSON.parse(out)) hashed.set(entry.label, entry);
  }
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const fixture = {
    about: 'Made-up test passwords, never a partner\'s, hashed by utils/hash.cjs on bcrypt 5 before Tier 2 WP3 upgraded to bcrypt 6. "verified" is what bcrypt 5\'s compare() answered for each probe. Made by tests/fixtures/make-bcrypt5-hashes.mjs; read by tests/password-hash.test.mjs.',
    madeBy: {
      bcrypt: bcryptVersion,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      commit,
      date: new Date().toISOString().slice(0, 10),
    },
    hashes: ENTRIES.map((e) => hashed.get(e.label)),
  };
  writeFileSync(new URL('./bcrypt5-hashes.json', import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`bcrypt ${bcryptVersion}: ${fixture.hashes.length} hashes written`);
}

if (process.argv[2] === '--child') await hashInChild();
else main();
