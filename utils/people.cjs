// People in the book and each client's three people: lead, second chair and
// originator (docs/plans/people-and-second-chair.md, P1-P6).
//
// Pure: no db.cjs import, so tests can load it. The routes do the queries and
// call these helpers; the frontend's copy of the picker rules is
// src/utils/people.js.

const ROLES = ['partner', 'emeritus', 'associate'];

// "Firm" is the originator value when the firm holds the credit (P4, and the
// import's `Originator` column); the others are pickers' empty labels.
const RESERVED_NAMES = ['firm', 'unassigned', 'none'];
const NAME_PATTERN = /^[A-Za-z][A-Za-z .'-]*$/;
const NAME_MAX = 100;

/**
 * Validate a person from the People dialog. With `partial`, only the fields
 * present are checked (an update); otherwise name and role are required.
 * Returns `{ errors: [{ field, message }], value }` with the cleaned fields.
 */
function validatePersonInput(input = {}, { partial = false } = {}) {
  const errors = [];
  const value = {};

  if (!partial || input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
    if (!name) {
      errors.push({ field: 'name', message: 'Enter a name.' });
    } else if (name.length > NAME_MAX) {
      errors.push({ field: 'name', message: `Names are at most ${NAME_MAX} characters.` });
    } else if (!NAME_PATTERN.test(name)) {
      errors.push({ field: 'name', message: 'Use letters, spaces, hyphens, apostrophes and periods only.' });
    } else if (RESERVED_NAMES.includes(name.toLowerCase())) {
      errors.push({ field: 'name', message: `"${name}" is reserved and cannot be a person's name.` });
    } else {
      value.name = name;
    }
  }

  if (!partial || input.role !== undefined) {
    if (!ROLES.includes(input.role)) {
      errors.push({ field: 'role', message: 'Role must be partner, emeritus or associate.' });
    } else {
      value.role = input.role;
    }
  }

  if (input.active !== undefined) {
    if (typeof input.active !== 'boolean') {
      errors.push({ field: 'active', message: 'Active must be true or false.' });
    } else {
      value.active = input.active;
    }
  }

  return { errors, value };
}

// A person id from a request: a positive integer, or its decimal string.
// Absent or '' is null; anything else is NaN, which matches nobody.
function parseId(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : NaN;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    return n > 0 ? n : NaN;
  }
  return NaN;
}

/**
 * Validate a client's three people against the people list (P3, P4): the lead
 * must be an active partner, the second chair any other active person, the
 * originator anyone on the list, active or not.
 * Returns `{ errors, value, lead, secondChair, originator }`; `value` holds the
 * columns to write.
 */
function validateAssignment(input = {}, people = []) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const errors = [];
  const leadId = parseId(input.lead_id);
  const secondId = parseId(input.second_chair_id);
  const originatorId = parseId(input.originator_id);

  let lead = null;
  if (leadId === null) {
    errors.push({ field: 'lead_id', message: 'Choose a lead partner.' });
  } else {
    const found = byId.get(leadId);
    if (found && found.role === 'partner' && found.active) lead = found;
    else errors.push({ field: 'lead_id', message: 'The lead must be an active partner.' });
  }

  let secondChair = null;
  if (secondId !== null) {
    const found = byId.get(secondId);
    if (!found || !found.active) {
      errors.push({ field: 'second_chair_id', message: 'The second chair must be an active person on the People list.' });
    } else if (secondId === leadId) {
      errors.push({ field: 'second_chair_id', message: 'The second chair cannot be the lead.' });
    } else {
      secondChair = found;
    }
  }

  let originator = null;
  if (originatorId !== null) {
    const found = byId.get(originatorId);
    if (found) originator = found;
    else errors.push({ field: 'originator_id', message: 'The originator must be on the People list.' });
  }

  const originatorIsFirm = input.originator_is_firm === true || input.originator_is_firm === 'true';

  return {
    errors,
    value: {
      lead_id: lead ? lead.id : null,
      second_chair_id: secondChair ? secondChair.id : null,
      originator_id: originator ? originator.id : null,
      originator_is_firm: originatorIsFirm,
    },
    lead,
    secondChair,
    originator,
  };
}

