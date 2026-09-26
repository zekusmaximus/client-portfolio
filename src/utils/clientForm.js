// The client form's fields for a stored client (ClientEnhancementForm in edit
// mode). Pure, so tests/client-form.test.mjs can check it.
//
// The name and the notes are shown unescaped (unescapeStored): the API returns
// them as sanitizeRequestBody stored them, `Barnes &amp; Noble Education
// Fund`, whose `;` the form's name pattern refuses, so every later edit of the
// client failed until the partner retyped the `&`; and notes, which have no
// pattern, gained a level of escaping with each save.

import { unescapeStored } from './escaping.js';

/** The form's state for `client`; a client with no revenue gets one empty row for `now`'s year. */
export function clientFormData(client, now = new Date()) {
  const clientRevenues = client.revenues || [];
  // If no revenue data exists, add an empty row with the next logical year
  const revenuesWithDefault = clientRevenues.length === 0
    ? [{ year: now.getFullYear(), revenue_amount: '' }]
    : clientRevenues;

  return {
    name: unescapeStored(client.name || ''),
    practiceArea: client.practiceArea || [],
    conflict_risk: client.conflict_risk || 'Medium',
    lead_id: client.lead_id ? String(client.lead_id) : '',
    second_chair_id: client.second_chair_id ? String(client.second_chair_id) : '',
    originator_id: client.originator_id ? String(client.originator_id) : '',
    originator_is_firm: client.originator_is_firm === true,
    interaction_frequency: client.interaction_frequency || 'As-Needed',
    stickiness: client.stickiness || 3,
    high_maintenance: client.high_maintenance === true,
    notes: unescapeStored(client.notes || ''),
    revenues: revenuesWithDefault
  };
}
