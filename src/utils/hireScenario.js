// An associate in Scenarios (docs/plans/tier-2.md, section 14, S18 and S19):
// one or more hypothetical associates, the second-chair seats proposed for
// them from the partners' books, the partner's picks over the proposals, and
// every person's load before and after. Nothing is written: the hypothetical
// people live only here and in the scenario's saved state, never on the People
// list, in the book, in the AI's prompts or in another tab.
//
// - The seats open to a new associate: a client whose lead is an active
//   partner and that has no second chair, or whose second chair is a partner
//   (the associate would take the seat and free that partner's share, P10).
//   A seat an existing associate or the emeritus holds is never proposed away,
//   and no lead ever changes (P3, P9).
// - Ranked for relief, on P10 as amended whatever the S19 toggle: partners by
//   their total load (lead effort plus the second-chair share, totalLoad in
//   ./departure.js), heaviest first, which is the order of how far each sits
//   above the partners' average; within a partner their seats by the client's
//   effort, heaviest first; practice-area fit with the associate's focus breaks
//   ties, then revenue, then the client's name and id. A seat belongs to its
//   lead and, when a partner holds it as second chair, to that partner too; it
//   ranks with the heavier of the two.
// - Settled one seat at a time, each counted before the next is ranked, so the
//   proposals spread across the heavy partners (as the associate split's do,
//   ./associateSplit.js): the associate gains the second chair's share, a
//   partner who held the seat loses it (P10), and the lead is counted as
//   relieved of the same share. That last is a ranking device, not a figure:
//   under P10 a lead's load never falls when an associate seconds its client
//   (section 14, "What the figures can show today"), so without it every
//   proposal would come from the one heaviest partner's book. It counts only
//   what this scenario proposes, picks or has had accepted, and it is the same
//   with the toggle on or off, so the toggle changes figures, never proposals.
// - The partner's picks come first and count toward the target: { [clientId]:
//   { associateId, seenSecondChairId } }, `associateId` a hypothetical's id
//   (the client's seat goes to it) or null (never propose this client), and
//   `seenSecondChairId` the second chair as the scenario saw it when the pick
//   was made (a person's id as text, or null for an empty seat). A pick P3 or
//   the seat rules refuse, or whose seat has changed since, is not applied:
//   its reason is given and the client is left to the proposals, as a refused
//   pick leaves the default standing in the departure engine.
// - A target stops each associate's proposals: a number of clients, or the
//   active associates' average second-chair effort now (the brief's measure of
//   load since Jeff's decision of 2026-09-25: total effort, the second chair's
//   share of it).
// - "Link to a person" (after the hire): an associate linked to an active
//   associate on the People list is that person in the figures, and the seats
//   that person already holds are its accepted seats.
// - S19's toggle: with it on, the figures beside P10's give a lead 80% of the
//   effort of each client an associate seconds (1 - SECOND_CHAIR_EFFORT_SHARE),
//   before and after. P10 stays the firm's: ./load.js and utils/book.cjs are
//   unchanged, and so is every other tab.
//
// Pure: people, clients, a revenue function and the scenario's entries in.

import { partnershipModel, practiceAreasOf, ratio, SECOND_CHAIR_EFFORT_SHARE, secondChairEffort } from './load.js';
import { resolveEffort } from './clientMetrics.js';
import { createLedger, rankCandidates } from './departure.js';
import { ROLE_ORDER, ROLE_LABELS } from './people.js';

const key = (id) => (id === null || id === undefined ? '' : String(id));
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
const compare = (x, y) => (Math.abs(x - y) < 1e-9 ? 0 : x - y);
const plural = (n, one, many) => (n === 1 ? one : many);

/** The label a new hypothetical associate starts with. */
export const DEFAULT_LABEL = 'New associate';

/** S19: the part of an associate-seconded client's effort its lead carries with the toggle on. */
export const RELIEVED_LEAD_SHARE = 1 - SECOND_CHAIR_EFFORT_SHARE;

/** A scenario-local id for a hypothetical associate ('h1', 'h2', ...): never a People list id. */
export const HYPOTHETICAL_ID = /^h[1-9]\d{0,3}$/;

