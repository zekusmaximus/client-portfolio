// Who's carrying what (docs/plans/people-and-second-chair.md, Phase 4, P10).
// Each person's lead book and second-chair load, from the People list and the
// clients' lead_id and second_chair_id, compared with the average of the active
// people in the same role. No capacity ceiling and no weights: clients, revenue
// in the reporting year and effort (getEffort in utils/strategic.cjs, sent by
// the API as client.effort), each shown against the peers' average.
//
// Pure: people, clients and a revenue function in, plain objects out, so the
// Partnership tab, the Dashboard card and the exports agree, and tests can
// import it. Phase 6 (the associate split) reuses it.

import { resolveEffort } from './clientMetrics.js';
import { ROLE_ORDER, ROLE_LABELS } from './people.js';

const emptyLoad = () => ({ clients: [], count: 0, revenue: 0, effort: 0 });

function addTo(load, client, revenue, effort) {
  load.clients.push(client);
  load.count += 1;
  load.revenue += revenue;
  load.effort += effort;
}

const byName = (a, b) => a.person.name.localeCompare(b.person.name, undefined, { sensitivity: 'base' });

/**
 * value ÷ average, or null when there is nothing to compare with: an average of
 * 0, or a role with fewer than two active people (one person is always 1.0×).
 */
export function ratio(value, average, members = 2) {
  if (members < 2 || !average) return null;
  return value / average;
}

/** "1.3×"; "<0.1×" for a load too small to show as 0.1× but not nothing; "—" when there is no comparison. */
export function formatRatio(r) {
  if (r === null || r === undefined || !Number.isFinite(r)) return '—';
  if (r > 0 && r < 0.05) return '<0.1×';
  return `${r.toFixed(1)}×`;
}

/** "$1,234,567", whole dollars. */
export function formatMoney(n) {
  return `$${Math.round(n || 0).toLocaleString('en-US')}`;
}

/** Effort to one decimal: "7.5". */
export function formatEffort(n) {
  return (Math.round((n || 0) * 10) / 10).toString();
}

/** A client's practice areas, whichever name the object carries them under. */
export function practiceAreasOf(client) {
  const areas = client?.practiceArea ?? client?.practice_area;
  return Array.isArray(areas) ? areas.filter(Boolean) : [];
}

/**
 * A set of clients by practice area: [{ area, count, revenue }], most clients
 * first. A client with several areas counts in each; one with none is
 * "Not specified".
 */
export function practiceAreaBreakdown(clients = [], revenueOf = () => 0) {
  const byArea = new Map();
  for (const client of clients) {
    const areas = practiceAreasOf(client);
    for (const area of areas.length ? areas : ['Not specified']) {
      const entry = byArea.get(area) || { area, count: 0, revenue: 0 };
      entry.count += 1;
      entry.revenue += revenueOf(client) || 0;
      byArea.set(area, entry);
    }
  }
  return [...byArea.values()].sort((a, b) => b.count - a.count || b.revenue - a.revenue || a.area.localeCompare(b.area));
}

/**
 * Every revenue year in the book, oldest first: the years in which any client
 * has a revenue row above zero.
 */
