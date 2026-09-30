// Exposure (docs/plans/tier-1.md, T5; docs/plans/tier-3.md, section 13): the
// reporting-year revenue of clients rated Stickiness 1 or 2, the brief's thin
// relationships, in total and by lead, with the clients nobody has rated
// counted apart, as unknown and never as safe. The Dashboard's exposure card
// and its Exposure sub-tab show it, and a lead's sheet lists the clients
// behind a lead's figures.
//
// A port of the book's exposure (utils/book.cjs: stickinessPick,
// THIN_STICKINESS, band() and the exposure bands in bookModel), so the page
// shows exactly the figures the AI is given. The server never loads this file
// (T3); tests/book.test.mjs holds the two equal with ===, figure for figure,
// and the port's figures written in the book's words equal to the book's
// `## Exposure` lines. Change one side, change the other.
//
// The clients are sorted as the book sorts them (by name regardless of case,
// then id as text) before anything is summed, so every sum is the book's bit
// for bit. That matters for the share: the book rounds the unsettled sums, and
// the same revenue summed in another order can land on the other side of a
// half (a thin band of exactly 12.5% reads 13% in the book and 12% summed in
// reverse). The share's whole is this model's own total, summed the same way,
// never the store's getTotalRevenue().
//
// Pure: the clients as the API sends them (the lead nested, `stickiness`,
// `revenues`) and a revenue function in; no People list, no effort.

/** The Stickiness picks (docs/plans/people-and-second-chair.md, section 3), as the book labels them. */
export const STICKINESS_LABELS = {
  5: "Personal bond (won't leave)",
  4: 'Strong, established',
  3: 'Solid but transactional',
  2: 'New / still shallow',
  1: 'Cold (never met in person)',
};

/** T5: the brief's thin relationships. */
export const THIN_STICKINESS = [1, 2];

/**
 * The 1–5 Stickiness pick, or null when the client is not rated: an integer
 * from 1 to 5 after parseFloat, so the text '4' is 4, and 0, 6, 2.5, '' and
 * null are not rated.
 */
export function stickinessPick(client) {
  const n = parseFloat(client?.stickiness);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/** "1 Cold (never met in person)", or "not rated". */
export function stickinessText(pick) {
  return pick === null ? 'not rated' : `${pick} ${STICKINESS_LABELS[pick]}`;
}

// Text as stored, trimmed
const text = (v) => (v === null || v === undefined ? '' : String(v).trim());

// Case-insensitive, then exact, by UTF-16 code units: the book's order, which
// localeCompare would not give on every machine
function compareText(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  if (a !== b) return a < b ? -1 : 1;
  return 0;
}
const compareId = (a, b) => {
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

// The lead as the book reads it: none unless the nested lead has an id
const leadOf = (client) => {
  const lead = client?.lead;
  return lead?.id != null ? { id: lead.id, name: text(lead.name), role: lead.role, active: Boolean(lead.active) } : null;
};

// The lead's name as the book writes it
const leadName = (person) => (person ? `${person.name}${person.active ? '' : ' (inactive)'}` : 'no lead');

// One band (the book's band()): how many, their revenue, and the same by lead,
// the leads heaviest revenue first, then by name, "no lead" last
function band(entries, total) {
  const byLead = new Map();
  for (const e of entries) {
    const key = e.lead ? String(e.lead.id) : '';
    if (!byLead.has(key)) byLead.set(key, { person: e.lead, name: leadName(e.lead), count: 0, revenue: 0, clients: [] });
    const entry = byLead.get(key);
    entry.count += 1;
    entry.revenue += e.revenue;
    entry.clients.push(e.client);
  }
  const revenue = entries.reduce((sum, e) => sum + e.revenue, 0);
  return {
    count: entries.length,
    revenue,
    // "(P% of the book's revenue)", only while the book has revenue in the year
    share: total > 0 ? Math.round((revenue / total) * 100) : null,
    byLead: [...byLead.values()].sort((a, b) =>
      (a.person ? 0 : 1) - (b.person ? 0 : 1) ||
      b.revenue - a.revenue ||
      compareText(a.person?.name || '', b.person?.name || '')),
  };
}

/**
 * The book's exposure, on the page.
 *
 * @param {Array} clients the book as the API sends it
 * @param {(client) => number} revenueOf revenue in the reporting year
 * @returns {{ total, count, rated, thin, unrated, solid }} `total` is every
 *   client's revenue, `count` the clients and `rated` those with a pick; each
 *   band (thin: rated 1 or 2; unrated; solid: rated 3 to 5) is
 *   { count, revenue, share, byLead: [{ person, name, count, revenue, clients }] },
 *   `share` the whole percent of `total` (null when `total` is 0), `person`
 *   the lead ({ id, name, role, active }, or null for the clients without a
 *   lead), `name` as the book writes it ("Joe (inactive)", "no lead") and
 *   `clients` the API's clients, by name.
 */
export function exposureModel(clients = [], revenueOf = () => 0) {
  const entries = (Array.isArray(clients) ? clients : [])
    .filter(Boolean)
    .map((client) => ({
      client,
      id: client.id,
      name: text(client.name),
      lead: leadOf(client),
      revenue: revenueOf(client) || 0,
      pick: stickinessPick(client),
    }))
    .sort((a, b) => compareText(a.name, b.name) || compareId(a.id, b.id));

  const total = entries.reduce((sum, e) => sum + e.revenue, 0);
  const thin = entries.filter((e) => e.pick !== null && THIN_STICKINESS.includes(e.pick));
  const unrated = entries.filter((e) => e.pick === null);
  const solid = entries.filter((e) => e.pick !== null && !THIN_STICKINESS.includes(e.pick));
  return {
    total,
    count: entries.length,
    rated: thin.length + solid.length,
    thin: band(thin, total),
    unrated: band(unrated, total),
    solid: band(solid, total),
  };
}
