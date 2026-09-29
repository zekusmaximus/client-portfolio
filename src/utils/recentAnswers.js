// The AI tab's Recent answers (docs/plans/tier-1.md, WP4; T12, T13): what a
// row says and what the month's line says, from GET /api/ai/answers and
// /api/ai/answers/summary. Pure. Costs arrive as text, because ai_answers.
// cost_usd is NUMERIC and pg returns NUMERIC as a string; parseCost turns
// them into numbers here, and nowhere else. From Tier 2 WP10 (S14, S15) also
// threads: the turns the tab shows above a follow-up, and what a row says of
// a follow-up, an answer on an earlier book and a hidden one.

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

/**
 * What a saved answer was: the question, "Brief", or "Transition plan:
 * <client>"; a follow-up's question after "Follow-up: " (WP10).
 */
export function answerTitle(answer) {
  if (answer?.kind === 'brief') return 'Brief';
  if (answer?.kind === 'transition-plan') return `Transition plan: ${answer.client_name || 'a client'}`;
  const question = answer?.question || 'A question';
  return answer?.parent_id !== null && answer?.parent_id !== undefined ? `Follow-up: ${question}` : question;
}

/**
 * What a row says after when and who: declined, cut off, given on an earlier
 * book (WP10, S15), and, in the hidden list, who hid it.
 */
export function rowNotes(answer) {
  const notes = [];
  if (answer?.refused) notes.push('declined');
  if (answer?.truncated) notes.push('cut off');
  if (answer?.earlier_book === true) notes.push('on an earlier book');
  if (answer?.hidden_at) notes.push(`hidden by ${answer.hidden_by_username || 'a former account'}`);
  return notes;
}

/** The follow-ups a thread may hold after its first answer: utils/aiThreads.cjs's FOLLOW_UP_MAX. */
export const FOLLOW_UP_MAX = 5;

/** "Follow-up 2 of 5" for an answer's number in its thread, or null for a first answer. */
export function followUpLine(followUp) {
  return Number.isInteger(followUp) && followUp > 0 ? `Follow-up ${followUp} of ${FOLLOW_UP_MAX}` : null;
}

/**
 * One earlier turn of a thread as the tab shows it above a follow-up, from an
 * answer as Ask returns it or a saved one: its question (none for the
 * brief), its answer and the two notices.
 */
export function threadTurn(answer) {
  return {
    id: answer?.id ?? null,
    kind: answer?.kind === 'brief' ? 'brief' : 'ask',
    question: typeof answer?.question === 'string' ? answer.question : null,
    answer: typeof answer?.answer === 'string' ? answer.answer : '',
    truncated: answer?.truncated === true,
    refused: answer?.refused === true,
  };
}

/** The turns shown above a follow-up to `result`, the answer the Ask card shows: the turns it showed, then it. */
export function turnsBefore(result) {
  return [...(Array.isArray(result?.turns) ? result.turns : []).map(threadTurn), threadTurn(result)];
}

/** The same for a saved answer opened from the list (GET /api/ai/answers/:id): its thread, then it. */
export function savedTurnsBefore(answer) {
  return [...(Array.isArray(answer?.thread) ? answer.thread : []).map(threadTurn), threadTurn(answer)];
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
