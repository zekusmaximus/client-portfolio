// The book as the AI sees it (docs/plans/tier-1.md, WP2; T3, T4, T5): every
// client and every person who carries one, built on the server from the
// database at each request and rendered as deterministic text. The AI tab
// shows this exact text ("What the AI is given"); from WP3 the prompts send it.
//
// Pure: no db.cjs import, so tests can load it. routes/ai.cjs reads the
// clients (models/clientModel.cjs listWithMetrics, which scores them with
// utils/strategic.cjs) and the People list and calls buildBook.
//
// The per-person figures port the page's arithmetic, which stays in the
// page's own ES modules (T3: the server never require()s src/): partnershipModel
// and SECOND_CHAIR_EFFORT_SHARE (src/utils/load.js), computeReportingYear and
// revenueForYear (src/utils/revenue.js), resolveEffort
// (src/utils/clientMetrics.js). tests/book.test.mjs imports both sides and
// holds them equal on fixture and random books. Change one side, change the
// other.
//
// Never in the book: client notes (the one free-text field that may hold
// confidential matter), ids, dates, the partners' sign-in names, user_id and
// the retired columns (status, contract period, relationship strength,
// relationship intensity, renewal probability, strategic fit, time
// commitment). A default is labelled as one: an unrated client reads "not
// rated" and a missing cadence "not set", never a value.

const { unescapeText } = require('./transitionPlan.cjs');
const { getEffort, calculateStrategicValue, EFFORT_BY_CADENCE, HANDFUL_MULTIPLIER } = require('./strategic.cjs');

/**
 * The part of a client's effort its second chair carries (P10 as amended by
 * Jeff on 2026-09-25); the lead carries all of it. The page's copy is
 * SECOND_CHAIR_EFFORT_SHARE in src/utils/load.js, and tests/book.test.mjs
 * fails when the two differ.
 */
const SECOND_CHAIR_EFFORT_SHARE = 0.2;

/** The estimate the AI tab shows: characters ÷ 4. Not a token count (no Anthropic call). */
const CHARS_PER_TOKEN = 4;

const ROLE_ORDER = ['partner', 'emeritus', 'associate'];
const ROLE_GROUP_LABELS = { partner: 'Partners', emeritus: 'Emeritus', associate: 'Associates' };

// The Stickiness picks (docs/plans/people-and-second-chair.md, section 3)
const STICKINESS_LABELS = {
  5: "Personal bond (won't leave)",
  4: 'Strong, established',
  3: 'Solid but transactional',
  2: 'New / still shallow',
  1: 'Cold (never met in person)',
};
const THIN_STICKINESS = [1, 2]; // T5: the brief's thin relationships
const CONFLICT_RISKS = ['Low', 'Medium', 'High'];

const num = (v) => {
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
};

// Text as stored, with the request sanitizer's escaping undone (review 4.9:
// names saved through the client form are stored as "Smith &amp; Co").
const text = (v) => (v === null || v === undefined ? '' : String(unescapeText(String(v))).trim());

// Case-insensitive, then exact, by UTF-16 code units: the same on every
// machine, unlike localeCompare.
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

/* ------------------------------------------------------------------------ */
/*                   Ports of the page's arithmetic (T3)                     */
/* ------------------------------------------------------------------------ */

/** computeReportingYear (src/utils/revenue.js): the latest year with revenue > 0, else now's year. */
function reportingYear(clients, now = new Date()) {
  let latest = null;
  for (const client of clients || []) {
    if (!client || !Array.isArray(client.revenues)) continue;
    for (const row of client.revenues) {
      if (!row) continue;
      const year = Number(row.year);
      if (!Number.isInteger(year) || year <= 0) continue;
      const amount = parseFloat(row.revenue_amount);
      if (!(amount > 0)) continue;
      if (latest === null || year > latest) latest = year;
    }
  }
  return latest ?? now.getFullYear();
}

/** revenueForYear (src/utils/revenue.js): the first row for the year, or 0. */
function revenueForYear(client, year) {
  if (!client || !Array.isArray(client.revenues)) return 0;
  if (year === null || year === undefined) return 0;
  const wanted = Number(year);
  const row = client.revenues.find((r) => r && Number(r.year) === wanted);
  return row ? parseFloat(row.revenue_amount) || 0 : 0;
}

