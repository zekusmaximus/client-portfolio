// src/utils/clientForm.js: the client form's fields for a stored client. A
// name or notes the form saved before Tier 2 WP5 are stored HTML-escaped (the
// request sanitizer, and DOMPurify for a note with `<`) until the repair
// (scripts/unescape-book.cjs); the form shows them unescaped, so an edit saves
// without retyping the name. Since WP5 the save is modelled as the page and
// the server do it: the form's sanitizeFormData, which trims, then the
// server's trimRequestBody, which trims; nothing is escaped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import validator from 'validator';
import { clientFormData, clientRequestBody, revenuesToSend, formErrors, SEE_ABOVE } from '../src/utils/clientForm.js';
import { validateField, sanitizeFormData } from '../src/utils/validation.js';

// What the database holds after the form saves `form`
const stored = (form) => {
  const sent = sanitizeFormData(form);
  return { name: sent.name.trim(), notes: sent.notes.trim() };
};

const CLIENT = {
  id: 7,
  name: 'Barnes &amp; Noble Education Fund',
  practiceArea: ['Education'],
  conflict_risk: 'Low',
  lead_id: 3,
  second_chair_id: 5,
  originator_id: null,
  originator_is_firm: true,
  interaction_frequency: 'Monthly',
  stickiness: 4,
  high_maintenance: false,
  notes: 'O&#x27;Brien asked about R&amp;amp;D',
  revenues: [{ year: 2026, revenue_amount: '40000.00' }],
};

test('a stored client fills the form with its name and notes unescaped, and every other field as before', () => {
  assert.deepEqual(clientFormData(CLIENT), {
    name: 'Barnes & Noble Education Fund',
    practiceArea: ['Education'],
    conflict_risk: 'Low',
    lead_id: '3',
    second_chair_id: '5',
    originator_id: '',
    originator_is_firm: true,
    interaction_frequency: 'Monthly',
    stickiness: 4,
    high_maintenance: false,
    notes: "O'Brien asked about R&D",
    revenues: [{ year: 2026, revenue_amount: '40000.00' }],
  });
  // The defaults, and one empty revenue row in `now`'s year
  assert.deepEqual(clientFormData({ id: 1, name: 'Plain' }, new Date('2027-01-15T12:00:00Z')), {
    name: 'Plain', practiceArea: [], conflict_risk: 'Medium', lead_id: '', second_chair_id: '', originator_id: '',
    originator_is_firm: false, interaction_frequency: 'As-Needed', stickiness: null, high_maintenance: false, notes: '',
    revenues: [{ year: 2027, revenue_amount: '' }],
  });
});

test('a name stored escaped passes the form\'s name pattern, so an edit saves without retyping it', () => {
  for (const name of ['Barnes &amp; Noble Education Fund', 'O&#x27;Brien Trust', 'O&amp;#x27;Brien Trust', 'Health &#x2F; Human Services']) {
    assert.match(validateField('name', name) || '', /invalid characters/, `stored as ${name}: refused as it was shown before`);
    assert.equal(validateField('name', clientFormData({ name }).name), null, name);
  }
});

test('a save stores the name and notes exactly as typed, and saving again stores the same text', () => {
  const cases = [
    { name: 'Barnes & Noble Education Fund', notes: 'R&D and Q&A' },
    { name: "O'Brien Trust", notes: "Sen. O'Brien; follow up" },
    // Until WP5 a `<` made DOMPurify serialize the text, escaping `&` itself before the server did
    { name: 'Health / Human Services', notes: 'R&D < 5% of "budget"' },
    // and dropped anything shaped like a tag
    { name: 'Tag Co', notes: 'x <b>bold</b> y, a\u00a0b < c' },
  ];
  for (const typed of cases) {
    let db = stored(typed);
    const first = { ...db };
    assert.deepEqual(first, typed, 'stored as typed');
    for (let save = 0; save < 3; save += 1) {
      const form = clientFormData(db);
      assert.deepEqual({ name: form.name, notes: form.notes }, typed, `save ${save + 1}: the form shows what was typed`);
      db = stored(form);
      assert.deepEqual(db, first, `save ${save + 1}: stored unchanged`);
    }
  }

  // Notes a save escaped several levels deep before the form filled its
  // fields unescaped: shown as typed, then, since WP5, stored as typed
  const deep = { name: 'Acme', notes: validator.escape(validator.escape(validator.escape('A&B'))) };
  assert.equal(deep.notes, 'A&amp;amp;amp;B');
  const form = clientFormData(deep);
  assert.equal(form.notes, 'A&B');
  assert.equal(stored(form).notes, 'A&B');

  // As the form stored a name and a note with `<` before WP5 (DOMPurify, then
  // the sanitizer): opened as typed, saved as typed
  const before = { name: validator.escape('Barnes & Noble'), notes: validator.escape('R&amp;D &lt; 5% of "budget"') };
  assert.deepEqual(before, { name: 'Barnes &amp; Noble', notes: 'R&amp;amp;D &amp;lt; 5% of &quot;budget&quot;' });
  assert.deepEqual(stored(clientFormData(before)), { name: 'Barnes & Noble', notes: 'R&D < 5% of "budget"' });
});

test('a client nobody has rated opens as Not rated, so saving it for another reason keeps it unrated; a rating stays', () => {
  // The store sends `stickiness ?? null`, and the server stores what it is sent
  for (const stickiness of [null, undefined]) {
    assert.equal(clientFormData({ name: 'Unrated', stickiness }).stickiness, null, String(stickiness));
  }
  for (const stickiness of [1, 2, 3, 4, 5]) {
    assert.equal(clientFormData({ name: 'Rated', stickiness }).stickiness, stickiness);
  }
});

