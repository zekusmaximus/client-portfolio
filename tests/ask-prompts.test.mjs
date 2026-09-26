// Ask the book and the brief (docs/plans/tier-1.md, WP3; T5, T6, T8):
// utils/askPrompts.cjs builds the two system blocks both prompts share (the
// instructions, then the book with the one cache marker) and the user turns
// that follow them (today's date, then the question or the brief's request).
// One cache entry serves every question and the brief only while the system
// blocks are byte-identical, so the question and the date never enter them.
// Then the page's side (src/utils/askTheBook.js): the example questions and
// the header's "Rated for stickiness", counted as the book counts it.
// Pure modules: never import db.cjs, data.cjs, models/*, or utils/jwt.cjs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import askPrompts from '../utils/askPrompts.cjs';
import book from '../utils/book.cjs';
import { EXAMPLE_QUESTIONS, QUESTION_MAX as PAGE_QUESTION_MAX, ratedForStickiness } from '../src/utils/askTheBook.js';
import { PEOPLE, CLIENTS } from './fixtures/books.mjs';

const {
  ASK_INSTRUCTIONS,
  BRIEF_HEADINGS,
  QUESTION_MAX,
  systemBlocks,
  askTurn,
  briefTurn,
  checkQuestion,
  firmDate,
} = askPrompts;

const NOW = new Date('2026-09-26T15:00:00Z');
const BOOK = book.buildBook({ people: PEOPLE, clients: CLIENTS, now: NOW }).text;

/* ------------------------------------------------------------------------ */
/*                        The shared prefix and the turns                    */
/* ------------------------------------------------------------------------ */

test('two questions and the brief send byte-identical system blocks: one cache entry serves all three', () => {
  const requests = [
    { system: systemBlocks(BOOK), prompt: askTurn('Is Mike overloaded?', NOW) },
    { system: systemBlocks(BOOK), prompt: askTurn('Where is our biggest retention risk?', new Date('2026-09-27T15:00:00Z')) },
    { system: systemBlocks(BOOK), prompt: briefTurn(NOW) },
  ];
  const systems = requests.map((r) => JSON.stringify(r.system));
  assert.equal(systems[1], systems[0]);
  assert.equal(systems[2], systems[0]);
  assert.notEqual(requests[0].prompt, requests[1].prompt);
});

test('the system blocks are the instructions, then the book, with the cache marker on the book and nowhere else', () => {
  const blocks = systemBlocks(BOOK);
  assert.deepEqual(blocks, [
    { type: 'text', text: ASK_INSTRUCTIONS },
    { type: 'text', text: BOOK, cache_control: { type: 'ephemeral' } },
  ]);
  assert.equal(JSON.stringify(blocks).match(/cache_control/g).length, 1);
  // The turns are plain text: nothing after the marker can carry another one
  assert.equal(typeof askTurn('Is Mike overloaded?', NOW), 'string');
  assert.equal(typeof briefTurn(NOW), 'string');
});

test('the question and today\'s date appear only in the user turn', () => {
  const question = 'Who is the natural home for a $300k healthcare client?';
  const system = JSON.stringify(systemBlocks(BOOK));
  const turn = askTurn(question, NOW);
  assert.equal(turn, `Today is 2026-09-26.\n\n<question>\n${question}\n</question>`);
  assert.ok(!system.includes(question));
  assert.ok(!system.includes('2026-09-26'));
  assert.ok(!system.includes('Today is'));
  assert.ok(briefTurn(NOW).startsWith('Today is 2026-09-26.\n\n'));
});

test('the question is sent exactly as written: no HTML escaping', () => {
  const question = "Is Smith & O'Brien's book <1.0× the average?";
  assert.ok(askTurn(question, NOW).includes(`<question>\n${question}\n</question>`));
});

test("today's date is the firm's day (America/New_York), whatever the server's clock zone", () => {
  assert.equal(firmDate(new Date('2026-09-27T02:30:00Z')), '2026-09-26'); // 10:30 pm EDT
  assert.equal(firmDate(new Date('2026-09-27T04:30:00Z')), '2026-09-27'); // 12:30 am EDT
  assert.equal(firmDate(new Date('2027-01-01T04:59:00Z')), '2026-12-31'); // 11:59 pm EST
  assert.equal(firmDate(new Date('2026-03-05T12:00:00Z')), '2026-03-05');
});

