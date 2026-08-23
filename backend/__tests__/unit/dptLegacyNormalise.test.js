const {
  EARLY_GATES, EARLY_ROUND_BONUS, FULL_EARLY_VALUE,
  earlyRoundValue, normaliseLegacyDptScore,
} = require('../../utils/dptLegacyNormalise');

// The four rounds Hard gave up when the ladder was split in half.
describe('what rounds 1-4 were worth', () => {
  it('is 12 gates and the bonuses for rounds 1 to 4', () => {
    expect(EARLY_GATES).toBe(2 + 2 + 3 + 5);
    expect(EARLY_ROUND_BONUS).toBe(50 * (1 + 2 + 3 + 4));
    expect(FULL_EARLY_VALUE).toBe(1700);
  });

  // The whole point of the number: it is simultaneously "what a pre-split run
  // scored before the new Hard board starts" and "a perfect score on the new
  // Easier board". Those have to be the same figure or the split has leaked
  // points somewhere.
  it('is exactly a perfect Easier run', () => {
    const perfectEasier = 12 * 100 + 50 * (1 + 2 + 3 + 4);
    expect(FULL_EARLY_VALUE).toBe(perfectEasier);
  });

  it('takes the full amount off any run that hit 12 or more gates', () => {
    expect(earlyRoundValue(12)).toBe(FULL_EARLY_VALUE);
    expect(earlyRoundValue(24)).toBe(FULL_EARLY_VALUE);
    expect(earlyRoundValue(36)).toBe(FULL_EARLY_VALUE);
  });

  // The one guard on the estimate: a run that hit 7 gates in total cannot have
  // earned twelve gates' worth in rounds 1-4, so it is not charged for them.
  it('never charges a run for gates it did not hit', () => {
    expect(earlyRoundValue(7)).toBe(7 * 100 + EARLY_ROUND_BONUS);
    expect(earlyRoundValue(0)).toBe(EARLY_ROUND_BONUS);
  });

  it('treats a missing or negative gate count as zero gates', () => {
    expect(earlyRoundValue(undefined)).toBe(EARLY_ROUND_BONUS);
    expect(earlyRoundValue(-5)).toBe(EARLY_ROUND_BONUS);
  });
});

describe('normaliseLegacyDptScore', () => {
  // The real top of the board. A perfect eight-round run scored 6,900 —
  // 36 gates, 6 intercepts and 50 × (1+…+8) of bonus — and normalises to
  // exactly 5,200, which is exactly a perfect four-round Hard run. That
  // equality is the evidence the decomposition is right.
  it('turns a perfect eight-round run into a perfect Hard run', () => {
    expect(normaliseLegacyDptScore({ totalScore: 6900, gatesHit: 36 })).toBe(5200);
  });

  it('takes a flat 1,700 off a normal run', () => {
    expect(normaliseLegacyDptScore({ totalScore: 3850, gatesHit: 29 })).toBe(2150);
  });

  // Subtracting a constant is what makes this safe: it cannot reorder the
  // legacy runs among themselves, only against the runs that come after.
  it('preserves the order of runs that all hit 12 or more gates', () => {
    const before = [6900, 5000, 3850, 2400, 1750];
    const after  = before.map(totalScore => normaliseLegacyDptScore({ totalScore, gatesHit: 30 }));
    expect(after).toEqual([...after].sort((a, b) => b - a));
    for (let i = 0; i < before.length - 1; i++) {
      expect(after[i] - after[i + 1]).toBe(before[i] - before[i + 1]);
    }
  });

  it('floors at zero rather than going negative', () => {
    expect(normaliseLegacyDptScore({ totalScore: 900, gatesHit: 20 })).toBe(0);
    expect(normaliseLegacyDptScore({ totalScore: 0, gatesHit: 0 })).toBe(0);
  });

  it('handles a row with no score at all', () => {
    expect(normaliseLegacyDptScore({})).toBe(0);
  });

  // Running the migration twice must not subtract twice. The script guards on
  // the legacyEightRound marker rather than on the arithmetic, but the maths
  // should be sane if it is ever applied to an already-normalised total.
  it('never produces a score above the new Hard ceiling', () => {
    for (const totalScore of [6900, 6711, 6450, 6336, 6300]) {
      expect(normaliseLegacyDptScore({ totalScore, gatesHit: 36 })).toBeLessThanOrEqual(5200);
    }
  });
});
