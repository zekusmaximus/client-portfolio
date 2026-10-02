// Where a new client fits (docs/plans/tier-3.md, section 14, WP6; the brief's
// third glanceable truth, U12 (b)): a hypothetical client from a partner's
// picks, the lead Stage 1's engine would propose for it, the second chair the
// associate split would propose, everyone's load before and after, and where
// the client lands among the book's clients, in words. Nothing is written:
// the client lives only here (HYPOTHETICAL_CLIENT_ID, text no stored id
// matches on either table shape), never in the book, the AI's prompts, the
// People list or another tab, and only the Scenarios tab's view and the store
// import this module (tests/client-fit.test.mjs checks the importers).
//
// - The lead is Stage 1's answer with nobody leaving (./departure.js, as it
//   is): the active partners (leadPool), ranked by rankCandidates on the
//   practice areas of each partner's lead book (areaIndex(clients).lead) and
//   each person's total load from a ledger of every seat in the book, with no
//   second chair to prefer. A new client is a client whose lead is leaving
//   before they ever had one, so departureModel with the client added under a
//   ghost partner marked as leaving gives, as its one decision, the same
//   candidates in the same order with the same reasons and loads, the same
//   fate for the choice and the same seat (the test holds it so). Fit ranks
//   before load, as Stage 1 ranks (14.8, trap 1): a partner who leads one
//   client in the area ranks above an idle partner without it, whatever their
//   loads, so the reason and the load show on every row and the partner
//   decides. With no shared area, equal loads rank by revenue, then by name
//   (trap 2).
// - The second chair is the associate split's answer (./associateSplit.js,
//   U23 (a)): everyone P3 allows but the lead (secondChairPool), ranked on the
//   areas of every client they hold (areaIndex(clients).any) and the ledger,
//   the associates first, the best-ranked active associate proposed or none;
//   None and any of them pickable. Stage 1 proposes a second chair only for a
//   vacated seat and leaves a never-held seat empty, so the split is the code
//   for an empty seat; the test holds this to associateSplitModel over the
//   book with the client added under its lead and every other open seat "not
//   now".
// - The partner's choice ({ leadId?, secondChairId? }, as the engine takes
//   one) is applied unless assignmentProblems gives a reason, and the proposal
//   then stands, as a refused pick leaves the default standing in Stage 2; a
//   secondChairId of null is "None".
// - The loads are partnershipModel's (./load.js, P10 as amended): `before`
//   the book, `after` the book with the client and its two seats. The lead
//   gains the client's full effort and the second chair
//   SECOND_CHAIR_EFFORT_SHARE of it; nothing else moves, and the partners'
//   average lead figures move by the client's share over the active partners,
//   so every other partner's ratio falls a notch (trap 3): the averages' line
//   shows it.
// - The strategic value is the page's mirror of the scorer
//   (resolveStrategicValue, strategicValueParts in ./clientMetrics.js,
//   U21 (a)), rounded as the API rounds before the client is placed among
//   the book's clients, whose figures are the API's (trap 12). The typed
//   amount is the client's revenue in the reporting year (D4) and, for the
//   score, its own latest year (D6): the same year for a client with one row.
//   An unrated Stickiness scores the stand-in, 40 / 9, and the lines say what
//   the book's legend says: the same for every unrated client, not a rating
//   (trap 5); its exposure band is "not rated", never "rated 3 to 5".
// - The conflict flag (U25 (a)) is the partner's own pick, with its penalty
//   in the score and flagged when High; the book holds nothing a conflict
//   check could read.
//
// Pure: people, clients, a revenue function and the partner's picks in.

import { partnershipModel, formatMoney, formatEffort, practiceAreasOf } from './load.js';
import { resolveEffort, strategicValueParts, resolveStrategicValue, UNRATED_STICKINESS, REVENUE_WEIGHT, STICKINESS_WEIGHT } from './clientMetrics.js';
import {
  areaIndex,
  assignmentProblems,
  candidateReason,
  createLedger,
  leadPool,
  rankCandidates,
  secondChairPool,
} from './departure.js';
import { stickinessPick, stickinessText, THIN_STICKINESS } from './exposure.js';
import { ROLE_ORDER, ROLE_LABELS } from './people.js';
import { VALIDATION_RULES, PRACTICE_AREAS } from './validation.js';

