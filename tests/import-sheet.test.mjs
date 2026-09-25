// The import sheet's people and judgment columns
// (docs/plans/people-and-second-chair.md, section 3 and P8): header matching,
// each column's vocabulary, name resolution against the People list, every
// refusal, blank cells clearing, and a file without the new columns reading
// exactly as before. Pure modules only; the database half is
// tests/import-db.test.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import csvImport from '../utils/csvImport.cjs';
import analyzer from '../clientAnalyzer.cjs';

const {
  findSheetColumns,
  readSheetRow,
  resolveSheetPeople,
  checkSheet,
  importWriteColumns,
  valuesList,
  CADENCES,
  PRACTICE_AREAS,
} = csvImport;
const { processCSVData } = analyzer;

// The seeded People list plus the cases the rules turn on
const BRENDAN = { id: 1, name: 'Brendan', role: 'partner', active: true };
const KEVIN = { id: 4, name: 'Kevin', role: 'partner', active: true };
const PAULA = { id: 6, name: 'Paula', role: 'partner', active: true };
const JAY = { id: 7, name: 'Jay', role: 'emeritus', active: true };
const STEVE = { id: 8, name: 'Steve', role: 'partner', active: false };
const ANNA = { id: 9, name: 'Anna', role: 'associate', active: true };
const MARY = { id: 10, name: "Mary O'Brien", role: 'associate', active: true };
const OLD = { id: 11, name: 'Old Timer', role: 'associate', active: false };
const ROSTER = [BRENDAN, KEVIN, PAULA, JAY, STEVE, ANNA, MARY, OLD];

const ALL_COLUMNS = findSheetColumns([
  'Lead', 'Second Chair', 'Originator', 'Credit To Firm', 'Stickiness', 'Cadence',
  'Handful', 'Conflict Risk', 'Practice Area', 'Notes',
]).columns;

// One row's judgment values for a single column
const judge = (header, value) => readSheetRow({ [header]: value }, findSheetColumns([header]).columns);

// resolveSheetPeople from a row of the four people columns (absent keys are absent columns)
const assign = (cells, existing = null) => resolveSheetPeople(
  { lead: '', ...cells },
  ROSTER,
  existing
);

describe('findSheetColumns', () => {
  test('matches case-insensitively, trimmed, with runs of spaces read as one', () => {
    const { columns, errors } = findSheetColumns([
      'CLIENT', 'Contract Period', '2026 Contracts', ' lead ', 'SECOND  CHAIR', 'originator',
      'credit to firm', 'Stickiness ', 'cadence', 'HANDFUL', 'Conflict risk', 'practice area', 'NOTES',
    ]);
    assert.deepEqual(errors, []);
    assert.deepEqual(columns, {
      lead: ' lead ',
      secondChair: 'SECOND  CHAIR',
      originator: 'originator',
      creditToFirm: 'credit to firm',
      stickiness: 'Stickiness ',
      cadence: 'cadence',
      handful: 'HANDFUL',
      conflictRisk: 'Conflict risk',
      practiceArea: 'practice area',
      notes: 'NOTES',
    });
  });

  test('a file without the sheet columns has none, and unknown headers are ignored', () => {
    assert.deepEqual(findSheetColumns(['CLIENT', 'Contract Period', '2025 Contracts', 'Lobbyist', 'Leads']), { columns: {}, errors: [] });
    assert.deepEqual(findSheetColumns(undefined), { columns: {}, errors: [] });
  });

  test('a column given twice refuses the file, in any spelling or as PapaParse renames it', () => {
    const differentCase = findSheetColumns(['Lead', 'lead']);
    assert.deepEqual(differentCase.errors, ['The header has 2 Lead columns ("Lead", "lead"); keep one.']);

    // PapaParse renames an exact repeat to `Stickiness_1`
    const renamed = findSheetColumns(['Stickiness', 'Stickiness_1']);
    assert.equal(renamed.columns.stickiness, 'Stickiness');
    assert.deepEqual(renamed.errors, ['The header has 2 Stickiness columns ("Stickiness", "Stickiness_1"); keep one.']);
  });

  test('Second Chair, Originator and Credit To Firm need a Lead column', () => {
    assert.deepEqual(findSheetColumns(['Second Chair', 'Originator', 'Credit To Firm']).errors, [
      'The file has Second Chair, Originator, Credit To Firm but no Lead column; add Lead, the lead partner for every client.',
    ]);
    assert.deepEqual(findSheetColumns(['Originator']).errors.length, 1);
    assert.deepEqual(findSheetColumns(['Lead', 'Originator']).errors, []);
    // the judgment columns stand alone
    assert.deepEqual(findSheetColumns(['Stickiness', 'Notes']).errors, []);
  });
});

