// src/utils/clientForm.js: the client form's fields for a stored client. A
// name or notes the form saved are stored HTML-escaped by sanitizeRequestBody;
// the form shows them unescaped, so an edit saves without retyping the name
// and a save no longer adds a level of escaping. The save is modelled as the
// page and the server do it: the form's sanitizeFormData (DOMPurify), then the
// server's validator.escape after a trim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import validator from 'validator';
import { clientFormData } from '../src/utils/clientForm.js';
import { validateField, sanitizeFormData } from '../src/utils/validation.js';

// What the database holds after the form saves `form`
const stored = (form) => {
  const sent = sanitizeFormData(form);
  return { name: validator.escape(sent.name.trim()), notes: validator.escape(sent.notes.trim()) };
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

test('saving a client again stores the same text: the name and notes no longer gain a level per save', () => {
  const cases = [
    { name: 'Barnes & Noble Education Fund', notes: 'R&D and Q&A' },
    { name: "O'Brien Trust", notes: "Sen. O'Brien; follow up" },
    // A `<` makes DOMPurify serialize the text, escaping `&` itself before the server does
    { name: 'Health / Human Services', notes: 'R&D < 5% of "budget"' },
  ];
  for (const typed of cases) {
    let db = stored(typed);
    const first = { ...db };
    for (let save = 0; save < 3; save += 1) {
      const form = clientFormData(db);
      assert.deepEqual({ name: form.name, notes: form.notes }, typed, `save ${save + 1}: the form shows what was typed`);
      db = stored(form);
      assert.deepEqual(db, first, `save ${save + 1}: stored unchanged`);
    }
  }

  // Notes a save escaped several levels deep before this fix: shown as typed, then stored one level deep
  const deep = { name: 'Acme', notes: validator.escape(validator.escape(validator.escape('A&B'))) };
  assert.equal(deep.notes, 'A&amp;amp;amp;B');
  const form = clientFormData(deep);
  assert.equal(form.notes, 'A&B');
  assert.equal(stored(form).notes, 'A&amp;B');
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
