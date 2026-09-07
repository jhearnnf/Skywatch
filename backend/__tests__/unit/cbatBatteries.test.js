const { BATTERIES, BATTERY_BY_KEY, DOMAINS, TESTS, STANINE_ANCHORS, SCORED_GAME_KEYS, MAX_SCORE, MAX_STANINE } = require('../../constants/cbatBatteries');
const { CBAT_GAMES } = require('../../constants/cbatGames');
const { scoreToStanine, scoreForStanine, MEDIAN_STANINE, STRONG_STANINE } = require('../../utils/cbatStanine');

// The battery definitions are transcribed by hand from photographed OASC score sheets, so these
// assertions are the transcription's proof-reader: a slipped digit in a weight or a mistyped test
// code produces a report that looks perfectly plausible and is quietly wrong.

describe('battery definitions', () => {
  it('has every battery weighted to exactly 100', () => {
    // The real sheets all sum to 100 — that is what makes `score / 100 * 20` land on 180 — so a
    // battery that doesn't is a transcription error, not a design choice.
    for (const b of BATTERIES) {
      const sum = b.domains.reduce((a, d) => a + d.weight, 0);
      expect([b.key, sum]).toEqual([b.key, 100]);
    }
  });

  it('references only domains and tests that exist', () => {
    for (const b of BATTERIES) {
      for (const d of b.domains) {
        expect(DOMAINS[d.key]).toBeDefined();
        expect(d.tests.length).toBeGreaterThan(0);
        for (const t of d.tests) {
          expect(TESTS[t.code]).toBeDefined();
          expect(t.mult).toBeGreaterThan(0);
        }
      }
    }
  });

  it('gives every battery a unique key and a cutoff inside the scale', () => {
    const keys = BATTERIES.map(b => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const b of BATTERIES) {
      expect(b.cutoff).toBeGreaterThan(0);
      expect(b.cutoff).toBeLessThanOrEqual(MAX_SCORE);
    }
  });

  it('lists each domain at most once per battery', () => {
    // A repeated domain would be double-counted in the weighted mean.
    for (const b of BATTERIES) {
      const keys = b.domains.map(d => d.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('exposes a lookup covering every battery', () => {
    expect(Object.keys(BATTERY_BY_KEY)).toHaveLength(BATTERIES.length);
  });
});

describe('test → game mapping', () => {
  it('points only at real CBAT registry entries', () => {
    for (const [code, t] of Object.entries(TESTS)) {
      for (const gameKey of t.games) {
        expect([code, gameKey, !!CBAT_GAMES[gameKey]]).toEqual([code, gameKey, true]);
      }
    }
  });

  it('never maps a test to an Easier collection', () => {
    // Only Hard counts — the real CBAT has one difficulty, and folding Easier runs in would
    // inflate every estimate. See the note in utils/cbatAptitudeReport.js.
    for (const t of Object.values(TESTS)) {
      for (const gameKey of t.games) expect(gameKey.endsWith('-easier')).toBe(false);
    }
  });

  it('marks a test with no game as match "none", and one with a game as direct or proxy', () => {
    for (const [code, t] of Object.entries(TESTS)) {
      expect([code, t.match === 'none']).toEqual([code, t.games.length === 0]);
      if (t.games.length) expect(['direct', 'proxy']).toContain(t.match);
    }
  });

  it('has stanine anchors for every scorable game', () => {
    for (const gameKey of SCORED_GAME_KEYS) {
      expect([gameKey, !!STANINE_ANCHORS[gameKey]]).toEqual([gameKey, true]);
    }
  });

  it('only scores higher-is-better games', () => {
    // scoreToStanine assumes strong > median, which only holds when a bigger primaryField is a
    // better result. Mapping a lower-is-better game (the Trace practise modes) would silently
    // invert its stanines.
    for (const gameKey of SCORED_GAME_KEYS) {
      expect([gameKey, CBAT_GAMES[gameKey].sortDir]).toEqual([gameKey, -1]);
    }
  });
});

describe('scoreToStanine', () => {
  it('puts the median anchor at 5 and the strong anchor at 8', () => {
    for (const [gameKey, a] of Object.entries(STANINE_ANCHORS)) {
      expect([gameKey, scoreToStanine(gameKey, a.median)]).toEqual([gameKey, MEDIAN_STANINE]);
      expect([gameKey, scoreToStanine(gameKey, a.strong)]).toEqual([gameKey, STRONG_STANINE]);
    }
  });

  it('clamps to 1..9 rather than running off either end', () => {
    expect(scoreToStanine('cut', -100_000)).toBe(1);
    expect(scoreToStanine('cut', 100_000)).toBe(MAX_STANINE);
  });

  it('never decreases as the score rises', () => {
    let prev = 0;
    for (let s = 0; s <= 1200; s += 10) {
      const v = scoreToStanine('cut', s);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('returns null for a game with no anchors, and for a non-numeric score', () => {
    // plane-turn-2d is a practise mode, lower-is-better, and deliberately never mapped to a test —
    // so it will never gain anchors, unlike the games that keep being added to the roster.
    expect(scoreToStanine('plane-turn-2d', 10)).toBeNull();
    expect(scoreToStanine('not-a-game', 10)).toBeNull();
    expect(scoreToStanine('cut', null)).toBeNull();
    expect(scoreToStanine('cut', undefined)).toBeNull();
  });
});

describe('scoreForStanine', () => {
  it('returns a whole score that actually reaches the stanine asked for', () => {
    // The round-trip is the contract: the report tells a user "average 409+ for a 6", so 409 had
    // better come back as a 6 or better. Not exactly 6 — on a game with few possible scores the
    // bands are sub-integer and the first reachable score can land in the band above.
    for (const gameKey of Object.keys(STANINE_ANCHORS)) {
      for (let target = 2; target <= MAX_STANINE; target++) {
        const need = scoreForStanine(gameKey, target);
        expect(Number.isInteger(need)).toBe(true);
        expect([gameKey, target, scoreToStanine(gameKey, need) >= target]).toEqual([gameKey, target, true]);
      }
    }
  });

  it('never tells a user to aim lower than the score they already have', () => {
    // The report only ever asks for target = current + 1, so the suggested score must sit strictly
    // above the band the user is in — otherwise it reads as "you're on a 5, now score 5".
    for (const gameKey of Object.keys(STANINE_ANCHORS)) {
      for (let current = 1; current < MAX_STANINE; current++) {
        const need = scoreForStanine(gameKey, current + 1);
        expect([gameKey, current, scoreToStanine(gameKey, need) > current]).toEqual([gameKey, current, true]);
      }
    }
  });

  it('has nothing to aim at below 1 or above 9', () => {
    expect(scoreForStanine('cut', 1)).toBeNull();
    expect(scoreForStanine('cut', 10)).toBeNull();
    expect(scoreForStanine('nope', 5)).toBeNull();
  });
});

describe('the ceiling on a bounded game', () => {
  const bounded = Object.entries(STANINE_ANCHORS).filter(([, a]) => Number.isFinite(a.max));

  it('marks a ceiling on at least the games that have one', () => {
    // A bare guard against the `max` keys being dropped in a future re-anchor, which would put the
    // overshoot back without failing anything else in this file.
    expect(bounded.length).toBeGreaterThan(0);
    for (const [gameKey, a] of bounded) {
      expect([gameKey, a.max > a.strong]).toEqual([gameKey, true]);
    }
  });

  it('keeps stanine 9 reachable on every game that can be maxed out', () => {
    // The one that matters. A real OASC sheet awards a 9 on every test, so a game whose
    // stanine-9 threshold sits above its own maximum score is broken however good the anchors are:
    // ANT's measured anchors (53, 77) put it at 81 on a board marked out of 80, and the report
    // spent its life telling players to average a score the game cannot award.
    for (const [gameKey, a] of bounded) {
      expect([gameKey, scoreForStanine(gameKey, MAX_STANINE) <= a.max]).toEqual([gameKey, true]);
      expect([gameKey, scoreToStanine(gameKey, a.max)]).toEqual([gameKey, MAX_STANINE]);
    }
  });

  it('leaves a game whose line already fits its ceiling exactly as it was', () => {
    // Compression is a guard on the overshoot, not a second scale — so only ANT should have moved.
    expect(scoreForStanine('sat', 9)).toBe(13);
    expect(scoreForStanine('angles', 9)).toBe(19);
    expect(scoreForStanine('code-duplicates', 9)).toBe(14);
    expect(scoreForStanine('trace-1', 9)).toBe(39);
  });

  it('reads ANT off the compressed top band without moving anything below it', () => {
    expect(scoreForStanine('ant', 8)).toBe(73);   // unchanged: the plain line still owns 1-8
    expect(scoreForStanine('ant', 9)).toBe(79);   // was 81, one point past a board marked out of 80
    expect(scoreToStanine('ant', 72)).toBe(7);
    expect(scoreToStanine('ant', 73)).toBe(8);
    expect(scoreToStanine('ant', 78)).toBe(8);
    expect(scoreToStanine('ant', 79)).toBe(9);
    expect(scoreToStanine('ant', 80)).toBe(MAX_STANINE);
  });
});
