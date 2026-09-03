/**
 * Path → presence label.
 *
 * The rule that matters most here is the last group: an id in the path must
 * never survive into the label, because the label is what gets stored.
 */
const {
  locationLabel, LOCATIONS, CBAT_CARDS, cbatCardKey, cbatCardFromLabel,
} = require('../../constants/presenceLocations');

describe('locationLabel', () => {
  it('names each CBAT game by the page someone is on', () => {
    expect(locationLabel('/cbat/act')).toBe('CBAT · ACT');
    expect(locationLabel('/cbat/rtt')).toBe('CBAT · Rapid Tracking');
    expect(locationLabel('/cbat/numerical-ops')).toBe('CBAT · Numerical Operations');
  });

  it('does not let a prefix swallow the route below it', () => {
    // Ordering bugs in the table show up here first: /cbat matches every game
    // path, /play matches /play/quiz, and so on.
    expect(locationLabel('/cbat')).toBe('CBAT menu');
    expect(locationLabel('/cbat/flag')).toBe('CBAT · FLAG');
    expect(locationLabel('/cbat/flag/leaderboard')).toBe('CBAT · Leaderboard');
    expect(locationLabel('/play')).toBe('Play');
    expect(locationLabel('/play/quiz')).toBe('Quiz briefs');
    expect(locationLabel('/profile')).toBe('Profile');
    expect(locationLabel('/profile/badge')).toBe('Choosing a badge');
    expect(locationLabel('/chat')).toBe('Community');
    expect(locationLabel('/chat/admin')).toBe('Community console');
    expect(locationLabel('/case-files')).toBe('Case Files');
    expect(locationLabel('/case-files/hormuz/one')).toBe('Playing a case file');
    expect(locationLabel('/case-files/hormuz/one/debrief')).toBe('Case file debrief');
  });

  it('tolerates a trailing slash', () => {
    expect(locationLabel('/cbat/act/')).toBe('CBAT · ACT');
    expect(locationLabel('/')).toBe('Landing page');
  });

  it('reduces a path with a record id to the kind of page it is', () => {
    // The whole point of the table: an admin learns someone is reading a brief,
    // and the id never reaches the database.
    expect(locationLabel('/brief/68f1a2b3c4d5e6f708192a3b')).toBe('Reading a brief');
    expect(locationLabel('/quiz/68f1a2b3c4d5e6f708192a3b')).toBe('Brief quiz');
    expect(locationLabel('/chat/68f1a2b3c4d5e6f708192a3b')).toBe('Community');
  });

  it('never returns anything containing part of the path it was given', () => {
    const ids = ['68f1a2b3c4d5e6f708192a3b', 'some-secret-slug', '900900900'];
    const paths = [
      ...ids.map(id => `/brief/${id}`),
      ...ids.map(id => `/chat/${id}`),
      ...ids.map(id => `/case-files/${id}/${id}`),
      ...ids.map(id => `/cbat/${id}/leaderboard`),
    ];
    for (const p of paths) {
      const label = locationLabel(p);
      expect(label).not.toBeNull();
      for (const id of ids) expect(label).not.toContain(id);
    }
  });

  it('drops a query string and fragment rather than labelling from them', () => {
    expect(locationLabel('/cbat/act?round=3')).toBe('CBAT · ACT');
    expect(locationLabel('/profile#stats')).toBe('Profile');
    // A search term is exactly the sort of thing that must not be stored.
    expect(locationLabel('/admin?q=someone@example.com')).toBe('Admin');
  });

  it('returns null for an unknown route instead of falling back to the path', () => {
    // The fallback is the leak: a route added later would start storing its own
    // ids without anyone touching this file.
    expect(locationLabel('/some/route/we/have/not/labelled')).toBeNull();
    expect(locationLabel('/brief')).toBeNull();
  });

  it('returns null for junk rather than throwing on it', () => {
    for (const junk of [undefined, null, 42, {}, [], '', '   ', 'not-a-path', 'https://evil.test/x']) {
      expect(locationLabel(junk)).toBeNull();
    }
    expect(locationLabel(`/${'x'.repeat(500)}`)).toBeNull();
  });

  it('keeps every label short enough for the strip', () => {
    for (const [, label] of LOCATIONS) {
      expect(label.length).toBeLessThanOrEqual(40);
    }
  });
});

/**
 * Path → CBAT hub card.
 *
 * The rule here is that a card is not a route: the game, its practise mode and
 * every leaderboard variant of it are all the same tile, because that is the
 * question the dots on the hub answer ("is anyone at Target right now").
 */
