// utils/sse.cjs
//
// The wire format of Ask's and the brief's streamed answers
// (docs/plans/tier-1.md, WP5, T9): server-sent events on a POST, which the
// page reads with fetch and a stream reader (src/utils/sse.js parses them).
// Pure: routes/ai.cjs writes what these return.
//
//   event: start   data: {"model":"claude-opus-5"}
//   event: text    data: {"text":"Mike leads "}          (each piece of the answer)
//   : ping                                                (every AI_STREAM_PING_MS until done)
//   event: done    data: {"answerId":42,"saved":true,"answer":"...",...}
//   event: error   data: {"error":"The AI service is temporarily unavailable."}

const DEFAULT_PING_MS = 15_000;

/**
 * One event: its type, then its data as one line of JSON. JSON.stringify
 * escapes every line break inside a string, so the data never spans lines and
 * never ends the event early.
 */
function sseEvent(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A comment line, which keeps the connection busy while the model thinks; the page's parser ignores it. */
function ssePing() {
  return ': ping\n\n';
}

/** Whether a request asked for the stream: `Accept: text/event-stream`, alone or among other types. */
function wantsStream(accept) {
  return typeof accept === 'string' && /(^|[\s,])text\/event-stream(\s*(;|,|$))/i.test(accept);
}

/**
 * AI_STREAM_PING_MS: a whole number of milliseconds, at least 1, for tests
 * that hold a stream open; unset, blank or anything else means 15 seconds.
 */
function pingInterval(value) {
  if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_PING_MS;
  const ms = Number(String(value).trim());
  return Number.isInteger(ms) && ms >= 1 ? ms : DEFAULT_PING_MS;
}

// The headers of a streamed answer. no-transform and X-Accel-Buffering ask
// the proxies between Render and the browser not to compress or hold the
// stream; server.cjs has no compression middleware for the same reason.
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
};

module.exports = { sseEvent, ssePing, wantsStream, pingInterval, SSE_HEADERS, DEFAULT_PING_MS };
