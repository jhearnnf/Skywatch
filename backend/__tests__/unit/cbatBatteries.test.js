const { BATTERIES, BATTERY_BY_KEY, DOMAINS, TESTS, STANINE_ANCHORS, SCORED_GAME_KEYS, MAX_SCORE, MAX_STANINE } = require('../../constants/cbatBatteries');
const { CBAT_GAMES } = require('../../constants/cbatGames');
const { scoreToStanine, scoreForStanine, stanineStep, topSegment, removeCohortShift, applyCohortShift, clampStanine, COHORT_SHIFT, MEDIAN_STANINE, STRONG_STANINE } = require('../../utils/cbatStanine');

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
  it('reads the median and strong anchors off the shifted line', () => {
    // The anchors place a score against SKYWATCH's field; the cohort shift then translates that
    // into an OASC estimate, so a middling SkyWatch player does not read 5 on the sheet. The shift
    // is whole at the median and tapered above it, which is why `strong` is not simply 8 + shift.
    for (const [gameKey, a] of Object.entries(STANINE_ANCHORS)) {
      expect([gameKey, scoreToStanine(gameKey, a.median)])
        .toEqual([gameKey, clampStanine(Math.round(applyCohortShift(MEDIAN_STANINE)))]);
      expect([gameKey, scoreToStanine(gameKey, a.strong)])
        .toEqual([gameKey, clampStanine(Math.round(applyCohortShift(STRONG_STANINE)))]);
    }
  });

  it('taper: shifts the median a whole stanine and leaves the top of the scale alone', () => {
    // The property the taper exists for. A flat shift would round `strong` up to a 9, give every
    // strong player 180 of 180, and leave them no next target on any game.
    expect(applyCohortShift(MEDIAN_STANINE)).toBe(MEDIAN_STANINE + COHORT_SHIFT);
    expect(applyCohortShift(MAX_STANINE)).toBe(MAX_STANINE);
    expect(Math.round(applyCohortShift(STRONG_STANINE))).toBe(STRONG_STANINE);

    // Monotonic and invertible across the whole scale, including the join at the median.
    let prev = -Infinity;
    for (let s = 1; s <= MAX_STANINE; s += 0.25) {
      const shifted = applyCohortShift(s);
      expect(shifted).toBeGreaterThan(prev);
      expect(removeCohortShift(shifted)).toBeCloseTo(s, 10);
      prev = shifted;
    }
  });

  it('reads every score at least as high as the unshifted line would', () => {
    // The shift exists because we were reading real candidates LOW — a change that moved any score
    // down would be the opposite of the thing it was added to fix.
    for (const [gameKey, a] of Object.entries(STANINE_ANCHORS)) {
      const step = stanineStep(gameKey);
      for (let n = -4; n <= 6; n++) {
        const score = a.median + n * step;
        const unshifted = Math.min(MAX_STANINE, Math.max(1, Math.round(MEDIAN_STANINE + n)));
        expect([gameKey, score, scoreToStanine(gameKey, score) >= unshifted])
          .toEqual([gameKey, score, true]);
      }
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

  it('leaves a game whose line already fits its ceiling on the plain line', () => {
    // Compression is a guard on the overshoot, not a second scale, so a game that never overshot
    // reads straight off its anchors. Stated as the line rather than as four frozen raw scores,
    // because those move whenever the anchors or the cohort shift move and the claim here is
    // neither of those things.
    for (const gameKey of ['sat', 'angles', 'code-duplicates', 'trace-1']) {
      expect([gameKey, topSegment(gameKey)]).toEqual([gameKey, null]);
      const a = STANINE_ANCHORS[gameKey];
      const plain = Math.ceil(
        a.median + (removeCohortShift(MAX_STANINE) - MEDIAN_STANINE - 0.5) * stanineStep(gameKey),
      );
      expect([gameKey, scoreForStanine(gameKey, MAX_STANINE)]).toEqual([gameKey, plain]);
    }
  });

  it('keeps ANT inside its board, whether or not the compressed band is in use', () => {
    // ANT is the game compression was written for: measured anchors of 53 and 77 put the plain
    // stanine-9 threshold at 81 on a board marked out of 80.
    //
    // The cohort shift pulls that threshold well below the ceiling on its own, so the compressed
    // band is currently DORMANT rather than gone — with a shift of 1 the top branch needs a target
    // above 9, which cannot be asked for. It stays because it is the guard that holds if the shift
    // returns to 0 or a re-anchor spreads ANT out again, and because nothing about it is wrong.
    // What matters either way is the property below, which is what the guard existed to protect.
    const a = STANINE_ANCHORS.ant;
    expect(topSegment('ant')).not.toBeNull();
    expect(scoreForStanine('ant', MAX_STANINE)).toBeLessThanOrEqual(a.max);
    expect(scoreToStanine('ant', a.max)).toBe(MAX_STANINE);

    // Monotonic right across the join between the plain line and the compressed band.
    let prev = 0;
    for (let s = 40; s <= a.max; s++) {
      const v = scoreToStanine('ant', s);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