/** The next free scenario-local id. */
export function nextAssociateId(associates = []) {
  const used = associates.map((a) => Number(/^h(\d+)$/.exec(String(a?.id))?.[1] || 0));
  return `h${Math.max(0, ...used) + 1}`;
}

/**
 * The target a new hypothetical associate starts with: the active associates'
 * average second-chair load, or, when the firm has no active associate, a
 * number of clients: what an active partner seconds today, rounded, at least 1.
 */
export function defaultTarget(people = [], clients = []) {
  if (people.some((p) => p.active && p.role === 'associate')) return { kind: 'average' };
  const partners = people.filter((p) => p.active && p.role === 'partner');
  const ids = new Set(partners.map((p) => key(p.id)));
  const seconded = clients.filter((c) => c.secondChair?.id != null && ids.has(key(c.secondChair.id))).length;
  return { kind: 'count', count: Math.max(1, Math.round(partners.length ? seconded / partners.length : 0)) };
}

/** A new hypothetical associate: the label, no focus, the default target, no link. */
export function newAssociate(associates = [], { people = [], clients = [] } = {}) {
  return { id: nextAssociateId(associates), label: DEFAULT_LABEL, focus: [], target: defaultTarget(people, clients), personId: null };
}

/**
 * S19's figures for a partnershipModel result: each person's lead effort with
 * an associate-seconded client counted at RELIEVED_LEAD_SHARE of its effort,
 * their total (that plus their second-chair effort, unchanged), and the
 * averages and ratios of the active people in each role. `roleOf(person)` is
 * the role of a client's second chair.
 */
export function reliefFigures(model, roleOf) {
  const rows = new Map();
  for (const row of model.rows) {
    let leadEffort = 0;
    for (const client of row.lead.clients) {
      const second = client.secondChair;
      const relieved = second?.id != null && roleOf(second) === 'associate';
      leadEffort += resolveEffort(client) * (relieved ? RELIEVED_LEAD_SHARE : 1);
    }
    rows.set(key(row.person.id), { person: row.person, leadEffort, totalEffort: leadEffort + row.second.effort });
  }
  const averages = {};
  for (const role of ROLE_ORDER) {
    const members = [...rows.values()].filter((r) => r.person.active && r.person.role === role);
    const mean = (pick) => (members.length ? members.reduce((sum, r) => sum + pick(r), 0) / members.length : 0);
    averages[role] = { members: members.length, leadEffort: mean((r) => r.leadEffort), totalEffort: mean((r) => r.totalEffort) };
  }
  for (const r of rows.values()) {
    // Lead books compare with the partners, as partnershipModel's leadRatio does
    const leadAvg = r.person.role === 'partner' || r.leadEffort > 0 ? averages.partner : { members: 0, leadEffort: 0 };
    const own = averages[r.person.role] || { members: 0, totalEffort: 0 };
    r.leadRatio = ratio(r.leadEffort, leadAvg.leadEffort, leadAvg.members);
    r.totalRatio = ratio(r.totalEffort, own.totalEffort, own.members);
  }
  return { rows, averages };
}

// Why a client's seat cannot go to this associate, or null
function seatProblem({ lead, holder, associate }) {
  if (!lead) return 'The client has no lead; give it one in Client Details first.';
  if (!(lead.active && lead.role === 'partner')) {
    return `${lead.name}, the lead, is not an active partner; give the client a lead in Client Details first.`;
  }
  if (associate && key(lead.id) === key(associate.id)) return `${lead.name} is the lead; the second chair must be someone else.`;
  if (holder && holder.role !== 'partner') {
    const role = holder.role === 'emeritus' ? 'the emeritus' : `an ${ROLE_LABELS[holder.role]?.toLowerCase() || holder.role}`;
    return `${holder.name}, ${role}, holds this seat; a hire scenario takes only empty seats and partners' seats.`;
  }
  return null;
}

