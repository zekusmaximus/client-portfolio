/**
 * Reporting-year helpers (docs/plans/tier-0.md, D4). Pure functions with no
 * store import, so they are unit-testable under node --test.
 *
 * The reporting year is the latest year in which any client has a revenue row
 * with amount > 0, falling back to the current calendar year. In January,
 * before the new sheet is imported, the book therefore still shows last year
 * rather than $0; once a sheet with the new year's amounts lands, every total,
 * card, chart and label moves to it without a code change.
 */

/**
 * @param {Array} clients - clients as the API returns them (`revenues` arrays)
 * @param {Date} [now] - defaults to today; pass one for deterministic tests
 * @returns {number} the reporting year
 */
export function computeReportingYear(clients, now = new Date()) {
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

/**
 * A client's revenue in one year, read from `client.revenues`; 0 when the
 * client has no row for that year.
 */
export function revenueForYear(client, year) {
  if (!client || !Array.isArray(client.revenues)) return 0;
  if (year === null || year === undefined) return 0;
  const wanted = Number(year);
  const row = client.revenues.find((r) => r && Number(r.year) === wanted);
  return row ? parseFloat(row.revenue_amount) || 0 : 0;
}
