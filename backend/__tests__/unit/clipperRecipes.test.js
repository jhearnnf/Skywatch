/**
 * clipperRecipes.test.js
 *
 * Capture recipes are data, and the failures they cause are silent: a recipe
 * that mistimes a step still produces a video file and still reports success.
 * The play-dpt recipe recorded a briefing screen, eight seconds of gameplay and
 * twenty seconds of menu, and nothing in the job log said so.
 *
 * These assert the properties that stop that recurring. Lives here because
 * clipper-agent/ has no test runner of its own.
 */

const { RECIPES, getRecipe } = require('../../../clipper-agent/recipes');

const stepsOf = (id) => RECIPES[id].steps;
const kinds = (id) => stepsOf(id).map(s => s.do);

describe('getRecipe', () => {
  it('returns a known recipe', () => {
    expect(getRecipe('play-dpt').label).toBe('Play the DPT game');
  });

  it('names the alternatives when asked for one that does not exist', () => {
    expect(() => getRecipe('nope')).toThrow(/Unknown capture recipe "nope"/);
    expect(() => getRecipe('nope')).toThrow(/play-dpt/);
  });
});

describe('every recipe', () => {
  const ids = Object.keys(RECIPES);

  it.each(ids)('%s declares a label, auth and at least one step', (id) => {
    const r = RECIPES[id];
    expect(r.label).toBeTruthy();
    expect(typeof r.requiresAuth).toBe('boolean');
    expect(r.steps.length).toBeGreaterThan(0);
  });

  it.each(ids)('%s opens by navigating somewhere', (id) => {
    expect(stepsOf(id)[0]).toMatchObject({ do: 'goto' });
  });

  it.each(ids)('%s uses only step kinds the handler implements', (id) => {
    const known = [
      'goto', 'wait', 'waitFor', 'waitForGone', 'assertVisible',
      'click', 'clickIfPresent', 'scroll', 'idle', 'keys', 'play',
    ];
    for (const kind of kinds(id)) expect(known).toContain(kind);
  });

  it.each(ids)('%s gives every selector-driven step a selector', (id) => {
    for (const step of stepsOf(id)) {
      if (['waitFor', 'waitForGone', 'assertVisible', 'click', 'clickIfPresent'].includes(step.do)) {
        expect(step.selector).toBeTruthy();
      }
    }
  });

  it.each(ids)('%s sends only keys a keyboard can produce', (id) => {
    const sequences = stepsOf(id).flatMap(s => (s.do === 'keys' ? [s.keys] : s.commands ?? []));
    for (const seq of sequences) {
      expect(Array.isArray(seq)).toBe(true);
      // Playwright presses one key per entry, so a multi-character entry other
      // than a named key silently does nothing.
      for (const key of seq) expect(key).toMatch(/^([\w]|Arrow(Left|Right|Up|Down)|Enter|Escape|Space|Tab)$/);
    }
  });
});

describe('play-dpt', () => {
  const steps = stepsOf('play-dpt');

  // The bug this recipe had: a fixed 1500ms wait after picking an aircraft,
  // while the logo intro that plays first lasts 1800ms. The idle therefore
  // started with the curtain still up and spent its budget filming it.
  it('waits for the arena to appear rather than sleeping past the intro', () => {
    const click = steps.findIndex(s => s.do === 'click');
    const curtainGone = steps.findIndex(s => s.do === 'waitForGone');
    const between = steps.slice(click + 1, curtainGone + 1);

    // Getting from "aircraft picked" to "game accepting input" must be done by
    // waiting on the UI. A sleep here is a guess against an animation length,
    // and the last guess was 300ms short.
    expect(between.some(s => s.do === 'waitFor')).toBe(true);
    expect(between.some(s => s.do === 'wait')).toBe(false);
  });

  it('starts play through the site-wide start marker, not a label', () => {
    const click = steps.find(s => s.do === 'click');
    expect(click.selector).toContain('[data-demo-start]');
  });

  // A run that quits early records the menu, and that is what a good recording
  // looks like from the outside.
  it('checks the game is still on screen when the recipe ends', () => {
    expect(steps[steps.length - 1]).toMatchObject({ do: 'assertVisible' });
  });

  // Gameplay has to dominate: a beat is a couple of seconds and takes them from
  // wherever the trim points, so a clip that is mostly briefing has mostly
  // nothing to offer.
  it('spends far longer filming the game than the briefing', () => {
    const playing = steps
      .filter(s => s.do === 'idle' || s.do === 'play')
      .reduce((n, s) => n + s.ms, 0);
    const beforeClick = steps.slice(0, steps.findIndex(s => s.do === 'click'));
    const briefing = beforeClick.reduce((n, s) => n + (s.ms || 0) + (s.overMs || 0), 0);

    expect(playing).toBeGreaterThanOrEqual(20000);
    expect(briefing).toBeLessThan(2500);
    expect(playing).toBeGreaterThan(briefing * 5);
  });

  // The arena mounts behind the logo intro and the key listener is only
  // attached once the phase leaves 'intro'. Keys sent before the curtain lifts
  // are dropped in silence — which is how the round-skip below did nothing at
  // all on its first outing.
  it('waits for the intro curtain before sending any keys', () => {
    const curtain = steps.findIndex(s => s.do === 'waitForGone');
    const firstKeys = steps.findIndex(s => s.do === 'keys' || s.do === 'play');

    expect(curtain).toBeGreaterThan(-1);
    expect(steps[curtain].selector).toContain('skywatch-logo-intro');
    expect(curtain).toBeLessThan(firstKeys);
  });

  // Round 1 is two aircraft on an empty board. The game's own admin cheat
  // (ADMIN_ROUND_CHEATS in src/pages/CbatDpt.jsx) jumps to a busier one.
  it('jumps to a later round so the board is not empty', () => {
    const jump = steps.find(s => s.do === 'keys' && s.keys.join('') === '555');
    expect(jump).toBeDefined();
  });

  // An untouched DPT arena is four aircraft flying in straight lines.
  it('issues real commands while filming, not just watching', () => {
    const play = steps.find(s => s.do === 'play');
    expect(play.commands.length).toBeGreaterThanOrEqual(4);
    // Each command is select-aircraft, turn-direction, three bearing digits.
    for (const cmd of play.commands) {
      expect(cmd).toHaveLength(5);
      expect(['a', 'n', 'f']).toContain(cmd[0]);
      expect(['ArrowLeft', 'ArrowRight']).toContain(cmd[1]);
      expect(cmd.slice(2).join('')).toMatch(/^\d{3}$/);
    }
  });

  // A bearing that collides with a cheat code would silently do something else
  // entirely — 555 would restart round 5 on every pass.
  it('uses no bearing that is also a cheat code', () => {
    const cheats = ['111', '222', '333', '444', '555', '666', '777', '888'];
    for (const cmd of steps.find(s => s.do === 'play').commands) {
      const bearing = cmd.slice(2).join('');
      expect(cheats).not.toContain(bearing);
      expect(Number(bearing)).toBeLessThan(900);   // 9XX is the size cheat
    }
  });
});
