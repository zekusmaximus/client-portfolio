// utils/clientRules.cjs (docs/plans/tier-2.md, S7, WP4): the rules POST and
// PUT /api/data/clients apply, the vocabularies the import reads from the same
// module, the page's copy of the lists and the name pattern
// (src/utils/validation.js) held equal to them, and the page's own save path
// (src/utils/clientForm.js) passing them, both as sanitizeRequestBody leaves a
// body today and as the partner typed it, which is what the server receives
// once WP5 removes the sanitizer.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import validator from 'validator';
import rules from '../utils/clientRules.cjs';
import csvImport from '../utils/csvImport.cjs';
import strategic from '../utils/strategic.cjs';
import middleware from '../middleware/validation.cjs';
import { VALIDATION_RULES, validateClientForm, validateField, validateRevenueEntry, sanitizeFormData } from '../src/utils/validation.js';
import { clientFormData, clientRequestBody, revenuesToSend, formErrors, SEE_ABOVE } from '../src/utils/clientForm.js';
import { toPersonId } from '../src/utils/people.js';

const {
  PRACTICE_AREAS, CADENCES, CONFLICT_RISKS, STICKINESS, NAME_MAX, NAME_PATTERN, NAME_MESSAGES,
  REVENUE_AMOUNT_MAX, isObjectBody, isRevenueYear, checkClient,
} = rules;

// A body as sanitizeRequestBody hands it to the route: every string trimmed and escaped
const sanitized = (body) => {
  const req = { body: structuredClone(body) };
  middleware.sanitizeRequestBody(req, {}, () => {});
  return req.body;
};

// A body the rules accept, as the client form sends one
const VALID = {
  name: "Smith & O'Brien / Partners",
  practice_area: ['Healthcare', 'Real Estate'],
  conflict_risk: 'Low',
  notes: 'R&D < 5% of "budget"',
  lead_id: 3,
  second_chair_id: null,
  originator_id: null,
  originator_is_firm: false,
  interaction_frequency: 'Weekly',
  stickiness: 4,
  high_maintenance: false,
  revenues: [{ year: 2025, revenue_amount: 50000 }, { year: 2026, revenue_amount: 60000.5 }],
};
const detailsFor = (overrides) => checkClient({ ...VALID, ...overrides });
// The details as the route answers them today (sanitized) and once WP5 lands (as typed): the same
const bothWays = (body) => {
  const typed = checkClient(body);
  assert.deepEqual(checkClient(sanitized(body)), typed, `sanitized and typed agree: ${JSON.stringify(body)}`);
  return typed;
};

// Deterministic pseudo-random numbers (mulberry32), so a failure reproduces
function random(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the vocabularies', () => {
  test('the twelve practice areas, the scorer\'s cadences, three conflict risks and stickiness 1 to 5', () => {
    assert.deepEqual(PRACTICE_AREAS, [
      'Healthcare', 'Municipal', 'Corporate', 'Energy', 'Financial', 'Education',
      'Transportation', 'Environmental', 'Technology', 'Real Estate', 'Non-Profit', 'Other',
    ]);
    assert.deepEqual(CADENCES, Object.keys(strategic.EFFORT_BY_CADENCE));
    assert.deepEqual(CADENCES, ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'As-Needed']);
    assert.deepEqual(CONFLICT_RISKS, ['Low', 'Medium', 'High']);
    assert.deepEqual(STICKINESS, [1, 2, 3, 4, 5]);
  });

  test('the import reads the same lists: one copy on the server', () => {
    assert.equal(csvImport.PRACTICE_AREAS, PRACTICE_AREAS);
    assert.equal(csvImport.CADENCES, CADENCES);
    assert.equal(csvImport.CONFLICT_RISKS, CONFLICT_RISKS);
  });

  test('a revenue year is one the import reads as a `YYYY Contracts` column, and only a whole number', () => {
    for (let year = 1800; year <= 2200; year++) {
      assert.equal(isRevenueYear(year), csvImport.revenueYearOfHeader(`${year} Contracts`) === year, String(year));
    }
    assert.deepEqual([isRevenueYear(1900), isRevenueYear(2099), isRevenueYear(1899), isRevenueYear(2100)], [true, true, false, false]);
    for (const other of ['2026', 2026.5, null, undefined, NaN, Infinity, true, [2026], -2026, 2026e20]) {
      assert.equal(isRevenueYear(other), false, String(other));
    }
  });
});

