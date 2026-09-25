// The departure engine (docs/plans/people-and-second-chair.md, Phase 5, P3,
// P5, P9, P10). For one or more people leaving, the clients that need a
// decision, the candidates for each seat, and everyone's load before and after.
//
// - A client a departing person leads needs a new lead: an active partner who
//   is staying. Candidates: the client's second chair first when that person
//   is an active partner who is staying, then practice-area fit (the client's
//   areas that the candidate's current lead book has), then the lighter total
//   load (see below).
// - A second-chair seat a departing person holds becomes empty, and so does
//   the seat of a second chair promoted to lead. Candidates: every active
//   person who is staying, other than the client's lead, by practice-area fit
//   (the areas of every client they hold now, in either seat), then the
//   lighter total load. Phase 6 (the associate split) reuses rankCandidates,
//   secondChairPool, createLedger and areaIndex as they are.
// - "Load", for both seats, is total effort: the lead effort plus the
//   second-chair effort (SECOND_CHAIR_EFFORT_SHARE of each client's), then the
//   revenue of both seats, then the name. Jeff, 2026-09-25: "total effort is
//   the better measure since we are going to be looking for who to add/remove
//   both lead and second chair responsibilities for." Ranking by one seat's
//   load made a partner with a heavy lead book and no seats look as free as
//   an idle associate.
// - "Lighter load" counts what this scenario has already given each person:
//   the affected clients are settled one at a time, heaviest effort first,
//   and each settled seat adds to its holder's load before the next client is
//   ranked, so a departing partner's book spreads instead of landing on
//   whoever was lightest at the start.
// - "After" applies the partner's choices ({ [clientId]: { leadId,
//   secondChairId } }; a key left out takes the default, a secondChairId of
//   null leaves the seat empty) and otherwise each seat's first candidate. A
//   choice P3 or the departures forbid is not applied: its problem is reported
//   and the default stands. No candidate is a valid outcome: the seat stays
//   empty and the decision says so; the engine never invents one.
//
// Pure: people, clients, ids and a revenue function in, plain objects out.

import {
  partnershipModel,
  practiceAreasOf,
  secondChairEffort,
} from './load.js';
import { resolveEffort } from './clientMetrics.js';
import { ROLE_ORDER, ROLE_LABELS } from './people.js';

const key = (id) => (id === null || id === undefined ? '' : String(id));
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
// Effort and revenue are sums of decimals; treat what rounding leaves as equal
const compare = (x, y) => (Math.abs(x - y) < 1e-9 ? 0 : x - y);
const zero = () => ({ count: 0, revenue: 0, effort: 0 });

/**
 * A person's total load from their two seats: { effort, revenue, lead,
 * second }, effort being the lead effort plus the second-chair effort (which
 * already carries the share), revenue both seats' revenue. What candidates
 * rank on.
 */
export function totalLoad({ lead = zero(), second = zero() } = {}) {
  return {
    effort: (lead.effort || 0) + (second.effort || 0),
    revenue: (lead.revenue || 0) + (second.revenue || 0),
    lead: { ...lead },
    second: { ...second },
  };
}

/**
 * Each person's lead and second-chair load, kept current as seats are settled.
 * `seat` is 'lead' or 'second'; a second chair's effort is the share (P10).
 */
export function createLedger() {
  const loads = new Map();
  const get = (personId) => {
    const k = key(personId);
    if (!loads.has(k)) loads.set(k, { lead: zero(), second: zero() });
    return loads.get(k);
  };
  const change = (personId, seat, revenue, effort, sign) => {
    const load = get(personId)[seat];
    load.count += sign;
    load.revenue += sign * (revenue || 0);
    load.effort += sign * (seat === 'second' ? secondChairEffort(effort) : effort || 0);
  };
  return {
    load: (personId) => get(personId),
    total: (personId) => totalLoad(get(personId)),
    add: (personId, seat, revenue, effort) => change(personId, seat, revenue, effort, 1),
    remove: (personId, seat, revenue, effort) => change(personId, seat, revenue, effort, -1),
  };
}

/**
 * The practice areas of each person's clients now: `lead` from the clients
 * they lead, `any` from the clients they hold in either seat.
 */
export function areaIndex(clients = []) {
  const lead = new Map();
  const any = new Map();
  const addAll = (map, personId, areas) => {
    const k = key(personId);
    if (!map.has(k)) map.set(k, new Set());
    areas.forEach((a) => map.get(k).add(a));
  };
  for (const client of clients) {
    const areas = practiceAreasOf(client);
    if (client.lead?.id != null) {
      addAll(lead, client.lead.id, areas);
      addAll(any, client.lead.id, areas);
    }
    if (client.secondChair?.id != null) addAll(any, client.secondChair.id, areas);
  }
  const empty = new Set();
  return { lead: (id) => lead.get(key(id)) || empty, any: (id) => any.get(key(id)) || empty };
}

