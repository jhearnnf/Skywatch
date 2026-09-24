// Slim mode opens Learn one category at a time. learnScope decides whether a
// request is slim and stamps the settings; subscription.js enforces it.
const { isSlimRequest, scopeLearnToSlim, SLIM_LEARN_CATEGORIES } = require('../../utils/learnScope');
const {
  getAccessibleCategories, canAccessCategory, isPathwayUnlocked, getPathwayAccessibleCategories,
} = require('../../utils/subscription');

const reqWith = (headers = {}) => ({ get: (h) => headers[h] });
const THRESHOLDS = [0, 100, 350];
const fullSettings = () => ({
  slimModeEnabled:  false,
  guestCategories:  ['News'],
  freeCategories:   ['News'],
  silverCategories: ['News', 'Aircrafts'],
  pathwayUnlocks:   [
    { category: 'News',      levelRequired: 1, rankRequired: 1 },
    { category: 'Aircrafts', levelRequired: 2, rankRequired: 1 },
  ],
});

describe('learnScope', () => {
  it('opens Aircrafts first', () => {
    expect(SLIM_LEARN_CATEGORIES).toEqual(['Aircrafts']);
  });

  it('treats the site-wide flag and the native header as slim', () => {
    expect(isSlimRequest(reqWith(), { slimModeEnabled: true })).toBe(true);
    expect(isSlimRequest(reqWith({ 'X-Slim-App': '1' }), { slimModeEnabled: false })).toBe(true);
    expect(isSlimRequest(reqWith(), { slimModeEnabled: false })).toBe(false);
  });

  it('closes every category when the admin switches Learn off', () => {
    const s = scopeLearnToSlim(reqWith({ 'X-Slim-App': '1' }), { ...fullSettings(), slimLearnEnabled: false });
    expect(s.learnCategoriesOverride).toEqual([]);
    expect(canAccessCategory('Aircrafts', 'gold', s)).toBe(false);
  });

  it('leaves full-site settings untouched', () => {
    const s = scopeLearnToSlim(reqWith(), fullSettings());
    expect(s.learnCategoriesOverride).toBeUndefined();
    expect(canAccessCategory('Aircrafts', 'free', s)).toBe(false);
  });

  describe('once scoped to slim', () => {
    const s = scopeLearnToSlim(reqWith({ 'X-Slim-App': '1' }), fullSettings());
    const freeLevel1 = { cycleAirstars: 0, rank: { rankNumber: 1 } };

    it('opens Aircrafts to a free level-1 player', () => {
      expect(canAccessCategory('Aircrafts', 'free', s)).toBe(true);
      expect(isPathwayUnlocked('Aircrafts', freeLevel1, s, THRESHOLDS)).toBe(true);
    });

    it('closes every other category to every tier, Gold included', () => {
      expect(canAccessCategory('News', 'gold', s)).toBe(false);
      expect(getAccessibleCategories('gold', s)).toEqual(['Aircrafts']);
      expect(isPathwayUnlocked('News', freeLevel1, s, THRESHOLDS)).toBe(false);
    });

    it('never changes with level, so no unlock notices fire', () => {
      const levelled = { cycleAirstars: 5000, rank: { rankNumber: 5 } };
      expect(getPathwayAccessibleCategories(freeLevel1, s, THRESHOLDS))
        .toEqual(getPathwayAccessibleCategories(levelled, s, THRESHOLDS));
    });
  });
});
