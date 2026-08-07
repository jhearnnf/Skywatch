/**
 * Game labels that spell out the difficulty.
 *
 * A split game keeps two registry keys with two separate boards, so a label that
 * names only one of them ("FLAG (Easier)" beside a bare "FLAG") reads as
 * ambiguous rather than as Hard. The Medals channel announces one result at a
 * time with nothing else to compare it against, so both halves are named.
 */

const { CBAT_GAMES, cbatLabelWithDifficulty } = require('../../constants/cbatGames');

const EASIER_KEYS = Object.keys(CBAT_GAMES).filter(k => k.endsWith('-easier'));

describe('cbatLabelWithDifficulty', () => {
  it('marks the Hard half of every split game', () => {
    expect(EASIER_KEYS.length).toBeGreaterThan(0);
    for (const easierKey of EASIER_KEYS) {
      const hardKey = easierKey.replace(/-easier$/, '');
      expect(CBAT_GAMES[hardKey]).toBeDefined();     // an orphan -easier key is a wiring bug
      expect(cbatLabelWithDifficulty(hardKey)).toBe(`${CBAT_GAMES[hardKey].label} (Hard)`);
    }
  });

  it('leaves the Easier half alone — its registry label already says so', () => {
    for (const easierKey of EASIER_KEYS) {
      expect(cbatLabelWithDifficulty(easierKey)).toBe(CBAT_GAMES[easierKey].label);
      expect(cbatLabelWithDifficulty(easierKey)).toContain('(Easier)');
    }
  });

  it('names FLAG both ways', () => {
    expect(cbatLabelWithDifficulty('flag')).toBe('FLAG (Hard)');
    expect(cbatLabelWithDifficulty('flag-easier')).toBe('FLAG (Easier)');
  });

  it('leaves a game with no split unqualified', () => {
    expect(cbatLabelWithDifficulty('target')).toBe('Target');
    expect(cbatLabelWithDifficulty('plane-turn-2d')).toBe('Trace Practise 2D');
    for (const [key, cfg] of Object.entries(CBAT_GAMES)) {
      if (key.endsWith('-easier') || CBAT_GAMES[`${key}-easier`]) continue;
      expect(cbatLabelWithDifficulty(key)).toBe(cfg.label);
    }
  });

  it('returns null for a key that is not a game', () => {
    expect(cbatLabelWithDifficulty('not-a-game')).toBeNull();
  });
});