describe('the page\'s copy (src/utils/validation.js) equals the server\'s', () => {
  test('the practice areas, conflict risks and cadences the form allows', () => {
    assert.deepEqual(VALIDATION_RULES.practiceArea.allowedValues, PRACTICE_AREAS);
    assert.deepEqual(VALIDATION_RULES.conflict_risk.allowedValues, CONFLICT_RISKS);
    assert.deepEqual(VALIDATION_RULES.interaction_frequency.allowedValues, CADENCES);
  });

  test('the name\'s pattern, length and messages', () => {
    const page = VALIDATION_RULES.name;
    assert.deepEqual([page.pattern.source, page.pattern.flags], [NAME_PATTERN.source, NAME_PATTERN.flags]);
    assert.equal(page.maxLength, NAME_MAX);
    assert.deepEqual(
      { required: page.errorMessages.required, maxLength: page.errorMessages.maxLength, pattern: page.errorMessages.pattern },
      NAME_MESSAGES
    );
  });

  test('a name the form accepts, the server accepts, sent as typed or as the sanitizer leaves it; and the reverse but for text that is itself an escape', () => {
    const next = random(20260927);
    const alphabet = "abcXYZ019 -.,&'()/;#<>\"@é\t";
    for (let i = 0; i < 3000; i++) {
      const typed = Array.from({ length: 1 + Math.floor(next() * 40) }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
      const page = validateField('name', typed) === null;
      for (const sent of [typed, validator.escape(typed.trim())]) {
        const server = !detailsFor({ name: sent }).some((d) => d.field === 'name');
        if (page) assert.ok(server, `the form accepts ${JSON.stringify(typed)}; the server refuses ${JSON.stringify(sent)}`);
        // The server reads the name through unescapeStored, which also undoes
        // an entity the partner typed; the form's pattern refuses its `;`
        if (server && !page) assert.match(typed, /&(amp|#x27|quot|lt|gt|#x2F|#x5C|#96);/, JSON.stringify(typed));
      }
    }
  });

  test('a revenue row the form accepts, the server accepts: years 1900 up, amounts 0 to 1,000,000,000', () => {
    // The form takes years up to this year + 10 by the clock
    // (validateRevenueEntry has no `now`); from 2090 it would take 2100, which
    // the import cannot read, and this test would say so
    const years = Array.from({ length: 2150 - 1850 }, (_, i) => 1850 + i);
    for (const year of years) {
      const page = Object.keys(validateRevenueEntry({ year: String(year), revenue_amount: '1000' })).length === 0;
      const server = checkClient({ ...VALID, revenues: [{ year, revenue_amount: 1000 }] }).length === 0;
      if (page) assert.ok(server, `year ${year}`);
    }
    assert.equal(checkClient({ ...VALID, revenues: [{ year: 1899, revenue_amount: 1 }] }).length, 1, 'the form\'s lower bound too');
    for (const amount of ['0', '0.01', '1', '999999999.99', '1000000000', '1000000000.01', '-0.01', '-1', '5000000000']) {
      const page = Object.keys(validateRevenueEntry({ year: '2026', revenue_amount: amount })).length === 0;
      const server = checkClient({ ...VALID, revenues: [{ year: 2026, revenue_amount: parseFloat(amount) }] }).length === 0;
      assert.equal(server, page, amount);
    }
    assert.equal(REVENUE_AMOUNT_MAX, 1e9);
  });
});

describe('checkClient', () => {
  test('a body as the form sends it has no details, as typed and as the sanitizer leaves it', () => {
    assert.deepEqual(bothWays(VALID), []);
  });

  test('a body that is not an object: one detail, `body`', () => {
    const detail = [{ field: 'body', message: "The request body must be a JSON object of the client's fields." }];
    for (const body of [undefined, null, [], [VALID], 'a client', 5, true]) {
      assert.deepEqual(checkClient(body), detail, JSON.stringify(body));
      assert.equal(isObjectBody(body), false);
    }
    assert.equal(isObjectBody({}), true);
  });

  test('the name: missing, blank, not text, too long, outside the form\'s pattern', () => {
    const name = (message) => [{ field: 'name', message }];
    for (const [value, message] of [
      [undefined, 'Client name is required'],
      [null, 'Client name is required'],
      ['', 'Client name is required'],
      ['   ', 'Client name is required'],
      [42, 'Client name must be text'],
      [['Acme'], 'Client name must be text'],
      ['A'.repeat(256), 'Client name must not exceed 255 characters'],
      ['Acme; Inc', 'Client name contains invalid characters'],
      ['Acme #1', 'Client name contains invalid characters'],
      ['Acme <b>', 'Client name contains invalid characters'],
      ['Café Society', 'Client name contains invalid characters'],
    ]) {
      assert.deepEqual(bothWays({ ...VALID, name: value }), name(message), JSON.stringify(value));
    }
    assert.deepEqual(bothWays({ ...VALID, name: 'A'.repeat(255) }), []);
    for (const ok of ["O'Brien Trust", 'Barnes & Noble Education Fund', 'Health / Human Services', 'St. Mary (North), Inc-1']) {
      assert.deepEqual(bothWays({ ...VALID, name: ok }), [], ok);
    }
  });

  test('a name stored escaped and sent back is read as typed, however many times it was escaped', () => {
    for (const stored of ['Barnes &amp; Noble Education Fund', 'O&#x27;Brien Trust', 'O&amp;#x27;Brien Trust', 'Health &#x2F; Human Services']) {
      assert.deepEqual(detailsFor({ name: stored }), [], stored);
      assert.deepEqual(detailsFor({ name: validator.escape(stored) }), [], `${stored}, escaped again by the sanitizer`);
    }
  });

  test('a name the form allows that is over 255 characters once escaped: refused with how much to cut, instead of failing in PostgreSQL', () => {
    const typed = `${'&'.repeat(50)}${'A'.repeat(20)}`;
    assert.equal(validateField('name', typed), null, 'the form allows it');
    const escaped = validator.escape(typed);
    assert.equal(escaped.length, 270);
    assert.deepEqual(checkClient({ ...VALID, name: escaped }), [{
      field: 'name',
      message: "Client name is too long to save: each &, ' and / in it is saved as 5 or 6 characters, which makes it 270, over the limit of 255. Shorten it by 15.",
    }]);
    assert.deepEqual(checkClient({ ...VALID, name: typed }), [], 'as typed (after WP5) it fits');
    const fits = `${'&'.repeat(47)}${'A'.repeat(20)}`;
    assert.equal(validator.escape(fits).length, 255);
    assert.deepEqual(checkClient({ ...VALID, name: validator.escape(fits) }), []);
  });

  test('practice areas: a list from the twelve; blank is no practice areas', () => {
    for (const blank of [undefined, null, []]) assert.deepEqual(bothWays({ ...VALID, practice_area: blank }), [], JSON.stringify(blank));
    const list = PRACTICE_AREAS.join(', ');
    assert.deepEqual(bothWays({ ...VALID, practice_area: ['Tax'] }), [{ field: 'practice_area', message: `Practice area "Tax" is not on the list: ${list}.` }]);
    assert.deepEqual(bothWays({ ...VALID, practice_area: ['healthcare', 'Energy', 'Tax & Estate', 7] }), [{
      field: 'practice_area', message: `Practice areas "healthcare", "Tax & Estate", 7 are not on the list: ${list}.`,
    }]);
    for (const notList of ['Healthcare', { 0: 'Healthcare' }, 5]) {
      assert.deepEqual(bothWays({ ...VALID, practice_area: notList }), [{ field: 'practice_area', message: `Practice areas must be a list from: ${list}.` }]);
    }
  });

  test('conflict risk: Low, Medium or High, required', () => {
    for (const risk of CONFLICT_RISKS) assert.deepEqual(bothWays({ ...VALID, conflict_risk: risk }), []);
    for (const [risk, message] of [
      [undefined, 'Conflict risk must be Low, Medium or High.'],
      [null, 'Conflict risk must be Low, Medium or High.'],
      ['', 'Conflict risk must be Low, Medium or High.'],
      ['low', 'Conflict risk "low" must be Low, Medium or High.'],
      ['Severe', 'Conflict risk "Severe" must be Low, Medium or High.'],
      [3, 'Conflict risk 3 must be Low, Medium or High.'],
    ]) {
      assert.deepEqual(bothWays({ ...VALID, conflict_risk: risk }), [{ field: 'conflict_risk', message }], JSON.stringify(risk));
    }
  });

  test('cadence: one of the five, or blank', () => {
    for (const cadence of [...CADENCES, '', null, undefined]) assert.deepEqual(bothWays({ ...VALID, interaction_frequency: cadence }), [], String(cadence));
    for (const cadence of ['Hourly', 'weekly', 'As Needed', 2]) {
      assert.deepEqual(bothWays({ ...VALID, interaction_frequency: cadence }), [{
        field: 'interaction_frequency',
        message: `Interaction frequency ${JSON.stringify(cadence)} must be one of Daily, Weekly, Monthly, Quarterly, As-Needed, or blank.`,
      }], String(cadence));
    }
  });

  test('stickiness: a whole number from 1 to 5, or not rated; high-maintenance: true or false, false when left out', () => {
    for (const stickiness of [...STICKINESS, null, undefined]) assert.deepEqual(bothWays({ ...VALID, stickiness }), []);
    for (const stickiness of [0, 6, 3.5, '3', '', true, [3]]) {
      assert.deepEqual(bothWays({ ...VALID, stickiness }), [{
        field: 'stickiness', message: 'Stickiness must be a whole number from 1 to 5, or null for not rated.',
      }], JSON.stringify(stickiness));
    }
    for (const handful of [true, false, undefined]) assert.deepEqual(bothWays({ ...VALID, high_maintenance: handful }), []);
    for (const handful of [null, 'true', 1, 'Y']) {
      assert.deepEqual(bothWays({ ...VALID, high_maintenance: handful }), [{ field: 'high_maintenance', message: 'High-maintenance must be true or false.' }]);
    }
  });

  test('revenue: whole years the import reads, amounts from 0 to 1,000,000,000, each year once; each detail named for its entry', () => {
    for (const revenues of [undefined, [], [{ year: 1900, revenue_amount: 0 }, { year: 2099, revenue_amount: 1e9 }]]) {
      assert.deepEqual(bothWays({ ...VALID, revenues }), [], JSON.stringify(revenues));
    }
    const amount = (label) => `The amount for ${label} must be a number from 0 to 1,000,000,000.`;
    for (const [revenues, details] of [
      [null, [{ field: 'revenues', message: 'Revenue must be a list of { year, revenue_amount } entries.' }]],
      [{ year: 2026, revenue_amount: 1 }, [{ field: 'revenues', message: 'Revenue must be a list of { year, revenue_amount } entries.' }]],
      [[{ year: 2026, revenue_amount: 1 }, 2026], [{ field: 'revenue_1', message: 'Revenue entry 2 must be { year, revenue_amount }.' }]],
      [[{ year: 1899, revenue_amount: 1 }], [{ field: 'revenue_0', message: 'Revenue year 1899 must be a whole year from 1900 to 2099.' }]],
      [[{ year: 2100, revenue_amount: 1 }], [{ field: 'revenue_0', message: 'Revenue year 2100 must be a whole year from 1900 to 2099.' }]],
      [[{ year: '2026', revenue_amount: 1 }], [{ field: 'revenue_0', message: 'Revenue year "2026" must be a whole year from 1900 to 2099.' }]],
      [[{ year: 2026.5, revenue_amount: 1 }], [{ field: 'revenue_0', message: 'Revenue year 2026.5 must be a whole year from 1900 to 2099.' }]],
      [[{ revenue_amount: 1 }], [{ field: 'revenue_0', message: 'Revenue year undefined must be a whole year from 1900 to 2099.' }]],
      [[{ year: 2026, revenue_amount: -1 }], [{ field: 'revenue_0', message: amount(2026) }]],
      [[{ year: 2026, revenue_amount: 1e9 + 0.01 }], [{ field: 'revenue_0', message: amount(2026) }]],
      [[{ year: 2026, revenue_amount: '5000' }], [{ field: 'revenue_0', message: amount(2026) }]],
      [[{ year: 2026, revenue_amount: null }], [{ field: 'revenue_0', message: amount(2026) }]],
      [[{ year: 2026 }], [{ field: 'revenue_0', message: amount(2026) }]],
      [[{ year: 'x', revenue_amount: 'y' }], [
        { field: 'revenue_0', message: 'Revenue year "x" must be a whole year from 1900 to 2099.' },
        { field: 'revenue_0', message: amount('revenue entry 1') },
      ]],
      [[{ year: 2025, revenue_amount: 1 }, { year: 2026, revenue_amount: 2 }, { year: 2025, revenue_amount: 3 }, { year: 2025, revenue_amount: 4 }], [
        { field: 'revenue_2', message: '2025 is given more than once; give each year once.' },
        { field: 'revenue_3', message: '2025 is given more than once; give each year once.' },
      ]],
    ]) {
      assert.deepEqual(bothWays({ ...VALID, revenues }), details, JSON.stringify(revenues));
    }
  });

  test('every field\'s detail, in the body\'s order; fields it does not know are ignored', () => {
    assert.deepEqual(bothWays({
      status: 'Former', notes: 42, lead_id: 'nobody', originator_is_firm: 'maybe',
      revenues: [{ year: 1, revenue_amount: 1 }], high_maintenance: 'no', stickiness: 9, interaction_frequency: 'Never',
      conflict_risk: 'None', practice_area: ['Law'], name: '',
    }).map((d) => d.field), ['name', 'practice_area', 'conflict_risk', 'interaction_frequency', 'stickiness', 'high_maintenance', 'revenue_0']);
  });
});

describe('the page\'s own values pass (src/utils/clientForm.js, the save path of ClientEnhancementForm.jsx)', () => {
  // What handleSave sends for the form's state `form`
  const pageBody = (form) => {
    const sanitizedData = sanitizeFormData(form);
    const { revenues } = revenuesToSend(sanitizedData.revenues);
    return clientRequestBody({
      ...sanitizedData,
      lead_id: toPersonId(form.lead_id),
      second_chair_id: toPersonId(form.second_chair_id),
      originator_id: toPersonId(form.originator_id),
      originator_is_firm: form.originator_is_firm === true,
      revenues,
    });
  };

  test('stored clients opened in the form and saved unchanged: escaped names and notes, no rating, no cadence, a note with <', () => {
    const stored = [
      {
        id: 7, name: 'Barnes &amp; Noble Education Fund', practiceArea: ['Education'], conflict_risk: 'Low', lead_id: 3,
        second_chair_id: 5, originator_id: null, originator_is_firm: true, interaction_frequency: 'Monthly', stickiness: 4,
        high_maintenance: false, notes: 'O&#x27;Brien asked about R&amp;amp;D &amp;lt; 5%', revenues: [{ year: 2026, revenue_amount: 40000 }],
      },
      {
        id: 8, name: 'O&amp;#x27;Brien Trust', practiceArea: ['Other'], conflict_risk: 'High', lead_id: 1, second_chair_id: null,
        originator_id: 7, originator_is_firm: false, interaction_frequency: '', stickiness: null, high_maintenance: true,
        notes: null, revenues: [{ year: 2024, revenue_amount: 1000.5 }, { year: 2026, revenue_amount: 999999999.99 }],
      },
      { id: 9, name: 'Plain Client', practiceArea: ['Healthcare'], conflict_risk: null, lead_id: 2, revenues: [{ year: 2025, revenue_amount: 7500 }] },
    ];
    for (const client of stored) {
      const form = clientFormData(client, new Date('2026-09-27T12:00:00Z'));
      assert.deepEqual(validateClientForm(form), {}, client.name);
      const body = pageBody(form);
      assert.deepEqual(checkClient(sanitized(body)), [], `${client.name}, as the sanitizer leaves it`);
      assert.deepEqual(checkClient(body), [], `${client.name}, as typed`);
    }
  });

  test('3,000 random forms the form accepts: the server accepts every one, sanitized and as typed', () => {
    const next = random(4);
    const pick = (list) => list[Math.floor(next() * list.length)];
    const nameChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -.,&'()/";
    const noteChars = 'ab <>&"\'/\\`;#\n';
    for (let i = 0; i < 3000; i++) {
      // At most 42 characters: 252 once each is escaped to six
      const name = `N${Array.from({ length: Math.floor(next() * 42) }, () => pick(nameChars)).join('')}`;
      const years = [...new Set(Array.from({ length: Math.floor(next() * 5) }, () => 1900 + Math.floor(next() * 137)))];
      const rows = years.map((year) => ({ year: String(year), revenue_amount: String(Math.round(next() * 1e11) / 100) }));
      if (next() < 0.3) rows.splice(Math.floor(next() * (rows.length + 1)), 0, { year: '', revenue_amount: '' });
      const form = {
        name,
        practiceArea: PRACTICE_AREAS.filter(() => next() < 0.25).concat(next() < 0.5 ? [] : [pick(PRACTICE_AREAS)]).filter((a, j, all) => all.indexOf(a) === j),
        conflict_risk: pick(CONFLICT_RISKS),
        lead_id: String(1 + Math.floor(next() * 6)),
        second_chair_id: pick(['', '7', '8']),
        originator_id: pick(['', '1', '9']),
        originator_is_firm: next() < 0.3,
        interaction_frequency: pick(CADENCES),
        stickiness: pick([null, ...STICKINESS]),
        high_maintenance: next() < 0.3,
        notes: Array.from({ length: Math.floor(next() * 30) }, () => pick(noteChars)).join(''),
        revenues: rows,
      };
      if (form.practiceArea.length === 0) form.practiceArea.push(pick(PRACTICE_AREAS));
      assert.deepEqual(validateClientForm(form), {}, JSON.stringify(form));
      const body = pageBody(form);
      assert.deepEqual(checkClient(sanitized(body)), [], JSON.stringify(body));
      assert.deepEqual(checkClient(body), [], JSON.stringify(body));
    }
  });

  test('what the form lets through and the server refuses shows beside the form\'s own row: a year given twice after an empty row', () => {
    const form = {
      ...clientFormData({ id: 1, name: 'Twice', practiceArea: ['Energy'], lead_id: 2 }, new Date('2026-09-27T12:00:00Z')),
      revenues: [{ year: '2025', revenue_amount: '10' }, { year: '', revenue_amount: '' }, { year: '2025', revenue_amount: '20' }],
    };
    assert.deepEqual(validateClientForm(form), {}, 'the form does not look for a repeated year');
    const { formRows } = revenuesToSend(sanitizeFormData(form).revenues);
    const details = checkClient(sanitized(pageBody(form)));
    assert.deepEqual(details, [{ field: 'revenue_1', message: '2025 is given more than once; give each year once.' }]);
    assert.deepEqual(formErrors(details, formRows), { revenue_2: '2025 is given more than once; give each year once.', general: SEE_ABOVE });
  });
});
