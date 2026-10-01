const { BATTERIES, BATTERY_BY_KEY, TESTS, SCORED_GAME_KEYS } = require('../../constants/cbatBatteries');
const { isCbatEasierKey } = require('../../constants/cbatGames');
const { MOCK, mockBatteries, mockSteps, breakPoints, buildMockPlan } = require('../../utils/cbatMockPlan');

// A seeded rng, so a shuffle can be asserted on.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const codesOf = b => [...new Set(b.domains.flatMap(d => d.tests.map(t => t.code)))];

describe('mock minutes', () => {
  it('has an estimate for every game a battery can draw on', () => {
    for (const g of SCORED_GAME_KEYS) expect([g, MOCK.minutes[g] > 0]).toEqual([g, true]);
  });
});

describe('mock paths', () => {
  it('has a launch path for every game a mock can sit', () => {
    for (const g of Object.keys(MOCK.minutes)) expect([g, MOCK.paths[g]]).toEqual([g, expect.stringMatching(/^\/cbat\//)]);
  });

  it('opens each Instruments board on its own mode', () => {
    expect(MOCK.paths.instruments).toBe('/cbat/instruments?mode=reading');
    expect(MOCK.paths['instruments-orientation']).toBe('/cbat/instruments?mode=orientation');
  });
});

describe('mockSteps', () => {
  it('sits every test a role lists that SkyWatch has a game for, and nothing else', () => {
    for (const b of BATTERIES) {
      const steps = mockSteps([b]);
      const sat = new Set(steps.flatMap(s => s.codes));
      for (const code of codesOf(b)) {
        expect([b.key, code, sat.has(code)]).toEqual([b.key, code, TESTS[code].games.length > 0]);
      }
    }
  });

  it('only ever plays the boards the Aptitude Report scores, never an Easier one', () => {
    for (const b of BATTERIES) {
      for (const s of mockSteps([b])) {
        for (const g of s.gameKeys) expect([b.key, g, isCbatEasierKey(g)]).toEqual([b.key, g, false]);
      }
    }
  });

  it('sits Vigilance once when a role lists both VIG1 and VGIL_SPEED', () => {
    const steps = mockSteps(mockBatteries({ region: 'GB' }));
    const vig = steps.filter(s => s.gameKeys.includes('vigilance-hard'));
    expect(vig).toHaveLength(1);
    expect(vig[0].codes).toEqual(expect.arrayContaining(['VIG1', 'VGIL_SPEED']));
  });

  it('plays Visualisation 2D and 3D as one step, back to back', () => {
    const steps = mockSteps([BATTERY_BY_KEY['wsop-isr']]);
    const viss = steps.find(s => s.codes.includes('VISS'));
    expect(viss.gameKeys).toEqual(['visualisation-2d', 'visualisation-3d']);
    expect(steps.filter(s => s.gameKeys.some(g => g.startsWith('visualisation')))).toHaveLength(1);
  });

  it('plays Instruments Reading and Orientation as one step, back to back', () => {
    const steps = mockSteps([BATTERY_BY_KEY.pilot]);
    const insc = steps.find(s => s.codes.includes('INSC'));
    expect(insc.gameKeys).toEqual(['instruments', 'instruments-orientation']);
    expect(steps.filter(s => s.gameKeys.some(g => g.startsWith('instruments')))).toHaveLength(1);
  });

  it('never repeats a game across steps', () => {
    for (const region of ['GB', 'CA', 'AU']) {
      const games = mockSteps(mockBatteries({ region })).flatMap(s => s.gameKeys);
      expect([region, new Set(games).size]).toEqual([region, games.length]);
    }
  });
});

describe('breakPoints', () => {
  const step = minutes => ({ minutes });

  it('breaks at the first boundary past the threshold, then counts again from zero', () => {
    const steps = [step(20), step(15), step(10), step(10), step(12), step(5)];
    // 20+15 = 35 -> break after index 1; 10+10+12 = 32 -> break after index 4.
    expect(breakPoints(steps, 30)).toEqual([1, 4]);
  });

  it('never breaks after the last test', () => {
    expect(breakPoints([step(10), step(40)], 30)).toEqual([]);
  });
});

describe('buildMockPlan', () => {
  it('builds a role mock in that role\'s region with the same steps in a shuffled order', () => {
    const plan = buildMockPlan({ batteryKey: 'pilot', rng: seeded(7) });
    expect(plan).toMatchObject({ scope: 'role', batteryKey: 'pilot', region: 'GB' });
    const unshuffled = mockSteps([BATTERY_BY_KEY.pilot]);
    expect(plan.steps.map(s => s.gameKeys.join('+')).sort()).toEqual(unshuffled.map(s => s.gameKeys.join('+')).sort());
  });

  it('gives the same order for the same seed and a different one for another', () => {
    const a = buildMockPlan({ batteryKey: 'pilot', rng: seeded(1) }).steps.map(s => s.gameKeys[0]);
    const b = buildMockPlan({ batteryKey: 'pilot', rng: seeded(1) }).steps.map(s => s.gameKeys[0]);
    const c = buildMockPlan({ batteryKey: 'pilot', rng: seeded(2) }).steps.map(s => s.gameKeys[0]);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('builds an all-roles mock from every battery in the region', () => {
    const plan = buildMockPlan({ region: 'CA', rng: seeded(3) });
    expect(plan).toMatchObject({ scope: 'all', batteryKey: null, region: 'CA' });
    const games = plan.steps.flatMap(s => s.gameKeys);
    expect(games).toContain('clan');
    expect(games).not.toContain('flag');
  });

  it('counts a full break in the total for every break point', () => {
    const plan = buildMockPlan({ batteryKey: 'pilot', rng: seeded(4) });
    const testMinutes = plan.steps.reduce((a, s) => a + s.minutes, 0);
    expect(plan.totalMinutes).toBe(testMinutes + plan.breakAfter.length * MOCK.breakMinutes);
    expect(plan.breakAfter.length).toBeGreaterThan(0);
  });

  it('returns null for a role that does not exist', () => {
    expect(buildMockPlan({ batteryKey: 'nope' })).toBeNull();
  });
});
