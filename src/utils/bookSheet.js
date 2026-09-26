// The book as an import sheet (Data Upload's "Download the book as a sheet"):
// the CSV POST /api/data/process-csv reads (docs/plans/people-and-second-chair.md,
// section 3), one row per client with its current values, so that importing it
// unchanged changes nothing. Pure: clients and the People list in, text out.
//
// Each cell holds what the import reads back into the stored value: people as
// the People list spells them, `Firm` and `Y` where the import expects them,
// blank where the book has nothing. Client names and notes are unescaped
// (unescapeStored): the API returns text the client form saved as
// sanitizeRequestBody stored it, and the import refuses a CLIENT holding a `;`.
//
// A client whose lead is missing or not an active partner, or whose second
// chair is inactive, is written as the book has it, so Check file refuses
// those rows with the import's own message and the partner fixes them; the
// page lists them before the download (`attention`). Leaving them out would
// make a master sheet that silently lacks clients, and a revenue import that
// silently skips them.

import { unescapeStored } from './escaping.js';
import { sheetCell } from './transitionPlans.js';
import { revenueForYear } from './revenue.js';

export const BOOK_SHEET_COLUMNS = [
  'Lead', 'Second Chair', 'Originator', 'Credit To Firm', 'Stickiness',
  'Cadence', 'Handful', 'Conflict Risk', 'Practice Area', 'Notes',
];

/** Every year in which any client has a revenue row with an amount above 0, oldest first. */
export function revenueYearsOnFile(clients = []) {
  const years = new Set();
  for (const client of clients) {
    for (const row of Array.isArray(client?.revenues) ? client.revenues : []) {
      const year = Number(row?.year);
      if (Number.isInteger(year) && year > 0 && parseFloat(row.revenue_amount) > 0) years.add(year);
    }
  }
  return [...years].sort((a, b) => a - b);
}

// An amount as the import parses it: whole dollars bare, cents to two places;
// nothing for 0, which the import reads the same as blank
const amountCell = (amount) => {
  if (!(amount > 0)) return '';
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
};

const text = (value) => (value === null || value === undefined ? '' : String(value));

/**
 * The book as an import sheet.
 * @param {Array} clients - the store's clients, as GET /api/data/clients returns them
 * @param {Array} people - the People list, `{ id, name, role, active }`
 * @param {number[]} [years] - the revenue years to write; every year on file by default
 * @returns {{ csv: string, years: number[], attention: Array<{ client: string, reason: string }> }}
 *   `csv` has no BOM (the download adds one); `attention` lists, by name, the
 *   clients whose rows Check file will refuse as the book stands.
 */
export function buildBookSheet(clients = [], people = [], years = revenueYearsOnFile(clients)) {
  const byId = new Map(people.map((p) => [String(p.id), p]));
  // The People list's spelling; the client's nested person if the list lacks it
  const person = (id, nested) => (id === null || id === undefined ? nested || null : byId.get(String(id)) || nested || null);

  const rows = clients.map((client) => {
    const name = unescapeStored(text(client.name));
    const lead = person(client.lead_id, client.lead);
    const secondChair = person(client.second_chair_id, client.secondChair);
    const originator = person(client.originator_id, client.originator);
    const firm = client.originator_is_firm === true;
    const areas = Array.isArray(client.practice_area) ? client.practice_area
      : Array.isArray(client.practiceArea) ? client.practiceArea : [];

    const reasons = [];
    if (!lead) reasons.push('no lead');
    else if (lead.role !== 'partner' || !lead.active) reasons.push(`lead ${lead.name} is not an active partner`);
    if (secondChair && !secondChair.active) reasons.push(`second chair ${secondChair.name} is inactive`);

    const cells = [
      name,
      ...years.map((year) => amountCell(revenueForYear(client, year))),
      lead ? lead.name : '',
      secondChair ? secondChair.name : '',
      originator ? originator.name : firm ? 'Firm' : '',
      firm ? 'Y' : '',
      text(client.stickiness),
      text(client.interaction_frequency),
      client.high_maintenance === true ? 'Y' : '',
      text(client.conflict_risk),
      areas.join(';'),
      unescapeStored(text(client.notes)),
    ];
    return { name, id: text(client.id), cells, reasons };
  });

  rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
  const lines = [
    ['CLIENT', ...years.map((year) => `${year} Contracts`), ...BOOK_SHEET_COLUMNS].map(sheetCell).join(','),
    ...rows.map((r) => r.cells.map(sheetCell).join(',')),
  ];
  return {
    csv: `${lines.join('\r\n')}\r\n`,
    years,
    attention: rows.filter((r) => r.reasons.length > 0).map((r) => ({ client: r.name, reason: r.reasons.join('; ') })),
  };
}

/** Download the sheet as client_book_<date>.csv, with a BOM so Excel reads UTF-8 (the import ignores it). */
export function exportBookSheet(csv, now = new Date()) {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `client_book_${now.toISOString().split('T')[0]}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
