/**
 * Game labels that spell out the difficulty.
 *
 * A split game keeps two registry keys with two separate boards, so a label that
 * names only one of them ("FLAG (Easier)" beside a bare "FLAG") reads as
 * ambiguous rather than as Hard. The Medals channel announces one result at a
 * time with nothing else to compare it against, so both halves are named.
 */

const {
  CBAT_GAMES, cbatLabelWithDifficulty, cbatHardKeyFor, isCbatEasierKey, isCbatHardKey,
} = require('../../constants/cbatGames');

// Read the split from the registry's own helpers rather than the '-easier'
// string: DPT's Hard half is 'dpt-hard' (plain 'dpt' is the retired eight-round
// board), and plain 'ant' / 'vigilance' are Easier boards that declare a
// `hardKey` instead of carrying the suffix.
const EASIER_KEYS = Object.keys(CBAT_GAMES).filter(isCbatEasierKey);

describe('cbatLabelWithDifficulty', () => {
  it('marks the Hard half of every split game', () => {
    expect(EASIER_KEYS.length).toBeGreaterThan(0);
    for (const easierKey of EASIER_KEYS) {
      const hardKey = cbatHardKeyFor(easierKey);
      expect(CBAT_GAMES[hardKey]).toBeDefined();     // an orphan Easier key is a wiring bug
      expect(cbatLabelWithDifficulty(hardKey)).toBe(`${CBAT_GAMES[hardKey].label} (Hard)`);
    }
  });

  it('names the Easier half exactly once', () => {
    for (const easierKey of EASIER_KEYS) {
      const label = cbatLabelWithDifficulty(easierKey);
      expect(label).toMatch(/ \(Easier\)$/);
      expect(label.match(/\(Easier\)/g)).toHaveLength(1);
    }
  });

  it('keeps the suffix out of the plain-key Easier labels (ANT, Vigilance, DAD)', () => {
    // Their bare key is also what the tutorial files under, so the registry
    // label stays bare and the helper adds "(Easier)".
    for (const key of ['ant', 'vigilance', 'dad']) {
      expect(CBAT_GAMES[key].label).not.toContain('(Easier)');
      expect(cbatLabelWithDifficulty(key)).toBe(`${CBAT_GAMES[key].label} (Easier)`);
    }
  });

  it('names FLAG both ways', () => {
    expect(cbatLabelWithDifficulty('flag')).toBe('FLAG (Hard)');
    expect(cbatLabelWithDifficulty('flag-easier')).toBe('FLAG (Easier)');
  });

  it('names DAD both ways', () => {
    expect(cbatLabelWithDifficulty('dad')).toBe('Directions and Distances (Easier)');
    expect(cbatLabelWithDifficulty('dad-hard')).toBe('Directions and Distances (Hard)');
  });

  it('leaves a game with no split unqualified', () => {
    expect(cbatLabelWithDifficulty('target')).toBe('Target');
    expect(cbatLabelWithDifficulty('plane-turn-2d')).toBe('Trace Practise 2D');
    for (const [key, cfg] of Object.entries(CBAT_GAMES)) {
      if (isCbatEasierKey(key) || isCbatHardKey(key)) continue;
      expect(cbatLabelWithDifficulty(key)).toBe(cfg.label);
    }
  });

  it('leaves the retired eight-round DPT board unqualified', () => {
    expect(cbatLabelWithDifficulty('dpt')).toBe(CBAT_GAMES.dpt.label);
  });

  it('returns null for a key that is not a game', () => {
    expect(cbatLabelWithDifficulty('not-a-game')).toBeNull();
  });
});