describe('cbatCardKey', () => {
  it('names the tile for a game page', () => {
    expect(cbatCardKey('/cbat/target')).toBe('target');
    expect(cbatCardKey('/cbat/act')).toBe('act');
    expect(cbatCardKey('/cbat/numerical-ops')).toBe('numerical-ops');
    expect(cbatCardKey('/cbat/sma/')).toBe('sma');
  });

  it('maps a combined tile route onto the one card its modes share', () => {
    // One tile, and not one of its URLs is named after it.
    for (const p of ['/cbat/trace', '/cbat/plane-turn', '/cbat/trace-1/leaderboard',
                     '/cbat/trace-2/leaderboard', '/cbat/plane-turn-3d/leaderboard']) {
      expect(cbatCardKey(p)).toBe('plane-turn');
    }
    for (const p of ['/cbat/visualisation', '/cbat/visualisation-2d', '/cbat/visualisation-3d/leaderboard']) {
      expect(cbatCardKey(p)).toBe('visualisation');
    }
  });

  it('counts a leaderboard, a practise mode and a difficulty split as the game itself', () => {
    // Someone reading Target's board is at Target. Difficulty and practise are
    // leaderboard keys, not tiles.
    expect(cbatCardKey('/cbat/target/leaderboard')).toBe('target');
    expect(cbatCardKey('/cbat/ant-practise/leaderboard')).toBe('ant');
    expect(cbatCardKey('/cbat/cut-easier/leaderboard')).toBe('cut');
    expect(cbatCardKey('/cbat/dpt-hard/leaderboard')).toBe('dpt');
  });

  it('has a card for every game the hub lists', () => {
    // The keys are the frontend's (src/data/cbatGames.js). A game whose route
    // is missing here silently never shows a dot, so every card must resolve
    // from its own path.
    for (const card of CBAT_CARDS) {
      const path = card === 'plane-turn' ? '/cbat/trace' : `/cbat/${card}`;
      expect(cbatCardKey(path)).toBe(card);
    }
  });

  it('is null for the parts of /cbat that are not a game', () => {
    expect(cbatCardKey('/cbat')).toBeNull();
    expect(cbatCardKey('/cbat/')).toBeNull();
    expect(cbatCardKey('/cbat/report')).toBeNull();
    expect(cbatCardKey('/profile')).toBeNull();
    expect(cbatCardKey('/cbat/target/something-else')).toBeNull();
  });

  it('only ever returns a key from the allowlist, whatever it is handed', () => {
    // Same guarantee as the label table: client input cannot put an unknown
    // string into the database through this.
    const junk = [
      '/cbat/68f1a2b3c4d5e6f708192a3b/leaderboard',
      '/cbat/68f1a2b3c4d5e6f708192a3b',
      '/cbat/../admin',
      '/cbat/TARGET',
      `/cbat/${'x'.repeat(400)}`,
      undefined, null, 42, {}, [], '', '   ', 'target', 'https://evil.test/cbat/target',
    ];
    for (const p of junk) expect(cbatCardKey(p)).toBeNull();
  });

  it('reads the pathname only, so a query string cannot change the answer', () => {
    // Admins start a game mid-run with ?round=N, and the report links carry
    // ?period=all-time.
    expect(cbatCardKey('/cbat/dpt?round=5')).toBe('dpt');
    expect(cbatCardKey('/cbat/flag/leaderboard?period=weekly')).toBe('flag');
    expect(cbatCardKey('/cbat/act#top')).toBe('act');
  });
});

/**
 * Label → CBAT hub card.
 *
 * The fallback for rows recorded before the tile was, which is every row a
 * backend older than that field writes.
 */
describe('cbatCardFromLabel', () => {
  it('reads the tile back out of a game label', () => {
    expect(cbatCardFromLabel('CBAT · Angles')).toBe('angles');
    expect(cbatCardFromLabel('CBAT · ACT')).toBe('act');
    expect(cbatCardFromLabel('CBAT · Trace 1/2')).toBe('plane-turn');
  });

  it('recovers a tile for every card the hub lists', () => {
    // If a label is reworded and this stops matching, the dots go out for
    // everyone still being served by an older backend.
    for (const card of CBAT_CARDS) {
      const path = card === 'plane-turn' ? '/cbat/trace' : `/cbat/${card}`;
      expect(cbatCardFromLabel(locationLabel(path))).toBe(card);
    }
  });

  it('cannot name a tile for a leaderboard, and does not guess', () => {
    // The label drops the game on purpose. Guessing here would put someone on
    // the wrong tile, which is worse than no dot.
    expect(cbatCardFromLabel('CBAT · Leaderboard')).toBeNull();
    expect(cbatCardFromLabel('CBAT menu')).toBeNull();
  });

  it('is null for a label from anywhere else, and for junk', () => {
    for (const l of ['Community', 'Reading a brief', 'Profile', '', 'angles',
                     undefined, null, 42, {}, []]) {
      expect(cbatCardFromLabel(l)).toBeNull();
    }
  });
});
