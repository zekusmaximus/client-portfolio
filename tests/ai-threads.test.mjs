// Follow-up questions (docs/plans/tier-2.md, S14, WP10): utils/aiThreads.cjs,
// the pure half of a thread, and the request services/anthropic.cjs builds
// from it. Every answer here comes from the real service driven by the
// recorded streams in tests/fixtures/anthropic/ (fakeFetch), so each stored
// turn holds exactly the content blocks the SDK returns, and each request is
// the one the SDK sends. The routes are tests/routes.test.mjs; the columns
// tests/schema.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import threads from '../utils/aiThreads.cjs';
import askPrompts from '../utils/askPrompts.cjs';
import aiAnswers from '../utils/aiAnswers.cjs';
import ai from '../services/anthropic.cjs';
import { fakeFetch } from './helpers/fakeAnthropic.mjs';

const {
  FOLLOW_UP_MAX, THREAD_KINDS, systemHash, turnContent, isTurn, replayBlocks, threadHistory, readParentId,
  checkFollowUp, threadPlace, earlierTurns,
} = threads;
const { systemBlocks, askTurn, briefTurn } = askPrompts;

const BOOK = '# The book\n\n| Client | Lead |\n| --- | --- |\n| Smith & Co | Mike |\n';
const SYSTEM = systemBlocks(BOOK);
const DAY = new Date('2026-09-29T15:00:00Z');

// A service answering from `queue`, its recorded requests, and complete()
// with its log lines silenced
function serviceWith(queue) {
  const fake = fakeFetch(queue);
  const service = ai.createService({ apiKey: 'test', fetch: fake.fetch, model: 'claude-opus-5' });
  const complete = async (options) => {
    const saved = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = () => {};
    try {
      return await service.complete({ maxTokens: 32000, label: 'test', ...options });
    } finally {
      Object.assign(console, saved);
    }
  };
  return { complete, requests: fake.requests };
}

// A turn as ai_answers.content stores it and gives it back (JSON through JSONB)
const stored = (content) => JSON.parse(JSON.stringify(content));

// A row of THREAD_SQL for a turn
const rowOf = (content, overrides = {}) => ({
  id: 1, parent_id: null, kind: 'ask', question: 'q', answer: 'An answer.', refused: false, truncated: false,
  book_sha256: aiAnswers.bookHash(BOOK), content, asked_by_username: 'jeff', created_at: '2026-09-29T15:00:00.000Z',
  ...overrides,
});
const CURRENT = { systemSha: systemHash(SYSTEM), bookSha: aiAnswers.bookHash(BOOK) };

// ------------------------------------------------------------------ turns ---

test('turnContent: a whole answer stores the user turn as sent and the content blocks as returned, with the system hash', async () => {
  const { complete } = serviceWith(['text-with-thinking.sse']);
  const prompt = askTurn('Who carries the most?', DAY);
  const result = await complete({ system: SYSTEM, prompt });
  const content = turnContent({ system: SYSTEM, prompt, result });
  assert.deepEqual(content, {
    system_sha256: systemHash(SYSTEM),
    messages: [
      { role: 'user', content: 'Today is 2026-09-29.\n\n<question>\nWho carries the most?\n</question>' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '', signature: 'EqQBCkYIBxgCKkDfakeSignature' },
          { type: 'text', text: '## EXECUTIVE SUMMARY\nMike leads six clients and carries the heaviest book.' },
        ],
      },
    ],
  });
  assert.equal(isTurn(content), true);
  assert.equal(isTurn(stored(content)), true);
});

test('turnContent: nothing for a refusal (before output or mid-stream), a cut-off answer, or one without text', async () => {
  for (const fixture of ['refusal-before-output.sse', 'refusal-mid-stream.sse', 'fallback-refused.sse', 'max-tokens.sse']) {
    const { complete } = serviceWith([fixture]);
    const result = await complete({ system: SYSTEM, prompt: 'x' });
    assert.equal(turnContent({ system: SYSTEM, prompt: 'x', result }), null, fixture);
  }
  const whole = { text: 'ok', refused: false, truncated: false, content: [{ type: 'text', text: 'ok' }] };
  assert.equal(turnContent({ system: SYSTEM, prompt: 'x', result: { ...whole, text: '' } }), null);
  assert.equal(turnContent({ system: SYSTEM, prompt: 'x', result: { ...whole, content: [] } }), null);
  assert.equal(turnContent({ system: SYSTEM, prompt: undefined, result: whole }), null);
  assert.equal(turnContent({ system: SYSTEM, prompt: 'x', result: undefined }), null);
  assert.notEqual(turnContent({ system: SYSTEM, prompt: 'x', result: whole }), null);
});

