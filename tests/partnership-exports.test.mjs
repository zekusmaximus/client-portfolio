// The Partnership tab's exports (docs/plans/people-and-second-chair.md,
// Phase 4): the report and the load CSV are built from partnershipModel, read
// the API's field names (strategicValue, not strategic_value), and escape
// what they print.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partnershipModel } from '../src/utils/load.js';
import { revenueForYear } from '../src/utils/revenue.js';
import {
  buildLoadCsv,
  buildPartnershipReportHtml,
  csvCell,
  escapeHtml,
} from '../src/utils/partnershipExports.js';

const person = (id, name, role, active = true) => ({ id, name, role, active });
const kevin = person(1, 'Kevin', 'partner');
const paula = person(2, 'Paula', 'partner');
const jay = person(3, 'Jay', 'emeritus');
const anna = person(4, "Anna O'Hara", 'associate');
const PEOPLE = [kevin, paula, jay, anna];

const client = (id, name, lead, secondChair, amount, extra = {}) => ({
  id, name, lead, secondChair, effort: 3, strategicValue: 7.25,
  practiceArea: ['Healthcare'],
  revenues: [{ year: 2026, revenue_amount: String(amount) }],
  ...extra,
});
const CLIENTS = [
  client(1, 'Health <Network> & Co', kevin, jay, 72000),
  client(2, 'Energy, "Coalition"', paula, anna, 85000, { effort: 4.5 }),
  client(3, '=Formula Inc', kevin, null, 10000),
];
const revenueOf = (c) => revenueForYear(c, 2026);
const model = partnershipModel(PEOPLE, CLIENTS, revenueOf);

test('the load CSV: one row per person, the year in the headers, ratios against the role average', () => {
  const lines = buildLoadCsv(model, 2026).split('\r\n');
  assert.equal(lines[0],
    'Person,Role,Active,Lead clients,Lead clients vs partner avg,Lead revenue 2026,Lead revenue vs partner avg,Lead effort,Lead effort vs partner avg,Second-chair clients,Second-chair clients vs role avg,Second-chair revenue 2026,Second-chair revenue vs role avg,Second-chair effort (20% share),Second-chair effort vs role avg');
  const rows = Object.fromEntries(lines.slice(1).map((line) => [line.split(',')[0], line]));
  assert.deepEqual(Object.keys(rows), ['Paula', 'Kevin', 'Jay', "Anna O'Hara"], 'lead books first, heaviest revenue first');
  // The partners average 1.5 clients, $83,500 and 5.25 effort; no partner is a
  // second chair, so their second-chair average is 0 and those ratios are blank
  assert.equal(rows.Kevin, 'Kevin,Partner,Y,2,1.33,82000,0.98,6,1.14,0,,0,,0,');
  assert.equal(rows.Paula, 'Paula,Partner,Y,1,0.67,85000,1.02,4.5,0.86,0,,0,,0,');
  // Neither the only emeritus nor the only associate can lead or has a peer:
  // blank ratios. A second chair carries 20% of the client's effort (P10 as
  // amended): Jay 20% of 3, Anna 20% of 4.5
  assert.equal(rows.Jay, 'Jay,Emeritus,Y,0,,0,,0,,1,,72000,,0.6,');
  assert.equal(rows["Anna O'Hara"], "Anna O'Hara,Associate,Y,0,,0,,0,,1,,85000,,0.9,");
});

test('csvCell: quotes, formulas and empty values', () => {
  assert.equal(csvCell('Energy, "Coalition"'), '"Energy, ""Coalition"""');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-Foo'), "'-Foo");
  assert.equal(csvCell(-5), '-5', 'a number is never prefixed');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(NaN), '');
});

test('the report: summary, lead books, second chairs by role, each person\'s clients, escaped', () => {
  const html = buildPartnershipReportHtml(model, 2026, revenueOf, new Date('2026-09-25T12:00:00Z'));
  assert.match(html, /<title>Who's carrying what: September 25, 2026<\/title>/);
  assert.match(html, /<tr><th>Clients<\/th><td>3<\/td><\/tr>/);
  assert.match(html, /<tr><th>Revenue 2026<\/th><td>\$167,000<\/td><\/tr>/);
  assert.match(html, /<tr><th>Clients without a second chair<\/th><td>1<\/td><\/tr>/);
  assert.doesNotMatch(html, /Clients without a lead/, 'shown only when some client has no lead');
  assert.match(html, /<h2>Lead books \(partners\)<\/h2>/);
  assert.match(html, /<h3>Emeritus<\/h3>/);
  assert.match(html, /<h3>Associates<\/h3>/);
  // The API's strategicValue, not the retired strategic_value that printed N/A
  assert.match(html, /<td>7\.3<\/td>/);
  assert.doesNotMatch(html, /N\/A/);
  // Escaped
  assert.match(html, /Health &lt;Network&gt; &amp; Co/);
  assert.match(html, /Energy, &quot;Coalition&quot;/);
  assert.match(html, /Anna O&#39;Hara/);
  assert.doesNotMatch(html, /<Network>/);
  // No invented numbers
  assert.doesNotMatch(html, /[Cc]apacity/);
  // The second-chair share (P10 as amended): the note, and each seat's effort column
  assert.match(html, /A client's lead carries its full effort and its second chair 20% of it/);
  assert.doesNotMatch(html, /counts in full for both its lead and its second chair/);
  const jay = html.slice(html.indexOf('<h3>Jay '), html.indexOf('<h3>Anna'));
  assert.match(jay, /<h4>Second chair on 1<\/h4>/);
  assert.match(jay, /<th>Effort \(20%\)<\/th>/);
  assert.match(jay, /<td>0\.6<\/td>/, "Jay's share of the client's effort of 3");
  const kevin = html.slice(html.indexOf('<h3>Kevin '), html.indexOf('<h3>Jay '));
  assert.match(kevin, /<td>3<\/td>/, 'the lead carries the full effort');
});

test('escapeHtml needs no DOM', () => {
  assert.equal(escapeHtml(`<a href="x">O'Brien & co</a>`), '&lt;a href=&quot;x&quot;&gt;O&#39;Brien &amp; co&lt;/a&gt;');
  assert.equal(escapeHtml(undefined), '');
});
