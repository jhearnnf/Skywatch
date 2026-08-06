/**
 * Unit tests for the Clipper script guardrails
 * (backend/utils/clipperGuardrails.js).
 *
 * These rules are the reason Clipper can be pointed at a Discord export about
 * the real CBAT without leaking someone's username or claiming we host the
 * real test. They are enforced in code rather than prompted, so they are
 * tested like any other invariant.
 */

const { validateScript, hasHedge } = require('../../utils/clipperGuardrails');

const FACTS = [
  { factKey: 'test:flag:0', grade: 'green' },
  { factKey: 'test:flag:1', grade: 'amber' },
  { factKey: 'day:day1:0',  grade: 'red'   },
];

const BLOCKLIST = ['blitz1031', 'NaturalGem08', 'Corri', 'God', 'Mac', 'Overwatch'];

// Build a one-beat script so each test asserts on a single rule.
function script(text, factKeys = [], outro = '') {
  return { beats: [{ id: 'b1', text, factKeys }], outro: { copy: outro } };
}

const run = (s) => validateScript(s, FACTS, BLOCKLIST);
const rules = (r) => r.findings.map(f => f.rule);

describe('grade gate', () => {
  it('allows a green fact to be stated flatly', () => {
    const r = run(script('Only circled aircraft matter.', ['test:flag:0']));
    expect(r.ok).toBe(true);
  });

  it('rejects an amber fact stated as established fact', () => {
    const r = run(script('The scoring weights every test equally.', ['test:flag:1']));
    expect(r.ok).toBe(false);
    expect(rules(r)).toContain('unhedged-amber');
  });

  it('accepts an amber fact when the same beat hedges it', () => {
    const r = run(script('A lot of sitters say the scoring weights every test equally.', ['test:flag:1']));
    expect(r.ok).toBe(true);
  });

  it('rejects a red fact outright, hedged or not', () => {
    const r = run(script('Reportedly, the test is scored out of 200.', ['day:day1:0']));
    expect(r.ok).toBe(false);
    expect(rules(r)).toContain('red-fact');
  });

  it('rejects a beat citing a fact key that does not exist', () => {
    const r = run(script('Something.', ['test:nope:9']));
    expect(r.ok).toBe(false);
    expect(rules(r)).toContain('unknown-fact');
  });
});

describe('hasHedge', () => {
  it.each([
    'people reportedly struggle',
    'a lot of sitters found it hard',
    'candidates say it is fast',
    'it seems to reward consistency',
    'this might catch you out',
  ])('recognises hedging in %p', (t) => expect(hasHedge(t)).toBe(true));

  it('does not see hedging in a flat assertion', () => {
    expect(hasHedge('The test is scored out of 200.')).toBe(false);
  });
});

describe('real names', () => {
  it('blocks a distinctive handle from the source material', () => {
    const r = run(script('As blitz1031 explained, timing matters.'));
    expect(r.ok).toBe(false);
    const finding = r.findings.find(f => f.rule === 'real-name');
    expect(finding.severity).toBe('error');
    expect(finding.match).toBe('blitz1031');
  });

  it('reports a handle that is also an ordinary word as a warning, not an error', () => {
    // "God" and "Overwatch" are genuine handles in the guide. Blocking them
    // outright would fire on innocent copy, so they are flagged for a human.
    const r = run(script('God knows the overwatch pattern is hard.'));
    expect(r.ok).toBe(true);
    expect(r.warnings.some(f => f.rule === 'real-name')).toBe(true);
  });

  it('does not match a handle inside a longer word', () => {
    const r = run(script('The macro pattern is worth learning.'));
    expect(r.findings.filter(f => f.rule === 'real-name' && f.match === 'Mac')).toHaveLength(0);
  });

  it('checks the outro as well as the beats', () => {
    const r = run(script('A normal line.', [], 'Thanks to Corri for the tip.'));
    expect(r.ok).toBe(false);
    expect(r.errors.some(f => f.rule === 'real-name' && f.beatId === 'outro')).toBe(true);
  });
});

describe('real-CBAT claims', () => {
  it.each([
    'This is the real CBAT, free on our site.',
    'Our games are identical to the real CBAT.',
    'Practise the actual CBAT right now.',
    'It is exactly the same as the real CBAT.',
  ])('rejects %p', (text) => {
    const r = run(script(text));
    expect(r.ok).toBe(false);
    expect(rules(r)).toContain('real-cbat-claim');
  });

  it('allows giving advice about the real test', () => {
    const r = run(script('On the real test, only circled aircraft count.', ['test:flag:0']));
    expect(r.ok).toBe(true);
  });
});

describe('RAF application claims', () => {
  it.each([
    'Pass your RAF application with these tips.',
    'This is how you get into the RAF.',
    'Boost your RAF chances today.',
  ])('rejects %p', (text) => {
    const r = run(script(text));
    expect(r.ok).toBe(false);
    expect(rules(r)).toContain('raf-application-claim');
  });

  it('allows a general RAF reference', () => {
    const r = run(script('The RAF uses this aptitude test.'));
    expect(r.ok).toBe(true);
  });

  it('catches an application claim in the outro, where it is most likely', () => {
    const r = run(script('A normal line.', [], 'Sign up free and boost your RAF application.'));
    expect(r.ok).toBe(false);
    expect(r.errors.some(f => f.rule === 'raf-application-claim')).toBe(true);
  });
});

describe('style', () => {
  it('warns on em and en dashes without blocking', () => {
    const r = run(script('The test is fast — brutally fast.'));
    expect(r.ok).toBe(true);
    expect(r.warnings.some(f => f.rule === 'style-dash')).toBe(true);
  });
});

describe('overall shape', () => {
  it('passes a clean script and reports nothing', () => {
    const r = run(script(
      'Only circled aircraft matter. Ignore the rest.',
      ['test:flag:0'],
      'More CBAT tips, free at skywatch.academy.',
    ));
    expect(r.ok).toBe(true);
    expect(r.findings).toHaveLength(0);
  });

  it('attributes every finding to the beat it came from', () => {
    const r = run(script('As blitz1031 said, it is hard.', ['test:flag:1']));
    expect(r.errors.every(f => f.beatId === 'b1')).toBe(true);
  });
});
