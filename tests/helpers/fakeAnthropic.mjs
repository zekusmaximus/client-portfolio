// A stand-in for Anthropic's Messages API (docs/plans/tier-1.md, section 4),
// so the real SDK can be driven without a key.
//
// Fixtures live in tests/fixtures/anthropic/: `*.sse` are streams written
// from the documented wire format (message_start, content_block_*,
// message_delta, message_stop, ping, error; lines starting with ":" are SSE
// comments, which say what the fixture records), and `*.json` are HTTP errors
// ({ status, headers, body }). A queue item is a fixture name, or one of:
//   { fixture: 'name.sse', pauseAfter: n, pauseMs: ms }  hold the stream open
//                                                        after n events
//   { fixture: 'name.sse', pauseAfter: n, until: promise } hold until it settles
//   { status, headers, body }                            an HTTP error
//   { sse: 'event: ...' }                                a stream given inline
//   { networkError: true }                               fetch() rejects (fakeFetch only)
//
// fakeFetch(queue) is a fetch for createService({ fetch }): it records each
// request and answers from the queue. startFakeAnthropic() is an http server
// on 127.0.0.1 that answers POST /v1/messages from its queue, or, when the
// queue is empty, with a short answer naming what it received (a transition
// plan request gets a plan in the six sections, recommending people from the
// prompt's own roster). It records every request body.
//
// As a script, for driving the page end to end with server.cjs:
//   node tests/helpers/fakeAnthropic.mjs --port 5099
//   ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://127.0.0.1:5099 NODE_ENV=development node server.cjs
// POST /__fake/enqueue { "fixtures": ["refusal-before-output.sse"] } queues
// fixtures for the next requests; GET /__fake/requests lists what it received.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/anthropic/', import.meta.url));

// One fixture as { kind: 'sse', events } (each event's raw text, comments
// dropped) or { kind: 'json', status, headers, body }.
export function loadFixture(name) {
  const text = readFileSync(new URL(name, pathToFileURL(FIXTURE_DIR)), 'utf8');
  return name.endsWith('.json') ? { kind: 'json', ...JSON.parse(text) } : parseSse(text);
}

export function parseSse(text) {
  const events = text
    .replace(/\r\n/g, '\n')
    .split(/\n\n+/)
    .map((chunk) => chunk.split('\n').filter((line) => line !== '' && !line.startsWith(':')).join('\n'))
    .filter((chunk) => chunk !== '')
    .map((chunk) => `${chunk}\n\n`);
  return { kind: 'sse', events };
}

function resolveItem(item) {
  if (typeof item === 'string') return { ...loadFixture(item), name: item };
  if (item?.fixture) return { ...loadFixture(item.fixture), name: item.fixture, pauseAfter: item.pauseAfter, pauseMs: item.pauseMs, until: item.until };
  if (item?.sse) return { ...parseSse(item.sse), name: 'inline', pauseAfter: item.pauseAfter, pauseMs: item.pauseMs, until: item.until };
  if (item?.networkError) return { kind: 'network' };
  if (typeof item?.status === 'number') return { kind: 'json', status: item.status, headers: item.headers || {}, body: item.body };
  throw new Error(`fakeAnthropic: cannot read queue item ${JSON.stringify(item)}`);
}

const pause = (item) => (item.until ? Promise.resolve(item.until).catch(() => {}) : new Promise((r) => setTimeout(r, item.pauseMs || 0)));

// Writes the events in order through `write`, holding after pauseAfter events.
async function playEvents(item, write) {
  for (let i = 0; i < item.events.length; i += 1) {
    if (item.pauseAfter !== undefined && i === item.pauseAfter) await pause(item);
    if (write(item.events[i]) === false) return;
  }
}

/** A fetch that answers from `queue` and records each request in `requests`. */
export function fakeFetch(queue = []) {
  const pending = [...queue];
  const requests = [];

  async function fetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const bodyText = typeof init.body === 'string' ? init.body : init.body ? await new Response(init.body).text() : '';
    requests.push({
      url,
      method: init.method,
      headers: Object.fromEntries(new Headers(init.headers)),
      body: bodyText ? JSON.parse(bodyText) : null,
    });
    if (pending.length === 0) throw new Error('fakeFetch: no response queued');
    const item = resolveItem(pending.shift());

    if (item.kind === 'network') throw new TypeError('fetch failed');
    if (item.kind === 'json') {
      return new Response(JSON.stringify(item.body), {
        status: item.status,
        headers: { 'content-type': 'application/json', ...item.headers },
      });
    }
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        await playEvents(item, (event) => controller.enqueue(encoder.encode(event)));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_fake_stream' } });
  }

  return { fetch, requests, pending };
}

// ---------------------------------------------------------------- answers ---

const sseEvent = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const tokensFor = (text) => Math.max(1, Math.ceil(String(text || '').length / 4));