/**
 * The legacy text columns for a client's people (P6): stored on every write so
 * older code still shows the right names after a rollback. `lobbyist_team` is
 * the whole team, lead first, because the succession metrics read its length
 * as the number of people on the client.
 */
function legacyText({ lead, secondChair, originator, originatorIsFirm }) {
  return {
    primary_lobbyist: lead ? lead.name : '',
    lobbyist_team: [lead, secondChair].filter(Boolean).map((p) => p.name),
    client_originator: originatorIsFirm ? 'Firm' : originator ? originator.name : '',
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Why a change to a person is refused (P5), as sentences; empty when allowed.
 * `current` is the stored person, `next` the requested fields, `counts` the
 * person's `lead_count` and `second_chair_count`.
 */
function personChangeBlockers(current, next = {}, counts = {}) {
  const leads = Number(counts.lead_count) || 0;
  const seconds = Number(counts.second_chair_count) || 0;
  const leavesPartner = current.role === 'partner' && next.role !== undefined && next.role !== 'partner';
  const deactivates = current.active !== false && next.active === false;
  const blockers = [];

  if ((leavesPartner || deactivates) && leads > 0) {
    blockers.push(`${current.name} leads ${plural(leads, 'client')}. Give ${leads === 1 ? 'it' : 'them'} a new lead partner first.`);
  }
  if (deactivates && seconds > 0) {
    blockers.push(`${current.name} is second chair on ${plural(seconds, 'client')}. Change ${seconds === 1 ? 'it' : 'them'} first.`);
  }
  return blockers;
}

// The SQL that brings a client's three people into a `SELECT ... FROM clients c`.
// Add CLIENT_PEOPLE_GROUP_BY to a GROUP BY c.id: grouping by each person's
// primary key is what lets PostgreSQL select their columns.
const CLIENT_PEOPLE_COLUMNS = `
  lp.name AS lead_name, lp.role AS lead_role, lp.active AS lead_active,
  sp.name AS second_chair_name, sp.role AS second_chair_role, sp.active AS second_chair_active,
  op.name AS originator_name, op.role AS originator_role, op.active AS originator_active`;
const CLIENT_PEOPLE_JOINS = `
  LEFT JOIN people lp ON lp.id = c.lead_id
  LEFT JOIN people sp ON sp.id = c.second_chair_id
  LEFT JOIN people op ON op.id = c.originator_id`;
const CLIENT_PEOPLE_GROUP_BY = 'lp.id, sp.id, op.id';

const JOINED_KEYS = ['lead', 'second_chair', 'originator'].flatMap((p) => [`${p}_name`, `${p}_role`, `${p}_active`]);

function joinedPerson(row, prefix) {
  const id = row[`${prefix}_id`];
  if (id === null || id === undefined || row[`${prefix}_name`] == null) return null;
  return { id, name: row[`${prefix}_name`], role: row[`${prefix}_role`], active: row[`${prefix}_active`] };
}

/**
 * Turn a joined client row into the API shape: `lead`, `secondChair` and
 * `originator` as `{ id, name, role, active }` or null, and the legacy fields
 * filled from them for a client saved under P3 (one with a lead). A client
 * without a lead keeps its stored legacy values (P6).
 */
function withPeopleFields(row) {
  const out = { ...row };
  for (const key of JOINED_KEYS) delete out[key];

  const lead = joinedPerson(row, 'lead');
  const secondChair = joinedPerson(row, 'second_chair');
  const originator = joinedPerson(row, 'originator');
  const originatorIsFirm = row.originator_is_firm === true;

  out.lead = lead;
  out.secondChair = secondChair;
  out.originator = originator;
  out.originator_is_firm = originatorIsFirm;
  if (lead) Object.assign(out, legacyText({ lead, secondChair, originator, originatorIsFirm }));
  return out;
}

module.exports = {
  ROLES,
  RESERVED_NAMES,
  validatePersonInput,
  parseId,
  validateAssignment,
  legacyText,
  personChangeBlockers,
  CLIENT_PEOPLE_COLUMNS,
  CLIENT_PEOPLE_JOINS,
  CLIENT_PEOPLE_GROUP_BY,
  withPeopleFields,
};
