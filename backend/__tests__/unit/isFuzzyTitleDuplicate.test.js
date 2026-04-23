/**
 * Unit tests for isFuzzyTitleDuplicate — the near-duplicate gate used by the
 * auto-seeder. Regression guard against the "Royal Air Force" bug: that title
 * normalises to an empty string, and before the fix it matched every new title
 * because every string contains "".
 */

const { isFuzzyTitleDuplicate, normForDupe } = require('../../utils/keywordLinking');

describe('isFuzzyTitleDuplicate', () => {
  test('returns false when the only existing title normalises to empty ("Royal Air Force")', () => {
    const existing = new Set([normForDupe('Royal Air Force')]);
    expect([...existing]).toContain('');
    expect(isFuzzyTitleDuplicate('Guided Weapons', existing)).toBe(false);
    expect(isFuzzyTitleDuplicate('Fast-Jet Assets', existing)).toBe(false);
    expect(isFuzzyTitleDuplicate('Contested Environments', existing)).toBe(false);
  });

  test('still catches the original "RAF Cranwell" ≈ "RAF College Cranwell" case', () => {
    const existing = new Set([normForDupe('RAF Cranwell')]);
    expect(isFuzzyTitleDuplicate('RAF College Cranwell', existing)).toBe(true);
  });

  test('catches substring matches in either direction', () => {
    const existing = new Set([normForDupe('Eurofighter Typhoon')]);
    expect(isFuzzyTitleDuplicate('Eurofighter', existing)).toBe(true);
    expect(isFuzzyTitleDuplicate('Eurofighter Typhoon FGR4', existing)).toBe(true);
  });

  test('does not match on very short (< 4 char) normalised forms', () => {
    const existing = new Set([normForDupe('F-35')]);
    expect(isFuzzyTitleDuplicate('Unrelated Subject Matter', existing)).toBe(false);
  });

  test('returns false for unrelated titles', () => {
    const existing = new Set(['typhoon', 'cranwell', 'lossiemouth']);
    expect(isFuzzyTitleDuplicate('Sky Sabre', existing)).toBe(false);
  });
});