/** A whole streamed answer: one text block, end_turn, usage estimated at four characters a token. */
export function streamedText(text, { model = 'claude-opus-5', inputTokens = 100 } = {}) {
  const usage = { input_tokens: inputTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, output_tokens: 1 };
  const pieces = String(text).match(/[\s\S]{1,80}/g) || [''];
  return [
    sseEvent('message_start', { message: { id: 'msg_fake_default', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, stop_details: null, usage } }),
    sseEvent('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ...pieces.map((piece) => sseEvent('content_block_delta', { index: 0, delta: { type: 'text_delta', text: piece } })),
    sseEvent('content_block_stop', { index: 0 }),
    sseEvent('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null, stop_details: null }, usage: { output_tokens: tokensFor(text) } }),
    sseEvent('message_stop', {}),
  ];
}

const systemText = (system) => (Array.isArray(system) ? system.map((block) => block?.text || '').join('\n') : system || '');
const promptText = (body) => {
  const content = body?.messages?.[0]?.content;
  return Array.isArray(content) ? content.map((block) => block?.text || '').join('\n') : String(content || '');
};

// A transition plan in the six sections the parser reads, recommending the
// first partner on the prompt's roster as lead and the next person as second
// chair, so the page's resolution against the roster can be seen working.
function transitionPlanAnswer(prompt) {
  const client = (prompt.match(/\*\*Name\*\*:\s*(.+)/) || [])[1]?.trim() || 'this client';
  const roster = [...prompt.matchAll(/^- (.+?) \((Partner|Emeritus|Associate)\): leads /gm)].map((m) => ({ name: m[1], role: m[2] }));
  const lead = roster.find((p) => p.role === 'Partner');
  const second = roster.find((p) => p !== lead);
  return [
    '## TRANSITION STRATEGY',
    `Fake Anthropic plan for ${client}: introduce the new lead in a joint meeting, then hand over the day-to-day contact.`,
    '',
    '## RECOMMENDED LEAD',
    lead ? lead.name : 'None',
    'The first partner on the roster the fake server received.',
    '',
    '## RECOMMENDED SECOND CHAIR',
    second ? second.name : 'None',
    'The next person on that roster.',
    '',
    '## TIMELINE',
    '60 days',
    '',
    '## KEY RISKS & MITIGATION',
    '- The client hears of the change second-hand: tell them first.',
    '',
    '## ACTION ITEMS',
    `1. Call ${client} to introduce the new lead`,
    '2. Hand over the open matters',
    '3. Check in after 30 days',
    '',
    '## CLIENT COMMUNICATION TEMPLATE',
    `Dear ${client}, we are writing to introduce your new lead.`,
  ].join('\n');
}

/** The answer when the queue is empty: what the request carried. */
export function describeRequest(body) {
  const prompt = promptText(body);
  const system = systemText(body?.system);
  if (prompt.includes('## RECOMMENDED LEAD')) return transitionPlanAnswer(prompt);
  const firstLine = prompt.split('\n').find((line) => line.trim() !== '') || '';
  return [
    '**Fake Anthropic answer.** This is what the request carried:',
    '',
    `- Model: ${body?.model}`,
    `- max_tokens: ${body?.max_tokens}`,
    `- System prompt: ${system.length} characters`,
    `- Prompt: ${prompt.length} characters, ${prompt.split('\n').length} lines`,
    `- First line: ${firstLine.slice(0, 160)}`,
    `- Fallbacks: ${body?.fallbacks ?? 'none'}`,
    `- Effort: ${body?.output_config?.effort ?? 'not set'}`,
  ].join('\n');
}

// ----------------------------------------------------------------- server ---

const readBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

const sendJson = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

/**
 * Starts the fake server. Returns { url, port, requests, enqueue(...items),
 * close() }; `url` is what ANTHROPIC_BASE_URL (or createService's baseURL)
 * takes. `onRequest(record)` is called with each recorded request.
 */
export function startFakeAnthropic({ port = 0, host = '127.0.0.1', onRequest } = {}) {
  const queue = [];
  const requests = [];

  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://fake');
    try {
      if (req.method === 'POST' && pathname === '/__fake/enqueue') {
        const { fixtures = [] } = JSON.parse((await readBody(req)) || '{}');
        queue.push(...fixtures);
        return sendJson(res, 200, { queued: queue.length });
      }
      if (req.method === 'GET' && pathname === '/__fake/requests') return sendJson(res, 200, requests);
      if (req.method !== 'POST' || pathname !== '/v1/messages') {
        return sendJson(res, 404, { type: 'error', error: { type: 'not_found_error', message: `No route ${req.method} ${pathname}` } });
      }

      const text = await readBody(req);
      const record = { path: req.url, headers: req.headers, body: text ? JSON.parse(text) : null, at: new Date().toISOString() };
      requests.push(record);
      if (onRequest) onRequest(record);

      const item = queue.length > 0
        ? resolveItem(queue.shift())
        : { kind: 'sse', events: streamedText(describeRequest(record.body), { model: record.body?.model, inputTokens: tokensFor(systemText(record.body?.system) + promptText(record.body)) }) };

      if (item.kind === 'json') return sendJson(res, item.status, item.body, item.headers);
      if (item.kind === 'network') {
        res.destroy();
        return undefined;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'request-id': 'req_fake_stream' });
      await playEvents(item, (event) => {
        if (res.destroyed) return false;
        res.write(event);
        return true;
      });
      res.end();
    } catch (err) {
      sendJson(res, 500, { type: 'error', error: { type: 'api_error', message: `fake server: ${err.message}` } });
    }
    return undefined;
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        url: `http://${host}:${address.port}`,
        port: address.port,
        requests,
        enqueue: (...items) => queue.push(...items),
        close: () => new Promise((done) => {
          server.closeAllConnections?.();
          server.close(() => done());
        }),
      });
    });
  });
}

// Run as a script: node tests/helpers/fakeAnthropic.mjs [--port 5099]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--port');
  const port = at >= 0 ? Number(process.argv[at + 1]) : 5099;
  const fake = await startFakeAnthropic({
    port,
    onRequest: (record) => console.log(JSON.stringify({
      event: 'fake_anthropic_request',
      model: record.body?.model,
      maxTokens: record.body?.max_tokens,
      fallbacks: record.body?.fallbacks ?? null,
      beta: record.headers['anthropic-beta'] ?? null,
      effort: record.body?.output_config?.effort ?? null,
      promptChars: promptText(record.body).length,
    })),
  });
  console.log(`Fake Anthropic listening on ${fake.url} (POST /v1/messages; POST /__fake/enqueue; GET /__fake/requests)`);
}
