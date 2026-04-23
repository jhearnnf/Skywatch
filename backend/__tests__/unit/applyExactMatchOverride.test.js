const { applyExactMatchOverride, normExactTitle } = require('../../utils/keywordLinking');

describe('normExactTitle', () => {
  test('lowercases and trims', () => {
    expect(normExactTitle('  Royal Air Force  ')).toBe('royal air force');
  });

  test('strips leading "The "', () => {
    expect(normExactTitle('The RAF')).toBe('raf');
    expect(normExactTitle('the raf')).toBe('raf');
  });

  test('strips trailing simple plural s', () => {
    expect(normExactTitle('Weapons Systems Officers')).toBe('weapons systems officer');
  });

  test('handles null/undefined safely', () => {
    expect(normExactTitle(null)).toBe('');
    expect(normExactTitle(undefined)).toBe('');
  });
});

describe('applyExactMatchOverride', () => {
  test('overrides cross-category AI pick (RAF/Heritage vs NATO/Allies)', () => {
    const links = [{ keyword: 'Royal Air Force', type: 'ALLY', title: 'NATO' }];
    const candidates = ['NATO', 'Royal Air Force'];
    const out = applyExactMatchOverride(links, candidates);
    expect(out[0].title).toBe('Royal Air Force');
  });

  test('overrides within-category wrong pick (Hawk T2 vs Hawk T1)', () => {
    const links = [{ keyword: 'Hawk T2', type: 'AIRCRAFT', title: 'BAE Systems Hawk T1' }];
    const candidates = ['BAE Systems Hawk T1', 'Hawk T2'];
    const out = applyExactMatchOverride(links, candidates);
    expect(out[0].title).toBe('Hawk T2');
  });

  test('respects AI null decisions (context-sensitivity)', () => {
    const links = [{ keyword: 'Typhoon', type: 'GENERIC', title: null }];
    const candidates = ['Eurofighter Typhoon FGR4', 'Typhoon'];
    const out = applyExactMatchOverride(links, candidates);
    expect(out[0].title).toBeNull();
  });

  test('no-op when AI already picked exact match', () => {
    const links = [{ keyword: 'NATO', type: 'ALLY', title: 'NATO' }];
    const candidates = ['NATO', 'Article 5'];
    const out = applyExactMatchOverride(links, candidates);
    expect(out[0].title).toBe('NATO');
  });

  test('no-op when no exact match exists (preserves AI pick)', () => {
    const links = [{ keyword: 'jet engine', type: 'TECH', title: 'Rolls-Royce EJ200' }];
    const candidates = ['Rolls-Royce EJ200', 'General Electric F110'];
    const out = applyExactMatchOverride(links, candidates);
    expect(out[0].title).toBe('Rolls-Royce EJ200');
  });

  test('trailing-plural keyword matches singular title', () => {
    const links = [{ keyword: 'Weapons Systems Officers', type: 'ROLE', title: 'RPAS Operator' }];
    const candidates = ['RPAS Operator', 'Weapons Systems Officer'];
    const out = applyExactMatchOverride(links, candidates);
    expect(out[0].title).toBe('Weapons Systems Officer');
  });

  test('leading "The " ignored in keyword', () => {
    const links = [{ keyword: 'The Royal Air Force', type: 'ALLY', title: 'NATO' }];
    const candidates = ['NATO', 'Royal Air Force'];
    const out = applyExactMatchOverride(links, candidates);
    expect(out[0].title).toBe('Royal Air Force');
  });

  test('case-insensitive match', () => {
    const links = [{ keyword: 'ROYAL AIR FORCE', type: 'ALLY', title: 'NATO' }];
    const candidates = ['NATO', 'Royal Air Force'];
    const out = applyExactMatchOverride(links, candidates);
    expect(out[0].title).toBe('Royal Air Force');
  });

  test('handles multiple links in one batch', () => {
    const links = [
      { keyword: 'Royal Air Force', type: 'ALLY', title: 'NATO' },
      { keyword: 'Typhoon', type: 'GENERIC', title: null },
      { keyword: 'Hawk T2', type: 'AIRCRAFT', title: 'BAE Systems Hawk T1' },
    ];
    const candidates = ['NATO', 'Royal Air Force', 'Typhoon', 'BAE Systems Hawk T1', 'Hawk T2'];
    const out = applyExactMatchOverride(links, candidates);
    expect(out[0].title).toBe('Royal Air Force');
    expect(out[1].title).toBeNull();
    expect(out[2].title).toBe('Hawk T2');
  });

  test('empty keyword string is skipped safely', () => {
    const links = [{ keyword: '', type: 'TERM', title: 'Some Brief' }];
    const candidates = ['Some Brief'];
    const out = applyExactMatchOverride(links, candidates);
    expect(out[0].title).toBe('Some Brief');
  });

  test('logger callback receives override messages', () => {
    const logs = [];
    const links = [{ keyword: 'Royal Air Force', type: 'ALLY', title: 'NATO' }];
    const candidates = ['NATO', 'Royal Air Force'];
    applyExactMatchOverride(links, candidates, (msg) => logs.push(msg));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some(m => m.includes('Exact-match override'))).toBe(true);
  });
});