// The save's side (docs/plans/tier-2.md, WP4): handleSave's revenue rows and the
// store's formatClientForAPI moved here unchanged, so tests can check the body
// against the server's rules (tests/client-rules.test.mjs). Frozen copies of
// the code they replaced, to show the body the API receives is the same.
const oldCleanRevenues = (revenues) => revenues.filter(rev =>
  rev.year && rev.revenue_amount
).map(rev => ({
  year: parseInt(rev.year),
  revenue_amount: parseFloat(rev.revenue_amount)
}));
const oldFormatClientForAPI = (clientData) => ({
  name: clientData.name || '',
  practice_area: clientData.practiceArea || [],
  conflict_risk: clientData.conflict_risk || 'Medium',
  notes: clientData.notes || '',
  lead_id: clientData.lead_id ?? null,
  second_chair_id: clientData.second_chair_id ?? null,
  originator_id: clientData.originator_id ?? null,
  originator_is_firm: clientData.originator_is_firm === true,
  interaction_frequency: clientData.interaction_frequency || '',
  stickiness: clientData.stickiness ?? null,
  high_maintenance: clientData.high_maintenance === true,
  revenues: clientData.revenues || []
});

test('revenuesToSend sends what the save sent, and the form row of each entry', () => {
  const rows = [
    { year: '2024', revenue_amount: '1000' },
    { year: '', revenue_amount: '' },
    { year: 2025, revenue_amount: 0 },
    { year: '2026', revenue_amount: '0' },
    { year: '', revenue_amount: '5' },
    { year: '2027', revenue_amount: '1234.56' },
  ];
  const { revenues, formRows } = revenuesToSend(rows);
  assert.deepEqual(revenues, oldCleanRevenues(rows));
  assert.deepEqual(revenues, [
    { year: 2024, revenue_amount: 1000 }, { year: 2026, revenue_amount: 0 }, { year: 2027, revenue_amount: 1234.56 },
  ]);
  assert.deepEqual(formRows, [0, 3, 5]);
  assert.deepEqual(revenuesToSend([]), { revenues: [], formRows: [] });
});

test('clientRequestBody is the body formatClientForAPI sent', () => {
  const samples = [
    {},
    { name: 'Acme', practiceArea: ['Energy'], conflict_risk: 'High', notes: 'n', lead_id: 3, second_chair_id: 0, originator_id: null,
      originator_is_firm: true, interaction_frequency: 'Daily', stickiness: 0, high_maintenance: true, revenues: [{ year: 2026, revenue_amount: 1 }] },
    { name: null, practiceArea: null, conflict_risk: '', notes: null, lead_id: undefined, originator_is_firm: 'true', interaction_frequency: null,
      stickiness: undefined, high_maintenance: 'yes', revenues: null, status: 'Former', practice_area: ['Other'] },
  ];
  for (const sample of samples) assert.deepEqual(clientRequestBody(sample), oldFormatClientForAPI(sample), JSON.stringify(sample));
});

test('formErrors puts each detail of a 400 beside its field, a revenue entry beside the form row that sent it, and the rest under general', () => {
  assert.deepEqual(formErrors([
    { field: 'name', message: 'Client name contains invalid characters' },
    { field: 'practice_area', message: 'Practice area "Tax" is not on the list.' },
    { field: 'conflict_risk', message: 'Conflict risk must be Low, Medium or High.' },
    { field: 'interaction_frequency', message: 'Interaction frequency "Hourly" must be one of ...' },
    { field: 'lead_id', message: 'Choose a lead partner.' },
    { field: 'second_chair_id', message: 'The second chair cannot be the lead.' },
    { field: 'originator_id', message: 'The originator must be on the People list.' },
    { field: 'revenue_1', message: '2025 is given more than once; give each year once.' },
    { field: 'revenue_1', message: 'The amount for 2025 must be a number from 0 to 1,000,000,000.' },
    { field: 'stickiness', message: 'Stickiness must be a whole number from 1 to 5, or null for not rated.' },
    { field: 'high_maintenance', message: 'High-maintenance must be true or false.' },
  ], [0, 2]), {
    name: 'Client name contains invalid characters',
    practiceArea: 'Practice area "Tax" is not on the list.',
    conflict_risk: 'Conflict risk must be Low, Medium or High.',
    interaction_frequency: 'Interaction frequency "Hourly" must be one of ...',
    lead_id: 'Choose a lead partner.',
    second_chair_id: 'The second chair cannot be the lead.',
    originator_id: 'The originator must be on the People list.',
    revenue_2: '2025 is given more than once; give each year once. The amount for 2025 must be a number from 0 to 1,000,000,000.',
    general: `Stickiness must be a whole number from 1 to 5, or null for not rated. High-maintenance must be true or false. ${SEE_ABOVE}`,
  });
  assert.equal(SEE_ABOVE, 'Not saved. Fix the fields marked in red above and save again.');
  // Without the rows (an entry the page did not send), and fields nobody knows
  assert.deepEqual(formErrors([{ field: 'revenue_4', message: 'r' }, { field: 'body', message: 'b' }, { message: 'm' }]), {
    revenue_4: 'r', general: `b m ${SEE_ABOVE}`,
  });
  // Only beside a field, or only under general
  assert.deepEqual(formErrors([{ field: 'lead_id', message: 'Choose a lead partner.' }]), { lead_id: 'Choose a lead partner.', general: SEE_ABOVE });
  assert.deepEqual(formErrors([{ field: 'revenues', message: 'Revenue must be a list.' }], [3]), { general: 'Revenue must be a list.' });
  assert.deepEqual(formErrors([]), {});
});
