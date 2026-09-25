// The Partnership tab's exports (docs/plans/people-and-second-chair.md,
// Phase 4): a printable report and a CSV of everyone's load, both built from
// partnershipModel in ./load.js, so they show exactly what the tab shows. The
// builders are pure (strings in, strings out) and tested; the two export
// functions only open the print window or start the download.

import {
  formatRatio,
  formatMoney as money,
  formatEffort as effort,
  secondChairEffort,
  SECOND_CHAIR_EFFORT_SHARE,
} from './load.js';
import { ROLE_LABELS } from './people.js';

const SHARE_PERCENT = Math.round(SECOND_CHAIR_EFFORT_SHARE * 100);
const strategic = (client) => {
  const v = parseFloat(client?.strategicValue);
  return Number.isFinite(v) ? v.toFixed(1) : '—';
};
const roleLabel = (person) =>
  `${ROLE_LABELS[person.role] || person.role}${person.active === false ? ', inactive' : ''}`;

/** HTML-escape text for the report; pure, no DOM. */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * One CSV cell. Quotes cells with a comma, quote or line break, and prefixes a
 * text cell that starts with = + - @ with an apostrophe so a spreadsheet does
 * not read it as a formula.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csvRow = (cells) => cells.map(csvCell).join(',');
const ratioCell = (r) => (r === null || r === undefined || !Number.isFinite(r) ? '' : Math.round(r * 100) / 100);

/**
 * Everyone's load as CSV: one row per person in the lead books or the
 * second-chair groups. Ratios are against the role's average (lead books
 * against the partners'), blank when there is nothing to compare with.
 * Second-chair effort is SECOND_CHAIR_EFFORT_SHARE of each client's (P10).
 */
export function buildLoadCsv(model, year) {
  const header = [
    'Person', 'Role', 'Active',
    'Lead clients', 'Lead clients vs partner avg',
    `Lead revenue ${year}`, 'Lead revenue vs partner avg',
    'Lead effort', 'Lead effort vs partner avg',
    'Second-chair clients', 'Second-chair clients vs role avg',
    `Second-chair revenue ${year}`, 'Second-chair revenue vs role avg',
    `Second-chair effort (${SHARE_PERCENT}% share)`, 'Second-chair effort vs role avg',
  ];
  const seen = new Set();
  const people = [...model.leadBooks, ...model.secondChairs.flatMap((g) => g.rows)]
    .filter((r) => !seen.has(r.person.id) && seen.add(r.person.id));

  const rows = people.map((r) => [
    r.person.name, ROLE_LABELS[r.person.role] || r.person.role, r.person.active ? 'Y' : 'N',
    r.lead.count, ratioCell(r.leadRatio.count),
    Math.round(r.lead.revenue * 100) / 100, ratioCell(r.leadRatio.revenue),
    Math.round(r.lead.effort * 100) / 100, ratioCell(r.leadRatio.effort),
    r.second.count, ratioCell(r.secondRatio.count),
    Math.round(r.second.revenue * 100) / 100, ratioCell(r.secondRatio.revenue),
    Math.round(r.second.effort * 100) / 100, ratioCell(r.secondRatio.effort),
  ]);
  return [header, ...rows].map(csvRow).join('\r\n');
}

const loadTable = (rows, which, label) => `
  <table>
    <thead><tr><th>${escapeHtml(label)}</th><th>Clients</th><th>vs avg</th><th>Revenue</th><th>vs avg</th><th>Effort</th><th>vs avg</th></tr></thead>
    <tbody>
      ${rows.map((r) => `
        <tr>
          <td>${escapeHtml(r.person.name)}${r.person.active === false ? ' (inactive)' : ''}</td>
          <td>${r[which].count}</td><td>${formatRatio(r[`${which}Ratio`].count)}</td>
          <td>${money(r[which].revenue)}</td><td>${formatRatio(r[`${which}Ratio`].revenue)}</td>
          <td>${effort(r[which].effort)}</td><td>${formatRatio(r[`${which}Ratio`].effort)}</td>
        </tr>`).join('')}
    </tbody>
  </table>`;

const clientEffort = (c) => parseFloat(c.effort) || 0;

