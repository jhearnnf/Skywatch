// Domain minimums: the red mark on every row of the real sheet. A battery fails when any domain
// sits under its minimum, however high the score (see _minStanineComment in cbatBatteries.json).

const { BATTERY_BY_KEY } = require('../../constants/cbatBatteries');
const { buildBatteryReport, minRunsFor } = require('../../utils/cbatAptitudeReport');
const { scoreForStanine, scoreToStanine } = require('../../utils/cbatStanine');

// A form that puts every game on `stanine`, except the overrides, with a full window of runs (or
// `runs` of them) so the report treats the evidence as firm.
function formAt(battery, stanine, overrides = {}, runs = null) {
  const form = {};
  for (const d of battery.domains) {
    for (const t of d.tests) {
      const { TESTS } = require('../../constants/cbatBatteries');
      for (const gameKey of TESTS[t.code].games) {
        const s = overrides[t.code] ?? stanine;
        const score = scoreForStanine(gameKey, s);
        // The inverse is only guaranteed to land in the band, so prove it did.
        expect([gameKey, scoreToStanine(gameKey, score)]).toEqual([gameKey, s]);
        form[gameKey] = { runs: runs ?? minRunsFor(gameKey), form: score, easierOnly: false, lastPlayedAt: null };
      }
    }
  }
  return form;
}

describe('domain minimums', () => {
  const pilot = BATTERY_BY_KEY.pilot;

  it('fails a battery that clears the pass mark but sits under a domain minimum', () => {
    // The real sheet: Pilot 138 against a cutoff of 112, FAIL, because CIP (FLAG) was on 3 against
    // a minimum of 5.
    const report = buildBatteryReport(pilot, formAt(pilot, 8, { FLAG: 3 }));
    expect(report.score).toBeGreaterThanOrEqual(pilot.cutoff);
    expect(report.status).toBe('fail');
    expect(report.failedMinimums).toEqual(['CIP']);
    const cip = report.domains.find(d => d.key === 'CIP');
    expect(cip).toMatchObject({ stanine: 3, minStanine: 5, belowMinimum: true });
  });

  it('passes when every domain is at or above its minimum', () => {
    const report = buildBatteryReport(pilot, formAt(pilot, 8, { FLAG: 5 }));
    expect(report.status).toBe('pass');
    expect(report.failedMinimums).toEqual([]);
  });

  it('holds a part-played domain under its minimum at provisional rather than calling a fail', () => {
    // One run each: the evidence is thin, so a low domain is not yet a verdict.
    const form = formAt(pilot, 8, { FLAG: 3 });
    form.flag = { ...form.flag, runs: 1 };
    const report = buildBatteryReport(pilot, form);
    expect(report.failedMinimums).toContain('CIP');
    expect(report.status).toBe('provisional');
  });
});
