// The People list on the page: who each picker offers and how a client's people
// read (docs/plans/people-and-second-chair.md, P1-P4). Pure; the server applies
// the same rules in utils/people.cjs and has the last word.

export const ROLE_ORDER = ['partner', 'emeritus', 'associate'];
export const ROLE_LABELS = { partner: 'Partner', emeritus: 'Emeritus', associate: 'Associate' };

const byRoleThenName = (a, b) =>
  ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Everyone, grouped the way the People dialog shows them: active by role, then inactive. */
export function groupPeople(people = []) {
  const groups = ROLE_ORDER.map((role) => ({
    key: role,
    label: role === 'emeritus' ? 'Emeritus' : `${ROLE_LABELS[role]}s`,
    people: people.filter((p) => p.active && p.role === role).sort(byRoleThenName),
  }));
  groups.push({ key: 'inactive', label: 'Inactive', people: people.filter((p) => !p.active).sort(byRoleThenName) });
  return groups;
}

/** The lead picker: active partners (P3). */
export function leadCandidates(people = []) {
  return people.filter((p) => p.active && p.role === 'partner').sort(byRoleThenName);
}

/** The second-chair picker: every active person except the lead (P3). */
export function secondChairCandidates(people = [], leadId = null) {
  return people.filter((p) => p.active && p.id !== leadId).sort(byRoleThenName);
}

/** The originator picker: active people, plus the current originator if inactive (P4). */
export function originatorCandidates(people = [], currentId = null) {
  return people.filter((p) => p.active || p.id === currentId).sort(byRoleThenName);
}

/** "Jay (Emeritus)", "Kevin (Partner)", "Steve (Partner, inactive)". */
export function personLabel(person) {
  if (!person) return '';
  const role = ROLE_LABELS[person.role] || person.role;
  return `${person.name} (${role}${person.active === false ? ', inactive' : ''})`;
}

/**
 * Who holds the origination credit, as the client list and cards show it:
 * "Kevin", "Firm (originated by Kevin)", "Firm", or '' when nothing is recorded.
 * Falls back to the legacy text for a client not yet saved with a lead.
 */
export function originatorLabel(client = {}) {
  const name = client.originator?.name;
  if (client.originator_is_firm) return name ? `Firm (originated by ${name})` : 'Firm';
  if (name) return name;
  return client.client_originator || '';
}

/**
 * The legacy people fields for a form's selections (ids as strings), as
 * legacyText in utils/people.cjs writes them: the views not yet rebuilt, such
 * as the form's succession preview, read these.
 */
export function legacyPeopleFields({ lead_id, second_chair_id, originator_id, originator_is_firm } = {}, people = []) {
  const byId = new Map(people.map((p) => [String(p.id), p]));
  const lead = byId.get(String(lead_id ?? ''));
  const secondChair = byId.get(String(second_chair_id ?? ''));
  const originator = byId.get(String(originator_id ?? ''));
  return {
    primary_lobbyist: lead ? lead.name : '',
    lobbyist_team: [lead, secondChair].filter(Boolean).map((p) => p.name),
    client_originator: originator_is_firm ? 'Firm' : originator ? originator.name : '',
  };
}

/** A select's string value back to a person id, or null for "None". */
export function toPersonId(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The client list's lead and second-chair filters: who each offers. The lead
 * filter offers the active partners and anyone else who leads a client; the
 * second-chair filter offers everyone active and anyone inactive still in a
 * seat. `seat` is 'lead' or 'second'.
 */
export function personFilterOptions(people = [], clients = [], seat = 'lead') {
  const key = seat === 'lead' ? 'lead' : 'secondChair';
  const holding = new Set(clients.map((c) => c?.[key]?.id).filter((id) => id !== null && id !== undefined));
  return people
    .filter((p) => holding.has(p.id) || (p.active && (seat !== 'lead' || p.role === 'partner')))
    .sort(byRoleThenName);
}

/**
 * Whether a client's person in one seat passes a filter value: 'all', 'none'
 * (the seat is empty), or a person id as the select gives it (a string).
 */
export function matchesPersonFilter(person, filter = 'all') {
  if (filter === 'all') return true;
  if (filter === 'none') return person === null || person === undefined;
  return person !== null && person !== undefined && String(person.id) === String(filter);
}
