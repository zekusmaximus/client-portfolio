// src/utils/clientForm.js: the client form's fields for a stored client,
// shown as stored, which since Tier 2 WP5 is as typed. Until WP5's second PR
// the form unescaped the name and notes, because the API's request sanitizer
// stored them HTML-escaped; the repair (scripts/unescape-book.cjs) found
// nothing left escaped on 2026-09-28. The save is modelled as the page and
// the server do it: the form's sanitizeFormData, which trims, then the
// server's trimRequestBody, which trims; nothing is escaped or unescaped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientFormData, clientRequestBody, revenuesToSend, formErrors, mergeAfterConflict, SEE_ABOVE } from '../src/utils/clientForm.js';
import { validateField, validateClientForm, validateRevenueEntry, sanitizeFormData } from '../src/utils/validation.js';

// What the database holds after the form saves `form`
const stored = (form) => {
  const sent = sanitizeFormData(form);
  return { name: sent.name.trim(), notes: sent.notes.trim() };
};

const CLIENT = {
  id: 7,
  name: 'Barnes & Noble Education Fund',
  practiceArea: ['Education'],
  conflict_risk: 'Low',
  lead_id: 3,
  second_chair_id: 5,
  originator_id: null,
  originator_is_firm: true,
  interaction_frequency: 'Monthly',
  stickiness: 4,
  high_maintenance: false,
  notes: "O'Brien asked about R&D < 5%",
  revenues: [{ year: 2026, revenue_amount: '40000.00' }],
};

test('a stored client fills the form with its name and notes as stored, and every other field as before', () => {
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
    notes: "O'Brien asked about R&D < 5%",
    revenues: [{ year: 2026, revenue_amount: '40000.00' }],
  });
  // The defaults, and one empty revenue row in `now`'s year. No cadence is
  // Not set (''): until WP6's candidate (a) was fixed, the form filled As-Needed
  assert.deepEqual(clientFormData({ id: 1, name: 'Plain' }, new Date('2027-01-15T12:00:00Z')), {
    name: 'Plain', practiceArea: [], conflict_risk: 'Medium', lead_id: '', second_chair_id: '', originator_id: '',
    originator_is_firm: false, interaction_frequency: '', stickiness: null, high_maintenance: false, notes: '',
    revenues: [{ year: 2027, revenue_amount: '' }],
  });
});