const key = (id) => (id === null || id === undefined ? '' : String(id));
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
// Effort and revenue are sums of decimals; treat what rounding leaves as equal
const compare = (x, y) => (Math.abs(x - y) < 1e-9 ? 0 : x - y);
const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const round2 = (n) => Math.round(n * 100) / 100;
// One decimal, settled first as the page's formatters settle a figure
const fmt1 = (n) => (Math.round(Number((Number(n) || 0).toPrecision(12)) * 10) / 10).toFixed(1);
const nobodyLeaving = new Set();
const isAssociate = (c) => c.person.role === 'associate';

/** The hypothetical client's id: text no stored id matches, on integer or uuid ids. */
export const HYPOTHETICAL_CLIENT_ID = 'new-client';

/** The name the client shows until one is typed. */
export const DEFAULT_NAME = 'New client';

/** The client form's vocabularies (src/utils/validation.js, held equal to utils/clientRules.cjs): the 21 practice areas offered, never a retired one. */
export { PRACTICE_AREAS };
export const CADENCES = VALIDATION_RULES.interaction_frequency.allowedValues;
export const CONFLICT_RISKS = VALIDATION_RULES.conflict_risk.allowedValues;

/**
 * The picks a new sandbox starts with: the client form's defaults for a new
 * client (no name, no revenue, no practice area, no cadence, not a handful,
 * not rated, Medium conflict risk). The keys are the form's field names, so
 * the draft "Add on Client Details" hands the form carries them as they are.
 */
export const emptyPicks = () => ({
  name: '',
  revenue: '',
  practiceArea: [],
  interaction_frequency: '',
  high_maintenance: false,
  stickiness: null,
  conflict_risk: 'Medium',
});

/** The store's slice for a new sandbox: the picks and the partner's choice of seats. */
export const emptySandbox = () => ({ picks: emptyPicks(), choice: {} });

/** Whether a sandbox holds anything a partner entered: a pick off the defaults, or a choice. */
export function sandboxEntered(sandbox = {}) {
  const picks = { ...emptyPicks(), ...(sandbox.picks || {}) };
  const choice = sandbox.choice || {};
  return text(picks.name) !== ''
    || text(picks.revenue) !== ''
    || (Array.isArray(picks.practiceArea) && picks.practiceArea.length > 0)
    || text(picks.interaction_frequency) !== ''
    || picks.high_maintenance === true
    || (picks.stickiness !== null && picks.stickiness !== undefined && picks.stickiness !== '')
    || (picks.conflict_risk !== 'Medium' && picks.conflict_risk !== undefined)
    || Object.values(choice).some((v) => v !== undefined);
}

