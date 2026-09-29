// The client form's fields for a stored client (ClientEnhancementForm in edit
// mode). Pure, so tests/client-form.test.mjs can check it.
//
// The name and the notes are shown as stored, which since Tier 2 WP5 is as
// they were typed. Until WP5's second PR the form unescaped them
// (unescapeStored), because the API's request sanitizer stored them
// HTML-escaped (`Barnes &amp; Noble`), whose `;` the form's name pattern
// refused; the repair (scripts/unescape-book.cjs) found nothing left escaped
// on 2026-09-28, and unescaping now would only change a literal `&lt;` a
// partner typed in a note into `<` at the next save.
//
// A client nobody has rated keeps `stickiness: null` ("Not rated"): the form
// used to fill it with 3, so saving the client for any reason rated it 3, and
// the book counts a rated 3 as safe where an unrated client is unknown (T5).
//
// The save's side too: the body the API receives (clientRequestBody, the
// store's formatClientForAPI), the revenue rows it sends (revenuesToSend) and
// a 400's details as the form's errors (formErrors; docs/plans/tier-2.md, WP4);
// and after a stale save's 409 (WP6, S10), the form as it should then be
// (mergeAfterConflict).

/** The form's state for `client`; a client with no revenue gets one empty row for `now`'s year. */
export function clientFormData(client, now = new Date()) {
  const clientRevenues = client.revenues || [];
  // If no revenue data exists, add an empty row with the next logical year
  const revenuesWithDefault = clientRevenues.length === 0
    ? [{ year: now.getFullYear(), revenue_amount: '' }]
    : clientRevenues;

  return {
    name: client.name || '',
    practiceArea: client.practiceArea || [],
    conflict_risk: client.conflict_risk || 'Medium',
    lead_id: client.lead_id ? String(client.lead_id) : '',
    second_chair_id: client.second_chair_id ? String(client.second_chair_id) : '',
    originator_id: client.originator_id ? String(client.originator_id) : '',
    originator_is_firm: client.originator_is_firm === true,
    interaction_frequency: client.interaction_frequency || 'As-Needed',
    stickiness: Number.isInteger(client.stickiness) ? client.stickiness : null,
    high_maintenance: client.high_maintenance === true,
    notes: client.notes || '',
    revenues: revenuesWithDefault
  };
}

/**
 * The form's revenue rows as a save sends them: only rows with a year and an
 * amount, as numbers. `formRows[i]` is the form's row of `revenues[i]`, so a
 * 400 about the i-th entry shows beside the row the partner filled in
 * (formErrors).
 */
export function revenuesToSend(rows = []) {
  const revenues = [];
  const formRows = [];
  rows.forEach((rev, index) => {
    if (!(rev.year && rev.revenue_amount)) return;
    revenues.push({
      year: parseInt(rev.year),
      revenue_amount: parseFloat(rev.revenue_amount)
    });
    formRows.push(index);
  });
  return { revenues, formRows };
}

/**
 * The body POST and PUT /api/data/clients receive (the store's
 * formatClientForAPI). People go as ids (docs/plans/people-and-second-chair.md,
 * P3, P4); the server writes the legacy primary_lobbyist, lobbyist_team and
 * client_originator text from them. The retired retention fields and the
 * phantom strategic_fit_score are not sent. `expected_updated_at` (WP6, S10)
 * goes only when the form gives one: the client's updated_at_exact as the
 * form loaded it, which only an API with client-edit-conflict sends, so the
 * API refuses a save over a newer one (409); an older API ignores it.
 */
export function clientRequestBody(clientData) {
  const expected = clientData.expected_updated_at === undefined ? {} : { expected_updated_at: clientData.expected_updated_at };
  return {
    ...expected,
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
  };
}

// The form's key for each field a 400's details name, where the form shows
// one (ClientEnhancementForm.jsx); the body calls the practice areas
// practice_area, the form practiceArea
const FORM_KEYS = {
  name: 'name',
  practice_area: 'practiceArea',
  conflict_risk: 'conflict_risk',
  interaction_frequency: 'interaction_frequency',
  notes: 'notes',
  lead_id: 'lead_id',
  second_chair_id: 'second_chair_id',
  originator_id: 'originator_id'
};

// Under general, beside the Save button, when a message is beside a field
// the partner may have scrolled past
export const SEE_ABOVE = 'Not saved. Fix the fields marked in red above and save again.';

/**
 * A 400's `details` ([{ field, message }], utils/clientRules.cjs and
 * validateAssignment on the server) as the form's errors: each beside its
 * field, `revenue_<i>` beside the form row that sent the i-th entry
 * (`formRows`, from revenuesToSend), and a field the form has no place for
 * (stickiness, high_maintenance, the body) under `general`, so every
 * message shows. Two messages for one place are shown together, and general
 * ends with SEE_ABOVE when any message is beside a field.
 */
export function formErrors(details = [], formRows = []) {
  const errors = {};
  const general = [];
  for (const { field, message } of details) {
    const revenue = /^revenue_(\d+)$/.exec(field || '');
    const key = revenue
      ? `revenue_${formRows[Number(revenue[1])] ?? revenue[1]}`
      : FORM_KEYS[field];
    if (!key) general.push(message);
    else errors[key] = errors[key] ? `${errors[key]} ${message}` : message;
  }
  if (Object.keys(errors).length > 0) general.push(SEE_ABOVE);
  if (general.length > 0) errors.general = general.join(' ');
  return errors;
}

// The form's fields, in the order it shows them (ClientEnhancementForm.jsx)
export const FORM_FIELDS = [
  'name', 'practiceArea', 'revenues', 'conflict_risk', 'lead_id', 'second_chair_id', 'originator_id',
  'originator_is_firm', 'interaction_frequency', 'high_maintenance', 'stickiness', 'notes'
];

// A field's value as a save would send it, for comparing two forms: practice
// areas as a set, revenue as the rows a save sends (revenuesToSend), by year
function comparable(field, value) {
  if (field === 'practiceArea') return JSON.stringify([...(value || [])].sort());
  if (field === 'revenues') {
    return JSON.stringify(revenuesToSend(value || []).revenues.slice().sort((a, b) => a.year - b.year));
  }
  return JSON.stringify(value ?? null);
}

/**
 * The form after a stale save's 409 (docs/plans/tier-2.md, S10, WP6): `base`
 * is the form as it was filled from the client the partner opened
 * (clientFormData), `mine` the form as the partner left it, `theirs` the form
 * filled from the client as it is now. A field the partner did not touch takes
 * the saved value; one the partner edited keeps the edit, so nothing typed is
 * lost; one both changed, differently, keeps the partner's and is named as a
 * clash; one both changed to the same value is simply the saved value. Saving the result writes the partner's edits over the newer client
 * without undoing the other save's changes.
 *
 * Returns { formData, theirs, kept, clashes }: `theirs` the fields the other
 * save changed, `kept` the partner's edits kept, `clashes` both; each a list of
 * FORM_FIELDS keys.
 */
export function mergeAfterConflict(base, mine, theirs) {
  const formData = { ...mine };
  const changedByThem = [];
  const kept = [];
  const clashes = [];
  for (const field of FORM_FIELDS) {
    const b = comparable(field, base[field]);
    const m = comparable(field, mine[field]);
    const t = comparable(field, theirs[field]);
    if (t !== b) changedByThem.push(field);
    if (m === b) formData[field] = theirs[field];
    else if (t === b) kept.push(field);
    else if (t !== m) clashes.push(field);
    // else both made the same change: nothing of the partner's to keep
  }
  return { formData, theirs: changedByThem, kept, clashes };
}