// Until WP5's second PR the form unescaped what it showed, so a note holding a
// literal entity (`&lt;b&gt;`) came back as `<b>` and the next save stored
// that. It shows the text as stored now; a name holding an entity, which only
// an old backup could bring back, is shown so and refused, as the server
// refuses it (the runbook's 7.5 repair is the remedy).
test('the form shows name and notes exactly as stored: a note with a literal entity is saved back unchanged; a name holding an entity is refused, as the server refuses it', () => {
  const literal = { ...CLIENT, notes: 'Write &lt;b&gt; for bold; Copyright &#169;; R&amp;D is not R&D' };
  const form = clientFormData(literal);
  assert.equal(form.notes, literal.notes);
  assert.deepEqual(stored(form), { name: literal.name, notes: literal.notes });
  for (const name of ['Barnes &amp; Noble Education Fund', 'O&#x27;Brien Trust']) {
    assert.equal(clientFormData({ name }).name, name);
    assert.match(validateField('name', name) || '', /invalid characters/, name);
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

// WP6's candidate (a) (docs/plans/tier-2.md): the form filled a client with no
// cadence as As-Needed and required one, so saving the client for any reason
// set As-Needed and halved its effort (the unset cadence's 1 to 0.5). As with
// stickiness (T5), it opens as Not set ('') and the save sends '' back, which
// the API stores as sent, the import writes for a blank cell and the history
// reads as NULL's "not set"
test('a client with no cadence opens as Not set, so saving it for another reason keeps it unset; a cadence stays', () => {
  for (const cadence of [null, undefined, '']) {
    const form = clientFormData({ ...CLIENT, interaction_frequency: cadence });
    assert.equal(form.interaction_frequency, '', String(cadence));
    assert.equal(validateField('interaction_frequency', form.interaction_frequency), null, `${cadence}: the form does not require one`);
    const rated = { ...form, stickiness: 2 };
    assert.deepEqual(validateClientForm(rated), {}, `${cadence}: saved for its Stickiness`);
    assert.equal(clientRequestBody(sanitizeFormData(rated)).interaction_frequency, '', `${cadence}: the save sends none`);
  }
  for (const cadence of ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'As-Needed']) {
    const form = clientFormData({ ...CLIENT, interaction_frequency: cadence });
    assert.equal(form.interaction_frequency, cadence);
    assert.equal(clientRequestBody(sanitizeFormData(form)).interaction_frequency, cadence);
  }
  // A value off the list is still refused
  assert.equal(validateField('interaction_frequency', 'Hourly'),
    'Interaction frequency must be one of: Daily, Weekly, Monthly, Quarterly, As-Needed, or Not set');
});

// Tier 3 WP4, candidate (j): the form starts a new client, and a stored client
// with no revenue, with one row for this year and no amount, and required an
// amount once a year was set, so neither could be saved without inventing
// revenue. The save sends only the rows with both (revenuesToSend), so the row
// is no error and stays in the form for the partner to fill.
const NEW_CLIENT = {
  name: 'New Co', practiceArea: ['Energy'], conflict_risk: 'Medium', lead_id: '3', second_chair_id: '', originator_id: '',
  originator_is_firm: false, interaction_frequency: '', stickiness: null, high_maintenance: false, notes: '',
  revenues: [{ year: 2026, revenue_amount: '' }],
};

test('a revenue row with a year and no amount is no error: a new client and a stored client with no revenue save without revenue, and the save leaves the row out', () => {
  for (const amount of ['', '  ', null, undefined]) {
    assert.deepEqual(validateRevenueEntry({ year: 2026, revenue_amount: amount }, 0), {}, JSON.stringify(amount));
    assert.deepEqual(validateRevenueEntry({ year: '2026', revenue_amount: amount }, 0), {}, `"2026", ${JSON.stringify(amount)}`);
  }
  const stored = clientFormData({ ...CLIENT, revenues: [] }, new Date('2026-09-30T12:00:00Z'));
  assert.deepEqual(stored.revenues, [{ year: 2026, revenue_amount: '' }], 'the empty row the form opens with');
  for (const form of [NEW_CLIENT, stored]) {
    assert.deepEqual(validateClientForm(form), {}, form.name);
    const body = clientRequestBody({ ...sanitizeFormData(form), revenues: revenuesToSend(sanitizeFormData(form).revenues).revenues });
    assert.deepEqual(body.revenues, [], `${form.name}: no revenue sent`);
  }
  // A row filled beside it is sent, from its own form row
  const filled = { ...NEW_CLIENT, revenues: [{ year: 2026, revenue_amount: '' }, { year: '2025', revenue_amount: '1200' }] };
  assert.deepEqual(validateClientForm(filled), {});
  assert.deepEqual(revenuesToSend(filled.revenues), { revenues: [{ year: 2025, revenue_amount: 1200 }], formRows: [1] });
  // An amount without a year, a bad year, and a bad amount are still errors
  assert.deepEqual(validateRevenueEntry({ year: '', revenue_amount: '5' }, 0), { year: 'Year is required when revenue amount is specified' });
  assert.deepEqual(validateRevenueEntry({ year: '', revenue_amount: 0 }, 0), { year: 'Year is required when revenue amount is specified' });
  assert.match(validateRevenueEntry({ year: '1899', revenue_amount: '' }, 0).year || '', /^Year must be between 1900 and /);
  for (const amount of ['-1', 'abc']) {
    assert.deepEqual(validateRevenueEntry({ year: '2026', revenue_amount: amount }, 0), { revenue_amount: 'Revenue amount must be a positive number' }, amount);
  }
  assert.deepEqual(validateRevenueEntry({ year: '2026', revenue_amount: '1000000000.01' }, 0), { revenue_amount: 'Revenue amount exceeds maximum limit (1 billion)' });
  assert.deepEqual(validateRevenueEntry({ year: '', revenue_amount: '' }, 0), {}, 'an empty row, as before');
});

// Tier 3 WP4, candidate (x): the API sends a stored $0 row's amount as the
// number 0, which the form read as missing ("Revenue amount is required"), so
// such a client could not be saved again. Only the form stores a $0 row (the
// import deletes one, D5). The save still leaves it out: revenuesToSend reads
// the number 0 as none, as the import's year rule reads `$0`, and the history
// reads a $0 row as none (utils/clientChanges.cjs), so the row goes at the
// next save that changes something, with nothing logged for it.
test('a stored $0 row is a value, not missing: the client saves again, and the save leaves the $0 row out', () => {
  assert.deepEqual(validateRevenueEntry({ year: 2025, revenue_amount: 0 }, 0), {});
  assert.deepEqual(validateRevenueEntry({ year: '2025', revenue_amount: '0' }, 0), {}, 'typed, as before');
  const form = clientFormData({ ...CLIENT, revenues: [{ year: 2025, revenue_amount: 0 }, { year: 2026, revenue_amount: 40000 }] });
  assert.deepEqual(form.revenues, [{ year: 2025, revenue_amount: 0 }, { year: 2026, revenue_amount: 40000 }]);
  assert.deepEqual(validateClientForm(form), {});
  assert.deepEqual(revenuesToSend(sanitizeFormData(form).revenues), { revenues: [{ year: 2026, revenue_amount: 40000 }], formRows: [1] });
  // A client whose only row is $0 sends none
  const only = clientFormData({ ...CLIENT, revenues: [{ year: 2025, revenue_amount: 0 }] });
  assert.deepEqual(validateClientForm(only), {});
  assert.deepEqual(revenuesToSend(only.revenues).revenues, []);
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

// Tier 2 WP6 (S10), on purpose: the body gains expected_updated_at when the
// form gives one (the client's updated_at_exact as it loaded it, or null for a
// client stored without updated_at), and is otherwise the old body
test('clientRequestBody adds expected_updated_at, and only when the form gives it', () => {
  const sample = { name: 'Acme', lead_id: 3, revenues: [] };
  assert.equal('expected_updated_at' in clientRequestBody(sample), false);
  assert.equal('expected_updated_at' in clientRequestBody({ ...sample, expected_updated_at: undefined }), false);
  for (const expected of ['2026-09-28T20:34:00.006586', null]) {
    assert.deepEqual(clientRequestBody({ ...sample, expected_updated_at: expected }),
      { ...oldFormatClientForAPI(sample), expected_updated_at: expected });
  }
});

// After a stale save's 409 (WP6, S10): the form shows the client as it is
// now, with every edit of this partner's kept over it
const formOf = (overrides = {}) => clientFormData({ ...CLIENT, ...overrides }, new Date('2026-09-28T12:00:00Z'));

test('mergeAfterConflict: the other save\'s changes where this partner changed nothing, this partner\'s edits kept, a field both changed kept as typed and named', () => {
  const base = formOf();
  // A (the other save) changed stickiness 4 to 5 and the revenue; B (this
  // partner) changed the cadence and the notes; both changed the conflict risk
  const theirs = formOf({ stickiness: 5, conflict_risk: 'High', revenues: [{ year: 2026, revenue_amount: '45000.00' }] });
  const mine = { ...base, interaction_frequency: 'Weekly', notes: 'Typed by B', conflict_risk: 'Medium' };
  const merge = mergeAfterConflict(base, mine, theirs);
  assert.deepEqual(merge.formData, {
    ...base, stickiness: 5, revenues: theirs.revenues, interaction_frequency: 'Weekly', notes: 'Typed by B', conflict_risk: 'Medium',
  });
  assert.deepEqual(merge.theirs, ['revenues', 'conflict_risk', 'stickiness']);
  assert.deepEqual(merge.kept, ['interaction_frequency', 'notes']);
  assert.deepEqual(merge.clashes, ['conflict_risk']);
  // Saved, the merge writes B's edits and keeps A's: nothing of A's is undone
  const body = clientRequestBody({ ...merge.formData, revenues: revenuesToSend(merge.formData.revenues).revenues });
  assert.deepEqual([body.stickiness, body.interaction_frequency, body.revenues], [5, 'Weekly', [{ year: 2026, revenue_amount: 45000 }]]);
});

test('mergeAfterConflict: practice areas as a set, revenue as a save sends it, the same change on both sides no clash, and no edits gives the client as it is now', () => {
  const base = formOf();
  const theirs = formOf({ stickiness: 2 });
  // Ticked in another order, and an empty revenue row added: no edit
  const reordered = { ...base, practiceArea: [...base.practiceArea].reverse(), revenues: [...base.revenues, { year: '', revenue_amount: '' }] };
  let merge = mergeAfterConflict(base, reordered, theirs);
  assert.deepEqual([merge.kept, merge.clashes, merge.theirs], [[], [], ['stickiness']]);
  assert.deepEqual(merge.formData, { ...reordered, practiceArea: theirs.practiceArea, revenues: theirs.revenues, stickiness: 2 });
  // Both set stickiness to 2: the saved value, neither kept nor a clash
  merge = mergeAfterConflict(base, { ...base, stickiness: 2 }, theirs);
  assert.deepEqual([merge.kept, merge.clashes, merge.formData.stickiness], [[], [], 2]);
  // A rating cleared by this partner ("Not rated") is an edit, kept
  merge = mergeAfterConflict(base, { ...base, stickiness: null }, formOf({ notes: 'By A' }));
  assert.deepEqual([merge.kept, merge.formData.stickiness, merge.formData.notes], [['stickiness'], null, 'By A']);
  // Nothing changed on either side
  assert.deepEqual(mergeAfterConflict(base, base, base), { formData: base, theirs: [], kept: [], clashes: [] });
});

// A client with no cadence may be NULL (a POST without the field, an older
// row) or '' (the import's blank cell, a save through the form): both open as
// Not set, so neither side has changed it
test('mergeAfterConflict: a cadence unset on both sides is no change, whichever spelling each side stored; one the other save set is theirs', () => {
  const base = formOf({ interaction_frequency: null });
  const mine = { ...base, notes: 'Typed by B' };
  let merge = mergeAfterConflict(base, mine, formOf({ interaction_frequency: '', stickiness: 2 }));
  assert.deepEqual([merge.theirs, merge.kept, merge.clashes], [['stickiness'], ['notes'], []]);
  assert.deepEqual([merge.formData.interaction_frequency, merge.formData.stickiness], ['', 2]);
  merge = mergeAfterConflict(base, mine, formOf({ interaction_frequency: 'Weekly' }));
  assert.deepEqual([merge.theirs, merge.kept, merge.formData.interaction_frequency], [['interaction_frequency'], ['notes'], 'Weekly']);
  // This partner setting one is an edit, kept
  merge = mergeAfterConflict(base, { ...base, interaction_frequency: 'Monthly' }, formOf({ interaction_frequency: '' }));
  assert.deepEqual([merge.theirs, merge.kept, merge.clashes, merge.formData.interaction_frequency], [[], ['interaction_frequency'], [], 'Monthly']);
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