describe('readSheetRow: vocabularies', () => {
  test('Stickiness: 1 to 5, blank is none; anything else refuses', () => {
    for (const v of ['1', '2', '3', '4', '5']) assert.deepEqual(judge('Stickiness', v), { values: { stickiness: Number(v) }, people: {}, errors: [] });
    assert.deepEqual(judge('Stickiness', '').values, { stickiness: null });
    assert.deepEqual(judge('Stickiness', undefined).values, { stickiness: null });
    for (const v of ['0', '6', '3.5', 'high', '10']) {
      const { values, errors } = judge('Stickiness', v);
      assert.deepEqual(values, {});
      assert.deepEqual(errors, [`Stickiness "${v}" must be a whole number from 1 to 5, or blank.`]);
    }
  });

  test('Cadence: the five cadences in any case, stored as spelled; blank clears', () => {
    assert.deepEqual(CADENCES, ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'As-Needed']);
    assert.deepEqual(judge('Cadence', 'weekly').values, { interaction_frequency: 'Weekly' });
    assert.deepEqual(judge('Cadence', 'AS-NEEDED').values, { interaction_frequency: 'As-Needed' });
    assert.deepEqual(judge('Cadence', '').values, { interaction_frequency: '' });
    assert.deepEqual(judge('Cadence', 'Biweekly').errors, [
      'Cadence "Biweekly" must be one of Daily, Weekly, Monthly, Quarterly, As-Needed, or blank.',
    ]);
    assert.equal(judge('Cadence', 'As Needed').errors.length, 1);
  });

  test('Handful: Y in any case, blank is off; anything else refuses', () => {
    assert.deepEqual(judge('Handful', 'Y').values, { high_maintenance: true });
    assert.deepEqual(judge('Handful', 'y').values, { high_maintenance: true });
    assert.deepEqual(judge('Handful', '').values, { high_maintenance: false });
    for (const v of ['N', 'Yes', '1', 'x']) {
      assert.deepEqual(judge('Handful', v).errors, [`Handful "${v}" must be Y or blank.`]);
    }
  });

  test('Conflict Risk: Low, Medium, High in any case; blank is back to Medium', () => {
    assert.deepEqual(judge('Conflict Risk', 'high').values, { conflict_risk: 'High' });
    assert.deepEqual(judge('Conflict Risk', 'Low').values, { conflict_risk: 'Low' });
    assert.deepEqual(judge('Conflict Risk', '').values, { conflict_risk: 'Medium' });
    assert.deepEqual(judge('Conflict Risk', 'Severe').errors, ['Conflict Risk "Severe" must be Low, Medium or High, or blank.']);
  });

  test('Practice Area: the list, separated by ;, any case and spacing, duplicates once; blank empties', () => {
    assert.equal(PRACTICE_AREAS.length, 12);
    assert.deepEqual(judge('Practice Area', 'Energy;Environmental').values, { practice_area: ['Energy', 'Environmental'] });
    assert.deepEqual(judge('Practice Area', ' energy ;  real   estate;;Energy; ').values, { practice_area: ['Energy', 'Real Estate'] });
    assert.deepEqual(judge('Practice Area', 'Non-Profit').values, { practice_area: ['Non-Profit'] });
    assert.deepEqual(judge('Practice Area', '').values, { practice_area: [] });

    const one = judge('Practice Area', 'Energy;Gaming');
    assert.deepEqual(one.values, {});
    assert.match(one.errors[0], /^Practice Area "Gaming" is not on the list: Healthcare, .*Other \(separate several with ;\)\.$/);
    assert.match(judge('Practice Area', 'Gaming, Energy;Sports').errors[0], /^Practice Area "Gaming, Energy", "Sports" are not on the list/);
  });

  test('Notes: free text kept as written, ends trimmed; blank empties', () => {
    assert.deepEqual(judge('Notes', '  Renewal talks  in spring ').values, { notes: 'Renewal talks  in spring' });
    assert.deepEqual(judge('Notes', '').values, { notes: '' });
  });

  test('only the columns the file has are read; people cells are passed on raw', () => {
    const row = { CLIENT: 'Acme', Lead: ' Kevin ', Stickiness: '9', Notes: 'x' };
    assert.deepEqual(readSheetRow(row, {}), { values: {}, people: {}, errors: [] });
    const { values, people, errors } = readSheetRow(row, findSheetColumns(Object.keys(row)).columns);
    assert.deepEqual(values, { notes: 'x' });
    assert.deepEqual(people, { lead: 'Kevin' });
    assert.equal(errors.length, 1);
  });
});

