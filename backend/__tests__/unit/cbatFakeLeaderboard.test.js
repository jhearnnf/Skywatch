const { padLeaderboard, padWeeklyLeaderboard, FAKE_TUNING } = require('../../utils/cbatFakeLeaderboard');
const { CBAT_GAMES } = require('../../constants/cbatGames');

// Per-game hard constraints every fake must satisfy.
const GAME_MAX = {
  'plane-turn-2d':   null,   // lower-better, no fixed max; "perfect" ≈ floor
  'plane-turn-3d':   null,
  'angles':          20,
  'code-duplicates': 15,
  'symbols':         15,
  'target':          null,   // accumulating score, no fixed ceiling (≥400 = Outstanding)
  'instruments':     null,   // time-limited, no fixed max
  'ant':             80,
  'flag':            null,   // accumulating score, no fixed ceiling
  'visualisation-2d': null,  // small count, no ceiling assertion needed
  'visualisation-3d': 8,     // 8 rounds, one point each
  'dpt':             null,   // accumulating score, no fixed ceiling
  'trace-1':         40,     // 5 rounds × 8 turns
  'trace-2':         8,      // 8 rounds, one question each
  'numerical-ops':   100,    // percentage 0–100
  'dad':             15,     // 15 questions, one point each
  'sat':             18,     // 18 questions (3 situations × 6), one point each
  'cut':             null,   // accumulating score, no fixed ceiling
};
const LOWER_BETTER = { 'plane-turn-2d': true, 'plane-turn-3d': true };

function realEntry({ id, userId, score, time, agent, rank }) {
  return { _id: id, userId, agentNumber: agent, bestScore: score, bestTime: time, rank };
}

// FAKE_TUNING is now keyed directly by gameKey (no embedded `:mode` suffix —
// the registry split plane-turn into two top-level keys).
const ALL_GAMES_FROM_TUNING = Object.keys(FAKE_TUNING).map(game => ({ game, opts: {} }));

describe('padLeaderboard', () => {

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

  it('fills up to 20 entries for every game/mode when real is empty', () => {
    for (const { game, opts } of ALL_GAMES_FROM_TUNING) {
      const out = padLeaderboard([], game, opts);
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
    for (const { game, opts } of ALL_GAMES_FROM_TUNING) {
      const out = padLeaderboard([], game, opts);
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
    for (const { game, opts } of ALL_GAMES_FROM_TUNING) {
      const lowerBetter = !!LOWER_BETTER[game];
      // Mix real entries that would naturally interleave with fakes
      const real = [
        realEntry({ id: 'r1', userId: 'u1', score: lowerBetter ? 16 : 10, time: 30, agent: '1111111', rank: 1 }),
        realEntry({ id: 'r2', userId: 'u2', score: lowerBetter ? 40 : 5,  time: 50, agent: '2222222', rank: 2 }),
      ];
      const out = padLeaderboard(real, game, opts);
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

  it('uses only multiples of 5 for ANT fakes (real game awards 0/5/10 per round)', () => {
    const out = padLeaderboard([], 'ant');
    out.filter(e => e.isFake).forEach(f => {
      expect(f.bestScore % 5).toBe(0);
    });
  });

  it('uses only multiples of 5 for numerical-ops fakes (correctPercentage = correctCount/20 × 100)', () => {
    const out = padLeaderboard([], 'numerical-ops');
    out.filter(e => e.isFake).forEach(f => {
      expect(f.bestScore % 5).toBe(0);
    });
  });

  it('produces a varied spread of scores (more than 5 distinct values) for every game', () => {
    for (const { game, opts } of ALL_GAMES_FROM_TUNING) {
      const out = padLeaderboard([], game, opts);
      const unique = new Set(out.map(e => e.bestScore));
      expect(unique.size).toBeGreaterThan(5);
    }
  });

  it('produces decimal-bearing demo times for every game except flag (fixed-60s, intentional)', () => {
    // Demo bestTime is rounded to 1 decimal. If seedTime AND timeStep are both
    // integers, every row displays as N.0 — looks fake. flag is the documented
    // exception (fixed-60s game where real runs also display 60.0).
    for (const { game, opts } of ALL_GAMES_FROM_TUNING) {
      if (game === 'flag') continue;
      const out = padLeaderboard([], game, opts);
      const fakes = out.filter(e => e.isFake);
      const fractional = fakes.filter(f => Math.round(f.bestTime * 10) % 10 !== 0);
      expect(fractional.length).toBeGreaterThan(0);
    }
  });

  it('flag fakes intentionally tie at 60.0 (fixed-60s game, real runs do the same)', () => {
    const out = padLeaderboard([], 'flag');
    out.filter(e => e.isFake).forEach(f => expect(f.bestTime).toBe(60));
  });

  it('full-sequence games (flag, ant, code-duplicates, cut) displace sub-floor real entries even when real fills the board', () => {
    // 20 real entries, every score below the game's floor. Without the
    // full-sequence path these would short-circuit past padding.
    const cases = [
      { game: 'flag',            subFloor: -10 }, // floor 55
      { game: 'ant',             subFloor:   5 }, // floor 15
      { game: 'code-duplicates', subFloor:   3 }, // floor 7
      { game: 'cut',             subFloor: 149 }, // floor 150
    ];
    for (const { game, subFloor } of cases) {
      const real = Array.from({ length: 20 }, (_, i) => realEntry({
        id: `r${i}`, userId: `u${i}`, score: subFloor, time: 60 + i, agent: `100000${i}`, rank: undefined,
      }));
      const out = padLeaderboard(real, game);
      expect(out).toHaveLength(20);
      expect(out.every(e => e.isFake)).toBe(true);
    }
  });
});

describe('padWeeklyLeaderboard', () => {
  // The product rule: no weekly board may show 0–1 players. EVERY leaderboard
  // game must produce demo rows when the week is empty.
  it('pads every CBAT game with demo rows on an empty week', () => {
    for (const gameKey of Object.keys(CBAT_GAMES)) {
      const out = padWeeklyLeaderboard([], gameKey, {});
      expect(out.length).toBeGreaterThanOrEqual(4); // "a few players", not 0 or 1
      expect(out.every(e => e.isFake)).toBe(true);
      // Demo rows look like a few light players: low play counts, positive totals.
      for (const row of out) {
        expect(row.plays).toBeGreaterThanOrEqual(1);
        expect(row.plays).toBeLessThanOrEqual(3);
        expect(row.weekTotal).toBeGreaterThan(0);
      }
      // Ranked, sorted by weekTotal descending.
      const totals = out.map(e => e.weekTotal);
      expect(totals).toEqual([...totals].sort((a, b) => b - a));
      expect(out.map(e => e.rank)).toEqual(out.map((_, i) => i + 1));
    }
  });

  it('still tops up a board with a single real player', () => {
    const real = [{ _id: 'r1', userId: 'u1', agentNumber: '1000000', weekTotal: 999999, plays: 1, rank: 1 }];
    const out = padWeeklyLeaderboard(real, 'target', {});
    expect(out.length).toBeGreaterThan(1);
    expect(out.filter(e => e.isFake).length).toBeGreaterThanOrEqual(4);
  });
});
