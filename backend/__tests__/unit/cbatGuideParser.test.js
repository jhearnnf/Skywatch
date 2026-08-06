/**
 * Guide parser — pulling the data literals out of the guide HTML.
 *
 * The parser evaluates literals from an admin-uploaded file, so the normalising
 * and containment behaviour is tested as carefully as the happy path.
 */
const {
  parseCbatGuide, renderGuideCorpus, matchBracket, normalise,
} = require('../../utils/cbatGuideParser');

const guide = (body) => `<!doctype html><html><body><script>${body}</script></body></html>`;

const MINIMAL = guide(`
const TESTS = [
  { id:'flag', name:'Figures, Logistics and Groups', abbr:'FLAG', aka:'"the triangles one"',
    verdict:'The highest-stakes test.',
    facts:[
      {c:'green',tag:'Core rule',t:'Only circled aircraft count.',n:'Fix your practice for this.'},
      {c:'amber',tag:'Scoring',t:'Partial points for near misses.',n:'Reported once only.'}
    ]}
];
const OPEN = [{ q:'What is in Trace 2?', note:'Nobody who sat it has said.' }];
`);

describe('parseCbatGuide', () => {
  it('extracts the data blocks', () => {
    const { sections, found } = parseCbatGuide(MINIMAL);
    expect(found).toContain('TESTS');
    expect(sections.TESTS).toHaveLength(1);
    expect(sections.TESTS[0].abbr).toBe('FLAG');
    expect(sections.TESTS[0].facts).toHaveLength(2);
  });

  it('reports blocks the file does not have rather than failing', () => {
    const { missing } = parseCbatGuide(MINIMAL);
    expect(missing).toContain('DAY_GROUPS');
    expect(missing).toContain('FELT');
  });

  it('rejects a file that is not the guide', () => {
    expect(() => parseCbatGuide(guide('const SOMETHING = [1,2,3];')))
      .toThrow(/does not look like the CBAT guide/i);
  });

  it('rejects an empty upload', () => {
    expect(() => parseCbatGuide('')).toThrow(/empty/i);
  });

  it('is not fooled by brackets inside strings', () => {
    // The real guide is full of quoted apostrophes and brackets; a naive scan
    // ends the slice early and silently truncates the data.
    const tricky = guide(`
      const TESTS = [
        { id:'a', name:'Bracket ] and } inside', facts:[{c:'green',tag:'x',t:'a [b] c',n:''}] }
      ];
    `);
    const { sections } = parseCbatGuide(tricky);
    expect(sections.TESTS[0].name).toBe('Bracket ] and } inside');
    expect(sections.TESTS[0].facts[0].t).toBe('a [b] c');
  });

  it('does not run the page rendering code', () => {
    // Only the named literals are evaluated. Anything else in the file — here a
    // throw — must never execute.
    const withOtherCode = guide(`
      const TESTS = [{ id:'a', name:'A', facts:[] }];
      throw new Error('rendering code ran');
      document.body.innerHTML = 'x';
    `);
    expect(() => parseCbatGuide(withOtherCode)).not.toThrow();
  });

  it('evaluates in a context with no globals to reach for', () => {
    // A bare vm context means require/process/fetch are simply absent, so a
    // literal that tries to touch them fails to evaluate rather than succeeding.
    const hostile = guide(`
      const TESTS = [{ id:'a', name: (typeof process === 'undefined' ? 'no-process' : 'HAS PROCESS'), facts:[] }];
    `);
    const { sections } = parseCbatGuide(hostile);
    expect(sections.TESTS[0].name).toBe('no-process');
  });
});

describe('normalise', () => {
  it('strips functions and getters to plain data', () => {
    const out = normalise({ a: 'keep', b: () => 'nope', c: { d: 1 } });
    expect(out).toEqual({ a: 'keep', b: null, c: { d: 1 } });
  });

  it('caps runaway strings and arrays', () => {
    expect(normalise('x'.repeat(99999)).length).toBe(4000);
    expect(normalise(new Array(9999).fill('x'))).toHaveLength(500);
  });

  it('drops keys that are not plain identifiers', () => {
    const out = normalise({ good: 1, 'bad key': 2, '2bad': 3, 'has-dash': 4 });
    expect(Object.keys(out)).toEqual(['good']);
  });

  it('drops prototype-poisoning keys, which do pass the identifier test', () => {
    const hostile = JSON.parse('{"good":1,"__proto__":{"polluted":true},"constructor":2}');
    const out = normalise(hostile);
    expect(Object.keys(out)).toEqual(['good']);
    expect({}.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

describe('renderGuideCorpus', () => {
  it('states up front that this is candidate-reported, not official', () => {
    const { sections } = parseCbatGuide(MINIMAL);
    const corpus = renderGuideCorpus(sections);
    expect(corpus).toMatch(/not official material and it is not the test itself/i);
  });

  it('attaches confidence to every fact, not just once at the top', () => {
    // The bot can only pass the distinction on to a reader if it is on each
    // claim — a single header would be lost the moment one fact is quoted.
    const { sections } = parseCbatGuide(MINIMAL);
    const corpus = renderGuideCorpus(sections);
    expect(corpus).toMatch(/\[WELL ESTABLISHED[^\]]*\] Core rule: Only circled aircraft count\./);
    expect(corpus).toMatch(/\[SINGLE ACCOUNT[^\]]*\] Scoring: Partial points for near misses\./);
    expect(corpus).toContain('Caveat: Reported once only.');
  });

  it('marks the open questions as having no answer', () => {
    const { sections } = parseCbatGuide(MINIMAL);
    const corpus = renderGuideCorpus(sections);
    expect(corpus).toMatch(/KNOWN UNKNOWNS — the guide has NO answer/);
    expect(corpus).toContain('What is in Trace 2?');
  });
});

describe('matchBracket', () => {
  it('skips comments and strings when finding the close', () => {
    const src = `[ 'a]b', /* ] */ 'c' ] tail`;
    expect(src[matchBracket(src, 0)]).toBe(']');
    expect(src.slice(0, matchBracket(src, 0) + 1)).toBe(`[ 'a]b', /* ] */ 'c' ]`);
  });

  it('throws on an unbalanced literal rather than returning nonsense', () => {
    expect(() => matchBracket('[1, 2, 3', 0)).toThrow(/Unbalanced/);
  });
});