/**
 * The whole hire scenario.
 *
 * @param {{ people: Array, clients: Array, revenueOf: Function,
 *   associates: Array, picks: Object, relief: boolean }} input
 *   `associates` are { id, label, focus, target, personId }; `target` is
 *   { kind: 'count', count } or { kind: 'average' }; `personId` the linked
 *   person, or null
 * @returns {{
 *   associates: Array, seats: Array, notApplied: Array, removed: Array,
 *   open: Array, partners: Array, before: object, after: object,
 *   relief: object|null, groups: Array, averages: object, totals: object
 * }}
 *   Each associate: { id, label, focus, target, personId, person (who holds
 *   its seats in the figures), hypothetical, linked, linkProblem, goal
 *   ({ kind: 'count', count } or { kind: 'average', effort, members }),
 *   goalProblem, reached, seats }. Each seat: { client, clientId, lead,
 *   holder, revenue, effort, associateId, source ('done', 'pick' or
 *   'proposal'), sharedAreas, partnerLoad, seenSecondChairId }. `notApplied`
 *   are the picks not applied, with `problem` and `stale`; `removed` the
 *   clients the partner took out of the proposals; `open` every seat a
 *   hypothetical associate could take, heaviest partner first; `partners` each
 *   active partner's P10 total load now against the partners' average.
 *   `before` and `after` are partnershipModel results, `after` with the seats
 *   applied and the unlinked hypotheticals added as active associates;
 *   `relief` is S19's figures for both (reliefFigures), or null with the
 *   toggle off.
 */