test('systemHash: the same blocks give the same hash; another book or other instructions another', () => {
  assert.equal(systemHash(systemBlocks(BOOK)), systemHash(systemBlocks(`${BOOK}`)));
  assert.match(systemHash(SYSTEM), /^[0-9a-f]{64}$/);
  assert.notEqual(systemHash(systemBlocks(`${BOOK}| Jones | Jeff |\n`)), systemHash(SYSTEM));
  assert.notEqual(systemHash([{ ...SYSTEM[0], text: `${SYSTEM[0].text} ` }, SYSTEM[1]]), systemHash(SYSTEM));
});

// ----------------------------------------------------------------- replay ---

test('replayBlocks: as returned without a fallback; after a mid-answer fallback, only text (and the marker) from before the boundary', async () => {
  const { complete } = serviceWith(['text-with-thinking.sse', 'fallback-mid-stream-thinking.sse', 'fallback-mid-stream.sse']);
  const plain = await complete({ system: SYSTEM, prompt: 'x' });
  assert.deepEqual(replayBlocks(plain.content), plain.content);

  const rescued = await complete({ system: SYSTEM, prompt: 'x' });
  assert.equal(rescued.text, 'Mike leads six clients and carries the heaviest lead book.');
  assert.deepEqual(rescued.content.map((b) => b.type), ['thinking', 'text', 'fallback', 'thinking', 'text']);
  assert.deepEqual(replayBlocks(rescued.content), [
    { type: 'text', text: 'Mike leads six clients ' },
    { type: 'fallback', from: { model: 'claude-opus-5' }, to: { model: 'claude-opus-4-8' }, trigger: { type: 'refusal', category: 'cyber' } },
    { type: 'thinking', thinking: '', signature: 'EqQBCkYIBxgCKkDopus48After' },
    { type: 'text', text: 'and carries the heaviest lead book.' },
  ]);

  const textOnly = await complete({ system: SYSTEM, prompt: 'x' });
  assert.deepEqual(replayBlocks(textOnly.content), textOnly.content);

  // The last boundary counts; model-internal blocks of any kind before it go
  const blocks = [
    { type: 'redacted_thinking', data: 'r' }, { type: 'text', text: 'a' }, { type: 'fallback', from: {}, to: {} },
    { type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 't', name: 'n', input: {} },
    { type: 'text', text: 'b' }, { type: 'fallback', from: {}, to: {} }, { type: 'thinking', thinking: '', signature: 'u' },
    { type: 'text', text: 'c' },
  ];
  assert.deepEqual(replayBlocks(blocks).map((b) => b.type), ['text', 'fallback', 'text', 'fallback', 'thinking', 'text']);
  assert.deepEqual(replayBlocks(undefined), []);
});

test('threadHistory: each saved turn\'s user message then its assistant message, oldest first; the same turns always give the same messages', () => {
  const turn = (q, sig) => ({
    system_sha256: 'x',
    messages: [{ role: 'user', content: q }, { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: sig }, { type: 'text', text: `A to ${q}` }] }],
  });
  const turns = [turn('one', 's1'), turn('two', 's2')];
  const history = threadHistory(turns);
  assert.deepEqual(history, [
    { role: 'user', content: 'one' },
    { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's1' }, { type: 'text', text: 'A to one' }] },
    { role: 'user', content: 'two' },
    { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's2' }, { type: 'text', text: 'A to two' }] },
  ]);
  assert.equal(JSON.stringify(threadHistory(stored(turns))), JSON.stringify(history));
  // Appending a turn appends to the messages and leaves the earlier ones as they were
  const longer = threadHistory([...turns, turn('three', 's3')]);
  assert.deepEqual(longer.slice(0, history.length), history);
  assert.deepEqual(threadHistory([]), []);
});

// --------------------------------------------------------------- requests ---

