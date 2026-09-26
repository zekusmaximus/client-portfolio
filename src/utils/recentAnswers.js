// The AI tab's Recent answers (docs/plans/tier-1.md, WP4; T12, T13): what a
// row says and what the month's line says, from GET /api/ai/answers and
// /api/ai/answers/summary. Pure. Costs arrive as text, because ai_answers.
// cost_usd is NUMERIC and pg returns NUMERIC as a string; parseCost turns
// them into numbers here, and nowhere else.

/** A saved cost ('0.0312', 0.0312) as a number, or null when there is none. */
export function parseCost(value) {
  if (value === null || value === undefined || value === '') return null;
  const usd = Number(value);
  return Number.isFinite(usd) ? usd : null;
}

/** A cost for display: "$0.03", "under $0.01", or "no price" (a model without one). */
export function formatCost(value) {
  const usd = parseCost(value);
  if (usd === null) return 'no price';
  if (usd > 0 && usd < 0.005) return 'under $0.01';
  return `$${usd.toFixed(2)}`;
}

/** What a saved answer was: the question, "Brief", or "Transition plan: <client>". */
export function answerTitle(answer) {
  if (answer?.kind === 'brief') return 'Brief';
  if (answer?.kind === 'transition-plan') return `Transition plan: ${answer.client_name || 'a client'}`;
  return answer?.question || 'A question';
}

const plural = (n, one, many) => `${Number(n || 0).toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * "This month: 3 answers, about $0.42", from the summary; answers saved on a
 * model without a price are left out of the sum, and said so.
 */
export function monthLine(summary) {
  if (!summary) return '';
  const usd = parseCost(summary.costUsd) ?? 0;
  const line = `This month: ${plural(summary.answers, 'answer', 'answers')}, about $${usd.toFixed(2)}`;
  return summary.unpriced > 0 ? `${line} (${plural(summary.unpriced, 'answer', 'answers')} without a price)` : line;
}

/** Older answers appended to the list, each id once, in the order the API gave them. */
export function appendAnswers(current, older) {
  const seen = new Set((current || []).map((a) => a.id));
  return [...(current || []), ...(older || []).filter((a) => !seen.has(a.id))];
}
