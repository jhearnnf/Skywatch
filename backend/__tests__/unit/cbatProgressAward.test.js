const {
  AWARD_TIERS,
  AWARD_MIN_ATTEMPTS,
  DONATION_MAX_DISMISSALS,
  improvementPct,
  highestTierReached,
  tierToAward,
  donationPromptDue,
} = require('../../utils/cbatProgressAward');

// A progress payload shaped like buildCbatProgress's return, with only the fields
// the award decision reads.
const progress = (attempts, firstAvg, lastAvg) => ({ attempts, firstAvg, lastAvg });

describe('improvementPct', () => {
  it('is positive when a higher-is-better score rises', () => {
    expect(improvementPct({ firstAvg: 10, lastAvg: 15 }, false)).toBe(50);
  });

  // Trace Practise scores rotations: fewer is better, so a FALLING average is an
  // improving player. Both directions must read as positive or the award would
  // congratulate the wrong half of the games.
  it('is positive when a lower-is-better score falls', () => {
    expect(improvementPct({ firstAvg: 100, lastAvg: 60 }, true)).toBe(40);
  });

  it('is negative when the player has got worse, in either direction', () => {
    expect(improvementPct({ firstAvg: 15, lastAvg: 10 }, false)).toBe(-33);
    expect(improvementPct({ firstAvg: 60, lastAvg: 100 }, true)).toBe(-67);
  });

  it('returns null when there is no trend window yet', () => {
    expect(improvementPct({ firstAvg: null, lastAvg: null }, false)).toBeNull();
  });

  // No percentage can be expressed against a zero baseline.
  it('returns null on a zero baseline', () => {
    expect(improvementPct({ firstAvg: 0, lastAvg: 5 }, false)).toBeNull();
  });
});

describe('highestTierReached', () => {
  it('returns null below the first tier', () => {
    expect(highestTierReached(14)).toBeNull();
  });

  it('returns the largest tier the percentage has reached', () => {
    expect(highestTierReached(15)).toBe(15);
    expect(highestTierReached(29)).toBe(15);
    expect(highestTierReached(30)).toBe(30);
    expect(highestTierReached(120)).toBe(50);
  });
});

describe('tierToAward', () => {
  it('awards nothing below the attempt floor, however big the improvement', () => {
    const p = progress(AWARD_MIN_ATTEMPTS - 1, 10, 30);
    expect(tierToAward(p, { lowerIsBetter: false })).toBeNull();
  });

  it('awards the tier once the attempt floor is met', () => {
    const p = progress(AWARD_MIN_ATTEMPTS, 10, 12);   // +20%
    expect(tierToAward(p, { lowerIsBetter: false })).toMatchObject({ tier: 15, pct: 20 });
  });

  it('awards nothing on a decline', () => {
    const p = progress(20, 12, 10);
    expect(tierToAward(p, { lowerIsBetter: false })).toBeNull();
  });

  // The point of the feature: crossing the line is the event, not sitting above it.
  it('does not re-award a tier the user has already been shown', () => {
    const p = progress(20, 10, 12);   // +20%, tier 15
    expect(tierToAward(p, { lowerIsBetter: false, seenTiers: [15] })).toBeNull();
  });

  it('awards the next tier up when the player improves further', () => {
    const p = progress(20, 10, 14);   // +40%, tier 30
    expect(tierToAward(p, { lowerIsBetter: false, seenTiers: [15] })).toMatchObject({ tier: 30 });
  });

  // A fast improver crosses several thresholds between two celebrations. They should get one
  // screen for the biggest, not three back to back — but the skipped ones must still be marked
  // claimed so they can never fire later on a smaller delta.
  it('awards only the highest unseen tier but claims every tier crossed', () => {
    const p = progress(20, 10, 16);   // +60%, past all three tiers
    const award = tierToAward(p, { lowerIsBetter: false });
    expect(award.tier).toBe(50);
    expect(award.claimed).toEqual(AWARD_TIERS);
  });

  it('applies the lower-is-better inversion', () => {
    const p = progress(20, 100, 60);  // 40% fewer rotations
    expect(tierToAward(p, { lowerIsBetter: true })).toMatchObject({ tier: 30, pct: 40 });
  });
});

describe('donationPromptDue', () => {
  const on = { progressAwardDonateEnabled: true, progressAwardDonateUrl: 'https://ko-fi.com/x' };
  const fresh = { lastShownAt: null, dismissCount: 0 };
  const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  it('is due for a user who has never been asked', () => {
    expect(donationPromptDue(fresh, on)).toBe(true);
  });

  it('is not due when the flag is off', () => {
    expect(donationPromptDue(fresh, { ...on, progressAwardDonateEnabled: false })).toBe(false);
  });

  // A live CTA pointing nowhere is worse than no CTA, so the URL is a hard gate
  // rather than something the UI is trusted to check.
  it('is not due when no donation URL is configured', () => {
    expect(donationPromptDue(fresh, { ...on, progressAwardDonateUrl: '' })).toBe(false);
    expect(donationPromptDue(fresh, { ...on, progressAwardDonateUrl: '   ' })).toBe(false);
  });

  // The only permanent stop. There is deliberately no "already donated" flag — the note has one
  // dismiss control, and two uses of it answer the question for good.
  it('stops asking after the dismissal cap', () => {
    expect(donationPromptDue({ ...fresh, dismissCount: DONATION_MAX_DISMISSALS - 1 }, on)).toBe(true);
    expect(donationPromptDue({ ...fresh, dismissCount: DONATION_MAX_DISMISSALS }, on)).toBe(false);
  });

  it('respects the cooldown since the last ask', () => {
    expect(donationPromptDue({ ...fresh, lastShownAt: daysAgo(3) }, on)).toBe(false);
    expect(donationPromptDue({ ...fresh, lastShownAt: daysAgo(31) }, on)).toBe(true);
  });

  it('treats a user with no prompt state at all as never asked', () => {
    expect(donationPromptDue(undefined, on)).toBe(true);
  });
});
