// utils/clientRules.cjs (docs/plans/tier-2.md, S7, WP4): the rules POST and
// PUT /api/data/clients apply, the vocabularies the import reads from the same
// module, the page's copy of the lists and the name pattern
// (src/utils/validation.js) held equal to them, and the page's own save path
// (src/utils/clientForm.js) passing them. Since WP5 (S8) the route receives a
// body as the partner typed it, trimmed by trimRequestBody
// (middleware/validation.cjs) and not escaped; a name holding an escape, as a
// client saved before WP5 is stored until the repair, is checked as sent.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import validator from 'validator';
import rules from '../utils/clientRules.cjs';
import csvImport from '../utils/csvImport.cjs';
import strategic from '../utils/strategic.cjs';
import middleware from '../middleware/validation.cjs';
import escaping from '../utils/escaping.cjs';
import { VALIDATION_RULES, validateClientForm, validateField, validateRevenueEntry, sanitizeFormData } from '../src/utils/validation.js';
import { clientFormData, clientRequestBody, revenuesToSend, formErrors, SEE_ABOVE } from '../src/utils/clientForm.js';
import { toPersonId } from '../src/utils/people.js';

const {
  PRACTICE_AREAS, CADENCES, CONFLICT_RISKS, STICKINESS, NAME_MAX, NAME_PATTERN, NAME_MESSAGES,
  REVENUE_AMOUNT_MAX, isObjectBody, isRevenueYear, checkClient,
} = rules;

// A body as trimRequestBody hands it to the route: every string trimmed
const asRouteSees = (body) => {
  const req = { body: structuredClone(body) };
  middleware.trimRequestBody(req, {}, () => {});
  return req.body;
};

