/**
 * Unit tests for the Clipper reference-guide parser
 * (backend/utils/clipperFactParser.js).
 *
 * Covers:
 *   - array literals are extracted by name and evaluated in isolation
 *   - facts flatten out of all four fact-bearing containers with stable keys
 *   - unknown confidence grades fall back to the most cautious value
 *   - the name blocklist harvests handles from people arrays AND fact refs
 *   - credit lists are split, and role parentheticals stripped
 *   - the real guide still parses (guard against a format change)
 */

const fs = require('fs');
const {
  parseGuideSource,
  parseGuideFile,
  extractArray,
  matchBracket,
  DEFAULT_GUIDE_PATH,
} = require('../../utils/clipperFactParser');

// A miniature stand-in for the guide: same array names and record shapes,
// small enough to assert on exactly.
const FIXTURE = `
<html><body><script>
const ANALYSTS = ['NaturalGem08','Culbert, J'];
const PEOPLE = [ {name:'PilotHamza', sat:true} ];
const STAFF  = [ {name:'Corri', refs:[{u:'Corri',l:12,q:'hello'}]} ];
const FELT   = [ {who:'blitz1031', felt:'x', actual:'y', d:'better', l:903} ];
const HELPED = [ {tool:'CBAT Ready app', who:'Elliot, FlyingSh33p', refs:[{u:'Elliot',l:1,q:'q'}]} ];
const OPEN   = [ {q:'question?', by:'Mighty (only advocate), lottie (enquirer)', l:5} ];
const TESTS = [
 { id:'flag', name:'Figures, Logistics and Groups', abbr:'FLAG',
   facts:[
     {c:'green',tag:'Real test',t:'Only circled aircraft matter.',why:'Confirmed twice.',refs:[{u:'Mac',l:100,q:'quote here'}]},
     {c:'amber',tag:'Prep',t:'Practise mental arithmetic.',why:'One source.',refs:[]}
   ] }
];
const DAY_GROUPS = [ { id:'day1', title:'The day itself', facts:[ {c:'red',tag:'Rumour',t:'Unverified claim.',why:'Nobody confirmed.',refs:[]} ] } ];
const APPS  = [ { id:'cbatready', name:'CBAT Ready', facts:[ {c:'green',tag:'App',t:'Good UI familiarity.',why:'Many users.',refs:[]} ] } ];
const OTHER = [ { id:'rn', flag:'Royal Navy', facts:[ {c:'weird',tag:'X',t:'Odd grade value.',why:'',refs:[]} ] } ];
document.body.innerHTML = '<p>render code that must never run</p>';
</script></body></html>
`;

describe('matchBracket / extractArray', () => {
  it('balances brackets that appear inside string content', () => {
    const src = `const A = ['a ] b', "c [ d", \`e ] f\`];`;
    const lit = matchBracket(src, src.indexOf('['));
    expect(lit).toBe(`['a ] b', "c [ d", \`e ] f\`]`);
  });

  it('evaluates an extracted literal without running surrounding code', () => {
    // `document` is undefined in the sandbox, so if the render line at the end
    // of the fixture were being evaluated this would throw.
    const arr = extractArray(FIXTURE, 'ANALYSTS');
    expect(arr).toEqual(['NaturalGem08', 'Culbert, J']);
  });

  it('returns null for an array that is not present', () => {
    expect(extractArray(FIXTURE, 'NOT_A_REAL_ARRAY')).toBeNull();
  });
});