describe('resolveSheetPeople', () => {
  test('the section 3 example rows: names to ids, credit to the firm, and the legacy text', () => {
    const kevin = assign({ lead: 'Kevin', secondChair: 'Jay', originator: 'Jay', creditToFirm: 'Y' });
    assert.deepEqual(kevin.errors, []);
    assert.deepEqual(kevin.values, { lead_id: 4, second_chair_id: 7, originator_id: 7, originator_is_firm: true });
    assert.deepEqual(kevin.legacy, { primary_lobbyist: 'Kevin', lobbyist_team: ['Kevin', 'Jay'], client_originator: 'Firm' });

    const paula = assign({ lead: 'Paula', secondChair: '', originator: 'Paula', creditToFirm: '' });
    assert.deepEqual(paula.errors, []);
    assert.deepEqual(paula.values, { lead_id: 6, second_chair_id: null, originator_id: 6, originator_is_firm: false });
    assert.deepEqual(paula.legacy, { primary_lobbyist: 'Paula', lobbyist_team: ['Paula'], client_originator: 'Paula' });
  });

  test('names resolve regardless of case and spacing, apostrophes included', () => {
    const { values, errors } = assign({ lead: 'KEVIN', secondChair: "mary o'brien", originator: 'paula' });
    assert.deepEqual(errors, []);
    assert.deepEqual(values, { lead_id: 4, second_chair_id: 10, originator_id: 6, originator_is_firm: false });
  });

  test('Originator "Firm" in any case means no person and credit to the firm', () => {
    for (const firm of ['Firm', 'FIRM', 'firm']) {
      const { values, legacy, errors } = assign({ lead: 'Kevin', originator: firm, creditToFirm: '' });
      assert.deepEqual(errors, []);
      assert.equal(values.originator_id, null);
      assert.equal(values.originator_is_firm, true);
      assert.equal(legacy.client_originator, 'Firm');
    }
  });

  test('an inactive originator is accepted; so is credit to the firm with no originator', () => {
    const steve = assign({ lead: 'Kevin', originator: 'Steve', creditToFirm: 'Y' });
    assert.deepEqual(steve.errors, []);
    assert.equal(steve.values.originator_id, 8);
    assert.equal(steve.values.originator_is_firm, true);

    const firmOnly = assign({ lead: 'Kevin', originator: '', creditToFirm: 'y' });
    assert.deepEqual(firmOnly.values, { lead_id: 4, second_chair_id: null, originator_id: null, originator_is_firm: true });
  });

  test('refusals: every people error, with the column and the name', () => {
    const cases = [
      [{ lead: 'Jhon' }, 'Lead "Jhon" is not on the People list.'],
      [{ lead: '' }, 'Lead (blank): Choose a lead partner.'],
      [{ lead: 'Jay' }, 'Lead "Jay": The lead must be an active partner.'],
      [{ lead: 'Anna' }, 'Lead "Anna": The lead must be an active partner.'],
      [{ lead: 'Steve' }, 'Lead "Steve": The lead must be an active partner.'],
      [{ lead: 'Firm' }, 'Lead "Firm" is not on the People list.'],
      [{ lead: 'Kevin', secondChair: 'kevin' }, 'Second Chair "kevin": The second chair cannot be the lead.'],
      [{ lead: 'Kevin', secondChair: 'Old Timer' }, 'Second Chair "Old Timer": The second chair must be an active person on the People list.'],
      [{ lead: 'Kevin', secondChair: 'Nobody' }, 'Second Chair "Nobody" is not on the People list.'],
      [{ lead: 'Kevin', originator: 'Zed' }, 'Originator "Zed" is not on the People list.'],
      [{ lead: 'Kevin', creditToFirm: 'N' }, 'Credit To Firm "N" must be Y or blank.'],
    ];
    for (const [cells, message] of cases) {
      assert.deepEqual(assign(cells).errors, [message], JSON.stringify(cells));
    }
  });

  test('several problems on one row are all reported', () => {
    const { errors } = assign({ lead: 'Jay', secondChair: 'Nobody', originator: 'Zed', creditToFirm: 'maybe' });
    assert.deepEqual(errors, [
      'Second Chair "Nobody" is not on the People list.',
      'Originator "Zed" is not on the People list.',
      'Credit To Firm "maybe" must be Y or blank.',
      'Lead "Jay": The lead must be an active partner.',
    ]);
  });

  test('blank cells clear: no second chair, no originator, no credit', () => {
    const existing = { second_chair_id: 9, originator_id: 8, originator_is_firm: true };
    const { values, legacy } = assign({ lead: 'Kevin', secondChair: '', originator: '', creditToFirm: '' }, existing);
    assert.deepEqual(values, { lead_id: 4, second_chair_id: null, originator_id: null, originator_is_firm: false });
    assert.deepEqual(legacy, { primary_lobbyist: 'Kevin', lobbyist_team: ['Kevin'], client_originator: '' });
  });

  test('a column the file lacks keeps the stored value, and the kept value is checked too', () => {
    const existing = { second_chair_id: 9, originator_id: 8, originator_is_firm: true };
    const kept = assign({ lead: 'Paula' }, existing);
    assert.deepEqual(kept.errors, []);
    assert.deepEqual(kept.values, { lead_id: 6, second_chair_id: 9, originator_id: 8, originator_is_firm: true });
    assert.deepEqual(kept.legacy, { primary_lobbyist: 'Paula', lobbyist_team: ['Paula', 'Anna'], client_originator: 'Firm' });

    // The new lead is the client's stored second chair, and the file has no Second Chair column
    const clash = assign({ lead: 'Brendan' }, { second_chair_id: 1, originator_id: null, originator_is_firm: false });
    assert.deepEqual(clash.errors, [
      'Second Chair (Brendan, kept: the file has no Second Chair column): The second chair cannot be the lead.',
    ]);

    // A new client has nothing stored: absent columns mean none
    assert.deepEqual(assign({ lead: 'Paula' }, null).values, { lead_id: 6, second_chair_id: null, originator_id: null, originator_is_firm: false });
  });

  test('Credit To Firm absent: an Originator of Firm sets the credit, a person keeps the stored flag', () => {
    const stored = { second_chair_id: null, originator_id: 4, originator_is_firm: true };
    assert.equal(assign({ lead: 'Kevin', originator: 'Paula' }, stored).values.originator_is_firm, true);
    assert.equal(assign({ lead: 'Kevin', originator: 'Paula' }, { ...stored, originator_is_firm: false }).values.originator_is_firm, false);
    assert.equal(assign({ lead: 'Kevin', originator: 'Firm' }, { ...stored, originator_is_firm: false }).values.originator_is_firm, true);
  });

  test('no Lead column: the file assigns no people', () => {
    assert.equal(resolveSheetPeople({}, ROSTER, null), null);
  });
});