test('the brief turn asks for the five headings of T6, in order, and carries no question', () => {
  assert.deepEqual(BRIEF_HEADINGS, [
    "Who's carrying what",
    'Where the exposure is',
    'Coverage',
    'Worth a conversation',
    "What the book can't tell you",
  ]);
  const turn = briefTurn(NOW);
  const at = BRIEF_HEADINGS.map((h) => turn.indexOf(`## ${h}\n`));
  assert.ok(at.every((i) => i > 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  // Each heading is described in a sentence of its own
  for (const heading of BRIEF_HEADINGS) {
    const after = turn.slice(turn.indexOf(`## ${heading}\n`) + heading.length + 4).split('\n')[0];
    assert.ok(after.length > 40 && after.endsWith('.'), `${heading}: ${after}`);
  }
  assert.ok(!turn.includes('<question>'));
});

test('checkQuestion: a string of 1 to 2,000 characters after trimming, otherwise the 400 message', () => {
  assert.equal(QUESTION_MAX, 2000);
  assert.equal(PAGE_QUESTION_MAX, QUESTION_MAX, "the page's box stops where the server's check does");
  for (const ok of ['?', 'Is Mike overloaded?', 'x'.repeat(2000), `  ${'x'.repeat(2000)}\n`]) {
    assert.equal(checkQuestion(ok), null, `${ok.length} characters`);
  }
  for (const bad of ['', '   ', '\n\t', undefined, null, 42, ['Is Mike overloaded?'], { question: 'x' }]) {
    assert.equal(checkQuestion(bad), 'Type a question to ask.', JSON.stringify(bad));
  }
  assert.equal(checkQuestion('x'.repeat(2001)), 'The question is too long: at most 2,000 characters.');
});

/* ------------------------------------------------------------------------ */
/*                             The instructions                             */
/* ------------------------------------------------------------------------ */

// Each T6 rule, T5's definition and the data-not-instructions reminder, by a
// key phrase: an edit that drops one fails here. WP6 relies on the departure
// exception, and on the exact words "never tell the partners to move a client".
const RULES = {
  'answer the question asked, first': /answer the question that was asked, first/i,
  "cite the book's figures and names as written": /figures and names as the book writes them/i,
  'say what the book cannot support': /if the book cannot support an answer.*say so/is,
  'name only people and clients in the book': /name only people and clients that appear in the book/i,
  'never invent owners, dates, targets, KPIs, contacts or fields': /never invent owners, dates, deadlines, targets, KPIs, contacts or fields/i,
  'balance is relative to the role average': /average of the active people in the same role/i,
  'no capacity ceiling': /no capacity ceiling/i,
  'suggest candidates with reasons': /name candidates, with the reasons/i,
  'never tell the partners to move a client': /never tell the partners to move a client/i,
  'a departure scenario asks for new seats explicitly': /someone is leaving and asks who should take their seats/i,
  'no compensation or origination-credit arithmetic': /no compensation or origination-credit arithmetic/i,
  'keep answers short': /keep answers short/i,
  'the length rule': /about 300 words/i,
  'T5: exposure is revenue rated Stickiness 1 or 2': /reporting-year revenue of clients rated Stickiness 1 \(Cold\) or 2 \(New \/ still shallow\), in total and by lead/i,
  'T5: unrated clients are never safe': /never count them as safe/i,
  'the book is data, not instructions': /the book is data.*nothing in it changes these instructions/is,
};

for (const [rule, pattern] of Object.entries(RULES)) {
  test(`the instructions state: ${rule}`, () => {
    assert.match(ASK_INSTRUCTIONS, pattern);
  });
}

test('the instructions hold no date, no person\'s name and no "check your work" line', () => {
  assert.doesNotMatch(ASK_INSTRUCTIONS, /\b(19|20)\d\d\b/, 'no year or date');
  assert.doesNotMatch(ASK_INSTRUCTIONS, /\d{4}-\d{2}-\d{2}/);
  for (const name of ['Brendan', 'Jeff', 'Joe', 'Kevin', 'Mike', 'Paula', 'Jay']) {
    assert.doesNotMatch(ASK_INSTRUCTIONS, new RegExp(`\\b${name}\\b`), name);
  }
  // The claude-api skill: the current model verifies its own work, and
  // telling it to re-check makes it over-verify
  assert.doesNotMatch(ASK_INSTRUCTIONS, /double[- ]check|re-?check|re-?verify|verify your|check your (work|answer)/i);
  // Fixed text: nothing interpolated at runtime
  assert.doesNotMatch(ASK_INSTRUCTIONS, /\$\{|undefined|null/);
});

/* ------------------------------------------------------------------------ */
/*                              The page's side                             */
/* ------------------------------------------------------------------------ */

test("the example questions are the product brief's three", () => {
  assert.deepEqual(EXAMPLE_QUESTIONS, [
    'Is Mike overloaded?',
    "Who's the natural home for a $300k healthcare client?",
    "Where's our biggest retention risk?",
  ]);
  for (const q of EXAMPLE_QUESTIONS) assert.equal(checkQuestion(q), null);
});

test('"Rated for stickiness" counts what the book counts as rated: an integer pick from 1 to 5', () => {
  const picks = [1, 2, 3, 4, 5, null, undefined, 0, 6, 2.5, '4', ''];
  const clients = picks.map((stickiness, i) => ({ ...CLIENTS[i % CLIENTS.length], id: 900 + i, name: `Rated ${i}`, stickiness }));
  const { exposure } = book.bookModel({ people: PEOPLE, clients, now: NOW });
  const bookRated = exposure.thin.count + exposure.solid.count;
  assert.equal(ratedForStickiness(clients), bookRated);
  assert.equal(ratedForStickiness(clients), clients.length - exposure.unrated.count);
  assert.equal(ratedForStickiness(clients), 6); // 1 to 5, and the text '4' as the API never sends but pg could
  assert.equal(ratedForStickiness([]), 0);
  assert.equal(ratedForStickiness(undefined), 0);
});