describe('parseGuideSource', () => {
  const parsed = parseGuideSource(FIXTURE);

  it('flattens facts from all four fact-bearing containers', () => {
    const kinds = parsed.facts.map(f => f.sourceKind);
    expect(kinds).toEqual(expect.arrayContaining(['test', 'day', 'app', 'other']));
    expect(parsed.counts.total).toBe(5);
  });

  it('builds stable, unique fact keys', () => {
    const keys = parsed.facts.map(f => f.factKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('test:flag:0');
    expect(keys).toContain('test:flag:1');
    expect(keys).toContain('other:rn:0');
  });

  it('carries container provenance onto each fact', () => {
    const f = parsed.facts.find(x => x.factKey === 'test:flag:0');
    expect(f.containerName).toBe('Figures, Logistics and Groups');
    expect(f.containerAbbr).toBe('FLAG');
    expect(f.grade).toBe('green');
    expect(f.refCount).toBe(1);
  });

  it('treats an unrecognised grade as red rather than trusting it', () => {
    const f = parsed.facts.find(x => x.factKey === 'other:rn:0');
    expect(f.grade).toBe('red');
  });

  it('gives identical content the same hash and different content a different one', () => {
    const again = parseGuideSource(FIXTURE);
    const a = parsed.facts.find(f => f.factKey === 'test:flag:0');
    const b = again.facts.find(f => f.factKey === 'test:flag:0');
    expect(a.contentHash).toBe(b.contentHash);

    const edited = parseGuideSource(FIXTURE.replace('Only circled aircraft matter.', 'Changed.'));
    const c = edited.facts.find(f => f.factKey === 'test:flag:0');
    expect(c.contentHash).not.toBe(a.contentHash);
  });

  it('harvests names from the people arrays and from fact refs', () => {
    // Straight from ANALYSTS / PEOPLE / STAFF / FELT
    expect(parsed.blocklist).toEqual(expect.arrayContaining([
      'NaturalGem08', 'PilotHamza', 'Corri', 'blitz1031',
    ]));
    // Only reachable via a fact's refs[].u
    expect(parsed.blocklist).toContain('Mac');
  });

  it('splits credit lists and strips role parentheticals', () => {
    expect(parsed.blocklist).toEqual(expect.arrayContaining(['Elliot', 'FlyingSh33p']));
    expect(parsed.blocklist).toContain('Mighty');
    expect(parsed.blocklist).toContain('lottie');
    // The combined credit string itself is noise and must not be kept.
    expect(parsed.blocklist).not.toContain('Elliot, FlyingSh33p');
    expect(parsed.blocklist.some(n => n.includes('('))).toBe(false);
  });

  it('throws when the source yields no facts', () => {
    expect(() => parseGuideSource('<html>nothing here</html>')).toThrow(/No facts extracted/);
  });

  it('throws on empty input', () => {
    expect(() => parseGuideSource('')).toThrow(/empty/i);
  });
});

// The parser targets a specific real file. If the guide is regenerated in a
// different shape this test fails loudly rather than the feature quietly
// producing zero facts.
const guideExists = fs.existsSync(DEFAULT_GUIDE_PATH);
const describeIfGuide = guideExists ? describe : describe.skip;

describeIfGuide('the real public CBAT guide', () => {
  const parsed = guideExists ? parseGuideFile() : null;

  it('parses into a sensible number of graded facts', () => {
    expect(parsed.counts.total).toBeGreaterThan(100);
    expect(parsed.counts.green).toBeGreaterThan(0);
    expect(parsed.counts.amber).toBeGreaterThan(0);
    expect(new Set(parsed.facts.map(f => f.factKey)).size).toBe(parsed.counts.total);
  });

  it('reads the rationale from the public guide\'s `n` field', () => {
    // The public edition folds the "why" narrative into `n` and ships no refs,
    // so a parser that only understood `why` would silently lose all of it.
    const withWhy = parsed.facts.filter(f => f.why.length > 0);
    expect(withWhy.length).toBeGreaterThan(parsed.counts.total * 0.8);
  });

  // The whole point of using the public edition is that it names nobody. If a
  // handle ever shows up here, we are reading the wrong file.
  it('yields no real handles', () => {
    expect(parsed.blocklist).toEqual([]);
  });

  it('points at the public guide, never the private one', () => {
    expect(DEFAULT_GUIDE_PATH).toMatch(/Public\.html$/i);
  });
});