export function hireScenarioModel({
  people = [], clients = [], revenueOf = () => 0, associates = [], picks = {}, relief = false,
} = {}) {
  const listed = new Map(people.map((p) => [key(p.id), p]));
  // The People list's record for a nested person (the current role and active flag)
  const current = (person) => (person?.id != null ? listed.get(key(person.id)) || person : null);
  const clientById = new Map(clients.map((c) => [key(c.id), c]));
  const before = partnershipModel(people, clients, revenueOf);

  // The associates, each with who holds its seats in the figures
  const linkedTo = new Map();
  const assoc = associates.map((a) => {
    const focus = Array.isArray(a.focus) ? a.focus : [];
    const hypothetical = { id: String(a.id), name: String(a.label || DEFAULT_LABEL), role: 'associate', active: true, hypothetical: true };
    let linked = null;
    let linkProblem = null;
    if (a.personId !== null && a.personId !== undefined && a.personId !== '') {
      const person = listed.get(key(a.personId));
      if (!person) linkProblem = 'The person this associate was linked to is no longer on the People list; the link is not used.';
      else if (!person.active || person.role !== 'associate') {
        linkProblem = `${person.name} is no longer an active associate on the People list; the link is not used.`;
      } else if (linkedTo.has(key(person.id))) {
        linkProblem = `${person.name} is already linked to ${linkedTo.get(key(person.id))}; the link is not used.`;
      } else {
        linked = person;
        linkedTo.set(key(person.id), hypothetical.name);
      }
    }
    return {
      id: String(a.id),
      label: hypothetical.name,
      focus,
      focusSet: new Set(focus),
      target: a.target,
      personId: a.personId ?? null,
      person: linked || hypothetical,
      hypothetical: !linked,
      linked,
      linkProblem,
      seats: [],
    };
  });
  const assocById = new Map(assoc.map((a) => [a.id, a]));
  const assocByPerson = new Map(assoc.map((a) => [key(a.person.id), a]));

  // The goals: the average is the active associates' now (the real ones)
  const assocAverage = before.averages.associate;
  for (const a of assoc) {
    const target = a.target || {};
    a.goalProblem = null;
    if (target.kind === 'average') {
      a.goal = { kind: 'average', effort: assocAverage.second.effort, members: assocAverage.members };
      if (assocAverage.members === 0) {
        a.goalProblem = 'The firm has no active associate to average; choose a number of clients.';
      } else if (!(assocAverage.second.effort > 0)) {
        a.goalProblem = 'The active associates second-chair nothing now, so their average is 0; choose a number of clients.';
      }
    } else {
      const count = Number.isInteger(target.count) && target.count >= 0 ? target.count : 0;
      a.goal = { kind: 'count', count };
    }
  }

  // Everyone's load now, then what the scenario settles
  const ledger = createLedger();
  for (const client of clients) {
    const revenue = revenueOf(client) || 0;
    const effort = resolveEffort(client);
    if (client.lead?.id != null) ledger.add(client.lead.id, 'lead', revenue, effort);
    if (client.secondChair?.id != null) ledger.add(client.secondChair.id, 'second', revenue, effort);
  }
  // The ranking device: what this scenario has counted as relief for each lead
  const relieved = new Map();
  const rankLoad = (person) => ledger.total(person.id).effort - (relieved.get(key(person.id)) || 0);
  const isActivePartner = (p) => !!p && p.active && p.role === 'partner';
  const partnerLoad = (seat) => Math.max(
    rankLoad(seat.lead),
    isActivePartner(seat.holder) ? rankLoad(seat.holder) : -Infinity,
  );

  const seatOf = (client) => {
    const revenue = revenueOf(client) || 0;
    const effort = resolveEffort(client);
    return {
      client,
      clientId: key(client.id),
      lead: current(client.lead),
      holder: current(client.secondChair),
      revenue,
      effort,
    };
  };
  const settled = new Set();
  const settle = (seat, a, source, extra = {}) => {
    const done = { ...seat, ...extra, associateId: a.id, source, sharedAreas: practiceAreasOf(seat.client).filter((x) => a.focusSet.has(x)) };
    done.partnerLoad = partnerLoad(seat);
    if (source !== 'done') {
      ledger.add(a.person.id, 'second', seat.revenue, seat.effort);
      if (seat.holder) ledger.remove(seat.holder.id, 'second', seat.revenue, seat.effort);
    }
    relieved.set(key(seat.lead.id), (relieved.get(key(seat.lead.id)) || 0) + secondChairEffort(seat.effort));
    settled.add(seat.clientId);
    a.seats.push(done);
    return done;
  };

  // 1. What a linked associate already holds: its accepted seats
  for (const client of clients) {
    const a = client.secondChair?.id != null ? assocByPerson.get(key(client.secondChair.id)) : null;
    if (!a || a.hypothetical) continue;
    const seat = seatOf(client);
    if (!seat.lead) continue;
    settle(seat, a, 'done', { seenSecondChairId: String(a.person.id) });
  }

  // 2. The partner's picks, heaviest client first
  const notApplied = [];
  const removed = [];
  const pickEntries = Object.entries(picks || {})
    .map(([clientId, pick]) => ({ clientId: key(clientId), pick: pick || {}, client: clientById.get(key(clientId)) }))
    .filter((p) => p.client)
    .map((p) => ({ ...p, seat: seatOf(p.client) }))
    .sort((x, y) =>
      compare(y.seat.effort, x.seat.effort) ||
      compare(y.seat.revenue, x.seat.revenue) ||
      byName(x.client, y.client) ||
      x.clientId.localeCompare(y.clientId));
  const declined = new Set();
  for (const { clientId, pick, seat } of pickEntries) {
    if (settled.has(clientId)) continue;
    if (pick.associateId === null || pick.associateId === undefined || pick.associateId === '') {
      declined.add(clientId);
      removed.push({ clientId, client: seat.client, lead: seat.lead, holder: seat.holder, revenue: seat.revenue, effort: seat.effort });
      continue;
    }
    const a = assocById.get(String(pick.associateId));
    const seen = pick.seenSecondChairId === undefined || pick.seenSecondChairId === '' ? null : pick.seenSecondChairId;
    let problem = null;
    let stale = false;
    if (!a) problem = 'This pick names an associate no longer in the scenario.';
    else if (!seat.lead || !isActivePartner(seat.lead)) problem = seatProblem({ ...seat, associate: a.person });
    else if (key(seen) !== key(seat.holder?.id)) {
      stale = true;
      const was = seen === null ? 'empty' : `held by ${listed.get(key(seen))?.name || 'someone no longer on the People list'}`;
      const now = seat.holder ? `held by ${seat.holder.name}` : 'empty';
      problem = `The seat was ${was} when this was picked and is ${now} now, so the pick is not applied. Pick it again or remove it.`;
    } else problem = seatProblem({ ...seat, associate: a.person });
    if (problem) {
      notApplied.push({ clientId, client: seat.client, lead: seat.lead, holder: seat.holder, associateId: String(pick.associateId), associate: a || null, seenSecondChairId: seen, problem, stale });
      continue;
    }
    settle(seat, a, 'pick', { seenSecondChairId: seen });
  }

  // 3. The open seats, for the proposals and the picker
  const open = clients
    .map(seatOf)
    .filter((seat) => !seatProblem({ ...seat, associate: null }))
    .map((seat) => ({ ...seat, partnerLoad: partnerLoad(seat) }))
    .sort((x, y) =>
      compare(y.partnerLoad, x.partnerLoad) ||
      compare(y.effort, x.effort) ||
      compare(y.revenue, x.revenue) ||
      byName(x.client, y.client) ||
      x.clientId.localeCompare(y.clientId));

  // 4. The proposals, one seat at a time, to the targets
  const below = (a) => {
    if (a.goalProblem) return false;
    if (a.goal.kind === 'count') return a.seats.length < a.goal.count;
    return compare(ledger.load(a.person.id).second.effort, a.goal.effort) < 0;
  };
  for (;;) {
    const pool = assoc.filter(below);
    if (pool.length === 0) break;
    const candidates = open
      .filter((seat) => !settled.has(seat.clientId) && !declined.has(seat.clientId))
      .map((seat) => {
        const allowed = pool.filter((a) => key(a.person.id) !== key(seat.lead.id));
        const areas = practiceAreasOf(seat.client);
        const fit = Math.max(0, ...allowed.map((a) => areas.filter((x) => a.focusSet.has(x)).length));
        return { seat, allowed, fit, load: partnerLoad(seat) };
      })
      .filter((c) => c.allowed.length > 0)
      .sort((x, y) =>
        compare(y.load, x.load) ||
        compare(y.seat.effort, x.seat.effort) ||
        y.fit - x.fit ||
        compare(y.seat.revenue, x.seat.revenue) ||
        byName(x.seat.client, y.seat.client) ||
        x.seat.clientId.localeCompare(y.seat.clientId));
    if (candidates.length === 0) break;
    const { seat, allowed } = candidates[0];
    // Which associate: the best fit with its focus, then the lighter load (Phase 5's ranking)
    const ranked = rankCandidates(seat.client, allowed.map((a) => a.person), {
      areasOf: (person) => assocByPerson.get(key(person.id)).focusSet,
      loadOf: (person) => ledger.total(person.id),
    });
    settle(seat, assocByPerson.get(key(ranked[0].person.id)), 'proposal', { seenSecondChairId: seat.holder ? String(seat.holder.id) : null });
  }

  for (const a of assoc) a.reached = !a.goalProblem && !below(a);

  // The book after: every seat applied, the unlinked hypotheticals added
  const seats = assoc.flatMap((a) => a.seats);
  const bySeat = new Map(seats.map((s) => [s.clientId, s]));
  const clientsAfter = clients.map((client) => {
    const seat = bySeat.get(key(client.id));
    return seat && seat.source !== 'done' ? { ...client, secondChair: assocById.get(seat.associateId).person } : client;
  });
  const hypotheticals = assoc.filter((a) => a.hypothetical).map((a) => a.person);
  const peopleAfter = [...people, ...hypotheticals];
  const after = partnershipModel(peopleAfter, clientsAfter, revenueOf);

  let reliefModel = null;
  if (relief) {
    const roles = new Map(peopleAfter.map((p) => [key(p.id), p.role]));
    const roleOf = (person) => roles.get(key(person.id)) ?? person.role;
    reliefModel = { before: reliefFigures(before, roleOf), after: reliefFigures(after, roleOf) };
  }

  // Each partner's P10 total load now against the partners' average, heaviest first
  const partnerAvg = before.averages.partner;
  const averageTotal = partnerAvg.lead.effort + partnerAvg.second.effort;
  const partners = before.rows
    .filter((r) => isActivePartner(r.person))
    .map((r) => ({ person: r.person, total: r.lead.effort + r.second.effort, excess: r.lead.effort + r.second.effort - averageTotal }))
    .sort((x, y) => compare(y.total, x.total) || byName(x.person, y.person));

  const beforeRows = new Map(before.rows.map((r) => [key(r.person.id), r]));
  const emptyRow = (person) => ({ person, lead: { clients: [], count: 0, revenue: 0, effort: 0 }, second: { clients: [], count: 0, revenue: 0, effort: 0 }, leadRatio: {}, secondRatio: {} });
  const reliefRow = (side, person) => reliefModel[side].rows.get(key(person.id)) || { person, leadEffort: 0, totalEffort: 0, leadRatio: null, totalRatio: null };
  const groups = ROLE_ORDER.map((role) => {
    const rows = after.rows
      .filter((r) => r.person.role === role && (r.person.active || r.lead.count > 0 || r.second.count > 0 || beforeRows.get(key(r.person.id))?.second.count > 0))
      .map((r) => ({
        person: r.person,
        hypothetical: r.person.hypothetical === true,
        associate: assocByPerson.get(key(r.person.id)) || null,
        before: beforeRows.get(key(r.person.id)) || emptyRow(r.person),
        after: r,
        relief: reliefModel ? { before: reliefRow('before', r.person), after: reliefRow('after', r.person) } : null,
      }));
    const total = (row) => row.before.lead.effort + row.before.second.effort;
    rows.sort((x, y) => (role === 'partner'
      ? compare(total(y), total(x)) || byName(x.person, y.person)
      : Number(y.hypothetical || !!y.associate) - Number(x.hypothetical || !!x.associate) || byName(x.person, y.person)));
    return { role, label: role === 'emeritus' ? 'Emeritus' : `${ROLE_LABELS[role]}s`, rows };
  }).filter((g) => g.rows.length > 0);

  const bySource = (source) => seats.filter((s) => s.source === source).length;
  return {
    associates: assoc.map(({ focusSet: _focusSet, ...a }) => a),
    seats,
    notApplied,
    removed,
    open,
    partners,
    before,
    after,
    relief: reliefModel,
    groups,
    averages: {
      partnerTotal: averageTotal,
      associateSecond: { effort: assocAverage.second.effort, count: assocAverage.second.count, members: assocAverage.members },
      associateSecondAfter: after.averages.associate,
    },
    totals: {
      seats: seats.length,
      done: bySource('done'),
      picked: bySource('pick'),
      proposed: bySource('proposal'),
      revenue: seats.reduce((sum, s) => sum + s.revenue, 0),
      effort: seats.reduce((sum, s) => sum + s.effort, 0),
      notApplied: notApplied.length,
    },
  };
}