// The typed amount as a number, or null for blank or bad (a negative amount,
// text that is not a number)
const readAmount = (value) => {
  const s = text(value);
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * The client as the API would send one, from the picks: each pick in the
 * form's vocabulary or the form's default (a cadence or conflict risk off the
 * list, or a Stickiness that is not 1 to 5, reads as the default); one revenue
 * row for the reporting year when an amount is typed (a blank or bad amount is
 * no row); `effort` from resolveEffort, as the API computes it; `strategicValue`
 * and `stickinessScore` rounded as the API rounds. `named` says whether a name
 * was typed (the name is DEFAULT_NAME otherwise); `hypothetical` marks it.
 */
export function hypotheticalClient(picks = {}, reportingYear) {
  const typed = text(picks.name);
  const practiceArea = PRACTICE_AREAS.filter((a) => Array.isArray(picks.practiceArea) && picks.practiceArea.includes(a));
  const cadence = CADENCES.includes(picks.interaction_frequency) ? picks.interaction_frequency : '';
  const conflict = CONFLICT_RISKS.includes(picks.conflict_risk) ? picks.conflict_risk : 'Medium';
  const stickiness = stickinessPick({ stickiness: picks.stickiness });
  const amount = readAmount(picks.revenue);
  const year = Number(reportingYear);
  const revenues = amount !== null && Number.isInteger(year) ? [{ year, revenue_amount: amount }] : [];
  const client = {
    id: HYPOTHETICAL_CLIENT_ID,
    name: typed || DEFAULT_NAME,
    named: typed !== '',
    hypothetical: true,
    practiceArea,
    practice_area: practiceArea,
    interaction_frequency: cadence,
    high_maintenance: picks.high_maintenance === true,
    stickiness,
    conflict_risk: conflict,
    conflictRisk: conflict,
    notes: '',
    lead: null,
    secondChair: null,
    originator: null,
    originator_is_firm: false,
    revenues,
  };
  const parts = strategicValueParts(client);
  return {
    ...client,
    effort: resolveEffort(client),
    averageRevenue: Math.round(parts.revenue),
    stickinessScore: round2(parts.stickiness),
    strategicValue: round2(parts.value),
  };
}

/** "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st". */
export function ordinal(n) {
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
  return `${n}${suffix}`;
}

// Where `figure` ranks among `figures` plus itself: 1 + the figures above it
// (equal figures tie), of them all plus one
const place = (figure, figures) => ({
  place: 1 + figures.filter((f) => compare(f, figure) > 0).length,
  of: figures.length + 1,
});

/** The exposure band's words, as the book's `## Exposure` lines name the bands (T5). */
export const BAND_TEXT = {
  thin: 'rated 1 or 2 (thin)',
  unrated: 'not rated (unknown, never safe)',
  solid: 'rated 3 to 5',
};

/** The sandbox's lines about the client (14.3), from a model's figures. */
export function clientLines({ client, revenue, effort, score, band, rank, reportingYear }) {
  const pick = stickinessPick(client);
  const hasRow = client.revenues.length > 0;
  const facts = [
    hasRow ? `${formatMoney(revenue)} in ${reportingYear}` : `no revenue in ${reportingYear}`,
    practiceAreasOf(client).join(', ') || 'no practice area',
    `${client.interaction_frequency || 'cadence not set'}${client.high_maintenance ? ', a handful' : ''}`,
    `Stickiness ${stickinessText(pick)}`,
    `conflict risk ${client.conflict_risk}`,
  ].join(', ');
  const stickiness = score.rated ? fmt1(score.stickiness) : UNRATED_STICKINESS.toFixed(2);
  const clamped = score.exact !== score.unclamped;
  return {
    facts: `${client.name}: ${facts}`,
    effort: `Effort ${formatEffort(effort)} (${ordinal(rank.effort.place)} of ${rank.effort.of} clients by effort).`,
    score: `Strategic value ${fmt1(score.value)} = revenue ${fmt1(score.revenueScore)} × ${REVENUE_WEIGHT} + stickiness ${stickiness} × ${STICKINESS_WEIGHT} − conflict ${score.penalty}`
      + `${clamped ? `, kept within 0 to 10` : ''} (${ordinal(rank.strategicValue.place)} of ${rank.strategicValue.of} by strategic value; `
      + `${ordinal(rank.revenue.place)} of ${rank.revenue.of} by revenue in ${reportingYear}).`,
    standIn: score.rated ? null : `Not rated: ${UNRATED_STICKINESS.toFixed(2)} is the stand-in every unrated client scores with, not a rating.`,
    exposure: `Exposure: ${BAND_TEXT[band]}.`,
  };
}

const zeroLoad = () => ({ clients: [], count: 0, revenue: 0, effort: 0 });
const emptyRow = (person) => ({ person, lead: zeroLoad(), second: zeroLoad(), leadRatio: {}, secondRatio: {} });

/**
 * The whole sandbox.
 *
 * @param {{ people: Array, clients: Array, revenueOf: Function, reportingYear: number,
 *   picks: Object, choice: Object }} input
 *   clients as the API sends them (lead and secondChair nested); revenueOf
 *   gives a client's revenue in the reporting year; `picks` as emptyPicks
 *   shapes them; `choice` { leadId?, secondChairId? }, a secondChairId of
 *   null for "None"
 * @returns {{
 *   client, revenue, effort, score, band, rank, lead, secondChair,
 *   before, after, groups, averages, lines
 * }}
 *   `lead` and `secondChair` are { candidates, proposal, choice, problem,
 *   after, noCandidate } as the departure engine shapes a seat: `candidates`
 *   rankCandidates' ({ person, preferred, sharedAreas, load }), in rank order
 *   (the second chair's associates first), `proposal` the engine's pick,
 *   `choice` the partner's as given, `problem` why it was not applied, `after`
 *   who holds the seat, and `noCandidate` that nobody can. `score` is
 *   strategicValueParts' with `value` rounded as the API rounds, `exact`
 *   unrounded, and `high` for a High conflict risk. `band` is 'thin',
 *   'unrated' or 'solid'. `rank` places the client among the book's clients
 *   by strategic value, effort and reporting-year revenue ({ place, of }).
 *   `before` and `after` are partnershipModel results; `groups` the load
 *   table's rows by role, the partners heaviest first, each { person, before,
 *   after, seat }; `averages` { before, after } are partnershipModel's
 *   averages by role; `lines` the client's lines in words (clientLines).
 */
export function clientFitModel({ people = [], clients = [], revenueOf = () => 0, reportingYear, picks = {}, choice = {} } = {}) {
  const byId = new Map(people.map((p) => [key(p.id), p]));
  const client = hypotheticalClient(picks, reportingYear);
  const revenue = revenueOf(client) || 0;
  const effort = resolveEffort(client);

  const before = partnershipModel(people, clients, revenueOf);
  const areas = areaIndex(clients);

  // Everyone's load now: every seat in the book, nobody leaving
  const ledger = createLedger();
  for (const c of clients) {
    const r = revenueOf(c) || 0;
    const e = resolveEffort(c);
    if (c.lead?.id != null) ledger.add(c.lead.id, 'lead', r, e);
    if (c.secondChair?.id != null) ledger.add(c.secondChair.id, 'second', r, e);
  }

  // The lead: Stage 1's ranking, no second chair to prefer
  const leadCandidates = rankCandidates(client, leadPool(people, nobodyLeaving), {
    areasOf: (p) => areas.lead(p.id),
    loadOf: (p) => ledger.total(p.id),
  });
  const lead = {
    candidates: leadCandidates,
    proposal: leadCandidates[0]?.person || null,
    choice: undefined,
    problem: null,
    after: leadCandidates[0]?.person || null,
    noCandidate: leadCandidates.length === 0,
  };
  if (choice.leadId !== undefined) {
    lead.choice = choice.leadId;
    lead.problem = assignmentProblems(people, [], { leadId: choice.leadId }).lead;
    if (!lead.problem) lead.after = byId.get(key(choice.leadId));
  }

  // The second chair: the associate split's ranking and proposal, once there
  // is a lead (the split takes a client with an active partner as lead); the
  // partner's pick is kept as given either way, for the picker
  const secondChair = { candidates: [], proposal: null, choice: choice.secondChairId, problem: null, after: null, noCandidate: false };
  if (lead.after) {
    const ranked = rankCandidates(client, secondChairPool(people, nobodyLeaving, lead.after.id), {
      areasOf: (p) => areas.any(p.id),
      loadOf: (p) => ledger.total(p.id),
    });
    secondChair.candidates = [...ranked.filter(isAssociate), ...ranked.filter((c) => !isAssociate(c))];
    secondChair.proposal = secondChair.candidates.find(isAssociate)?.person || null;
    secondChair.after = secondChair.proposal;
    secondChair.noCandidate = secondChair.candidates.length === 0;
    if (choice.secondChairId !== undefined) {
      if (choice.secondChairId === null || choice.secondChairId === '') {
        secondChair.after = null;
      } else {
        secondChair.problem = assignmentProblems(people, [], {
          leadId: lead.after.id,
          secondChairId: choice.secondChairId,
        }).secondChair;
        if (!secondChair.problem) secondChair.after = byId.get(key(choice.secondChairId));
      }
    }
  }

  // The book after: the client in its two seats
  const placed = { ...client, lead: lead.after, secondChair: secondChair.after };
  const after = partnershipModel(people, [...clients, placed], revenueOf);

  // The score with its parts, the band and the rank among the book's clients
  // (each figure rounded as the API's are, trap 12)
  const parts = strategicValueParts(client);
  const unclamped = parts.revenueScore * REVENUE_WEIGHT + parts.stickiness * STICKINESS_WEIGHT - parts.penalty;
  const score = { ...parts, high: parts.conflictRisk === 'High', value: round2(parts.value), exact: parts.value, unclamped };
  const pick = stickinessPick(client);
  const band = pick === null ? 'unrated' : THIN_STICKINESS.includes(pick) ? 'thin' : 'solid';
  const rank = {
    strategicValue: place(score.value, clients.map((c) => round2(resolveStrategicValue(c)))),
    effort: place(effort, clients.map((c) => resolveEffort(c))),
    revenue: place(revenue, clients.map((c) => revenueOf(c) || 0)),
  };

  // The load table: everyone active or holding a seat, by role, the partners
  // heaviest first (as the hire view lists them) and the others by name
  const beforeRows = new Map(before.rows.map((r) => [key(r.person.id), r]));
  const seatOf = (person) => (key(person.id) === key(lead.after?.id) ? 'lead'
    : key(person.id) === key(secondChair.after?.id) ? 'second' : null);
  const groups = ROLE_ORDER.map((role) => {
    const rows = after.rows
      .filter((r) => r.person.role === role && (r.person.active || r.lead.count > 0 || r.second.count > 0))
      .map((r) => ({ person: r.person, before: beforeRows.get(key(r.person.id)) || emptyRow(r.person), after: r, seat: seatOf(r.person) }));
    const total = (row) => row.before.lead.effort + row.before.second.effort;
    rows.sort((x, y) => (role === 'partner'
      ? compare(total(y), total(x)) || byName(x.person, y.person)
      : byName(x.person, y.person)));
    return { role, label: role === 'emeritus' ? 'Emeritus' : `${ROLE_LABELS[role]}s`, rows };
  }).filter((g) => g.rows.length > 0);

  const averages = { before: before.averages, after: after.averages };
  const lines = clientLines({ client, revenue, effort, score, band, rank, reportingYear });

  return { client, revenue, effort, score, band, rank, lead, secondChair, before, after, groups, averages, lines };
}

/** "shares Healthcare", "lighter total load": the engine's words for a candidate's place. */
export const reasonText = (candidate) => candidateReason(candidate);

/**
 * The client form's state for the sandbox's client ("Add on Client Details",
 * U26 (b)): the picks as typed, one revenue row for the reporting year with
 * the typed amount (blank for none), the lead and the second chair as the
 * form's select values ('' for none), no originator, no notes. The form's own
 * save then runs, with its checks and its history row; the name is '' when
 * none was typed, so the form asks for one.
 */
export function clientDraft(model, reportingYear) {
  const { client, lead, secondChair } = model;
  const amount = client.revenues[0]?.revenue_amount;
  return {
    name: client.named ? client.name : '',
    practiceArea: [...client.practiceArea],
    conflict_risk: client.conflict_risk,
    lead_id: lead.after ? String(lead.after.id) : '',
    second_chair_id: secondChair.after ? String(secondChair.after.id) : '',
    originator_id: '',
    originator_is_firm: false,
    interaction_frequency: client.interaction_frequency,
    stickiness: client.stickiness,
    high_maintenance: client.high_maintenance,
    notes: '',
    revenues: [{ year: Number(reportingYear), revenue_amount: amount === undefined ? '' : String(amount) }],
  };
}