export function bookYears(clients = []) {
  const years = new Set();
  for (const client of clients) {
    for (const row of client?.revenues || []) {
      if (row && Number(row.year) && (parseFloat(row.revenue_amount) || 0) > 0) years.add(Number(row.year));
    }
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * The per-year revenue of a set of clients: [{ year, revenue }]. For a
 * person's lead book this is the history of the clients they lead now, not
 * what they led in earlier years.
 */
export function revenueByYear(clients = [], years = [], revenueOfYear) {
  return years.map((year) => ({
    year,
    revenue: clients.reduce((sum, client) => sum + (revenueOfYear(client, year) || 0), 0),
  }));
}

/**
 * The whole picture for the Partnership tab.
 *
 * @param {Array} people the People list ({ id, name, role, active })
 * @param {Array} clients the book as the API sends it (lead and secondChair nested)
 * @param {(client) => number} revenueOf revenue in the reporting year
 * @returns {{
 *   rows: Array<{ person, lead, second, leadRatio, secondRatio }>,
 *   averages: Record<string, { members, lead, second }>,
 *   leadBooks: Array, secondChairs: Array<{ role, label, rows }>,
 *   unled: Array, noSecondChair: Array,
 *   totals: { clients, revenue, effort }
 * }}
 *   `lead` and `second` are { clients, count, revenue, effort }; the ratios
 *   are { count, revenue, effort } against the role's average (null when
 *   there is nothing to compare with). `leadBooks` are the active partners
 *   and anyone else who leads a client, heaviest revenue first; `secondChairs`
 *   group the active people by role, plus anyone inactive who still holds a
 *   seat. `unled` are clients without a lead (saved before the People list).
 */
export function partnershipModel(people = [], clients = [], revenueOf = () => 0) {
  const rows = new Map();
  const rowFor = (person) => {
    if (!rows.has(person.id)) rows.set(person.id, { person, lead: emptyLoad(), second: emptyLoad() });
    return rows.get(person.id);
  };
  people.forEach(rowFor);

  const unled = [];
  const noSecondChair = [];
  const totals = { clients: 0, revenue: 0, effort: 0 };

  for (const client of clients) {
    const revenue = revenueOf(client) || 0;
    const effort = resolveEffort(client);
    totals.clients += 1;
    totals.revenue += revenue;
    totals.effort += effort;

    if (client.lead?.id != null) addTo(rowFor(client.lead).lead, client, revenue, effort);
    else unled.push(client);

    if (client.secondChair?.id != null) addTo(rowFor(client.secondChair).second, client, revenue, effort);
    else if (client.lead?.id != null) noSecondChair.push(client);
  }

  // Averages over the active people in each role, those with no clients included
  const averages = {};
  for (const role of ROLE_ORDER) {
    const members = [...rows.values()].filter((r) => r.person.active && r.person.role === role);
    const mean = (pick) => (members.length ? members.reduce((sum, r) => sum + pick(r), 0) / members.length : 0);
    averages[role] = {
      members: members.length,
      lead: { count: mean((r) => r.lead.count), revenue: mean((r) => r.lead.revenue), effort: mean((r) => r.lead.effort) },
      second: { count: mean((r) => r.second.count), revenue: mean((r) => r.second.revenue), effort: mean((r) => r.second.effort) },
    };
  }

  const withRatios = (row) => {
    const avg = averages[row.person.role] || { members: 0, lead: {}, second: {} };
    // Lead books compare with the partners; someone who cannot lead and leads
    // nothing has no lead-book comparison at all
    const leadAvg = row.person.role === 'partner' || row.lead.count > 0 ? averages.partner : { members: 0, lead: {} };
    return {
      ...row,
      leadRatio: {
        count: ratio(row.lead.count, leadAvg.lead.count, leadAvg.members),
        revenue: ratio(row.lead.revenue, leadAvg.lead.revenue, leadAvg.members),
        effort: ratio(row.lead.effort, leadAvg.lead.effort, leadAvg.members),
      },
      secondRatio: {
        count: ratio(row.second.count, avg.second.count, avg.members),
        revenue: ratio(row.second.revenue, avg.second.revenue, avg.members),
        effort: ratio(row.second.effort, avg.second.effort, avg.members),
      },
    };
  };
  const all = [...rows.values()].map(withRatios);

  const isActivePartner = (r) => r.person.active && r.person.role === 'partner';
  const leadBooks = all
    .filter((r) => isActivePartner(r) || r.lead.count > 0)
    .sort((a, b) => b.lead.revenue - a.lead.revenue || byName(a, b));

  const secondChairs = ROLE_ORDER.map((role) => ({
    role,
    label: role === 'emeritus' ? 'Emeritus' : `${ROLE_LABELS[role]}s`,
    rows: all
      .filter((r) => r.person.role === role && (r.person.active || r.second.count > 0))
      .sort((a, b) => b.second.count - a.second.count || b.second.revenue - a.second.revenue || byName(a, b)),
  })).filter((group) => group.rows.length > 0);

  return { rows: all, averages, leadBooks, secondChairs, unled, noSecondChair, totals };
}

/**
 * The Dashboard's one-line summary: the partner whose lead book carries the
 * most revenue, against the partner average. null when no partner leads
 * anything.
 */
export function heaviestLeadBook(model) {
  const top = model.leadBooks.find((r) => r.person.role === 'partner' && r.lead.count > 0);
  if (!top) return null;
  return { person: top.person, revenue: top.lead.revenue, count: top.lead.count, ratio: top.leadRatio.revenue };
}
