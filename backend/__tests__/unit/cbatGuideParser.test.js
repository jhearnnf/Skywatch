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
    expect(corpus).toContain('[G] Core rule: Only circled aircraft count.');
    expect(corpus).toContain('[A] Scoring: Partial points for near misses.');
    expect(corpus).toContain('| Reported once only.');
  });

  it('expands the confidence codes once, so the codes themselves are readable', () => {
    // The codes are only cheap because the legend carries their meaning. Ship
    // the codes without it and the bot is grading claims off single letters.
    const { sections } = parseCbatGuide(MINIMAL);
    const corpus = renderGuideCorpus(sections);
    expect(corpus).toMatch(/\[G\] well established/i);
    expect(corpus).toMatch(/\[A\] single account/i);
    expect(corpus).toMatch(/\[R\] outdated/i);
    expect(corpus).toMatch(/\[P\] from the published test guides only/i);
  });

  it('grades a published-guides fact as P rather than dropping it to unrated', () => {
    // `grey` used to fall through to "UNRATED", which threw away the whole
    // point of that grade: nobody who sat the test has confirmed it.
    const html = MINIMAL.replace("c:'amber'", "c:'grey'");
    const { sections } = parseCbatGuide(html);
    const corpus = renderGuideCorpus(sections);
    expect(corpus).toContain('[P] Scoring: Partial points for near misses.');
    expect(corpus).not.toContain('UNRATED');
    expect(corpus).not.toContain('[?]');
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

describe('renderGuideCorpus — the roster line', () => {
  const THREE = guide(`
const TESTS = [
  { id:'flag', name:'Figures, Logistics and Groups', abbr:'FLAG', facts:[{c:'green',tag:'a',t:'b'}] },
  { id:'sdt',  name:'Sensory Discrimination Test',   abbr:'SDT',  facts:[{c:'green',tag:'a',t:'b'}] },
  { id:'act',  name:'Aircraft Control Test',         abbr:'ACT',  facts:[{c:'green',tag:'a',t:'b'}] }
];
`);

  it('states how many tests are described, so the bot never has to count', () => {
    // "How many tests are there?" is one of the first things anyone asks, and
    // the count is not written anywhere in the guide — only implied by the
    // sections. Counting headings in code is reliable; asking a model to is not.
    const { sections } = parseCbatGuide(THREE);
    expect(renderGuideCorpus(sections)).toMatch(/3 tests are described below/);
  });

  it('names them, so "which ones" is answerable too', () => {
    const { sections } = parseCbatGuide(THREE);
    const corpus = renderGuideCorpus(sections);
    expect(corpus).toContain('Figures, Logistics and Groups (FLAG)');
    expect(corpus).toContain('Sensory Discrimination Test (SDT)');
    expect(corpus).toContain('Aircraft Control Test (ACT)');
  });

  it('frames the count as a floor rather than a definitive roster', () => {
    // It is what candidates have described, not the published battery.
    const { sections } = parseCbatGuide(THREE);
    expect(renderGuideCorpus(sections)).toMatch(/at least this many/i);
  });

  it('omits the line entirely when there are no tests', () => {
    // Rendered directly: parseCbatGuide rejects a guide with no TESTS outright,
    // so this state only arises from a caller passing sections of its own.
    expect(renderGuideCorpus({})).not.toMatch(/tests are described below/);
    expect(renderGuideCorpus({ TESTS: [] })).not.toMatch(/tests are described below/);
  });
});

describe('renderGuideCorpus — rendering a subset', () => {
  const THREE = guide(`
const TESTS = [
  { id:'flag', name:'Figures, Logistics and Groups', abbr:'FLAG', facts:[{c:'green',tag:'Core rule',t:'Only circled aircraft count.'}] },
  { id:'cut',  name:'Cognitive Updating Test',       abbr:'CUT',  facts:[{c:'green',tag:'Format',t:'Six displays at once.'}] },
  { id:'rtt',  name:'Rapid Tracking Test',           abbr:'RTT',  facts:[{c:'green',tag:'Kit',t:'Uses a joystick.'}] }
];
`);

  it('writes out only the tests it was given', () => {
    const { sections } = parseCbatGuide(THREE);
    const only = renderGuideCorpus(sections, { tests: [sections.TESTS[0]] });

    expect(only).toContain('Only circled aircraft count.');
    expect(only).not.toContain('Six displays at once.');
    expect(only).not.toContain('Uses a joystick.');
  });

  it('still names every test in the roster', () => {
    // Otherwise the bot reads "not sent this time" as "not covered", and tells
    // the user it has nothing on a test the guide documents in full.
    const { sections } = parseCbatGuide(THREE);
    const only = renderGuideCorpus(sections, { tests: [sections.TESTS[0]] });

    expect(only).toMatch(/3 tests are described below/);
    expect(only).toContain('Cognitive Updating Test (CUT)');
    expect(only).toContain('Rapid Tracking Test (RTT)');
    expect(only).toMatch(/Only the tests relevant to the current question/);
    expect(only).toMatch(/Every test named above is covered/);
  });

  it('keeps the always-on core whatever the slice', () => {
    const { sections } = parseCbatGuide(MINIMAL);
    const core = renderGuideCorpus(sections, { tests: [] });

    expect(core).toContain('=== CBAT COMMUNITY GUIDE ===');
    expect(core).toContain('=== END OF GUIDE ===');
    expect(core).toMatch(/not official material/i);
    expect(core).toMatch(/KNOWN UNKNOWNS/);
  });

  it('adds no subset note when every test is included', () => {
    const { sections } = parseCbatGuide(THREE);
    const all = renderGuideCorpus(sections, { tests: sections.TESTS });
    expect(all).not.toMatch(/Only the tests relevant/);
  });

  it('renders everything by default', () => {
    const { sections } = parseCbatGuide(THREE);
    expect(renderGuideCorpus(sections)).toBe(renderGuideCorpus(sections, { tests: null }));
  });

  it('is materially smaller for one test than for all of them', () => {
    // Sized like the real guide — 23 tests averaging ~1,800 characters each.
    // The toy three-fact fixture above is too small to show the saving: the
    // "only the relevant tests" note costs more than the sections it removes.
    const facts = Array.from({ length: 8 }, (_, i) =>
      `{c:'green',tag:'Point ${i}',t:'${'detail '.repeat(20)}',n:'${'caveat '.repeat(10)}'}`).join(',');
    const big = guide(`
const TESTS = [
  { id:'a', name:'Alpha Test', abbr:'ALP', facts:[${facts}] },
  { id:'b', name:'Bravo Test', abbr:'BRV', facts:[${facts}] },
  { id:'c', name:'Charlie Test', abbr:'CHA', facts:[${facts}] }
];
`);
    const { sections } = parseCbatGuide(big);
    const one = renderGuideCorpus(sections, { tests: [sections.TESTS[0]] });
    const all = renderGuideCorpus(sections);

    // Roughly a third, since the fixture is almost entirely test bodies.
    expect(one.length).toBeLessThan(all.length * 0.5);
  });
});
