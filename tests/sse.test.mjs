// The streamed answers' wire format (docs/plans/tier-1.md, WP5): the server's
// writer (utils/sse.cjs) and the page's parser (src/utils/sse.js), which reads
// the response body in whatever chunks the network delivers. The fixtures in
// tests/fixtures/sse/ are server.cjs's own output, recorded with curl against
// the fake Anthropic server: a streamed Ask with text that has multi-byte
// characters, a CR and two pings, and one that fails after it opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sse from '../utils/sse.cjs';
import { createSseParser, eventJson } from '../src/utils/sse.js';

const { sseEvent, ssePing, wantsStream, pingInterval, SSE_HEADERS, DEFAULT_PING_MS } = sse;

const fixture = (name) => readFileSync(new URL(`./fixtures/sse/${name}`, import.meta.url));
const ASK = fixture('streamed-ask.sse');
const FAILED = fixture('streamed-error.sse');

// Every event the parser dispatches for these chunks, in order
function parse(chunks) {
  const events = [];
  const parser = createSseParser((event) => events.push(event));
  for (const chunk of chunks) parser.push(chunk);
  parser.end();
  return events;
}

const ASK_TEXT = "## Who’s carrying what\n\nMike leads **six** clients — $412,000 in 2026, 1.4× the partners’ average. "
  + 'Café « Smørrebrød », ✓ and 💼 are here so a chunk can split a character.\n\n'
  + '- Paula: 0.8×\n- Joe: "quoted" & <angled>\n\nA line with a CR\r in it.';

test('the recorded Ask: start, three text events, done; the pings are not events', () => {
  const events = parse([ASK]);
  assert.deepEqual(events.map((e) => e.type), ['start', 'text', 'text', 'text', 'done']);
  assert.deepEqual(eventJson(events[0]), { model: 'claude-opus-5' });
  const joined = events.filter((e) => e.type === 'text').map((e) => eventJson(e).text).join('');
  assert.equal(joined, ASK_TEXT);
  const done = eventJson(events[4]);
  assert.equal(done.answer, ASK_TEXT, 'done carries the answer as saved');
  assert.deepEqual([done.saved, typeof done.answerId, done.refused, done.truncated], [true, 'number', false, false]);
  assert.ok(ASK.toString('utf8').includes('\n: ping\n\n'), 'the recording has pings');
});

test('the recorded Ask split at every byte offset parses to the same events', () => {
  const whole = parse([ASK]);
  const bytes = new Uint8Array(ASK);
  // The 4-byte briefcase and the 3-byte ✓ are in there to be split
  assert.ok(bytes.length > Buffer.byteLength(ASK.toString('utf8').replace(/[^\x00-\x7f]/g, '')));
  for (let at = 0; at <= bytes.length; at += 1) {
    assert.deepEqual(parse([bytes.subarray(0, at), bytes.subarray(at)]), whole, `split at byte ${at}`);
  }
  // And one byte at a time
  assert.deepEqual(parse(Array.from(bytes, (_, i) => bytes.subarray(i, i + 1))), whole);
});

test('an error after the stream opened arrives as an error event', () => {
  const events = parse([FAILED]);
  assert.deepEqual(events.map((e) => e.type), ['start', 'text', 'error']);
  assert.deepEqual(eventJson(events[2]), { error: 'The AI service is temporarily unavailable.' });
  const bytes = new Uint8Array(FAILED);
  for (let at = 0; at <= bytes.length; at += 1) {
    assert.deepEqual(parse([bytes.subarray(0, at), bytes.subarray(at)]), events, `split at byte ${at}`);
  }
});

test('CRLF and CR line ends read as LF does, a CRLF split across two chunks included', () => {
  const lf = ASK.toString('utf8');
  const whole = parse([lf]);
  // The CR inside the answer is JSON-escaped (\r), so every raw line end is a real one
  const crlf = lf.replace(/\n/g, '\r\n');
  const cr = lf.replace(/\n/g, '\r');
  assert.deepEqual(parse([crlf]), whole);
  assert.deepEqual(parse([cr]), whole);
  for (let at = 0; at <= crlf.length; at += 1) {
    assert.deepEqual(parse([crlf.slice(0, at), crlf.slice(at)]), whole, `CRLF split at ${at}`);
  }
});

test('multi-line data joins with a line break; comments, unknown fields, id and retry are ignored', () => {
  const events = parse([
    ': a comment\n',
    'event: note\ndata: first\ndata:second\ndata\nid: 7\nretry: 1000\nfoo: bar\n\n',
    'data: no event name\n\n',
  ]);
  assert.deepEqual(events, [
    { type: 'note', data: 'first\nsecond\n' },
    { type: 'message', data: 'no event name' },
  ]);
});

test('an event without data is not dispatched, nor one the stream ends in the middle of', () => {
  assert.deepEqual(parse(['event: start\n\n', ': ping\n\n', 'event: text\ndata: {"text":"cut"}\n']), []);
  assert.deepEqual(parse(['event: text\ndata: {"text":"cut"}']), []);
});

test('sseEvent round-trips through the page\'s parser, line breaks, CRs and every character included', () => {
  const values = [
    { model: 'claude-opus-5' },
    { text: 'line one\nline two\r\nline three\rend' },
    { text: '\n\n' },
    { text: ': not a comment\ndata: not a field\n\nevent: nope' },
    { text: 'Café — ✓ 💼 « »    ' },
    { answerId: 42, saved: true, answer: 'x', usage: { input_tokens: 1 }, costUsd: 0.0712, refusalCategory: null },
    { error: 'The AI service is temporarily unavailable.' },
  ];
  for (const value of values) {
    const text = sseEvent('text', value);
    assert.ok(text.endsWith('\n\n'));
    assert.equal(text.split('\n').length, 4, 'event line, one data line, the blank line');
    const events = parse([new TextEncoder().encode(text)]);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'text');
    assert.deepEqual(eventJson(events[0]), value);
  }
  assert.equal(sseEvent('done', { a: 1 }), 'event: done\ndata: {"a":1}\n\n');
  assert.equal(ssePing(), ': ping\n\n');
  assert.deepEqual(parse([ssePing(), ssePing()]), []);
});

test('eventJson: null for data that is not JSON', () => {
  assert.equal(eventJson({ type: 'text', data: 'not json' }), null);
  assert.deepEqual(eventJson({ type: 'text', data: '{"text":"a"}' }), { text: 'a' });
});

test('wantsStream: Accept names text/event-stream, alone or among others; nothing else does', () => {
  for (const accept of ['text/event-stream', 'Text/Event-Stream', 'application/json, text/event-stream', 'text/event-stream;q=0.9, */*']) {
    assert.equal(wantsStream(accept), true, accept);
  }
  for (const accept of [undefined, '', '*/*', 'application/json', 'text/event-streams', 'x-text/event-stream', 'text/html']) {
    assert.equal(wantsStream(accept), false, String(accept));
  }
});

test('pingInterval: AI_STREAM_PING_MS as a whole number of milliseconds, else 15 seconds', () => {
  assert.equal(DEFAULT_PING_MS, 15000);
  assert.equal(pingInterval(undefined), 15000);
  assert.equal(pingInterval(''), 15000);
  assert.equal(pingInterval(' 250 '), 250);
  assert.equal(pingInterval('1'), 1);
  for (const bad of ['0', '-5', '1.5', 'abc', '15s']) assert.equal(pingInterval(bad), 15000, bad);
});

test('the stream\'s headers: an event stream, not cached or transformed, and not buffered by a proxy', () => {
  assert.deepEqual(SSE_HEADERS, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
});
