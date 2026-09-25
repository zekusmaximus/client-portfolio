// The associate split (docs/plans/people-and-second-chair.md, Phase 6, P9):
// the clients with a lead and no second chair, a proposed second chair for
// each from the associates, and each associate's second-chair load before and
// after, against the associates' average. A partner accepts or edits each
// proposal; accepting writes that one seat (PUT /api/data/clients/:id/
// second-chair). Lead changes are never proposed here (P9).
//
// The ranking is Phase 5's (./departure.js), as it is: practice-area fit with
// every client the person holds now, then the lighter total load (lead effort
// plus the second-chair share, then revenue, then name). Proposals are settled
// heaviest client first and each adds to its associate's load before the next
// client is ranked, so they spread across the associates. The proposal is the
// best-ranked associate; the picker also offers everyone else P3 allows (any
// active person but the lead), after the associates.
//
// Pure: people, clients, a revenue function and the partner's picks in.

import { partnershipModel } from './load.js';
import { resolveEffort } from './clientMetrics.js';
import {
  areaIndex,
  assignmentProblems,
  createLedger,
  rankCandidates,
  secondChairPool,
} from './departure.js';

const key = (id) => (id === null || id === undefined ? '' : String(id));
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
const compare = (x, y) => (Math.abs(x - y) < 1e-9 ? 0 : x - y);
const nobodyLeaving = new Set();

/**
 * @param {{ people: Array, clients: Array, revenueOf: Function, picks?: Object }} input
 *   `picks` are the partner's edits, { [clientId]: personId | null }: a person
 *   in place of the proposal, or null for "not now" (the seat stays empty)
 * @returns {{
 *   proposals: Array, associates: Array, averages: { before, after },
 *   before: object, after: object, totals: object
 * }}
 *   Each proposal: { client, lead, revenue, effort, candidates, proposal,
 *   pick, problem, after, blocker }. `candidates` are the associates in rank
 *   order, then everyone else P3 allows; `proposal` the first associate, or
 *   null when there is none; `after` who the seat would go to (the valid pick,
 *   or the proposal); `problem` why a pick was not applied; `blocker` why the
 *   client cannot take a second chair here (its lead is not an active
 *   partner). `associates` pair each active associate's rows before and
 *   after, busiest first.
 */
export function associateSplitModel({ people = [], clients = [], revenueOf = () => 0, picks = {} } = {}) {
  const byId = new Map(people.map((p) => [key(p.id), p]));
  const before = partnershipModel(people, clients, revenueOf);
  const areas = areaIndex(clients);

  // Everyone's load now; each proposal adds to it before the next client
  const ledger = createLedger();
  for (const client of clients) {
    const revenue = revenueOf(client) || 0;
    const effort = resolveEffort(client);
    if (client.lead?.id != null) ledger.add(client.lead.id, 'lead', revenue, effort);
    if (client.secondChair?.id != null) ledger.add(client.secondChair.id, 'second', revenue, effort);
  }

  const open = clients
    .filter((c) => c.lead?.id != null && c.secondChair?.id == null)
    .map((client) => ({ client, revenue: revenueOf(client) || 0, effort: resolveEffort(client) }))
    .sort((a, b) =>
      compare(b.effort, a.effort) ||
      compare(b.revenue, a.revenue) ||
      String(a.client.name || '').localeCompare(String(b.client.name || ''), undefined, { sensitivity: 'base' }) ||
      key(a.client.id).localeCompare(key(b.client.id)));

  const proposals = open.map(({ client, revenue, effort }) => {
    const lead = byId.get(key(client.lead.id)) || client.lead;
    const blocker = lead.active && lead.role === 'partner'
      ? null
      : `${lead.name}, the lead, is not an active partner; give the client a lead in Client Details first.`;
    const ranked = blocker ? [] : rankCandidates(client, secondChairPool(people, nobodyLeaving, lead.id), {
      areasOf: (p) => areas.any(p.id),
      loadOf: (p) => ledger.total(p.id),
    });
    const candidates = [
      ...ranked.filter((c) => c.person.role === 'associate'),
      ...ranked.filter((c) => c.person.role !== 'associate'),
    ];
    const proposal = candidates.find((c) => c.person.role === 'associate')?.person || null;

    const pick = Object.prototype.hasOwnProperty.call(picks, key(client.id)) ? picks[key(client.id)] : undefined;
    let after = proposal;
    let problem = null;
    if (pick === null || pick === '') {
      after = null;
    } else if (pick !== undefined) {
      problem = assignmentProblems(people, [], { leadId: lead.id, secondChairId: pick }).secondChair;
      if (!problem) after = byId.get(key(pick));
    }
    if (blocker) after = null;
    if (after) ledger.add(after.id, 'second', revenue, effort);

    return { client, lead, revenue, effort, candidates, proposal, pick, problem, after, blocker };
  });

  const byClient = new Map(proposals.map((p) => [key(p.client.id), p]));
  const clientsAfter = clients.map((c) => {
    const p = byClient.get(key(c.id));
    return p && p.after ? { ...c, secondChair: p.after } : c;
  });
  const after = partnershipModel(people, clientsAfter, revenueOf);
  const afterRows = new Map(after.rows.map((r) => [key(r.person.id), r]));
  const associates = before.rows
    .filter((r) => r.person.active && r.person.role === 'associate')
    .map((r) => ({ person: r.person, before: r, after: afterRows.get(key(r.person.id)) }))
    .sort((a, b) => b.after.second.count - a.after.second.count || byName(a.person, b.person));

  return {
    proposals,
    associates,
    averages: { before: before.averages.associate, after: after.averages.associate },
    before,
    after,
    totals: {
      open: proposals.length,
      proposed: proposals.filter((p) => p.after).length,
      revenue: proposals.reduce((sum, p) => sum + p.revenue, 0),
      associates: associates.length,
    },
  };
}
