// Family verdicts: the real sheet prints one PASS/FAIL per family of roles. Controller pairs pass
// if either role passes; WSOP ISR/RW/AM fail if any one fails (see _familiesComment in
// cbatBatteries.json). Both the Aptitude Report and the Mock Assessment sheet go through this.

const { BATTERY_BY_KEY, TESTS, FAMILIES } = require('../../constants/cbatBatteries');
const { buildBatteryReport, buildFamilyReport, applyFamilyVerdicts, minRunsFor } = require('../../utils/cbatAptitudeReport');
const { buildMockSheet } = require('../../utils/cbatMock');
const { scoreForStanine } = require('../../utils/cbatStanine');

// Every game the named roles draw on at `stanine`, except the overrides, with a full window of
// runs so the evidence is firm.
function formAt(keys, stanine, overrides = {}) {
  const form = {};
  for (const key of keys) {
    for (const d of BATTERY_BY_KEY[key].domains) {
      for (const t of d.tests) {
        for (const gameKey of TESTS[t.code].games) {
          const score = scoreForStanine(gameKey, overrides[t.code] ?? stanine);
          if (score == null) continue;   // a game whose anchors are still held
          form[gameKey] = { runs: minRunsFor(gameKey), form: score, easierOnly: false, lastPlayedAt: null };
        }
      }
    }
  }
  return form;
}

const WSOP = ['wsop-isr', 'wsop-rw', 'wsop-am'];
const CONTROL = ['control-officer-atc', 'control-officer-wc'];

// ISR-only tests low and AM's VLT high: ISR fails on its own while RW and AM pass, which is the
// mixed trio on the real sheet.
const wsopSplit = () => formAt(WSOP, 5, { VISS: 2, ABD5: 2, SLT: 2, VLT: 9 });
// ATC-only tests low: ATC fails on its own, WC passes.
const controlSplit = () => formAt(CONTROL, 5, { SAT: 2, NOP: 2, MATF: 2, DPT: 2 });

describe('family data', () => {
  it('names only real UK roles, each in one family', () => {
    const seen = new Set();
    for (const f of FAMILIES) {
      expect(['any', 'all']).toContain(f.rule);
      for (const k of f.members) {
        expect(BATTERY_BY_KEY[k]?.region).toBe('GB');
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    }
  });
});

describe('applyFamilyVerdicts', () => {
  const r = (key, status) => ({ key, label: BATTERY_BY_KEY[key].label, status });
  const byKey = list => Object.fromEntries(applyFamilyVerdicts(list).map(x => [x.key, x]));

  it('passes a controller role when its pair passes', () => {
    const out = byKey([r('control-officer-atc', 'fail'), r('control-officer-wc', 'pass')]);
    expect(out['control-officer-atc']).toMatchObject({ status: 'pass', ownStatus: 'fail' });
    expect(out['control-officer-atc'].family.decidedBy.map(s => s.key)).toEqual(['control-officer-wc']);
    expect(out['control-officer-wc']).toMatchObject({ status: 'pass', ownStatus: 'pass' });
  });

  it('fails every WSOP specialist role when one of them fails', () => {
    const out = byKey([r('wsop-isr', 'fail'), r('wsop-rw', 'pass'), r('wsop-am', 'pass')]);
    expect(out['wsop-rw']).toMatchObject({ status: 'fail', ownStatus: 'pass' });
    expect(out['wsop-am']).toMatchObject({ status: 'fail', ownStatus: 'pass' });
    expect(out['wsop-am'].family).toMatchObject({ rule: 'all', provisional: true });
  });

  it('lets no unknown sibling carry or sink a role', () => {
    const out = byKey([
      r('control-officer-atc', 'fail'), r('control-officer-wc', 'provisional'),
      r('wsop-isr', 'unscored'), r('wsop-rw', 'pass'), r('wsop-am', 'provisional'),
    ]);
    expect(out['control-officer-atc'].status).toBe('fail');
    expect(out['wsop-rw'].status).toBe('pass');
  });

  it('leaves an unscored role and a role with no family alone', () => {
    const out = byKey([r('control-officer-atc', 'unscored'), r('control-officer-wc', 'pass'), r('pilot', 'fail')]);
    expect(out['control-officer-atc'].status).toBe('unscored');
    expect(out.pilot).toEqual(r('pilot', 'fail'));
  });
});

describe('scored from real play', () => {
  it('the precondition holds: one member fails on its own, the others pass', () => {
    const w = wsopSplit();
    expect(WSOP.map(k => buildBatteryReport(BATTERY_BY_KEY[k], w).status)).toEqual(['fail', 'pass', 'pass']);
    const c = controlSplit();
    expect(CONTROL.map(k => buildBatteryReport(BATTERY_BY_KEY[k], c).status)).toEqual(['fail', 'pass']);
  });

  it('buildFamilyReport judges one role against siblings scored from the same form', () => {
    expect(buildFamilyReport(BATTERY_BY_KEY['wsop-rw'], wsopSplit())).toMatchObject({ status: 'fail', ownStatus: 'pass' });
    expect(buildFamilyReport(BATTERY_BY_KEY['control-officer-atc'], controlSplit())).toMatchObject({ status: 'pass', ownStatus: 'fail' });
    expect(buildFamilyReport(BATTERY_BY_KEY.pilot, controlSplit()).family).toBeUndefined();
  });
});

describe('mock score sheet', () => {
  // A sitting is one score per game; the sheet hands each over as a full window.
  const mockFrom = (form, extra) => ({
    region: 'GB',
    steps: [{ results: Object.entries(form).map(([gameKey, f]) => ({ gameKey, score: f.form, playedAt: null })) }],
    ...extra,
  });

  it('applies the family on a single-role mock', () => {
    const sheet = buildMockSheet(mockFrom(wsopSplit(), { scope: 'role', batteryKey: 'wsop-am' }));
    expect(sheet.batteries).toHaveLength(1);
    expect(sheet.batteries[0]).toMatchObject({ key: 'wsop-am', status: 'fail', ownStatus: 'pass' });
    expect(sheet.batteries[0].family.decidedBy.map(s => s.key)).toEqual(['wsop-isr']);
  });

  it('applies the family across an all-roles sheet', () => {
    const sheet = buildMockSheet(mockFrom({ ...wsopSplit(), ...controlSplit() }, { scope: 'all', batteryKey: null }));
    const byKey = Object.fromEntries(sheet.batteries.map(b => [b.key, b]));
    expect(byKey['control-officer-atc']).toMatchObject({ status: 'pass', ownStatus: 'fail' });
    expect(byKey['wsop-rw']).toMatchObject({ status: 'fail', ownStatus: 'pass' });
  });
});