// A question, then two follow-ups, as routes/ai.cjs builds them: each turn
// stored as the database gives it back, each follow-up's history from the
// stored turns. What the fake received is the proof: the book blocks
// byte-identical in the three requests, and each request the one before it
// with the answer it got and the new question appended, nothing edited.
test('a question and two follow-ups: the book blocks byte-identical, the history appended and never edited, thinking blocks back as returned', async () => {
  const { complete, requests } = serviceWith(['text-with-thinking.sse', 'fallback-mid-stream-thinking.sse', 'text-with-thinking.sse']);
  const turns = [];
  const results = [];
  for (const [i, question] of ['Who carries the most?', 'And after Mike?', 'Why?'].entries()) {
    const prompt = askTurn(question, new Date(DAY.getTime() + i * 86400000));
    const result = await complete({ system: SYSTEM, prompt, history: threadHistory(turns) });
    results.push(result);
    turns.push(stored(turnContent({ system: SYSTEM, prompt, result })));
  }
  assert.equal(requests.length, 3);
  const bodies = requests.map((r) => r.body);

  // The book blocks, byte for byte, with the one marker on the book
  for (const body of bodies) assert.equal(JSON.stringify(body.system), JSON.stringify(SYSTEM));

  // Each request: the one before, its answer as returned (replayed), the new question
  assert.deepEqual(bodies.map((b) => b.messages.length), [1, 3, 5]);
  for (let i = 1; i < 3; i += 1) {
    const before = bodies[i - 1].messages;
    assert.equal(JSON.stringify(bodies[i].messages.slice(0, before.length)), JSON.stringify(before), `request ${i + 1} begins with request ${i}`);
    assert.deepEqual(bodies[i].messages[before.length], { role: 'assistant', content: replayBlocks(results[i - 1].content) });
    assert.equal(bodies[i].messages.at(-1).role, 'user');
  }
  // The first answer's thinking block, signature and all, goes back unchanged, twice
  const firstThinking = { type: 'thinking', thinking: '', signature: 'EqQBCkYIBxgCKkDfakeSignature' };
  assert.deepEqual(bodies[1].messages[1].content[0], firstThinking);
  assert.deepEqual(bodies[2].messages[1].content[0], firstThinking);
  // The second answer was rescued mid-answer: its opus-5 thinking before the boundary is not replayed
  assert.deepEqual(bodies[2].messages[3].content.map((b) => b.type), ['text', 'fallback', 'thinking', 'text']);
  // Each question, with its own day, as it was sent
  assert.equal(bodies[2].messages[0].content, 'Today is 2026-09-29.\n\n<question>\nWho carries the most?\n</question>');
  assert.equal(bodies[2].messages[2].content, 'Today is 2026-09-30.\n\n<question>\nAnd after Mike?\n</question>');
  assert.equal(bodies[2].messages[4].content, 'Today is 2026-10-01.\n\n<question>\nWhy?\n</question>');

  // The automatic cache marker only on the follow-ups; everything else as on a first question
  assert.equal('cache_control' in bodies[0], false);
  assert.deepEqual([bodies[1].cache_control, bodies[2].cache_control], [{ type: 'ephemeral' }, { type: 'ephemeral' }]);
  for (const body of bodies) {
    assert.deepEqual(
      Object.keys(body).filter((k) => !['messages', 'cache_control'].includes(k)).sort(),
      ['fallbacks', 'max_tokens', 'model', 'stream', 'system'],
    );
    assert.deepEqual([body.model, body.max_tokens, body.fallbacks, body.stream], ['claude-opus-5', 32000, 'default', true]);
  }
  for (const { headers } of requests) assert.equal(headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
});

test('a brief followed up: the brief\'s turn as sent, then the question', async () => {
  const { complete, requests } = serviceWith(['text-with-thinking.sse', 'text-with-thinking.sse']);
  const brief = briefTurn(DAY);
  const result = await complete({ system: SYSTEM, prompt: brief });
  const turn = stored(turnContent({ system: SYSTEM, prompt: brief, result }));
  await complete({ system: SYSTEM, prompt: askTurn('Say more about Mike.', DAY), history: threadHistory([turn]) });
  assert.equal(requests[1].body.messages[0].content, brief);
  assert.equal(requests[1].body.messages.length, 3);
});

// ----------------------------------------------------------------- checks ---

const whole = (question = 'q') => ({
  system_sha256: CURRENT.systemSha,
  messages: [{ role: 'user', content: question }, { role: 'assistant', content: [{ type: 'text', text: 'An answer.' }] }],
});
// A thread of `n` answers, root first, each with its turn
const chainOf = (n, overrides = {}) => Array.from({ length: n }, (_, i) => rowOf(whole(`q${i}`), {
  id: i + 1, parent_id: i === 0 ? null : i, kind: i === 0 ? overrides.rootKind ?? 'ask' : 'ask',
}));

test('checkFollowUp: up to five follow-ups; the sixth refused', () => {
  assert.equal(FOLLOW_UP_MAX, 5);
  for (let n = 1; n <= FOLLOW_UP_MAX; n += 1) assert.equal(checkFollowUp(chainOf(n), CURRENT), null, `${n - 1} follow-ups so far`);
  assert.deepEqual(checkFollowUp(chainOf(FOLLOW_UP_MAX + 1), CURRENT),
    { status: 400, error: 'This thread already has its 5 follow-ups. Ask a new question.' });
  // A read that stopped before the thread's first answer is too long in any case
  const cut = chainOf(3);
  cut[0] = { ...cut[0], parent_id: 99 };
  assert.equal(checkFollowUp(cut, CURRENT).status, 400);
  // A brief starts a thread as an Ask does
  assert.equal(checkFollowUp(chainOf(2, { rootKind: 'brief' }), CURRENT), null);
  assert.deepEqual(THREAD_KINDS, ['ask', 'brief']);
});

test('checkFollowUp: each refusal, in order: missing, a transition plan, declined, cut off, no text, saved before WP10, then the book or the instructions changed', () => {
  assert.deepEqual(checkFollowUp([], CURRENT), { status: 404, error: 'No such answer.' });
  assert.deepEqual(checkFollowUp(undefined, CURRENT), { status: 404, error: 'No such answer.' });
  assert.deepEqual(checkFollowUp([rowOf(null, { kind: 'transition-plan' })], CURRENT),
    { status: 400, error: 'A transition plan cannot be followed up. Ask a new question.' });
  assert.deepEqual(checkFollowUp([rowOf(null, { refused: true, answer: '' })], CURRENT),
    { status: 400, error: 'The AI declined this one, so it cannot be followed up. Ask a new question.' });
  assert.deepEqual(checkFollowUp([rowOf(null, { truncated: true })], CURRENT),
    { status: 400, error: 'This answer was cut off, so it cannot be followed up. Ask a new, narrower question.' });
  assert.deepEqual(checkFollowUp([rowOf(null, { answer: '' })], CURRENT),
    { status: 400, error: 'This answer has no text, so it cannot be followed up. Ask a new question.' });
  assert.deepEqual(checkFollowUp([rowOf(null)], CURRENT),
    { status: 400, error: 'This answer was saved before follow-ups were possible, so it cannot be followed up. Ask a new question.' });
  assert.equal(checkFollowUp([rowOf({ ...whole(), messages: [] })], CURRENT).status, 400, 'a malformed turn');

  const otherBook = { systemSha: systemHash(systemBlocks(`${BOOK}| Jones | Jeff |\n`)), bookSha: aiAnswers.bookHash(`${BOOK}| Jones | Jeff |\n`) };
  assert.deepEqual(checkFollowUp(chainOf(2), otherBook), {
    status: 409,
    error: 'The book has changed since this answer was given, so a follow-up would not read the same book. Ask a new question.',
  });
  const otherInstructions = { ...CURRENT, systemSha: 'b'.repeat(64) };
  assert.deepEqual(checkFollowUp(chainOf(2), otherInstructions), {
    status: 409,
    error: "The AI's instructions have changed since this answer was given, so it cannot be followed up. Ask a new question.",
  });
  // Declined outranks a changed book: the partner learns the answer can never be followed up
  assert.equal(checkFollowUp([rowOf(null, { refused: true })], otherBook).status, 400);
});

test('readParentId: absent or null is a new question; a positive integer an answer; anything else refused', () => {
  assert.deepEqual(readParentId(undefined), { parentId: null, error: null });
  assert.deepEqual(readParentId(null), { parentId: null, error: null });
  assert.deepEqual(readParentId(41), { parentId: 41, error: null });
  assert.deepEqual(readParentId(2147483647), { parentId: 2147483647, error: null });
  for (const bad of ['41', 0, -1, 1.5, 2147483648, true, {}, [41], '']) {
    assert.deepEqual(readParentId(bad), { parentId: null, error: 'parentId must be the id of an answer.' }, JSON.stringify(bad));
  }
});

test('threadPlace and earlierTurns: the answer\'s number in its thread, whether it can be followed up, and the turns before it', () => {
  assert.deepEqual(threadPlace(chainOf(1), CURRENT), { followUp: 0, canFollowUp: true });
  assert.deepEqual(threadPlace(chainOf(3), CURRENT), { followUp: 2, canFollowUp: true });
  assert.deepEqual(threadPlace(chainOf(6), CURRENT), { followUp: 5, canFollowUp: false });
  assert.deepEqual(threadPlace([rowOf(null)], CURRENT), { followUp: 0, canFollowUp: false });
  assert.deepEqual(threadPlace([], CURRENT), { followUp: 0, canFollowUp: false });

  const chain = chainOf(3);
  const earlier = earlierTurns(chain);
  assert.equal(earlier.length, 2);
  assert.deepEqual(Object.keys(earlier[0]).sort(), ['answer', 'asked_by_username', 'created_at', 'id', 'kind', 'question', 'refused', 'truncated']);
  assert.deepEqual(earlier.map((t) => t.id), [1, 2]);
  assert.equal('content' in earlier[0], false, 'the stored turn is not sent to the page');
  assert.deepEqual(earlierTurns(chainOf(1)), []);
});
