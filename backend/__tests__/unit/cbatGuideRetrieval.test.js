/**
 * Guide retrieval — which slice of the guide a question needs.
 *
 * The whole guide is ~15,000 tokens and was going out on every question: about
 * $0.015 of input per reply, ~95% of the measured cost, to answer something
 * about one test. These cover the two things that must hold for that to be
 * safe — the right sections get picked, and anything unrecognised falls back to
 * the full guide rather than to a slice that happens to contain nothing.
 */
const {
  scoreTest, selectTests, selectGuideSlice, looksCoreOnly,
} = require('../../utils/cbatGuideRetrieval');

const test_ = (name, abbr, aka = null) => ({ name, abbr, aka, facts: [] });

const SECTIONS = {
  TESTS: [
    test_('Figures, Logistics and Groups', 'FLAG', '"the triangles one"'),
    test_('Cognitive Updating Test', 'CUT'),
    test_('Rapid Tracking Test', 'RTT'),
    test_('Auditory Capacity Test', 'ACT'),
    test_('Verbal Logic Test', 'VLT'),
  ],
};

const picked = (q) => {
  const { tests, full } = selectGuideSlice(SECTIONS, q);
  return full ? 'FULL' : (tests.length ? tests.map(t => t.abbr).join(',') : 'CORE');
};

describe('scoreTest', () => {
  it('matches an abbreviation on a word boundary', () => {
    expect(scoreTest(SECTIONS.TESTS[0], 'what does FLAG involve')).toBeGreaterThan(0);
    // Not a substring match: "flagship" is not the FLAG test.
    expect(scoreTest(SECTIONS.TESTS[0], 'the flagship of the fleet')).toBe(0);
  });

  it('matches the full name and the nickname', () => {
    expect(scoreTest(SECTIONS.TESTS[0], 'tell me about figures, logistics and groups')).toBeGreaterThan(0);
    expect(scoreTest(SECTIONS.TESTS[0], 'what is the triangles one')).toBeGreaterThan(0);
  });

  it('is case-insensitive', () => {
    expect(scoreTest(SECTIONS.TESTS[1], 'how hard is the cut')).toBeGreaterThan(0);
  });

  it('does not fire on the words every test name shares', () => {
    // Without stopwords, "what is the test about" matches everything called
    // "... Test" — which is nearly all of them.
    for (const t of SECTIONS.TESTS) {
      expect(scoreTest(t, 'what is the test about')).toBe(0);
    }
  });
});

describe('selectTests', () => {
  it('returns the named test only', () => {
    expect(picked('what does FLAG involve?')).toBe('FLAG');
  });

  it('returns several when several are named', () => {
    expect(picked('how does FLAG compare to the CUT').split(',').sort()).toEqual(['CUT', 'FLAG']);
  });

  it('caps how many one question can pull in', () => {
    const out = selectTests(SECTIONS, 'FLAG CUT RTT ACT VLT');
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it('returns null when no test is named', () => {
    expect(selectTests(SECTIONS, 'what happens on the day')).toBeNull();
  });
});

describe('core-only questions', () => {
  // These name no test, so before core-topic routing they fell through to the
  // full-guide fallback — and they are among the most commonly asked.
  it.each([
    'how many tests are there',
    'what tests are in it',
    'what happens on the assessment day',
    'is the australian one the same',
    'does the navy use it too',
    'what should I practise with',
    'any books that helped',
  ])('answers "%s" from the core alone', (q) => {
    expect(looksCoreOnly(q)).toBe(true);
    expect(picked(q)).toBe('CORE');
  });
});

describe('the fallback', () => {
  it('sends the whole guide when nothing matches', () => {
    // Guessing at a slice here risks answering "I don't have that" about
    // something the guide does cover, which is the failure that matters.
    expect(picked('whats the hardest bit')).toBe('FULL');
    expect(picked('any advice')).toBe('FULL');
  });

  it('sends the whole guide when there are no parsed tests at all', () => {
    expect(selectGuideSlice({}, 'anything').full).toBe(true);
    expect(selectGuideSlice({ TESTS: [] }, 'anything').full).toBe(true);
  });

  it('prefers a named test over the core, when the question does both', () => {
    // "how many questions in FLAG" is about FLAG, not about the roster.
    expect(picked('how many questions are in FLAG')).toBe('FLAG');
  });
});
