/**
 * clipperVoiceboxSse.test.js
 *
 * Voicebox reports generation progress on GET /generate/{id}/status as Server-
 * Sent Events. The agent used to call res.json() on it, which failed with
 * `Unexpected token 'd', "data:{"id"...` — a parser complaint that named
 * neither the endpoint nor the reason.
 *
 * These cover the frame parser, because chunk boundaries fall wherever the
 * network puts them and a parser that only works on whole frames is a parser
 * that works until it doesn't.
 *
 * Lives here because clipper-agent/ has no test runner of its own.
 */

const { parseSseFrames } = require('../../../clipper-agent/voicebox');

const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

describe('parseSseFrames', () => {
  it('reads a single complete frame', () => {
    const { events, rest } = parseSseFrames(frame({ id: 'a', status: 'generating' }));
    expect(events).toEqual([{ id: 'a', status: 'generating' }]);
    expect(rest).toBe('');
  });

  it('reads several frames from one chunk', () => {
    const buffer = frame({ status: 'generating' }) + frame({ status: 'completed', duration: 3.2 });
    const { events } = parseSseFrames(buffer);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ status: 'completed', duration: 3.2 });
  });

  // The case that matters: a read can end mid-frame, and the tail has to
  // survive until the rest of it arrives.
  it('keeps a partial frame back rather than dropping it', () => {
    const whole = frame({ status: 'completed', duration: 3.2 });
    const split = Math.floor(whole.length / 2);

    const first = parseSseFrames(whole.slice(0, split));
    expect(first.events).toEqual([]);
    expect(first.rest).toBe(whole.slice(0, split));

    const second = parseSseFrames(first.rest + whole.slice(split));
    expect(second.events).toEqual([{ status: 'completed', duration: 3.2 }]);
    expect(second.rest).toBe('');
  });

  it('reassembles a frame delivered one byte at a time', () => {
    const whole = frame({ status: 'completed' });
    let buffer = '';
    let seen = [];
    for (const ch of whole) {
      const { events, rest } = parseSseFrames(buffer + ch);
      buffer = rest;
      seen = seen.concat(events);
    }
    expect(seen).toEqual([{ status: 'completed' }]);
  });

  it('handles CRLF line endings', () => {
    const { events } = parseSseFrames('data: {"status":"completed"}\r\n\r\n');
    expect(events).toEqual([{ status: 'completed' }]);
  });

  it('ignores comments, empty data and the done sentinel', () => {
    const buffer = ': keep-alive\n\n'
      + 'data:\n\n'
      + 'data: [DONE]\n\n'
      + frame({ status: 'completed' });
    expect(parseSseFrames(buffer).events).toEqual([{ status: 'completed' }]);
  });

  // A frame we cannot read is not a reason to abandon a 45-second generation:
  // the next one carries the same status.
  it('skips an unparseable frame and keeps the rest', () => {
    const buffer = 'data: {not json\n\n' + frame({ status: 'completed' });
    expect(parseSseFrames(buffer).events).toEqual([{ status: 'completed' }]);
  });

  it('ignores non-data lines inside a frame', () => {
    const buffer = 'event: status\nid: 7\ndata: {"status":"generating"}\n\n';
    expect(parseSseFrames(buffer).events).toEqual([{ status: 'generating' }]);
  });

  it('returns nothing for an empty buffer', () => {
    expect(parseSseFrames('')).toEqual({ events: [], rest: '' });
  });
});
