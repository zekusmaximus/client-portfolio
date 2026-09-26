// src/utils/bookSheet.js: the book as an import sheet (Data Upload's
// "Download the book as a sheet"). Every column and vocabulary, text the
// request sanitizer stored escaped written unescaped, quoting, blank cells,
// the revenue years, a missing or inactive lead, and the sheet read back by
// the import's own parsing (processCSVData, checkSheet) into the stored
// values. tests/import-db.test.mjs imports it through server.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { buildBookSheet, revenueYearsOnFile, BOOK_SHEET_COLUMNS } from '../src/utils/bookSheet.js';
import csvImport from '../utils/csvImport.cjs';
import analyzer from '../clientAnalyzer.cjs';

const { findSheetColumns, checkSheet, indexStoredClients } = csvImport;
const { processCSVData } = analyzer;

const person = (id, name, role, active = true) => ({ id, name, role, active });
const KEVIN = person(4, 'Kevin', 'partner');
const PAULA = person(6, 'Paula', 'partner');
const JAY = person(7, 'Jay', 'emeritus');
const STEVE = person(8, 'Steve', 'partner', false);
const MARY = person(10, "Mary O'Brien", 'associate');
const OLD = person(11, 'Old Timer', 'associate', false);
const PEOPLE = [KEVIN, PAULA, JAY, STEVE, MARY, OLD];

// As GET /api/data/clients returns them: the stored columns, the nested people, the revenue rows
const client = (id, name, fields = {}) => ({
  id, name, lead_id: null, second_chair_id: null, originator_id: null, originator_is_firm: false,
  lead: null, secondChair: null, originator: null, stickiness: null, interaction_frequency: '',
  high_maintenance: false, conflict_risk: 'Medium', practice_area: [], notes: '', revenues: [],
  ...fields,
});
const seats = (lead, second = null, originator = null) => ({
  lead_id: lead?.id ?? null, lead,
  second_chair_id: second?.id ?? null, secondChair: second,
  originator_id: originator?.id ?? null, originator,
});

const BARNES = client('b1', 'Barnes &amp; Noble Education Fund', {
  ...seats(KEVIN, JAY, JAY), originator_is_firm: true, stickiness: 5, interaction_frequency: 'Weekly',
  conflict_risk: 'Low', practice_area: ['Healthcare', 'Education'],
  notes: 'O&#x27;Brien said &quot;renew&quot;, R&amp;amp;D\nsecond line',
  revenues: [{ year: 2024, revenue_amount: 60000 }, { year: 2026, revenue_amount: 72000.5 }],
});
const ENERGY = client('e1', 'Energy, Inc', {
  ...seats(PAULA), originator_is_firm: true, high_maintenance: true, conflict_risk: 'High',
  revenues: [{ year: 2025, revenue_amount: '40000.00' }, { year: 2023, revenue_amount: 0 }],
});
const OBRIEN = client('o1', 'O&#x27;Brien Trust', {
  ...seats(PAULA, MARY, STEVE), stickiness: 1, interaction_frequency: 'As-Needed',
  practice_area: ['Non-Profit', 'Real Estate'], notes: 'Formula-looking =SUM(A1)',
  revenues: [{ year: 2026, revenue_amount: 1 }],
});
const LEADLESS = client('l1', 'Leadless Client', { revenues: [{ year: 2026, revenue_amount: 5000 }] });
const OLD_LEAD = client('s1', 'Old Lead Client', { ...seats(STEVE, OLD), stickiness: 3 });
const BOOK = [OLD_LEAD, OBRIEN, LEADLESS, ENERGY, BARNES];

const parse = (csv) => Papa.parse(csv, { header: true, skipEmptyLines: true });

test('the header: CLIENT, every revenue year on file, then the plan\'s section 3 columns in order', () => {
  const sheet = buildBookSheet(BOOK, PEOPLE);
  assert.deepEqual(sheet.years, [2024, 2025, 2026], 'a year with only a $0 row (2023) is not on file');
  assert.equal(sheet.csv.split('\r\n')[0],
    'CLIENT,2024 Contracts,2025 Contracts,2026 Contracts,Lead,Second Chair,Originator,Credit To Firm,Stickiness,Cadence,Handful,Conflict Risk,Practice Area,Notes');

  const template = readFileSync(new URL('../public/client-book-template.csv', import.meta.url), 'utf8');
  const templateColumns = template.split(/\r?\n/)[0].split(',').filter((h) => h !== 'CLIENT' && !/Contracts$/.test(h));
  assert.deepEqual(BOOK_SHEET_COLUMNS, templateColumns, 'the template\'s columns, in its order');
  assert.deepEqual(findSheetColumns(BOOK_SHEET_COLUMNS).errors, []);

  assert.deepEqual(revenueYearsOnFile([]), []);
  assert.equal(buildBookSheet([], PEOPLE).csv, `CLIENT,${BOOK_SHEET_COLUMNS.join(',')}\r\n`);
});

