// A client's history on the client form (docs/plans/tier-2.md, S9 and S10,
// WP6): the rows GET /api/data/clients/:id/changes answers, newest first, as
// the form's "Last changed by" line and History list, and the notice a stale
// save's 409 turns into. Pure, so tests/client-history.test.mjs can check it.
//
// A row's `changes` is { field: { from, to } } over the fields a partner sets,
// named as their columns (utils/clientChanges.cjs on the server), and
// revenue: { year: { from, to } }. Dates show as the firm reads a clock, in
// America/New_York (utils/clientChanges.cjs's firmTime), whatever the
// browser's zone. Who is the account that saved (accounts are not the People
// list, P2).

export const FIRM_TIME_ZONE = 'America/New_York';

// The server's FIELDS (utils/clientChanges.cjs), in the same order; held
// equal by tests/client-history.test.mjs
export const HISTORY_FIELDS = [
  'name', 'lead_id', 'second_chair_id', 'originator_id', 'originator_is_firm', 'stickiness',
  'interaction_frequency', 'high_maintenance', 'conflict_risk', 'practice_area', 'notes',
];

const LABELS = {
  name: 'Name',
  lead_id: 'Lead',
  second_chair_id: 'Second chair',
  originator_id: 'Originator',
  originator_is_firm: 'Origination credit to the firm',
  stickiness: 'Stickiness',
  interaction_frequency: 'Cadence',
  high_maintenance: 'High-maintenance',
  conflict_risk: 'Conflict risk',
  practice_area: 'Practice areas',
  notes: 'Notes',
};

// Where a change came from, as the list says it
const SOURCES = {
  form: 'Client Details',
  import: 'an import',
  'second-chair': 'the associate split',
  delete: 'Client Details',
};
// Beside a name, for a change that did not come from the client form
const VIA = { import: ' (an import)', 'second-chair': ' (the associate split)' };

const firmTimeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: FIRM_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** "Sep 28, 2026, 4:34 PM" in the firm's zone. */
export const firmTime = (when) => firmTimeFormat.format(new Date(when));

// $40,000, or $55,000.50 when there are cents
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const money = { format: (amount) => (Number.isInteger(amount) ? dollars : cents).format(amount) };

function valueText(field, value) {
  if (value === null || value === undefined) {
    if (field === 'stickiness') return 'not rated';
    if (field === 'interaction_frequency') return 'not set';
    return 'none';
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return value.name || `person #${value.id}`;
  return String(value);
}

const who = (row) => row.changed_by_username || 'a former account';

/**
 * One history row as the list shows it: { id, when, who, kind ('created',
 * 'changed' or 'deleted'), title, lines }, each line { key, label, text,
 * long, fromText, toText }. Notes are long: the list says they changed and
 * shows before and after on request. Fields in HISTORY_FIELDS' order, then
 * revenue by year.
 */
export function historyEntry(row) {
  const changes = row.changes || {};
  const revenue = changes.revenue || {};
  // A stored client always has a name, so only a creation changes it from none
  const created = changes.name !== undefined && changes.name.from === null;
  const kind = row.source === 'delete' ? 'deleted' : created ? 'created' : 'changed';
  const via = SOURCES[row.source] || row.source;
  const title = kind === 'created' ? `Created on ${via}` : kind === 'deleted' ? 'Deleted' : `Changed on ${via}`;

  const line = (key, label, from, to, field) => {
    const fromText = field === 'revenue' ? (from === null || from === undefined ? 'none' : money.format(from)) : valueText(field, from);
    const toText = field === 'revenue' ? (to === null || to === undefined ? 'none' : money.format(to)) : valueText(field, to);
    const long = field === 'notes';
    let text;
    if (long) text = kind === 'created' ? `${label} added` : kind === 'deleted' ? `${label} removed` : `${label} changed`;
    else if (kind === 'created') text = `${label}: ${toText}`;
    else if (kind === 'deleted') text = `${label}: ${fromText}`;
    else text = `${label}: ${fromText} → ${toText}`;
    return { key, label, text, long, fromText, toText };
  };

  const lines = [
    ...HISTORY_FIELDS.filter((field) => field in changes)
      .map((field) => line(field, LABELS[field], changes[field].from, changes[field].to, field)),
    ...Object.keys(revenue).sort().map((year) => line(`revenue_${year}`, `Revenue ${year}`, revenue[year].from, revenue[year].to, 'revenue')),
  ];
  return { id: row.id, when: firmTime(row.created_at), who: who(row), kind, title, lines };
}

/** "Last changed by jeff on Sep 28, 2026, 4:34 PM", from the newest row, or null for none. */
export function lastChangedLine(rows) {
  const [latest] = rows || [];
  if (!latest) return null;
  return `Last changed by ${who(latest)}${VIA[latest.source] || ''} on ${firmTime(latest.created_at)}`;
}

// The client form's fields as the merge after a 409 names them
// (mergeAfterConflict, src/utils/clientForm.js)
export const FORM_LABELS = {
  name: 'Name',
  practiceArea: 'Practice areas',
  conflict_risk: 'Conflict risk',
  lead_id: 'Lead',
  second_chair_id: 'Second chair',
  originator_id: 'Originator',
  originator_is_firm: 'Origination credit to the firm',
  interaction_frequency: 'Cadence',
  stickiness: 'Stickiness',
  high_maintenance: 'High-maintenance',
  notes: 'Notes',
  revenues: 'Revenue',
};

const list = (keys) => {
  const labels = keys.map((key) => FORM_LABELS[key] || key);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
};

/**
 * What the form says after a stale save (409): who saved last and when (the
 * 409's latest_change, or nobody named when the client has no history row),
 * that nothing was saved, what the form now shows (the merge:
 * mergeAfterConflict), and to save again.
 */
export function conflictNotice(latestChange, merge = { theirs: [], kept: [], clashes: [] }) {
  const parts = [
    latestChange
      ? `Not saved: ${who(latestChange)}${VIA[latestChange.source] || ''} saved this client on ${firmTime(latestChange.created_at)}, after you opened it.`
      : 'Not saved: someone saved this client after you opened it.',
  ];
  if (merge.theirs.length > 0) parts.push(`The form now shows their changes to ${list(merge.theirs)}.`);
  else parts.push('The form now shows the client as it is saved.');
  if (merge.kept.length > 0) parts.push(`Your edits to ${list(merge.kept)} are still in the form.`);
  if (merge.clashes.length > 0) parts.push(`You both changed ${list(merge.clashes)}: the form shows yours, and theirs is in the History below.`);
  parts.push(merge.kept.length + merge.clashes.length > 0 ? 'Check the form and save again.' : 'Nothing of yours was lost.');
  return parts.join(' ');
}
