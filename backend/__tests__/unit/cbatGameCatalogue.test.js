/**
 * The guide bot's game list, held in step with the registry.
 *
 * The catalogue is hand-written prose about each game, so nothing can generate
 * it — but it can be checked, and it has to be. A game added to CBAT_GAMES and
 * not described here produces exactly the failure the catalogue exists to fix:
 * a bot that confidently tells a player the game in front of them does not
 * exist. These tests fail at that moment rather than in a channel.
 */
const {
  CBAT_GAME_CATALOGUE, renderGameCatalogue, CATALOGUE_HEADER, CATALOGUE_FOOTER,
} = require('../../constants/cbatGameCatalogue');
const { CBAT_GAMES, CBAT_TUTORIAL_GAME_KEYS, isCbatEasierKey } = require('../../constants/cbatGames');
const { TESTS } = require('../../constants/cbatBatteries');

describe('coverage of the registry', () => {
  it('describes every CBAT_GAMES key exactly once', () => {
    const claimed = CBAT_GAME_CATALOGUE.flatMap(g => g.registryKeys);
    const dupes = claimed.filter((k, i) => claimed.indexOf(k) !== i);
    expect(dupes).toEqual([]);
    expect([...claimed].sort()).toEqual(Object.keys(CBAT_GAMES).sort());
  });

  it('names a difficulty split wherever the registry has one, and nowhere else', () => {
    for (const game of CBAT_GAME_CATALOGUE) {
      const split = game.registryKeys.some(isCbatEasierKey);
      expect([game.name, Boolean(game.difficulties)]).toEqual([game.name, split]);
      if (split) expect(game.difficulties).toEqual(['Easier', 'Hard']);
    }
  });

  it('only claims to drill a test code the batteries actually define', () => {
    for (const game of CBAT_GAME_CATALOGUE) {
      if (!game.simulates) continue;
      expect({ game: game.name, defined: game.simulates in TESTS })
        .toEqual({ game: game.name, defined: true });
    }
  });

  // A tutorial is the answer to "how do the controls work", so the bot must
  // know exactly which games have one. The registry list is what the admin
  // funnels read and what the games actually post to, so it is the truth here;
  // CUT's tutorial shipped without being added to it and went unreported for a
  // day, which is the drift this pins.
  it('claims a tutorial for exactly the games that ship one', () => {
    const claimed = CBAT_GAME_CATALOGUE.filter(g => g.tutorial).flatMap(g => g.registryKeys);
    for (const key of CBAT_TUTORIAL_GAME_KEYS) {
      expect({ key, described: claimed.includes(key) }).toEqual({ key, described: true });
    }
    for (const game of CBAT_GAME_CATALOGUE) {
      const ships = game.registryKeys.some(k => CBAT_TUTORIAL_GAME_KEYS.includes(k));
      expect([game.name, Boolean(game.tutorial)]).toEqual([game.name, ships]);
      if (game.tutorial) expect(game.tutorial.length).toBeGreaterThan(20);
    }
  });

  // The mapping the bot repeats back to a user. Two of these are not what the
  // initials suggest (TRT is Target Recognition, MATF is Table Reading), and
  // both were wrong in the Aptitude Report before being corrected, so the
  // catalogue is pinned to the batteries file rather than trusted on its own.
  it('agrees with the batteries file about which game drills which test', () => {
    for (const game of CBAT_GAME_CATALOGUE) {
      if (!game.simulates) continue;
      const games = TESTS[game.simulates].games;
      expect([game.name, games.some(k => game.registryKeys.includes(k))])
        .toEqual([game.name, true]);
    }
  });
});

describe('entry shape', () => {
  it('gives every game a name, a sentence and at least one alias', () => {
    for (const game of CBAT_GAME_CATALOGUE) {
      expect(game.name).toBeTruthy();
      expect(game.what.length).toBeGreaterThan(20);
      expect(game.aliases.length).toBeGreaterThan(0);
    }
  });

  // Resolving what someone typed is the entire job, and a stray capital or a
  // trailing space is enough to make an alias miss.
  it('keeps aliases lower case and trimmed', () => {
    for (const game of CBAT_GAME_CATALOGUE) {
      for (const alias of game.aliases) {
        expect(alias).toBe(alias.toLowerCase().trim());
      }
    }
  });

  it('never gives two games the same alias', () => {
    const all = CBAT_GAME_CATALOGUE.flatMap(g => g.aliases);
    expect(all.filter((a, i) => all.indexOf(a) !== i)).toEqual([]);
  });

  // The exchange that prompted all of this: a user asked about "trace 3d" and
  // "the 3d practise", and the bot said the app must have invented it.
  it('resolves the names the Trace modes actually get called', () => {
    const trace3d = CBAT_GAME_CATALOGUE.find(g => g.name === 'Trace Practise 3D');
    for (const alias of ['trace 3d', '3d practise', '3d practice']) {
      expect(trace3d.aliases).toContain(alias);
    }
  });
});

describe('rendering', () => {
  it('wraps the list in markers and names every game', () => {
    const block = renderGameCatalogue();
    expect(block.startsWith(CATALOGUE_HEADER)).toBe(true);
    expect(block.endsWith(CATALOGUE_FOOTER)).toBe(true);
    for (const game of CBAT_GAME_CATALOGUE) expect(block).toContain(game.name);
  });

  it('states the list is fact about this app rather than a candidate report', () => {
    expect(renderGameCatalogue()).toMatch(/fact about this app/i);
  });

  it('still says these are simulations rather than the real tests', () => {
    expect(renderGameCatalogue()).toMatch(/not the real tests/i);
  });

  // Where a game has a tutorial the rendered line must say so, and the
  // preamble must name the set, or a user asking "is there a DPT tutorial"
  // gets the real-battery answer instead of ours.
  it('prints each tutorial on its game and names the six games that have one', () => {
    const block = renderGameCatalogue();
    for (const game of CBAT_GAME_CATALOGUE) {
      const line = block.split('\n').find(l => l.startsWith(`- ${game.name} |`));
      expect([game.name, line.includes('tutorial:')]).toEqual([game.name, Boolean(game.tutorial)]);
    }
    expect(block).toMatch(/Six games have a tutorial: Target, ANT, FLAG, SAT, CUT and DPT/);
  });

  it('drops a game an admin has switched off', () => {
    const block = renderGameCatalogue({ isEnabled: (k) => k !== 'vigilance' });
    expect(block).not.toContain('Vigilance Test');
    expect(block).toContain('Target');
  });

  // Turning off one difficulty must not hide the game: FLAG with only its
  // Easier board switched off is still FLAG, and still playable.
  it('keeps a game while any of its boards is on', () => {
    const block = renderGameCatalogue({ isEnabled: (k) => k !== 'flag-easier' });
    expect(block).toContain('FLAG');
  });
});