// `seat` is 'lead' or 'second': the effort column is what the person carries,
// the client's full effort as lead and the second-chair share as second chair.
const clientTable = (clients, revenueOf, otherLabel, otherOf, seat = 'lead') => `
  <table>
    <thead><tr><th>Client</th><th>Revenue</th><th>Strategic value</th><th>${seat === 'second' ? `Effort (${SHARE_PERCENT}%)` : 'Effort'}</th><th>${escapeHtml(otherLabel)}</th></tr></thead>
    <tbody>
      ${clients.map((c) => `
        <tr>
          <td>${escapeHtml(c.name)}</td><td>${money(revenueOf(c))}</td><td>${strategic(c)}</td>
          <td>${effort(seat === 'second' ? secondChairEffort(clientEffort(c)) : clientEffort(c))}</td><td>${escapeHtml(otherOf(c) || '—')}</td>
        </tr>`).join('')}
    </tbody>
  </table>`;

/**
 * The printable report: the summary, the partners' lead books, the
 * second-chair load by role, then each person's clients.
 */
export function buildPartnershipReportHtml(model, year, revenueOf, now = new Date()) {
  const date = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const people = [...model.leadBooks, ...model.secondChairs.flatMap((g) => g.rows)]
    .filter((r, i, all) => all.findIndex((x) => x.person.id === r.person.id) === i)
    .filter((r) => r.lead.count > 0 || r.second.count > 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Who's carrying what: ${escapeHtml(date)}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 24px; color: #222; line-height: 1.4; }
  h1 { margin-bottom: 4px; } h2 { margin-top: 28px; border-bottom: 2px solid #333; padding-bottom: 4px; }
  h3 { margin: 18px 0 6px; } h4 { margin: 10px 0 4px; font-size: 0.95em; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 0.9em; }
  th, td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; }
  th { background: #f2f2f2; }
  .muted { color: #666; font-size: 0.9em; }
  .person { page-break-inside: avoid; }
  @media print { body { margin: 0; } h2 { page-break-after: avoid; } }
</style>
</head>
<body>
  <h1>Who's carrying what</h1>
  <p class="muted">${escapeHtml(date)}. Revenue is ${year}'s. Confidential: internal use only.</p>

  <h2>Summary</h2>
  <table>
    <tbody>
      <tr><th>Clients</th><td>${model.totals.clients}</td></tr>
      <tr><th>Revenue ${year}</th><td>${money(model.totals.revenue)}</td></tr>
      <tr><th>Clients without a second chair</th><td>${model.noSecondChair.length}</td></tr>
      ${model.unled.length > 0 ? `<tr><th>Clients without a lead</th><td>${model.unled.length}</td></tr>` : ''}
    </tbody>
  </table>

  <h2>Lead books (partners)</h2>
  ${loadTable(model.leadBooks, 'lead', 'Partner')}

  <h2>Second-chair load</h2>
  ${model.secondChairs.map((g) => `<h3>${escapeHtml(g.label)}</h3>${loadTable(g.rows, 'second', ROLE_LABELS[g.role] || g.role)}`).join('')}

  <h2>Clients by person</h2>
  ${people.map((r) => `
    <div class="person">
      <h3>${escapeHtml(r.person.name)} <span class="muted">(${escapeHtml(roleLabel(r.person))})</span></h3>
      ${r.lead.count > 0 ? `<h4>Leads ${r.lead.count}</h4>${clientTable(r.lead.clients, revenueOf, 'Second chair', (c) => c.secondChair?.name)}` : ''}
      ${r.second.count > 0 ? `<h4>Second chair on ${r.second.count}</h4>${clientTable(r.second.clients, revenueOf, 'Lead', (c) => c.lead?.name, 'second')}` : ''}
    </div>`).join('')}

  <h2>Notes</h2>
  <ul class="muted">
    <li>Each figure is compared with the average of the active people in the same role; lead books with the partners' average. "—" means there is no one to compare with.</li>
    <li>Effort is each client's contact cadence (Daily 5, Weekly 3, Monthly 2, Quarterly 1, As-Needed 0.5, unset 1), × 1.5 when the client is a handful.</li>
    <li>A client's lead carries its full effort and its second chair ${SHARE_PERCENT}% of it; clients and revenue count in full for both.</li>
  </ul>
</body>
</html>`;
}

/** Open the report in a new window and print it. */
export function exportPartnershipReport(model, year, revenueOf) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) throw new Error('The browser blocked the report window; allow pop-ups for this site and try again.');
  printWindow.document.write(buildPartnershipReportHtml(model, year, revenueOf));
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 500);
}

/** Download everyone's load as load_<date>.csv (with a BOM, so Excel reads UTF-8). */
export function exportLoadCsv(model, year) {
  const blob = new Blob([`\uFEFF${buildLoadCsv(model, year)}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `load_${new Date().toISOString().split('T')[0]}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