// The request sanitizer the routes ran until WP5 (middleware/validation.cjs at
// efef19d), frozen: every string trimmed, then escaped
const oldSanitizer = (value) => {
  if (typeof value === 'string') return validator.escape(value.trim());
  if (Array.isArray(value)) return value.map(oldSanitizer);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, oldSanitizer(v)]));
  return value;
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
// The details for a body as typed, the same once trimRequestBody has passed it on
const routeSees = (body) => {
  const typed = checkClient(body);
  assert.deepEqual(checkClient(asRouteSees(body)), typed, `as typed and as the route sees it agree: ${JSON.stringify(body)}`);
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

  // WP6's candidate (a): the form required a cadence and filled As-Needed
  // where none was set; like the server, it allows none ("Not set")
  test('no cadence: allowed by the form, as by the server; a value off the list refused by both', () => {
    assert.equal(VALIDATION_RULES.interaction_frequency.required, false);
    for (const none of ['', null, undefined]) {
      assert.equal(validateField('interaction_frequency', none), null, String(none));
      assert.deepEqual(detailsFor({ interaction_frequency: none }), [], String(none));
    }
    for (const other of ['Hourly', 'weekly', 'As Needed']) {
      assert.notEqual(validateField('interaction_frequency', other), null, other);
      assert.deepEqual(detailsFor({ interaction_frequency: other }).map((d) => d.field), ['interaction_frequency'], other);
    }
  });

  // Tier 3 WP4, U7 (b), candidate (k): the form required a practice area,
  // though the server, the import and the book allow none, so a client the
  // import created with a blank Practice Area could not be saved from the
  // form until someone picked an area nobody chose
  test('no practice area: allowed by the form, as by the server; an area off the list refused by both', () => {
    const page = VALIDATION_RULES.practiceArea;
    assert.equal(page.required, false);
    assert.equal(page.minItems, undefined);
    for (const none of [[], null, undefined]) {
      assert.equal(validateField('practiceArea', none), null, JSON.stringify(none));
      assert.deepEqual(detailsFor({ practice_area: none }), [], JSON.stringify(none));
    }
    const imported = clientFormData({ id: 1, name: 'Imported', lead_id: 2, revenues: [{ year: 2026, revenue_amount: 5000 }] });
    assert.deepEqual(validateClientForm({ ...imported, stickiness: 3 }), {}, 'an imported client with none, saved for its Stickiness');
    for (const other of [['Tax'], ['healthcare'], ['Energy', 'Law']]) {
      assert.equal(validateField('practiceArea', other), page.errorMessages.allowedValues, JSON.stringify(other));
      assert.deepEqual(detailsFor({ practice_area: other }).map((d) => d.field), ['practice_area'], JSON.stringify(other));
    }
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

  test('a name the form accepts, the server accepts, and the reverse; sent escaped, as stored before WP5, it is refused once escaping changed it', () => {
    const next = random(20260927);
    const alphabet = "abcXYZ019 -.,&'()/;#<>\"@é\t";
    for (let i = 0; i < 3000; i++) {
      const typed = Array.from({ length: 1 + Math.floor(next() * 40) }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
      const page = validateField('name', typed) === null;
      const server = (sent) => !detailsFor({ name: sent }).some((d) => d.field === 'name');
      assert.equal(server(typed), page, JSON.stringify(typed));
      assert.equal(server(asRouteSees({ name: typed }).name), page, `${JSON.stringify(typed)}, trimmed`);
      // A direct request sending the text as the sanitizer stored it: checked
      // as sent, so an escape's `;` is refused as the form refuses it
      const escaped = validator.escape(typed.trim());
      assert.equal(server(escaped), page && escaped === typed.trim(), JSON.stringify(escaped));
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
  test('a body as the form sends it has no details, as typed and as the route sees it', () => {
    assert.deepEqual(routeSees(VALID), []);
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
      assert.deepEqual(routeSees({ ...VALID, name: value }), name(message), JSON.stringify(value));
    }
    assert.deepEqual(routeSees({ ...VALID, name: 'A'.repeat(255) }), []);
    for (const ok of ["O'Brien Trust", 'Barnes & Noble Education Fund', 'Health / Human Services', 'St. Mary (North), Inc-1']) {
      assert.deepEqual(routeSees({ ...VALID, name: ok }), [], ok);
    }
  });

  // Until WP5 the name was read through unescapeStored, since the request
  // sanitizer had escaped it, and a stored escaped name sent back passed and
  // was stored escaped once more. The page sends names unescaped
  // (clientFormData); only a direct request sends the stored text.
  test('a name stored escaped before WP5 and sent back as stored is refused, as the form refuses its `;`; unescaped, as the page sends it, it passes', () => {
    for (const stored of ['Barnes &amp; Noble Education Fund', 'O&#x27;Brien Trust', 'O&amp;#x27;Brien Trust', 'Health &#x2F; Human Services']) {
      assert.deepEqual(routeSees({ ...VALID, name: stored }), [{ field: 'name', message: 'Client name contains invalid characters' }], stored);
      assert.equal(validateField('name', stored), 'Client name contains invalid characters');
      assert.deepEqual(routeSees({ ...VALID, name: escaping.unescapeStored(stored) }), [], `${stored}, unescaped`);
    }
  });

  // Until WP5 clients.name (VARCHAR(255)) held the name escaped, each &, ' and
  // / as 5 or 6 characters, and a second rule refused a name over 255 once
  // escaped. The name is stored as typed now, and 255 is the form's limit and
  // the column's.
  test('a name the form allows passes up to 255 characters, however many &, \' and / it holds; the stored-length rule is gone', () => {
    for (const typed of [`${'&'.repeat(50)}${'A'.repeat(20)}`, '&'.repeat(255), `${"'/".repeat(127)}A`]) {
      assert.equal(validateField('name', typed), null, 'the form allows it');
      assert.ok(validator.escape(typed).length > NAME_MAX, 'over 255 once escaped');
      assert.deepEqual(routeSees({ ...VALID, name: typed }), [], typed);
    }
    assert.deepEqual(routeSees({ ...VALID, name: '&'.repeat(256) }), [{ field: 'name', message: 'Client name must not exceed 255 characters' }]);
  });

  test('practice areas: a list from the twelve; blank is no practice areas', () => {
    for (const blank of [undefined, null, []]) assert.deepEqual(routeSees({ ...VALID, practice_area: blank }), [], JSON.stringify(blank));
    const list = PRACTICE_AREAS.join(', ');
    assert.deepEqual(routeSees({ ...VALID, practice_area: ['Tax'] }), [{ field: 'practice_area', message: `Practice area "Tax" is not on the list: ${list}.` }]);
    assert.deepEqual(routeSees({ ...VALID, practice_area: ['healthcare', 'Energy', 'Tax & Estate', 7] }), [{
      field: 'practice_area', message: `Practice areas "healthcare", "Tax & Estate", 7 are not on the list: ${list}.`,
    }]);
    for (const notList of ['Healthcare', { 0: 'Healthcare' }, 5]) {
      assert.deepEqual(routeSees({ ...VALID, practice_area: notList }), [{ field: 'practice_area', message: `Practice areas must be a list from: ${list}.` }]);
    }
  });

  test('conflict risk: Low, Medium or High, required', () => {
    for (const risk of CONFLICT_RISKS) assert.deepEqual(routeSees({ ...VALID, conflict_risk: risk }), []);
    for (const [risk, message] of [
      [undefined, 'Conflict risk must be Low, Medium or High.'],
      [null, 'Conflict risk must be Low, Medium or High.'],
      ['', 'Conflict risk must be Low, Medium or High.'],
      ['low', 'Conflict risk "low" must be Low, Medium or High.'],
      ['Severe', 'Conflict risk "Severe" must be Low, Medium or High.'],
      [3, 'Conflict risk 3 must be Low, Medium or High.'],
    ]) {
      assert.deepEqual(routeSees({ ...VALID, conflict_risk: risk }), [{ field: 'conflict_risk', message }], JSON.stringify(risk));
    }
  });

  test('cadence: one of the five, or blank', () => {
    for (const cadence of [...CADENCES, '', null, undefined]) assert.deepEqual(routeSees({ ...VALID, interaction_frequency: cadence }), [], String(cadence));
    for (const cadence of ['Hourly', 'weekly', 'As Needed', 2]) {
      assert.deepEqual(routeSees({ ...VALID, interaction_frequency: cadence }), [{
        field: 'interaction_frequency',
        message: `Interaction frequency ${JSON.stringify(cadence)} must be one of Daily, Weekly, Monthly, Quarterly, As-Needed, or blank.`,
      }], String(cadence));
    }
  });

  test('stickiness: a whole number from 1 to 5, or not rated; high-maintenance: true or false, false when left out', () => {
    for (const stickiness of [...STICKINESS, null, undefined]) assert.deepEqual(routeSees({ ...VALID, stickiness }), []);
    for (const stickiness of [0, 6, 3.5, '3', '', true, [3]]) {
      assert.deepEqual(routeSees({ ...VALID, stickiness }), [{
        field: 'stickiness', message: 'Stickiness must be a whole number from 1 to 5, or null for not rated.',
      }], JSON.stringify(stickiness));
    }
    for (const handful of [true, false, undefined]) assert.deepEqual(routeSees({ ...VALID, high_maintenance: handful }), []);
    for (const handful of [null, 'true', 1, 'Y']) {
      assert.deepEqual(routeSees({ ...VALID, high_maintenance: handful }), [{ field: 'high_maintenance', message: 'High-maintenance must be true or false.' }]);
    }
  });

  test('revenue: whole years the import reads, amounts from 0 to 1,000,000,000, each year once; each detail named for its entry', () => {
    for (const revenues of [undefined, [], [{ year: 1900, revenue_amount: 0 }, { year: 2099, revenue_amount: 1e9 }]]) {
      assert.deepEqual(routeSees({ ...VALID, revenues }), [], JSON.stringify(revenues));
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
      assert.deepEqual(routeSees({ ...VALID, revenues }), details, JSON.stringify(revenues));
    }
  });

  test('every field\'s detail, in the body\'s order; fields it does not know are ignored', () => {
    assert.deepEqual(routeSees({
      status: 'Former', notes: 42, lead_id: 'nobody', originator_is_firm: 'maybe',
      revenues: [{ year: 1, revenue_amount: 1 }], high_maintenance: 'no', stickiness: 9, interaction_frequency: 'Never',
      conflict_risk: 'None', practice_area: ['Law'], name: '',
    }).map((d) => d.field), ['name', 'practice_area', 'conflict_risk', 'interaction_frequency', 'stickiness', 'high_maintenance', 'revenue_0']);
  });
});

// WP5's trap 1: the request sanitizer trimmed every string before the route
// saw it, and checkClient compares the vocabularies exactly. trimRequestBody
// keeps that trim and drops only the escape.
describe('trimRequestBody (middleware/validation.cjs): the sanitizer\'s trim, without its escape', () => {
  test('every string at any depth trimmed, nothing escaped: the old sanitizer\'s output with its one escape undone, on 2,000 seeded random bodies', () => {
    const next = random(55);
    const chars = " \t\n&<>\"'/\\`;#aZ9é\u00a0";
    const text = () => Array.from({ length: Math.floor(next() * 12) }, () => chars[Math.floor(next() * chars.length)]).join('');
    const value = (depth) => {
      const r = next();
      if (depth > 2 || r < 0.4) return text();
      if (r < 0.5) return [null, 7, 2.5, true, false][Math.floor(next() * 5)];
      if (r < 0.75) return Array.from({ length: Math.floor(next() * 4) }, () => value(depth + 1));
      return Object.fromEntries(Array.from({ length: Math.floor(next() * 4) }, (_, i) => [`k${i}`, value(depth + 1)]));
    };
    const undoOne = (v) => {
      // One validator.escape undone: its replacements, `&amp;` last
      if (typeof v === 'string') return escaping.ESCAPES.reduce((out, [entity, char]) => out.split(entity).join(char), v);
      if (Array.isArray(v)) return v.map(undoOne);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, undoOne(x)]));
      return v;
    };
    for (let i = 0; i < 2000; i++) {
      const body = { body: value(0) };
      assert.deepEqual(asRouteSees(body), undoOne(oldSanitizer(body)), JSON.stringify(body));
      assert.deepEqual(middleware.trimStrings(body), asRouteSees(body));
    }
    assert.deepEqual(asRouteSees({ notes: '  R&D < 5% of "budget"  ', name: " O'Brien / Co\t" }), { notes: 'R&D < 5% of "budget"', name: "O'Brien / Co" });
    for (const empty of [undefined, null]) {
      const req = { body: empty };
      middleware.trimRequestBody(req, {}, () => {});
      assert.equal(req.body, empty);
    }
  });

  test('a padded name, vocabulary value or note is trimmed before the check, as the sanitizer trimmed it; as sent, the exact comparison refuses it', () => {
    const padded = {
      ...VALID,
      name: '  Smith & Co  ',
      practice_area: [' Healthcare', 'Real Estate '],
      conflict_risk: ' Low ',
      interaction_frequency: 'Weekly\t',
      notes: '\n R&D < 5% \n',
    };
    assert.deepEqual(checkClient(asRouteSees(padded)), []);
    assert.deepEqual(asRouteSees(padded), { ...padded, name: 'Smith & Co', practice_area: ['Healthcare', 'Real Estate'], conflict_risk: 'Low', interaction_frequency: 'Weekly', notes: 'R&D < 5%' });
    assert.deepEqual(checkClient(padded).map((d) => d.field), ['practice_area', 'conflict_risk', 'interaction_frequency'], 'the rules compare exactly; the trim comes first');
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

  // Clients as stored since Tier 2 WP5 (the repair found nothing left
  // escaped); the form opens them as stored and sends them back unchanged
  test('stored clients opened in the form and saved unchanged: names with & and \', a note with < and a literal entity, no rating, no cadence', () => {
    const stored = [
      {
        id: 7, name: 'Barnes & Noble Education Fund', practiceArea: ['Education'], conflict_risk: 'Low', lead_id: 3,
        second_chair_id: 5, originator_id: null, originator_is_firm: true, interaction_frequency: 'Monthly', stickiness: 4,
        high_maintenance: false, notes: "O'Brien asked about R&D < 5%; write &lt;b&gt; for bold", revenues: [{ year: 2026, revenue_amount: 40000 }],
      },
      {
        id: 8, name: "O'Brien Trust", practiceArea: ['Other'], conflict_risk: 'High', lead_id: 1, second_chair_id: null,
        originator_id: 7, originator_is_firm: false, interaction_frequency: '', stickiness: null, high_maintenance: true,
        notes: null, revenues: [{ year: 2024, revenue_amount: 1000.5 }, { year: 2026, revenue_amount: 999999999.99 }],
      },
      { id: 9, name: 'Plain Client', practiceArea: ['Healthcare'], conflict_risk: null, lead_id: 2, revenues: [{ year: 2025, revenue_amount: 7500 }] },
      // Tier 3 WP4: as the import creates one with blank Practice Area and
      // no revenue ((k), (j)), and one with a $0 row the form stored ((x))
      { id: 10, name: 'Imported Blank', practiceArea: [], conflict_risk: 'Medium', lead_id: 4, second_chair_id: null, revenues: [] },
      { id: 11, name: 'Zero Row Co', practiceArea: ['Energy'], conflict_risk: 'Low', lead_id: 5, revenues: [{ year: 2025, revenue_amount: 0 }, { year: 2026, revenue_amount: 12000 }] },
    ];
    for (const client of stored) {
      const form = clientFormData(client, new Date('2026-09-27T12:00:00Z'));
      assert.deepEqual(validateClientForm(form), {}, client.name);
      const body = pageBody(form);
      assert.deepEqual(checkClient(asRouteSees(body)), [], `${client.name}, as the route sees it`);
      assert.deepEqual(checkClient(body), [], `${client.name}, as typed`);
      // The stored text goes out as it is: nothing escaped or unescaped
      assert.deepEqual([body.name, body.notes], [client.name, client.notes || '']);
      // and no cadence as none (WP6's candidate (a); the form sent As-Needed)
      assert.equal(body.interaction_frequency, client.interaction_frequency || '', `${client.name}: the cadence as stored`);
      // The practice areas as stored, none included; the revenue rows above
      // $0, none for a client with none (the form's empty row is not sent)
      assert.deepEqual(body.practice_area, client.practiceArea, `${client.name}: the practice areas as stored`);
      assert.deepEqual(body.revenues, client.revenues.filter((r) => r.revenue_amount > 0), `${client.name}: the revenue sent`);
    }
  });

  test('3,000 random forms the form accepts: the server accepts every one, as typed and as the route sees it, and each text goes out as typed, trimmed', () => {
    const next = random(4);
    const pick = (list) => list[Math.floor(next() * list.length)];
    const nameChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -.,&'()/";
    const noteChars = 'ab <>&"\'/\\`;#\n';
    for (let i = 0; i < 3000; i++) {
      // Up to the form's 255 characters, whatever they are: stored as typed
      const name = `N${Array.from({ length: Math.floor(next() * 255) }, () => pick(nameChars)).join('')}`;
      const years = [...new Set(Array.from({ length: Math.floor(next() * 5) }, () => 1900 + Math.floor(next() * 137)))];
      const rows = years.map((year) => ({ year: String(year), revenue_amount: String(Math.round(next() * 1e11) / 100) }));
      if (next() < 0.3) rows.splice(Math.floor(next() * (rows.length + 1)), 0, { year: '', revenue_amount: '' });
      const filled = [...rows];
      // Tier 3 WP4: a year with no amount, as the form's empty row (j), and a
      // $0 row as the API sends a stored one (x); the save sends neither
      if (next() < 0.3) rows.splice(Math.floor(next() * (rows.length + 1)), 0, { year: String(1900 + Math.floor(next() * 137)), revenue_amount: '' });
      if (next() < 0.3) rows.splice(Math.floor(next() * (rows.length + 1)), 0, { year: 1900 + Math.floor(next() * 137), revenue_amount: 0 });
      const form = {
        name,
        practiceArea: PRACTICE_AREAS.filter(() => next() < 0.25).concat(next() < 0.5 ? [] : [pick(PRACTICE_AREAS)]).filter((a, j, all) => all.indexOf(a) === j),
        conflict_risk: pick(CONFLICT_RISKS),
        lead_id: String(1 + Math.floor(next() * 6)),
        second_chair_id: pick(['', '7', '8']),
        originator_id: pick(['', '1', '9']),
        originator_is_firm: next() < 0.3,
        // '' is Not set (WP6's candidate (a); the form required one until then)
        interaction_frequency: pick(['', ...CADENCES]),
        stickiness: pick([null, ...STICKINESS]),
        high_maintenance: next() < 0.3,
        notes: Array.from({ length: Math.floor(next() * 30) }, () => pick(noteChars)).join(''),
        revenues: rows,
      };
      // No practice area is allowed (Tier 3 WP4, U7 (b)); until then this
      // test gave every form one, since the form required it
      assert.deepEqual(validateClientForm(form), {}, JSON.stringify(form));
      const body = pageBody(form);
      assert.deepEqual(body.revenues, revenuesToSend(filled).revenues, 'no year without an amount, and no $0 row the API sent');
      assert.deepEqual(checkClient(asRouteSees(body)), [], JSON.stringify(body));
      assert.deepEqual(checkClient(body), [], JSON.stringify(body));
      assert.deepEqual([body.name, body.notes], [form.name.trim(), form.notes.trim()], 'sanitizeFormData trims and nothing else');
      assert.deepEqual(asRouteSees(body), body, 'the route sees what the page sent');
    }
  });

  test('what the form lets through and the server refuses shows beside the form\'s own row: a year given twice after an empty row', () => {
    const form = {
      ...clientFormData({ id: 1, name: 'Twice', practiceArea: ['Energy'], lead_id: 2 }, new Date('2026-09-27T12:00:00Z')),
      revenues: [{ year: '2025', revenue_amount: '10' }, { year: '', revenue_amount: '' }, { year: '2025', revenue_amount: '20' }],
    };
    assert.deepEqual(validateClientForm(form), {}, 'the form does not look for a repeated year');
    const { formRows } = revenuesToSend(sanitizeFormData(form).revenues);
    const details = checkClient(asRouteSees(pageBody(form)));
    assert.deepEqual(details, [{ field: 'revenue_1', message: '2025 is given more than once; give each year once.' }]);
    assert.deepEqual(formErrors(details, formRows), { revenue_2: '2025 is given more than once; give each year once.', general: SEE_ABOVE });
  });
});
