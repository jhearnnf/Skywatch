/**
 * The SSE subscriber map behind the CBAT lounge.
 *
 * Everything here is about connections rather than messages: who gets a push,
 * who stops getting one, and what happens when a browser leaves sockets behind.
 */
const chatStream = require('../../utils/chatStream');

const client = (userId = 'u1') => {
  const sent = [];
  return {
    userId,
    sent,
    closed: false,
    send: (event, data) => sent.push({ event, data }),
    close() { this.closed = true; },
  };
};

beforeEach(() => chatStream._reset());

describe('publish', () => {
  it('reaches every listener on that conversation and nobody else', () => {
    const a = client(), b = client('u2'), elsewhere = client('u3');
    chatStream.subscribe('convo-1', a);
    chatStream.subscribe('convo-1', b);
    chatStream.subscribe('convo-2', elsewhere);

    const delivered = chatStream.publish('convo-1', 'message', { body: 'hi' });

    expect(delivered).toBe(2);
    expect(a.sent).toEqual([{ event: 'message', data: { body: 'hi' } }]);
    expect(b.sent).toHaveLength(1);
    expect(elsewhere.sent).toHaveLength(0);
  });

  it('accepts an ObjectId-ish key and a string for the same conversation', () => {
    const a = client();
    chatStream.subscribe({ toString: () => 'convo-1' }, a);
    chatStream.publish('convo-1', 'message', { body: 'hi' });
    expect(a.sent).toHaveLength(1);
  });

  it('is a no-op when nobody is listening', () => {
    expect(chatStream.publish('convo-1', 'message', {})).toBe(0);
  });

  it('drops a client whose socket has died rather than throwing at the caller', () => {
    const broken = client();
    broken.send = () => { throw new Error('EPIPE'); };
    const healthy = client('u2');
    chatStream.subscribe('convo-1', broken);
    chatStream.subscribe('convo-1', healthy);

    expect(() => chatStream.publish('convo-1', 'message', {})).not.toThrow();
    expect(healthy.sent).toHaveLength(1);
    expect(chatStream.subscriberCount('convo-1')).toBe(1);
    expect(chatStream.connectionCount()).toBe(1);
  });
});

describe('unsubscribe', () => {
  it('stops delivery and frees the slot', () => {
    const a = client();
    const off = chatStream.subscribe('convo-1', a);
    off();

    chatStream.publish('convo-1', 'message', {});
    expect(a.sent).toHaveLength(0);
    expect(chatStream.connectionCount()).toBe(0);
  });

  // A 'close' handler can fire more than once; double-counting would drift the
  // total down and eventually let the ceiling be exceeded.
  it('is idempotent', () => {
    const a = client();
    const off = chatStream.subscribe('convo-1', a);
    off(); off();
    expect(chatStream.connectionCount()).toBe(0);
  });
});

describe('ceilings', () => {
  it('evicts a user\'s oldest connection past the per-user cap', () => {
    const mine = [];
    for (let i = 0; i <= chatStream.MAX_PER_USER; i += 1) {
      const c = client('u1');
      mine.push(c);
      chatStream.subscribe('convo-1', c);
    }

    expect(mine[0].closed).toBe(true);
    expect(chatStream.subscriberCount('convo-1')).toBe(chatStream.MAX_PER_USER);
    chatStream.publish('convo-1', 'message', {});
    expect(mine[0].sent).toHaveLength(0);
    expect(mine[mine.length - 1].sent).toHaveLength(1);
  });

  it('counts the cap per user, not per conversation', () => {
    for (let i = 0; i < chatStream.MAX_PER_USER; i += 1) {
      chatStream.subscribe('convo-1', client('u1'));
    }
    const other = client('u2');
    chatStream.subscribe('convo-1', other);

    expect(other.closed).toBe(false);
    expect(chatStream.subscriberCount('convo-1')).toBe(chatStream.MAX_PER_USER + 1);
  });

  // The route turns a null into "fall back to polling" rather than leaving the
  // client on a stream that will never deliver anything.
  it('refuses a connection past the process ceiling', () => {
    for (let i = 0; i < chatStream.MAX_TOTAL; i += 1) {
      chatStream.subscribe(`convo-${i}`, client(`user-${i}`));
    }
    expect(chatStream.subscribe('convo-new', client('someone'))).toBeNull();
  });
});