test('each cell: people as the People list spells them, Firm and Y, the vocabularies, blanks', () => {
  const { data } = parse(buildBookSheet(BOOK, PEOPLE).csv);
  const row = Object.fromEntries(data.map((r) => [r.CLIENT, r]));
  assert.deepEqual(data.map((r) => r.CLIENT), ['Barnes & Noble Education Fund', 'Energy, Inc', 'Leadless Client', "O'Brien Trust", 'Old Lead Client'],
    'unescaped, and sorted by name as spelled');

  assert.deepEqual(row['Barnes & Noble Education Fund'], {
    CLIENT: 'Barnes & Noble Education Fund', '2024 Contracts': '60000', '2025 Contracts': '', '2026 Contracts': '72000.50',
    Lead: 'Kevin', 'Second Chair': 'Jay', Originator: 'Jay', 'Credit To Firm': 'Y', Stickiness: '5', Cadence: 'Weekly',
    Handful: '', 'Conflict Risk': 'Low', 'Practice Area': 'Healthcare;Education',
    Notes: 'O\'Brien said "renew", R&D\nsecond line',
  });
  assert.deepEqual(row['Energy, Inc'], {
    CLIENT: 'Energy, Inc', '2024 Contracts': '', '2025 Contracts': '40000', '2026 Contracts': '',
    Lead: 'Paula', 'Second Chair': '', Originator: 'Firm', 'Credit To Firm': 'Y', Stickiness: '', Cadence: '',
    Handful: 'Y', 'Conflict Risk': 'High', 'Practice Area': '', Notes: '',
  });
  assert.deepEqual(
    [row["O'Brien Trust"].Originator, row["O'Brien Trust"]['Credit To Firm'], row["O'Brien Trust"]['Practice Area'], row["O'Brien Trust"].Notes],
    ['Steve', '', 'Non-Profit;Real Estate', 'Formula-looking =SUM(A1)'],
    'an inactive originator is fine; no formula guard, so text round-trips',
  );

  // A renamed person: the People list's spelling wins over the client's nested copy
  const renamed = client('r1', 'Renamed', { ...seats({ ...KEVIN, name: 'Kev' }), revenues: [] });
  assert.equal(parse(buildBookSheet([renamed], PEOPLE).csv).data[0].Lead, 'Kevin');
});

test('quoting: a comma, a quote or a line break, and nothing else', () => {
  const lines = buildBookSheet(BOOK, PEOPLE).csv.split('\r\n');
  assert.ok(lines.some((l) => l.startsWith('"Energy, Inc",')));
  assert.ok(lines.some((l) => l.startsWith('Barnes & Noble Education Fund,') && l.endsWith(',"O\'Brien said ""renew"", R&D\nsecond line"')));
  assert.ok(lines.some((l) => l.startsWith("O'Brien Trust,")));
  assert.ok(!buildBookSheet(BOOK, PEOPLE).csv.startsWith('\uFEFF'), 'the text has no BOM; the download adds it');
  // The page's parse ignores the BOM the download adds
  assert.equal(parse(`\uFEFF${buildBookSheet(BOOK, PEOPLE).csv}`).meta.fields[0], 'CLIENT');
});

test('a missing or inactive lead, or an inactive second chair, is written as the book has it and listed', () => {
  const sheet = buildBookSheet(BOOK, PEOPLE);
  assert.deepEqual(sheet.attention, [
    { client: 'Leadless Client', reason: 'no lead' },
    { client: 'Old Lead Client', reason: 'lead Steve is not an active partner; second chair Old Timer is inactive' },
  ]);
  const row = Object.fromEntries(parse(sheet.csv).data.map((r) => [r.CLIENT, r]));
  assert.deepEqual([row['Leadless Client'].Lead, row['Old Lead Client'].Lead, row['Old Lead Client']['Second Chair']], ['', 'Steve', 'Old Timer']);
  assert.deepEqual(buildBookSheet([BARNES, ENERGY, OBRIEN], PEOPLE).attention, []);
});

test('read back by the import\'s own parsing, every cell gives the stored value, and only the listed rows are refused', () => {
  const sheet = buildBookSheet(BOOK, PEOPLE);
  const { data } = parse(sheet.csv);
  const headers = Object.keys(data[0]);
  const { columns, errors: headerErrors } = findSheetColumns(headers);
  assert.deepEqual(headerErrors, []);
  const parsed = processCSVData(data);
  const stored = indexStoredClients(BOOK);
  const check = checkSheet(parsed, { headerErrors, roster: PEOPLE, existingByName: stored.byName, sharedNames: stored.shared });

  // Only the two rows the page listed
  assert.deepEqual([...new Set(check.errors.map((e) => e.client))], ['Leadless Client', 'Old Lead Client']);
  assert.ok(check.errors.every((e) => e.row > 1), 'no header problem');

  for (const c of [BARNES, ENERGY, OBRIEN]) {
    const read = parsed.find((p) => stored.byName.get(p.name.toLowerCase()) === c);
    assert.ok(read, c.name);
    const expectedNotes = c === BARNES ? 'O\'Brien said "renew", R&D\nsecond line' : c.notes;
    assert.deepEqual(read.sheet.values, {
      stickiness: c.stickiness,
      interaction_frequency: c.interaction_frequency,
      high_maintenance: c.high_maintenance,
      conflict_risk: c.conflict_risk,
      practice_area: c.practice_area,
      notes: expectedNotes,
    }, c.name);
    assert.deepEqual(check.people.get(read.rowNumber).values, {
      lead_id: c.lead_id, second_chair_id: c.second_chair_id, originator_id: c.originator_id, originator_is_firm: c.originator_is_firm,
    }, c.name);
    const amounts = Object.fromEntries(sheet.years.map((y) => [y, (c.revenues.find((r) => Number(r.year) === y && parseFloat(r.revenue_amount) > 0) || { revenue_amount: 0 }).revenue_amount]));
    assert.deepEqual(read.revenue, Object.fromEntries(Object.entries(amounts).map(([y, a]) => [y, parseFloat(a)])), c.name);
  }
});
