/**
 * CSV import helpers: pure functions, no database access.
 *
 * Year rule (docs/plans/tier-0.md, D5): a CSV is authoritative for exactly the
 * years its header contains, as `YYYY Contracts` columns. For each client and
 * each of those years, an amount > 0 upserts the (client, year) row, a blank
 * or 0 cell deletes it, and years the file does not mention are left alone.
 * That preserves history when a single-year sheet is imported and still lets
 * a corrected sheet zero out a year.
 *
 * Nothing in this file knows which years exist; `2026 Contracts` needs no
 * code change, and neither will `2027 Contracts`.
 */

const REVENUE_HEADER = /^\s*((?:19|20)\d{2})\s+contracts?\s*$/i;

/**
 * The year named by a `YYYY Contracts` header, or null when the header is not
 * a revenue column. Case-insensitive; surrounding whitespace and the singular
 * `Contract` are tolerated.
 */
function revenueYearOfHeader(header) {
  if (typeof header !== 'string') return null;
  const match = header.match(REVENUE_HEADER);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Sorted, de-duplicated integer years for every header that names a revenue
 * column.
 */
function extractRevenueYears(headers) {
  const years = new Set();
  for (const header of headers || []) {
    const year = revenueYearOfHeader(header);
    if (year !== null) years.add(year);
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * Union of the keys of every row. With Papaparse in header mode every row
 * carries the header's keys, so this is the header; taking the union also
 * covers a short first row.
 */
function headerKeys(rows) {
  const keys = new Set();
  for (const row of rows || []) {
    if (row && typeof row === 'object') {
      Object.keys(row).forEach((key) => keys.add(key));
    }
  }
  return [...keys];
}

/**
 * Parse a revenue cell. Strips `$`, `,` and whitespace; parentheses mean
 * negative; blank, missing or non-numeric cells are 0. Numbers pass through.
 */
function parseAmount(cell) {
  if (cell === null || cell === undefined) return 0;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : 0;

  let text = String(cell).replace(/[$,\s]/g, '');
  if (text === '') return 0;

  let sign = 1;
  const parenthesised = text.match(/^\((.*)\)$/);
  if (parenthesised) {
    sign = -1;
    text = parenthesised[1];
  }

  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return 0;
  const amount = parseFloat(text);
  if (!Number.isFinite(amount) || amount === 0) return 0;
  return sign * amount;
}

/**
 * Plan the revenue writes for one import (D5).
 *
 * @param {Array<{id: string, revenue: Object}>} clients - `revenue` maps year → amount
 * @param {number[]} years - the years the file's header covered
 * @returns {{upserts: Array<[string, number, number]>, deletes: Array<[string, number]>}}
 *   `upserts` are (client_id, year, amount) for present years with amount > 0;
 *   `deletes` are (client_id, year) for present years with a blank, 0 or
 *   non-positive amount. Years absent from `years` produce no write at all.
 *   Each (client, year) pair appears at most once, so one INSERT ... ON
 *   CONFLICT statement can carry every upsert.
 */
function planRevenueWrites(clients, years) {
  const upserts = new Map();
  const deletes = new Map();
  const fileYears = [...new Set(
    (years || []).map((year) => parseInt(year, 10)).filter(Number.isInteger)
  )];

  for (const client of clients || []) {
    if (!client || client.id === null || client.id === undefined) continue;
    const revenue = client.revenue && typeof client.revenue === 'object' ? client.revenue : {};

    for (const year of fileYears) {
      const amount = parseAmount(revenue[year]);
      const key = `${client.id}|${year}`;
      if (amount > 0) {
        upserts.set(key, [client.id, year, amount]);
        deletes.delete(key);
      } else {
        deletes.set(key, [client.id, year]);
        upserts.delete(key);
      }
    }
  }

  return { upserts: [...upserts.values()], deletes: [...deletes.values()] };
}

module.exports = {
  revenueYearOfHeader,
  extractRevenueYears,
  headerKeys,
  parseAmount,
  planRevenueWrites,
};