/** Who can lead: active partners who are staying (P3). */
export function leadPool(people = [], departing = new Set()) {
  return people.filter((p) => p.active && p.role === 'partner' && !departing.has(key(p.id)));
}

/** Who can second-chair: active people who are staying, other than the lead (P3). */
export function secondChairPool(people = [], departing = new Set(), leadId = null) {
  return people.filter((p) => p.active && !departing.has(key(p.id)) && key(p.id) !== key(leadId));
}

/**
 * Rank a seat's candidates: `preferredId` first (a lead's second chair), then
 * the most of the client's practice areas in `areasOf(person)`, then the
 * lighter `loadOf(person)` by effort, revenue and name. The engine passes
 * each person's total load (`totalLoad`), for both seats.
 * @returns {Array<{ person, preferred, sharedAreas, load }>} `load` is a copy
 *   of the load the candidate was ranked on
 */
export function rankCandidates(client, pool = [], { areasOf = () => new Set(), loadOf = zero, preferredId = null } = {}) {
  const clientAreas = practiceAreasOf(client);
  return pool
    .map((person) => {
      const theirs = areasOf(person) || new Set();
      return {
        person,
        preferred: preferredId !== null && preferredId !== undefined && key(person.id) === key(preferredId),
        sharedAreas: clientAreas.filter((a) => theirs.has(a)),
        load: { ...loadOf(person) },
      };
    })
    .sort((a, b) =>
      Number(b.preferred) - Number(a.preferred) ||
      b.sharedAreas.length - a.sharedAreas.length ||
      compare(a.load.effort, b.load.effort) ||
      compare(a.load.revenue, b.load.revenue) ||
      byName(a.person, b.person));
}

/**
 * Why a pick cannot hold a seat, or null when it can (P3 and the departures).
 * `leadId` null means no lead was picked; a `secondChairId` of null is an
 * empty seat, which is allowed.
 */
export function assignmentProblems(people = [], departingIds = [], { leadId, secondChairId } = {}) {
  const byId = new Map(people.map((p) => [key(p.id), p]));
  const departing = new Set(departingIds.map(key));
  const problems = { lead: null, secondChair: null };

  if (leadId !== undefined) {
    const lead = byId.get(key(leadId));
    if (leadId === null || leadId === '') problems.lead = 'Every client needs a lead: choose an active partner who is staying.';
    else if (!lead) problems.lead = 'This person is not on the People list.';
    else if (departing.has(key(lead.id))) problems.lead = `${lead.name} is leaving.`;
    else if (!lead.active) problems.lead = `${lead.name} is inactive.`;
    else if (lead.role !== 'partner') problems.lead = `${lead.name} is not a partner; the lead must be an active partner.`;
  }

  if (secondChairId !== undefined && secondChairId !== null && secondChairId !== '') {
    const second = byId.get(key(secondChairId));
    if (!second) problems.secondChair = 'This person is not on the People list.';
    else if (departing.has(key(second.id))) problems.secondChair = `${second.name} is leaving.`;
    else if (!second.active) problems.secondChair = `${second.name} is inactive.`;
    else if (leadId !== undefined && leadId !== null && key(second.id) === key(leadId)) {
      problems.secondChair = `${second.name} is the lead; the second chair must be someone else.`;
    }
  }
  return problems;
}

/** "the second chair", "shares Healthcare, Energy", or "lighter total load": why a candidate ranks where it does. */
export function candidateReason(candidate) {
  if (!candidate) return '';
  if (candidate.preferred) return 'the second chair';
  if (candidate.sharedAreas.length > 0) return `shares ${candidate.sharedAreas.join(', ')}`;
  return 'lighter total load';
}

const isActivePartner = (p) => !!p && p.active && p.role === 'partner';

/**
 * The whole departure.
 *
 * @param {{ people: Array, clients: Array, departingIds: Array, revenueOf: Function, choices?: Object }} input
 *   clients as the API sends them (lead and secondChair nested); revenueOf
 *   gives a client's revenue in the reporting year
 * @returns {{
 *   departing: Array, decisions: Array, unresolved: Array,
 *   before: object, after: object, groups: Array, totals: object
 * }}
 *   Each decision: { client, revenue, effort, lead, secondChair }, where
 *   `lead` is { before, needed, why, candidates, choice, problem, after,
 *   noCandidate } (`why`: 'leaves', or 'missing' for a lead on record who is
 *   not an active partner) and `secondChair` is { before, vacated, why,
 *   candidates, choice, problem, after, noCandidate } (`why`: 'leaves',
 *   'promoted' or 'inactive'). `choice` is the partner's pick as given,
 *   `problem` why it was not applied, `after` who holds the seat after, and
 *   `noCandidate` that the seat needed someone and nobody can take it.
 *   Decisions are in the order they were settled, heaviest effort first.
 *   `before` and `after` are partnershipModel results; in `after` the departing
 *   people are inactive and hold nothing. `groups` pair each person's rows by
 *   role: { role, label, rows: [{ person, departing, before, after }] }.
 */
