// The AI tab's Ask box (docs/plans/tier-1.md, WP3): the product brief's
// example questions, the box's length (the server's QUESTION_MAX in
// utils/askPrompts.cjs), and the header's "Rated for stickiness: n of m",
// which tells a partner how much of the book the AI can reason about.
// tests/ask-prompts.test.mjs holds the length and the count to the server's.

export const EXAMPLE_QUESTIONS = [
  'Is Mike overloaded?',
  "Who's the natural home for a $300k healthcare client?",
  "Where's our biggest retention risk?",
];

export const QUESTION_MAX = 2000;

/**
 * The clients with a Stickiness pick, an integer from 1 to 5: the ones the
 * book (utils/book.cjs, stickinessPick) shows as rated. The rest read "not
 * rated" there, and count as unknown in its exposure, never as safe.
 */
export function ratedForStickiness(clients) {
  if (!Array.isArray(clients)) return 0;
  return clients.filter((client) => {
    const pick = parseFloat(client?.stickiness);
    return Number.isInteger(pick) && pick >= 1 && pick <= 5;
  }).length;
}
