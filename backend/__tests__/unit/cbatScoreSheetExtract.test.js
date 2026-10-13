const { parseExtraction, batteryKeyFor } = require('../../utils/cbatScoreSheetExtract');

describe('batteryKeyFor', () => {
  it.each([
    ['RAF Pilot 2026', 'pilot'],
    ['RAF Pilot 2025', 'pilot'],
    ['Pilot', 'pilot'],
    ['Pilot ISR (RPAS)', 'pilot-isr-rpas'],
    ['Weapon Systems Officer', 'wso'],
    ['Air & Space Ops - Control Officer (ATC)', 'control-officer-atc'],
    ['Control Officer (WC)', 'control-officer-wc'],
    ['Air & Space Ops - Operations Officer', 'operations-officer'],
    ['Intelligence', 'intelligence'],
    ['WSOP(Air Signaller - Linguist)', 'wsop-linguist'],
    ['WSOP(ISR)', 'wsop-isr'],
    ['WSOP(RW)', 'wsop-rw'],
    ['WSOP(AM)', 'wsop-am'],
    ['Non-Commissioned Control (ATC)', 'nco-control-atc'],
    ['Air Traffic & Weapons Controller (WC)', 'nco-control-wc'],
  ])('maps %s to %s', (label, key) => {
    expect(batteryKeyFor(label)).toBe(key);
  });

  it('leaves a name it has never seen unmatched', () => {
    expect(batteryKeyFor('Space Operations Officer')).toBeNull();
  });
});

describe('parseExtraction', () => {
  const reply = (obj) => `Here is the table:\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``;

  it('cleans the model output into stored fields', () => {
    const out = parseExtraction(reply({
      isScoreSheet: true, testDate: '2026-09-30', board: 'RAF',
      batteries: [{
        label: 'RAF  Pilot 2026', sideBar: 1, verdict: 'PASS', cutoff: '112', score: 123,
        domains: [{ key: 'StrgcTM', weight: '17x', tests: [{ code: 'CUT', mult: 3 }, { code: 'SAT' }], stanine: 6, minStanine: 4, belowMinimum: false }],
      }],
    }));
    expect(out.testDate.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(out.batteries[0]).toEqual({
      label: 'RAF Pilot 2026', batteryKey: 'pilot', sideBar: 1, verdict: 'pass', cutoff: 112, score: 123,
      domains: [{ key: 'StrgcTM', weight: 17, tests: [{ code: 'CUT', mult: 3 }, { code: 'SAT', mult: 1 }], stanine: 6, minStanine: 4, belowMinimum: false }],
    });
  });

  it('drops numbers that cannot be on a sheet rather than storing them', () => {
    const out = parseExtraction(reply({ batteries: [{ label: 'Intelligence', verdict: 'maybe', cutoff: 400, domains: [{ key: 'SymR', stanine: 12 }] }] }));
    expect(out.batteries[0]).toMatchObject({ verdict: null, cutoff: null });
    expect(out.batteries[0].domains[0].stanine).toBeNull();
  });

  it('never keeps a field it did not ask for, such as a name', () => {
    const out = parseExtraction(reply({ name: 'Someone', dateOfBirth: '2000-01-01', batteries: [] }));
    expect(Object.keys(out).sort()).toEqual(['batteries', 'board', 'isScoreSheet', 'testDate']);
  });

  it('reports a photo that is not a score sheet', () => {
    expect(parseExtraction('{"isScoreSheet": false}')).toMatchObject({ isScoreSheet: false, batteries: [] });
  });

  it('returns null when there is no JSON in the reply', () => {
    expect(parseExtraction('I cannot read this image.')).toBeNull();
  });
});
