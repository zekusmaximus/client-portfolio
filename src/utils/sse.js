// src/utils/sse.js
//
// Reads the server-sent events Ask and the brief stream (docs/plans/tier-1.md,
// WP5; the server writes them with utils/sse.cjs). The page reads the
// response body with fetch and a stream reader, never EventSource (T9), so it
// parses the bytes itself, as the HTML standard's event-stream rules say:
// chunks may split anywhere, a UTF-8 character included; lines end with
// CRLF, LF or CR; a line starting with ":" is a comment (the server's pings);
// `data` lines join with a line break; a blank line ends an event, and an
// event without data is dropped; so is one the stream ends in the middle of.
// Pure: no DOM, no fetch.

/**
 * A parser that calls onEvent({ type, data }) for each whole event, `type`
 * being the event's name ("message" when it has none) and `data` its text.
 * push(chunk) takes bytes (a Uint8Array) or text; end() finishes the stream.
 */
export function createSseParser(onEvent) {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let type = '';
  let data = [];
  let hasData = false;

  const dispatch = () => {
    if (hasData) onEvent({ type: type || 'message', data: data.join('\n') });
    type = '';
    data = [];
    hasData = false;
  };

  const line = (text) => {
    if (text === '') return dispatch();
    if (text.startsWith(':')) return undefined;
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') type = value;
    else if (field === 'data') {
      data.push(value);
      hasData = true;
    }
    // id and retry mean nothing here; unknown fields are ignored
    return undefined;
  };

  // Every whole line in the buffer. A CR at the very end may be the first
  // half of a CRLF split across chunks, so it waits for the next chunk.
  const drain = (final) => {
    let start = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const c = buffer[i];
      if (c !== '\n' && c !== '\r') continue;
      if (c === '\r' && i === buffer.length - 1 && !final) break;
      line(buffer.slice(start, i));
      if (c === '\r' && buffer[i + 1] === '\n') i += 1;
      start = i + 1;
    }
    buffer = buffer.slice(start);
  };

  return {
    push(chunk) {
      buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      drain(false);
    },
    end() {
      buffer += decoder.decode();
      drain(true);
      // An event the stream ended in the middle of is not dispatched
      buffer = '';
      type = '';
      data = [];
      hasData = false;
    },
  };
}

/** An event's data as JSON, or null when it is not JSON. */
export function eventJson(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    return null;
  }
}
