/**
 * clipperFootageRelevance.test.js
 *
 * Footage used to arrive in the order the providers answered in: three searches
 * interleaved, first eighteen kept. A clip's position in the strip therefore
 * recorded which API was quickest and nothing about whether it suited the line
 * it would play under - and an admin choosing left to right mostly took
 * whatever landed first. That is why finished videos did not match their words.
 *
 * These pin the ranking that replaced it.
 */

const {
  rankCandidates, scoreCandidate, relevanceTokens, interleave,
} = require('../../utils/clipperFootage');

const clip = (provider, title, extra = {}) => ({ provider, title, ...extra });

const tokens = (s) => relevanceTokens(s);

describe('relevanceTokens', () => {
  it('drops words that would match everything', () => {
    expect(tokens('a free stock video of the cockpit')).toEqual(['cockpit']);
  });

  it('ignores fragments too short to mean anything', () => {
    expect(tokens('f 16 jet')).toEqual(['jet']);
  });
});

describe('scoreCandidate', () => {
  const q = tokens('cockpit instrument panel');

  it('rates a clip that names the query above one that names nothing', () => {
    const named = scoreCandidate(clip('pixabay', 'Pixabay: cockpit panel aircraft'), q, []);
    const blank = scoreCandidate(clip('pexels',  'Pexels clip by Jane'), q, []);
    expect(named).toBeGreaterThan(blank);
  });

  // The query names the thing to film; the beat text is the line it sits under.
  // Matching the line is a bonus, not the job - otherwise a beat about "sixty
  // seconds" pulls up clocks ahead of the aircraft the query asked for.
  it('weighs the query far above the beat text', () => {
    const onQuery = scoreCandidate(clip('pexels', 'cockpit'), q, tokens('runway'));
    const onBeat  = scoreCandidate(clip('pexels', 'runway'),  q, tokens('runway'));
    expect(onQuery).toBeGreaterThan(onBeat);
  });

  // Both are terser about themselves than Pixabay is, and both are likelier to
  // belong on this channel, so a small prior stops them sinking for it.
  it('gives the curated library and DVIDS a head start', () => {
    const lib   = scoreCandidate(clip('library', 'Typhoon takeoff'), tokens('hangar'), []);
    const stock = scoreCandidate(clip('pexels',  'Typhoon takeoff'), tokens('hangar'), []);
    expect(lib).toBeGreaterThan(stock);
  });

  it('prefers a clip already shaped for a 9:16 frame', () => {
    const tall = scoreCandidate(clip('pexels', 'jet', { width: 1080, height: 1920 }), [], []);
    const wide = scoreCandidate(clip('pexels', 'jet', { width: 1920, height: 1080 }), [], []);
    expect(tall).toBeGreaterThan(wide);
  });
});

describe('rankCandidates', () => {
  it('puts the clip that answers the beat first', () => {
    const ranked = rankCandidates([
      clip('pexels',  'Pexels clip by Bob'),
      clip('pexels',  'Pexels clip by Jane'),
      clip('pixabay', 'Pixabay: radar screen air traffic control'),
    ], { queryTokens: tokens('air traffic control radar screen'), beatTokens: [] });

    expect(ranked[0].title).toMatch(/radar/);
  });

  // An admin scanning left to right should still see the range available, so
  // relevance orders the strip without one provider taking all of it.
  it('does not let one provider take the whole strip', () => {
    const ranked = rankCandidates([
      clip('pixabay', 'Pixabay: cockpit one'),
      clip('pixabay', 'Pixabay: cockpit two'),
      clip('pixabay', 'Pixabay: cockpit three'),
      clip('pexels',  'Pexels clip by Jane'),
    ], { queryTokens: tokens('cockpit'), beatTokens: [] });

    expect(ranked[1].provider).toBe('pexels');
  });

  it('keeps the provider order stable when nothing scores', () => {
    const input = [clip('pexels', 'one'), clip('pexels', 'two')];
    expect(rankCandidates(input, { queryTokens: [], beatTokens: [] })).toEqual(input);
  });

  it('still interleaves the way the strip always did', () => {
    expect(interleave([[1, 3], [2, 4]])).toEqual([1, 2, 3, 4]);
  });
});