/** "Picked 2 of 4", or how a target reads: "4 clients", "the associates' average (1.2 effort)". */
export function targetText(goal) {
  if (!goal) return '';
  if (goal.kind === 'count') return `${goal.count} ${plural(goal.count, 'client', 'clients')}`;
  return `the associates' average second-chair effort (${(Math.round(goal.effort * 10) / 10).toString()})`;
}

/**
 * The picks with one client's pick set: an associate's id (the seat goes to
 * it, as the scenario sees it now), null (never propose the client), or
 * undefined to forget the pick (the proposals decide again).
 */
export function withPick(picks = {}, client, associateId) {
  const next = { ...picks };
  const id = key(client?.id);
  if (associateId === undefined) delete next[id];
  else next[id] = { associateId: associateId === null ? null : String(associateId), seenSecondChairId: client?.secondChair?.id != null ? String(client.secondChair.id) : null };
  return next;
}

/** The picks without any that name the associate `associateId` (it was removed from the scenario). */
export function withoutAssociatePicks(picks = {}, associateId) {
  return Object.fromEntries(Object.entries(picks).filter(([, pick]) => String(pick?.associateId) !== String(associateId)));
}

/**
 * Whether a seat can be accepted now, after the hire (P9: one at a time): it
 * needs a linked person, and a pick's seat as the scenario saw it; `holder`
 * is the seat as the page shows it now, which the route then checks again.
 * Returns { ok, reason, expectedSecondChairId }.
 */
export function acceptance(seat, associate) {
  if (!associate?.linked) return { ok: false, reason: 'Link this associate to a person on the People list first.' };
  if (seat.source === 'done') return { ok: false, reason: `${associate.linked.name} is its second chair.` };
  return { ok: true, reason: null, expectedSecondChairId: seat.holder ? seat.holder.id : null };
}
