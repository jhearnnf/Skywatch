const { padLeaderboard, FAKE_TUNING } = require('../../utils/cbatFakeLeaderboard');

// Per-game hard constraints every fake must satisfy.
const GAME_MAX = {
  'plane-turn':      null,   // lower-better, no fixed max; "perfect" ≈ floor
  'angles':          20,
  'code-duplicates': 15,
  'symbols':         15,
  'target':          null,   // accumulating score, no fixed ceiling (≥400 = Outstanding)
  'instruments':     null,   // time-limited, no fixed max
  'sdt':             80,
};
const LOWER_BETTER = { 'plane-turn': true };

function realEntry({ id, userId, score, time, agent, rank }) {
  return { _id: id, userId, agentNumber: agent, bestScore: score, bestTime: time, rank };
}

describe('padLeaderboard', () => {
  const ALL_GAMES = Object.keys(FAKE_TUNING);

  it('returns the original list unchanged when already at or above limit', () => {
    const real = Array.from({ length: 20 }, (_, i) => realEntry({
      id: `r${i}`, userId: `u${i}`, score: 15 - i, time: 20 + i, agent: `100000${i}`, rank: undefined,
    }));
    const out = padLeaderboard(real, 'symbols');
    expect(out).toHaveLength(20);
    expect(out.every(e => !e.isFake)).toBe(true);
    // Ranks must be assigned even on the no-pad path (caller-stripped or unset)
    out.forEach((e, i) => expect(e.rank).toBe(i + 1));

    const overFull = [...real, realEntry({ id: 'r20', userId: 'u20', score: -5, time: 99, agent: '1000020', rank: undefined })];
    const outOver = padLeaderboard(overFull, 'symbols');
    expect(outOver).toHaveLength(21);
    outOver.forEach((e, i) => expect(e.rank).toBe(i + 1));
  });

  it('fills up to 20 entries for every game when real is empty', () => {
    for (const game of ALL_GAMES) {
      const out = padLeaderboard([], game);
      expect(out).toHaveLength(20);
      expect(out.every(e => e.isFake)).toBe(true);
      out.forEach((e, i) => expect(e.rank).toBe(i + 1));
    }
  });

  it('is deterministic — same input yields same output', () => {
    const a = padLeaderboard([], 'symbols');
    const b = padLeaderboard([], 'symbols');
    expect(a).toEqual(b);
  });

  it('never shows a zero score on a fake row (per product requirement)', () => {
    for (const game of ALL_GAMES) {
      const out = padLeaderboard([], game);
      out.filter(e => e.isFake).forEach(f => expect(f.bestScore).toBeGreaterThan(0));
    }
  });

  it('never lets a fake hit the game\'s perfect-score ceiling', () => {
    for (const [game, max] of Object.entries(GAME_MAX)) {
      if (max == null) continue; // skip games without a fixed max
      const out = padLeaderboard([], game);
      out.filter(e => e.isFake).forEach(f => expect(f.bestScore).toBeLessThan(max));
    }
  });

  it('sorts the merged list by points-priority, then time-on-ties (all games)', () => {
    for (const game of ALL_GAMES) {
      const lowerBetter = !!LOWER_BETTER[game];
      // Mix real entries that would naturally interleave with fakes
      const real = [
        realEntry({ id: 'r1', userId: 'u1', score: lowerBetter ? 16 : 10, time: 30, agent: '1111111', rank: 1 }),
        realEntry({ id: 'r2', userId: 'u2', score: lowerBetter ? 40 : 5,  time: 50, agent: '2222222', rank: 2 }),
      ];
      const out = padLeaderboard(real, game);
      for (let i = 1; i < out.length; i++) {
        const prev = out[i - 1], cur = out[i];
        if (lowerBetter) expect(cur.bestScore).toBeGreaterThanOrEqual(prev.bestScore);
        else             expect(cur.bestScore).toBeLessThanOrEqual(prev.bestScore);
        if (cur.bestScore === prev.bestScore) {
          expect(cur.bestTime).toBeGreaterThanOrEqual(prev.bestTime);
        }
      }
      out.forEach((e, i) => expect(e.rank).toBe(i + 1));
    }
  });

  it('merges real entries into their sorted position — fakes can outrank real', () => {
    // Real user scored 10 (below most of the fake distribution).
    // Expect fakes to take ranks 1..19 with real appearing further down.
    const real = [realEntry({ id: 'r1', userId: 'u1', score: 10, time: 30, agent: '1111111', rank: 1 })];
    const out = padLeaderboard(real, 'symbols');
    expect(out).toHaveLength(20);
    const realIndex = out.findIndex(e => !e.isFake);
    expect(realIndex).toBeGreaterThan(0); // real is NOT #1 — fakes outranked it
    // Invariant: every row above the real entry has score ≥ real's
    out.slice(0, realIndex).forEach(f => expect(f.bestScore).toBeGreaterThanOrEqual(10));
  });

  it('attaches email="demo" to fakes when isAdmin is true', () => {
    const out = padLeaderboard([], 'symbols', { isAdmin: true });
    out.filter(e => e.isFake).forEach(f => expect(f.email).toBe('demo'));
  });

  it('omits email on fakes when isAdmin is false', () => {
    const out = padLeaderboard([], 'symbols', { isAdmin: false });
    out.filter(e => e.isFake).forEach(f => expect(f.email).toBeUndefined());
  });

  it('uses plausible agent numbers (7-digit strings)', () => {
    const out = padLeaderboard([], 'symbols');
    out.filter(e => e.isFake).forEach(f => expect(f.agentNumber).toMatch(/^\d{7}$/));
  });

  it('produces different agent rosters across games (different offsets)', () => {
    const a = padLeaderboard([], 'symbols').map(e => e.agentNumber);
    const b = padLeaderboard([], 'target').map(e => e.agentNumber);
    expect(a).not.toEqual(b);
  });

  it('returns real unchanged when gameKey is unknown', () => {
    const real = [realEntry({ id: 'r1', userId: 'u1', score: 5, time: 20, agent: '1111111', rank: 1 })];
    expect(padLeaderboard(real, 'nonsense')).toEqual(real);
  });

  it('uses only multiples of 5 for SDT fakes (real game awards 0/5/10 per round)', () => {
    const out = padLeaderboard([], 'sdt');
    out.filter(e => e.isFake).forEach(f => {
      expect(f.bestScore % 5).toBe(0);
    });
  });

  it('produces a varied spread of scores (more than 5 distinct values) for every game', () => {
    for (const game of ALL_GAMES) {
      const out = padLeaderboard([], game);
      const unique = new Set(out.map(e => e.bestScore));
      expect(unique.size).toBeGreaterThan(5);
    }
  });
});