describe('processCSVData and checkSheet', () => {
  const file = (rows) => processCSVData(rows);

  test('a file without the new columns reads exactly as before', () => {
    const [client] = file([{ CLIENT: 'Acme Corp', 'Contract Period': '1/1/26-12/31/26', '2026 Contracts': '$100,000' }]);
    assert.deepEqual(client.practiceArea, []);
    assert.equal(client.conflictRisk, 'Medium');
    assert.equal(client.notes, '');
    assert.equal(client.relationshipStrength, 5);
    assert.equal(client.renewalProbability, 0.7);
    assert.equal(client.strategicFitScore, 5);
    for (const key of ['stickiness', 'interaction_frequency', 'high_maintenance', 'lead_id']) {
      assert.equal(key in client, false, key);
    }
    assert.deepEqual(client.sheet, { values: {}, people: {}, errors: [] });

    const { errors, people } = checkSheet([client], { roster: ROSTER });
    assert.deepEqual(errors, []);
    assert.equal(people.size, 0);
  });

  test('a file without the new columns writes exactly the columns it always has', () => {
    const base = importWriteColumns({}).map(([column]) => column);
    assert.deepEqual(base, [
      'name', 'status', 'practice_area', 'relationship_strength', 'conflict_risk',
      'renewal_probability', 'strategic_fit_score', 'notes', 'primary_lobbyist',
      'client_originator', 'lobbyist_team', 'interaction_frequency', 'relationship_intensity',
    ]);
    // Stickiness, Handful and the people columns are written only when the file has them
    assert.deepEqual(importWriteColumns(ALL_COLUMNS).map(([column]) => column).slice(base.length), [
      'stickiness', 'high_maintenance', 'lead_id', 'second_chair_id', 'originator_id', 'originator_is_firm',
    ]);
    assert.deepEqual(importWriteColumns(findSheetColumns(['Notes', 'Cadence']).columns).length, base.length);
  });

  test('valuesList: one typed placeholder per cell, rows in order', () => {
    const { sql, params } = valuesList(
      [{ id: 'a', lead_id: null }, { id: 'b', lead_id: 4 }],
      [['id', 'uuid'], ['lead_id', 'int']]
    );
    assert.equal(sql, '($1::uuid, $2::int), ($3::uuid, $4::int)');
    assert.deepEqual(params, ['a', null, 'b', 4]);
  });

  test('row numbers count the header as row 1; the file values replace the defaults', () => {
    const clients = file([
      { CLIENT: 'Acme', 'Contract Period': '1/1/26-12/31/26', Stickiness: '4', Cadence: 'daily', Handful: 'Y', 'Conflict Risk': 'High', 'Practice Area': 'Energy', Notes: 'n' },
      { CLIENT: '', 'Contract Period': '', Stickiness: '', Cadence: '', Handful: '', 'Conflict Risk': '', 'Practice Area': '', Notes: '' },
      { CLIENT: 'Beta', 'Contract Period': '1/1/26-12/31/26', Stickiness: '', Cadence: '', Handful: '', 'Conflict Risk': '', 'Practice Area': '', Notes: '' },
    ]);
    assert.deepEqual(clients.map((c) => c.rowNumber), [2, 4]);
    const [acme, beta] = clients;
    assert.equal(acme.stickiness, 4);
    assert.equal(acme.interaction_frequency, 'Daily');
    assert.equal(acme.high_maintenance, true);
    assert.equal(acme.conflictRisk, 'High');
    assert.deepEqual(acme.practiceArea, ['Energy']);
    assert.equal(acme.notes, 'n');
    // blank cells in columns the file has: cleared
    assert.equal(beta.stickiness, null);
    assert.equal(beta.interaction_frequency, '');
    assert.equal(beta.high_maintenance, false);
    assert.equal(beta.conflictRisk, 'Medium');
    assert.deepEqual(beta.sheet.values, {
      stickiness: null, interaction_frequency: '', high_maintenance: false,
      conflict_risk: 'Medium', practice_area: [], notes: '',
    });
  });

  test('refusal: a bad lead, a bad Stickiness and a client named twice are all listed by row', () => {
    const rows = [
      { CLIENT: 'Acme', 'Contract Period': '1/1/26-12/31/26', Lead: 'Kevin', Stickiness: '3' },
      { CLIENT: 'Beta', 'Contract Period': '1/1/26-12/31/26', Lead: 'Jhon', Stickiness: '3' },
      { CLIENT: 'Gamma', 'Contract Period': '1/1/26-12/31/26', Lead: 'Paula', Stickiness: '7' },
      { CLIENT: 'ACME', 'Contract Period': '1/1/26-12/31/26', Lead: 'Paula', Stickiness: '2' },
    ];
    const { errors } = checkSheet(file(rows), { roster: ROSTER });
    assert.deepEqual(errors, [
      { row: 3, client: 'Beta', message: 'Lead "Jhon" is not on the People list.' },
      { row: 4, client: 'Gamma', message: 'Stickiness "7" must be a whole number from 1 to 5, or blank.' },
      { row: 5, client: 'ACME', message: '"ACME" is also on row 2; each client may appear once in the file.' },
    ]);
  });

  test('a client named twice refuses a file without the new columns too', () => {
    const rows = [
      { CLIENT: 'Acme', 'Contract Period': '1/1/26-12/31/26', '2026 Contracts': '1' },
      { CLIENT: 'Acme', 'Contract Period': '1/1/26-12/31/26', '2026 Contracts': '2' },
    ];
    assert.deepEqual(checkSheet(file(rows)).errors, [
      { row: 3, client: 'Acme', message: '"Acme" is also on row 2; each client may appear once in the file.' },
    ]);
  });

  test('header problems come first, as row 1', () => {
    const rows = [{ CLIENT: 'Acme', 'Contract Period': '1/1/26-12/31/26', 'Second Chair': 'Anna', Stickiness: 'x' }];
    const headerErrors = findSheetColumns(Object.keys(rows[0])).errors;
    const { errors } = checkSheet(file(rows), { headerErrors, roster: ROSTER });
    assert.deepEqual(errors.map((e) => [e.row, e.client]), [[1, ''], [2, 'Acme']]);
    assert.match(errors[0].message, /no Lead column/);
  });

  test('people are checked against the stored client for the columns the file lacks', () => {
    const rows = [{ CLIENT: 'Acme', 'Contract Period': '1/1/26-12/31/26', Lead: 'Brendan' }];
    const existingByName = new Map([['acme', { second_chair_id: 1, originator_id: null, originator_is_firm: false }]]);
    const { errors, people } = checkSheet(file(rows), { roster: ROSTER, existingByName });
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /^Second Chair \(Brendan, kept/);
    assert.equal(people.get(2).values.lead_id, 1);
  });

  test('the template and the plan\'s section 3 example import cleanly', () => {
    const template = readFileSync(new URL('../public/client-book-template.csv', import.meta.url), 'utf8');
    const plan = readFileSync(new URL('../docs/plans/people-and-second-chair.md', import.meta.url), 'utf8');
    const example = plan.match(/```csv\n([\s\S]*?)```/)[1];
    assert.equal(template, example, 'public/client-book-template.csv matches the plan\'s section 3 example');

    // As the page parses it
    const { data } = Papa.parse(template, { header: true, skipEmptyLines: true });
    const headerErrors = findSheetColumns(Object.keys(data[0])).errors;
    assert.deepEqual(headerErrors, []);
    const clients = file(data);
    const { errors, people } = checkSheet(clients, { headerErrors, roster: ROSTER });
    assert.deepEqual(errors, []);

    const [health, energy] = clients;
    assert.deepEqual(health.revenue, { 2024: 60000, 2025: 66000, 2026: 72000 });
    assert.deepEqual(health.sheet.values, {
      stickiness: 5, interaction_frequency: 'Weekly', high_maintenance: false,
      conflict_risk: 'Low', practice_area: ['Healthcare'], notes: '',
    });
    assert.deepEqual(people.get(2).values, { lead_id: 4, second_chair_id: 7, originator_id: 7, originator_is_firm: true });

    assert.deepEqual(energy.revenue, { 2024: 0, 2025: 40000, 2026: 85000 });
    assert.deepEqual(energy.sheet.values, {
      stickiness: 3, interaction_frequency: 'Monthly', high_maintenance: true,
      conflict_risk: 'Medium', practice_area: ['Energy', 'Environmental'], notes: 'Renewal talks in spring',
    });
    assert.deepEqual(people.get(3).values, { lead_id: 6, second_chair_id: null, originator_id: 6, originator_is_firm: false });
  });
});