/** bookYears (src/utils/load.js): every year with a revenue row above zero, oldest first. */
function bookYears(clients = []) {
  const years = new Set();
  for (const client of clients) {
    for (const row of client?.revenues || []) {
      if (row && Number(row.year) && (parseFloat(row.revenue_amount) || 0) > 0) years.add(Number(row.year));
    }
  }
  return [...years].sort((a, b) => a - b);
}

/** resolveEffort (src/utils/clientMetrics.js): the API's effort, else getEffort. */
function clientEffort(client) {
  if (!client) return 1;
  const precomputed = num(client.effort);
  return precomputed !== null ? precomputed : getEffort(client);
}

/** ratio (src/utils/load.js): value ÷ average, or null with fewer than two members or a zero average. */
function ratio(value, average, members = 2) {
  if (members < 2 || !average) return null;
  return value / average;
}

const isHandful = (client) => {
  const v = client.high_maintenance ?? client.highMaintenance ?? client.handful;
  return v === true || v === 'true' || v === 1 || v === '1';
};

const practiceAreasOf = (client) => {
  const areas = client?.practiceArea ?? client?.practice_area;
  return Array.isArray(areas) ? areas.filter(Boolean).map(text).filter(Boolean) : [];
};

/** The 1–5 Stickiness pick, or null when the client is not rated. */
function stickinessPick(client) {
  const n = num(client?.stickiness);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

// active as the page reads it (truthy), so the averages count the same people
const personView = (p) => ({ id: p.id, name: text(p.name), role: p.role, active: Boolean(p.active) });

/* ------------------------------------------------------------------------ */
/*                                The model                                  */
/* ------------------------------------------------------------------------ */

const emptyLoad = () => ({ clients: [], count: 0, revenue: 0, effort: 0 });

function addTo(load, client, revenue, effort) {
  load.clients.push(client);
  load.count += 1;
  load.revenue += revenue;
  load.effort += effort;
}

function tally(entries, keyOf) {
  const map = new Map();
  for (const entry of entries) {
    const key = keyOf(entry);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => b.count - a.count || compareText(a.area, b.area));
}

// One band of clients (T5): how many, their reporting-year revenue, and the
// same by lead ("no lead" last), heaviest revenue first.
function band(clients) {
  const byLead = new Map();
  for (const c of clients) {
    const key = c.lead ? String(c.lead.id) : '';
    if (!byLead.has(key)) byLead.set(key, { person: c.lead, count: 0, revenue: 0 });
    const entry = byLead.get(key);
    entry.count += 1;
    entry.revenue += c.revenue;
  }
  return {
    count: clients.length,
    revenue: clients.reduce((sum, c) => sum + c.revenue, 0),
    byLead: [...byLead.values()].sort((a, b) =>
      (a.person ? 0 : 1) - (b.person ? 0 : 1) ||
      b.revenue - a.revenue ||
      compareText(a.person?.name || '', b.person?.name || '')),
  };
}

/**
 * The whole book as numbers, for renderBook and the parity tests.
 *
 * @param {{ people: Array, clients: Array, now?: Date }} input
 *   people: the People list ({ id, name, role, active }); clients: as
 *   clientModel.listWithMetrics() returns them (lead, secondChair and
 *   originator nested; revenues; effort and strategicValue scored).
 * @returns the reporting year, the years on file, one entry per client (sorted
 *   by name regardless of case, then id as text), one row per person with the
 *   same figures as the page's partnershipModel (lead and second, each
 *   { clients, count, revenue, effort }; leadRatio and secondRatio; plus
 *   revenuePerEffort and practiceAreas), the role averages, the people the
 *   text lists, the totals, the totals by year, exposure (T5), and the clients
 *   without a lead or without a second chair.
 *
 * Clients are sorted before anything is summed, so the text never depends on
 * the order rows arrive in; the sums therefore run in a different order from
 * the page's, and the parity tests compare to within 1e-9.
 */
function bookModel({ people = [], clients = [], now = new Date() } = {}) {
  const year = reportingYear(clients, now);
  const years = bookYears(clients);

  const entries = clients.map((client) => {
    const revenueByYear = {};
    for (const y of years) {
      const row = Array.isArray(client.revenues)
        ? client.revenues.find((r) => r && Number(r.year) === y)
        : undefined;
      revenueByYear[y] = row ? parseFloat(row.revenue_amount) || 0 : null;
    }
    const conflict = 'conflict_risk' in client ? client.conflict_risk : client.conflictRisk;
    const cadence = text(client.interaction_frequency ?? client.interactionFrequency);
    const strategicValue = num(client.strategicValue);
    return {
      id: client.id,
      name: text(client.name),
      lead: client.lead?.id != null ? personView(client.lead) : null,
      secondChair: client.secondChair?.id != null ? personView(client.secondChair) : null,
      originator: client.originator?.id != null ? personView(client.originator) : null,
      originatorIsFirm: client.originator_is_firm === true,
      practiceAreas: practiceAreasOf(client),
      revenueByYear,
      revenue: revenueForYear(client, year),
      stickiness: stickinessPick(client),
      cadence: cadence || null,
      handful: isHandful(client),
      conflictRisk: text(conflict) || null,
      effort: clientEffort(client),
      strategicValue: strategicValue !== null ? strategicValue : calculateStrategicValue(client),
    };
  });
  entries.sort((a, b) => compareText(a.name, b.name) || compareId(a.id, b.id));

  // partnershipModel (src/utils/load.js), over the sorted clients. Every
  // person passed to rowFor is already a personView: the People list's, or
  // the one nested on a client whose person is not on the list.
  const rows = new Map();
  const rowFor = (person) => {
    if (!rows.has(person.id)) rows.set(person.id, { person, lead: emptyLoad(), second: emptyLoad() });
    return rows.get(person.id);
  };
  people
    .map(personView)
    .sort((a, b) => compareText(a.name, b.name) || compareId(a.id, b.id))
    .forEach(rowFor);

  const unled = [];
  const noSecondChair = [];
  const totals = { clients: 0, revenue: 0, effort: 0 };
  for (const c of entries) {
    totals.clients += 1;
    totals.revenue += c.revenue;
    totals.effort += c.effort;
    if (c.lead) addTo(rowFor(c.lead).lead, c, c.revenue, c.effort);
    else unled.push(c);
    if (c.secondChair) addTo(rowFor(c.secondChair).second, c, c.revenue, c.effort * SECOND_CHAIR_EFFORT_SHARE);
    else if (c.lead) noSecondChair.push(c);
  }
  totals.revenuePerEffort = totals.effort > 0 ? totals.revenue / totals.effort : null;

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

  const all = [...rows.values()].map((row) => {
    const avg = averages[row.person.role] || { members: 0, lead: {}, second: {} };
    // Lead books compare with the partners; someone who cannot lead and leads
    // nothing has no lead-book comparison at all
    const leads = row.person.role === 'partner' || row.lead.count > 0;
    const leadAvg = leads ? averages.partner : { members: 0, lead: {} };
    const heldAreas = (load) => tally(load.clients.flatMap((c) => c.practiceAreas), (area) => area);
    return {
      ...row,
      leads,
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
      revenuePerEffort: row.lead.effort > 0 ? row.lead.revenue / row.lead.effort : null,
      practiceAreas: { lead: heldAreas(row.lead), second: heldAreas(row.second) },
    };
  });

  // Listed: every active person, and anyone inactive who still holds a seat
  const listed = all
    .filter((r) => r.person.active || r.lead.count > 0 || r.second.count > 0)
    .sort((a, b) => compareText(a.person.name, b.person.name) || compareId(a.person.id, b.person.id));

  const byYear = years.map((y) => ({
    year: y,
    revenue: entries.reduce((sum, c) => sum + (c.revenueByYear[y] || 0), 0),
    clients: entries.filter((c) => (c.revenueByYear[y] || 0) > 0).length,
  }));

  const exposure = {
    thin: band(entries.filter((c) => c.stickiness !== null && THIN_STICKINESS.includes(c.stickiness))),
    unrated: band(entries.filter((c) => c.stickiness === null)),
    solid: band(entries.filter((c) => c.stickiness !== null && !THIN_STICKINESS.includes(c.stickiness))),
  };

  return {
    reportingYear: year,
    years,
    clients: entries,
    rows: all,
    averages,
    listed,
    totals,
    byYear,
    exposure,
    unled,
    noSecondChair,
  };
}

/* ------------------------------------------------------------------------ */
/*                                 The text                                  */
/* ------------------------------------------------------------------------ */

// A sum of floats to 12 significant digits before it is rounded for display,
// as the page's formatters do (settle in src/utils/load.js): the book sums in
// name order and the page in the API's order, and without this a figure such
// as 5.45 shows as 5.4 on one side and 5.5 on the other.
const settle = (n) => Number((Number(n) || 0).toPrecision(12));

/** "$1,234,567", whole dollars, as the page's formatMoney, without a locale. */
function formatMoney(n) {
  const rounded = Math.round(settle(n));
  const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${rounded < 0 ? '-' : ''}$${digits}`;
}

/** One decimal, as the page's formatEffort (src/utils/load.js): "7.5", "3". */
function formatEffort(n) {
  return (Math.round(settle(n) * 10) / 10).toString();
}

/** The page's formatRatio (src/utils/load.js): "1.3×", "<0.1×", "—" for no comparison. */
function formatRatio(r) {
  if (r === null || r === undefined || !Number.isFinite(r)) return '—';
  if (r > 0 && r < 0.05) return '<0.1×';
  return `${settle(r).toFixed(1)}×`;
}

// A client's own effort, to the hundredth getEffort rounds to: "0.75", "4.5"
const formatClientEffort = (n) => String(Math.round((n || 0) * 100) / 100);
const percent = (part, whole) => (whole > 0 ? ` (${Math.round((part / whole) * 100)}% of the book's revenue)` : '');
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const cell = (value) => String(value).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
const tableRow = (cells) => `| ${cells.map(cell).join(' | ')} |`;
const table = (header, rows) => [tableRow(header), tableRow(header.map(() => '---')), ...rows.map(tableRow)].join('\n');

const personName = (p) => (p ? `${p.name}${p.active ? '' : ' (inactive)'}` : 'none');
const withRatio = (value, r) => `${value} (${formatRatio(r)})`;
const areaList = (areas) => areas.map((a) => `${a.area} ${a.count}`).join(', ');

function originatorText(c) {
  if (c.originatorIsFirm) return c.originator ? `Firm (originated by ${personName(c.originator)})` : 'Firm';
  return c.originator ? personName(c.originator) : 'not recorded';
}

function stickinessText(pick) {
  return pick === null ? 'not rated' : `${pick} ${STICKINESS_LABELS[pick]}`;
}

function cadenceText(cadence) {
  if (!cadence) return 'not set';
  return Object.prototype.hasOwnProperty.call(EFFORT_BY_CADENCE, cadence) ? cadence : `${cadence} (not a known cadence)`;
}

function conflictText(risk) {
  if (!risk) return 'not set';
  return CONFLICT_RISKS.includes(risk) ? risk : `${risk} (scored as Medium)`;
}

function legend(model) {
  const y = model.reportingYear;
  const share = Math.round(SECOND_CHAIR_EFFORT_SHARE * 100);
  const cadences = Object.entries(EFFORT_BY_CADENCE).map(([name, weight]) => `${name} ${weight}`).join(', ');
  const stickiness = [5, 4, 3, 2, 1].map((n) => `${n} ${STICKINESS_LABELS[n]}`).join('; ');
  return [
    '## Legend',
    '',
    `- Stickiness is a partner's judgment of how locked-in the relationship is, from 1 to 5: ${stickiness}. "not rated" means nobody has judged it yet; it is not a middle value.`,
    `- Effort is the relative work a client takes, from how often it is touched (cadence): ${cadences}. A handful (every interaction is heavy) multiplies it by ${HANDFUL_MULTIPLIER}.`,
    `- Strategic value (0 to 10) = revenue score × 0.5 + stickiness score × 0.5 − conflict penalty, kept within 0 to 10. Revenue score = the client's latest year's revenue ÷ $50,000, at most 10 ($500,000 or more scores 10); the latest year is the client's own, which can be earlier than ${y}. Stickiness score = (pick − 1) ÷ 4 × 10. Conflict penalty: High 3, Medium 1, Low 0.`,
    '- Defaults, not judgments: stickiness "not rated" (the strategic value then uses a stand-in from older fields, not a rating); cadence "not set" (effort 1, and 1.5 with a handful); conflict risk "not set" (scored as Medium); originator "not recorded"; "—" in a revenue column (no revenue on file for that year). Treat each as unknown.',
    `- Load: a client's lead carries its full effort and its second chair ${share}% of it. Client counts and revenue count in full for both chairs. Revenue in the people tables is ${y}'s.`,
    `- Each person's figure is followed by its ratio to the average of the active people in the same role, those with no clients included: (1.3×) is 30% above that average. Lead books compare with the active partners. (—) means there is nothing to compare with: fewer than two active people in the role, or an average of zero. There is no capacity ceiling; balance is relative to the role average.`,
    `- Revenue per effort: the ${y} revenue of the clients a person leads ÷ their lead effort. "n/a" in a lead column: not a partner and leads no client.`,
    `- Exposure: the ${y} revenue of clients rated Stickiness 1 or 2 (thin relationships). Clients not rated are counted separately and are never counted as safe.`,
  ].join('\n');
}

function peopleSection(model) {
  const y = model.reportingYear;
  const share = Math.round(SECOND_CHAIR_EFFORT_SHARE * 100);
  const inactive = model.listed.filter((r) => !r.person.active).length;
  const lines = [
    `## People (${plural(model.listed.length - inactive, 'active person', 'active people')}${inactive ? `, and ${plural(inactive, 'inactive person', 'inactive people')} who still ${inactive === 1 ? 'holds' : 'hold'} a seat` : ''})`,
  ];
  const header = [
    'Name', 'Leads', `Revenue led ${y}`, 'Lead effort', 'Revenue per effort',
    'Second chair on', `Revenue seconded ${y}`, `Second-chair effort (${share}%)`, 'Practice areas held',
  ];
  const roles = [...ROLE_ORDER, ...[...new Set(model.listed.map((r) => r.person.role))].filter((r) => !ROLE_ORDER.includes(r)).sort()];
  for (const role of roles) {
    const members = model.listed.filter((r) => r.person.role === role);
    if (members.length === 0) continue;
    const avg = model.averages[role];
    const label = ROLE_GROUP_LABELS[role] || role;
    lines.push('', `### ${label}`, '');
    if (avg && avg.members > 0) {
      const leadPart = role === 'partner'
        ? `lead clients ${formatEffort(avg.lead.count)}, revenue led ${formatMoney(avg.lead.revenue)}, lead effort ${formatEffort(avg.lead.effort)}; `
        : '';
      lines.push(`Average over the active ${label.toLowerCase()} (${avg.members}): ${leadPart}second-chair clients ${formatEffort(avg.second.count)}, revenue seconded ${formatMoney(avg.second.revenue)}, second-chair effort ${formatEffort(avg.second.effort)}.`, '');
    } else {
      lines.push(`No active ${label.toLowerCase()}, so no average.`, '');
    }
    lines.push(table(header, members.map((r) => {
      const areas = [
        r.practiceAreas.lead.length ? `lead: ${areaList(r.practiceAreas.lead)}` : '',
        r.practiceAreas.second.length ? `second chair: ${areaList(r.practiceAreas.second)}` : '',
      ].filter(Boolean).join('; ') || 'none';
      const lead = r.leads
        ? [
          withRatio(r.lead.count, r.leadRatio.count),
          withRatio(formatMoney(r.lead.revenue), r.leadRatio.revenue),
          withRatio(formatEffort(r.lead.effort), r.leadRatio.effort),
          r.revenuePerEffort === null ? '—' : formatMoney(r.revenuePerEffort),
        ]
        : ['n/a', 'n/a', 'n/a', 'n/a'];
      return [
        personName(r.person),
        ...lead,
        withRatio(r.second.count, r.secondRatio.count),
        withRatio(formatMoney(r.second.revenue), r.secondRatio.revenue),
        withRatio(formatEffort(r.second.effort), r.secondRatio.effort),
        areas,
      ];
    })));
  }
  return lines.join('\n');
}

function totalsSection(model) {
  const { totals, byYear, reportingYear: y } = model;
  return [
    '## Totals',
    '',
    `${plural(totals.clients, 'client')}; ${formatMoney(totals.revenue)} in ${y}; total effort ${formatEffort(totals.effort)} (each client once, in full)${totals.revenuePerEffort === null ? '' : `; ${formatMoney(totals.revenuePerEffort)} of ${y} revenue per effort`}.`,
    '',
    byYear.length
      ? table(['Year', 'Revenue', 'Clients with revenue'], byYear.map((row) => [row.year, formatMoney(row.revenue), row.clients]))
      : 'No revenue on file for any year.',
  ].join('\n');
}

function exposureSection(model) {
  const { exposure, totals, reportingYear: y } = model;
  const byLead = (b) => b.byLead
    .map((e) => `${e.person ? personName(e.person) : 'no lead'} ${plural(e.count, 'client')}, ${formatMoney(e.revenue)}`)
    .join('; ');
  const line = (label, b, withLeads) => {
    const head = `- ${label}: ${plural(b.count, 'client')}, ${formatMoney(b.revenue)} in ${y}${percent(b.revenue, totals.revenue)}.`;
    return withLeads && b.count > 0 ? `${head} By lead: ${byLead(b)}.` : head;
  };
  return [
    `## Exposure (${y} revenue on thin relationships)`,
    '',
    line('Rated 1 or 2 (thin)', exposure.thin, true),
    line('Not rated (unknown, not safe)', exposure.unrated, true),
    line('Rated 3 to 5', exposure.solid, false),
  ].join('\n');
}

function coverageSection(model) {
  const names = (list) => list.map((c) => c.name).join('; ');
  return [
    '## Coverage',
    '',
    model.unled.length
      ? `- Without a lead (${model.unled.length}; they count in no one's book): ${names(model.unled)}.`
      : '- Without a lead: none.',
    model.noSecondChair.length
      ? `- With a lead and no second chair (${model.noSecondChair.length}): ${names(model.noSecondChair)}.`
      : '- With a lead and no second chair: none.',
  ].join('\n');
}

function clientsSection(model) {
  const y = model.reportingYear;
  const header = [
    'Client', 'Lead', 'Second chair', 'Originator', 'Practice areas',
    ...model.years.map((year) => `Revenue ${year}`),
    'Stickiness', 'Cadence', 'Handful', 'Conflict risk', 'Effort', 'Strategic value',
  ];
  return [
    `## Clients (${model.clients.length}, by name; revenue ${model.years.length ? `for every year on file, the reporting year being ${y}` : 'none on file'})`,
    '',
    table(header, model.clients.map((c) => [
      c.name,
      personName(c.lead),
      personName(c.secondChair),
      originatorText(c),
      c.practiceAreas.length ? c.practiceAreas.join('; ') : 'not set',
      ...model.years.map((year) => (c.revenueByYear[year] === null ? '—' : formatMoney(c.revenueByYear[year]))),
      stickinessText(c.stickiness),
      cadenceText(c.cadence),
      c.handful ? 'yes' : 'no',
      conflictText(c.conflictRisk),
      formatClientEffort(c.effort),
      c.strategicValue.toFixed(1),
    ])),
  ].join('\n');
}

/**
 * The book as text: a legend, the people by role, the totals by year,
 * exposure, coverage and one row per client. Deterministic: the same data
 * gives the same bytes (sorted, fixed number formats, no date), which the
 * prompt cache needs from WP3 (T8).
 */
function renderBook(model) {
  const head = ['# The book', ''];
  if (!model.clients.length) {
    return [...head, `The book has no clients yet, so there is nothing to show for ${model.reportingYear}.`, ''].join('\n');
  }
  head.push(
    `Reporting year ${model.reportingYear}: the latest year with revenue on file. ${plural(model.clients.length, 'client')}; ${plural(model.listed.length, 'person', 'people')} listed. Client notes are not included.`,
  );
  return [
    head.join('\n'),
    legend(model),
    peopleSection(model),
    totalsSection(model),
    exposureSection(model),
    coverageSection(model),
    clientsSection(model),
  ].join('\n\n') + '\n';
}

/** The estimate the AI tab shows: characters ÷ CHARS_PER_TOKEN, rounded. */
const estimateTokens = (bookText) => Math.round(bookText.length / CHARS_PER_TOKEN);

/**
 * GET /api/ai/book's answer, less `success`: the text and its size.
 * peopleCount is the people the text lists.
 */
function buildBook({ people = [], clients = [], now = new Date() } = {}) {
  const model = bookModel({ people, clients, now });
  const bookText = renderBook(model);
  return {
    model,
    reportingYear: model.reportingYear,
    clientCount: model.clients.length,
    peopleCount: model.listed.length,
    chars: bookText.length,
    estimatedTokens: estimateTokens(bookText),
    text: bookText,
  };
}

module.exports = {
  SECOND_CHAIR_EFFORT_SHARE,
  CHARS_PER_TOKEN,
  STICKINESS_LABELS,
  reportingYear,
  revenueForYear,
  bookYears,
  clientEffort,
  stickinessPick,
  bookModel,
  renderBook,
  estimateTokens,
  buildBook,
  formatMoney,
  formatEffort,
  formatRatio,
};