export function departureModel({ people = [], clients = [], departingIds = [], revenueOf = () => 0, choices = {} } = {}) {
  const departingKeys = new Set((departingIds || []).map(key));
  const byId = new Map(people.map((p) => [key(p.id), p]));
  const departs = (person) => !!person && departingKeys.has(key(person.id));
  // The People list's record for a nested person (it has the current role and
  // active flag); the nested object for someone missing from the list
  const current = (person) => (person ? byId.get(key(person.id)) || person : null);

  const departing = people
    .filter((p) => departingKeys.has(key(p.id)))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || byName(a, b));

  const before = partnershipModel(people, clients, revenueOf);
  const areas = areaIndex(clients);

  // Loads before any decision: the book without the departing people's seats
  const ledger = createLedger();
  for (const client of clients) {
    const revenue = revenueOf(client) || 0;
    const effort = resolveEffort(client);
    if (client.lead?.id != null && !departs(client.lead)) ledger.add(client.lead.id, 'lead', revenue, effort);
    if (client.secondChair?.id != null && !departs(client.secondChair)) ledger.add(client.secondChair.id, 'second', revenue, effort);
  }

  // Heaviest first, so the largest clients are spread first; a fixed order, so
  // accepting a default never moves another client's default
  const affected = clients
    .filter((c) => departs(c.lead) || departs(c.secondChair))
    .map((client) => ({ client, revenue: revenueOf(client) || 0, effort: resolveEffort(client) }))
    .sort((a, b) =>
      compare(b.effort, a.effort) ||
      compare(b.revenue, a.revenue) ||
      String(a.client.name || '').localeCompare(String(b.client.name || ''), undefined, { sensitivity: 'base' }) ||
      key(a.client.id).localeCompare(key(b.client.id)));

  const staying = leadPool(people, departingKeys);
  const decisions = affected.map(({ client, revenue, effort }) => {
    const choice = choices?.[key(client.id)] || {};
    const leadBefore = current(client.lead);
    const secondBefore = current(client.secondChair);

    // Lead: needed when the lead leaves, or (on a client the departure
    // touches) when the lead on record is not an active partner
    const leadWhy = departs(leadBefore) ? 'leaves' : !isActivePartner(leadBefore) ? 'missing' : null;
    const lead = {
      before: leadBefore, needed: leadWhy !== null, why: leadWhy,
      candidates: [], choice: undefined, problem: null, after: leadBefore, noCandidate: false,
    };
    if (lead.needed) {
      const preferredId = isActivePartner(secondBefore) && !departs(secondBefore) ? secondBefore.id : null;
      lead.candidates = rankCandidates(client, staying, {
        areasOf: (p) => areas.lead(p.id),
        loadOf: (p) => ledger.total(p.id),
        preferredId,
      });
      lead.after = lead.candidates[0]?.person || null;
      if (choice.leadId !== undefined) {
        lead.choice = choice.leadId;
        lead.problem = assignmentProblems(people, departingIds, { leadId: choice.leadId }).lead;
        if (!lead.problem) lead.after = byId.get(key(choice.leadId));
      }
    }

    // Second chair: empty when its holder leaves, is promoted to lead, or
    // (on a client the departure touches) is no longer active
    const promoted = !!secondBefore && !!lead.after && lead.needed && key(lead.after.id) === key(secondBefore.id);
    const secondWhy = !secondBefore ? null
      : departs(secondBefore) ? 'leaves'
        : promoted ? 'promoted'
          : !secondBefore.active ? 'inactive'
            : null;
    const secondChair = {
      before: secondBefore,
      vacated: secondWhy !== null,
      why: secondWhy,
      candidates: rankCandidates(client, secondChairPool(people, departingKeys, lead.after?.id ?? null), {
        areasOf: (p) => areas.any(p.id),
        loadOf: (p) => ledger.total(p.id),
      }),
      choice: undefined,
      problem: null,
      after: null,
      noCandidate: false,
    };
    const defaultSecond = secondChair.vacated ? secondChair.candidates[0]?.person || null : secondBefore;
    secondChair.after = defaultSecond;
    if (choice.secondChairId !== undefined) {
      secondChair.choice = choice.secondChairId;
      if (choice.secondChairId === null || choice.secondChairId === '') {
        secondChair.after = null;
      } else {
        secondChair.problem = assignmentProblems(people, departingIds, {
          leadId: lead.after ? lead.after.id : null,
          secondChairId: choice.secondChairId,
        }).secondChair;
        if (!secondChair.problem) secondChair.after = byId.get(key(choice.secondChairId));
      }
    }
    // Never the lead in both seats (P3), whatever the stored data holds
    if (secondChair.after && lead.after && key(secondChair.after.id) === key(lead.after.id)) {
      secondChair.after = secondChair.candidates[0]?.person || null;
    }
    lead.noCandidate = lead.needed && lead.candidates.length === 0;
    secondChair.noCandidate = secondChair.vacated && secondChair.candidates.length === 0;

    // Settle the seats in the ledger before the next client is ranked
    const countedLead = leadBefore && !departs(leadBefore) ? leadBefore : null;
    if (lead.needed) {
      if (countedLead) ledger.remove(countedLead.id, 'lead', revenue, effort);
      if (lead.after) ledger.add(lead.after.id, 'lead', revenue, effort);
    }
    const countedSecond = secondBefore && !departs(secondBefore) ? secondBefore : null;
    if (key(countedSecond?.id) !== key(secondChair.after?.id)) {
      if (countedSecond) ledger.remove(countedSecond.id, 'second', revenue, effort);
      if (secondChair.after) ledger.add(secondChair.after.id, 'second', revenue, effort);
    }

    return { client, revenue, effort, lead, secondChair };
  });

  // The book after: the affected clients with their new people, and the
  // departing people inactive, so they leave the role averages
  const afterById = new Map(decisions.map((d) => [key(d.client.id), d]));
  const clientsAfter = clients.map((client) => {
    const d = afterById.get(key(client.id));
    return d ? { ...client, lead: d.lead.after, secondChair: d.secondChair.after } : client;
  });
  const peopleAfter = people.map((p) => (departingKeys.has(key(p.id)) ? { ...p, active: false } : p));
  const after = partnershipModel(peopleAfter, clientsAfter, revenueOf);

  const afterRows = new Map(after.rows.map((r) => [key(r.person.id), r]));
  const beforeRows = new Map(before.rows.map((r) => [key(r.person.id), r]));
  const emptyRow = (person) => ({ person, lead: { ...zero(), clients: [] }, second: { ...zero(), clients: [] } });
  const groups = ROLE_ORDER.map((role) => ({
    role,
    label: role === 'emeritus' ? 'Emeritus' : `${ROLE_LABELS[role]}s`,
    rows: before.rows
      .filter((r) => r.person.role === role && (r.person.active || r.lead.count > 0 || r.second.count > 0))
      .map((r) => ({
        person: r.person,
        departing: departs(r.person),
        before: r,
        after: afterRows.get(key(r.person.id)) || emptyRow(r.person),
      }))
      .sort((a, b) => Number(b.departing) - Number(a.departing) || byName(a.person, b.person)),
  })).filter((g) => g.rows.length > 0);
  // Anyone who gains a seat but was not in `before` (not on the list): none in
  // practice, since every candidate comes from the People list
  for (const r of after.rows) {
    if (!beforeRows.has(key(r.person.id)) && (r.lead.count > 0 || r.second.count > 0)) {
      const group = groups.find((g) => g.role === r.person.role);
      if (group) group.rows.push({ person: r.person, departing: false, before: emptyRow(r.person), after: r });
    }
  }

  const unresolved = decisions.filter((d) => d.lead.needed && !d.lead.after);
  return {
    departing,
    decisions,
    unresolved,
    before,
    after,
    groups,
    totals: {
      clients: decisions.length,
      revenue: decisions.reduce((sum, d) => sum + d.revenue, 0),
      newLeads: decisions.filter((d) => d.lead.needed).length,
      seatsToFill: decisions.filter((d) => d.secondChair.vacated).length,
      noLeadCandidate: unresolved.length,
      noSecondChairCandidate: decisions.filter((d) => d.secondChair.noCandidate).length,
    },
  };
}

/** The departing ids with `personId` added, or removed if it was there (the store's toggle). */
export function toggleId(ids = [], personId) {
  return ids.some((x) => key(x) === key(personId)) ? ids.filter((x) => key(x) !== key(personId)) : [...ids, personId];
}

/**
 * The choices with one client's pick merged in: { leadId?, secondChairId? },
 * each key replacing the one before; a null `choice` forgets the client's pick.
 */
export function withChoice(choices = {}, clientId, choice) {
  const next = { ...choices };
  if (choice === null || choice === undefined) delete next[key(clientId)];
  else next[key(clientId)] = { ...(choices[key(clientId)] || {}), ...choice };
  return next;
}
