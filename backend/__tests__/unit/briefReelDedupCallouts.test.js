const { dedupCallouts } = require('../../services/briefReelAi');

function makeTimeline(beats) {
  return { version: 1, totalDurationMs: 10000, actors: [], props: [], beats };
}

describe('dedupCallouts', () => {
  test('drops a later show-text whose tokens largely overlap an earlier one', () => {
    const t = makeTimeline([
      { id: 'b1', textSpan: { start: 0, end: 10 }, durationMs: 3000, actions: [
        { type: 'show-text', params: { text: 'AI-enabled air force planned for the 2030s' } },
      ]},
      { id: 'b2', textSpan: { start: 11, end: 20 }, durationMs: 3000, actions: [
        { type: 'enter', actorId: 'a1', params: { position: 'centre' } },
        { type: 'show-text', params: { text: 'AI-enabled air force must arrive sooner' } },
      ]},
    ]);
    dedupCallouts(t);
    expect(t.beats[0].actions.some(a => a.type === 'show-text')).toBe(true);
    expect(t.beats[1].actions.some(a => a.type === 'show-text')).toBe(false);
    expect(t.beats[1].actions.some(a => a.type === 'enter')).toBe(true); // non-callout actions survive
  });

  test('keeps callouts about distinct concepts', () => {
    const t = makeTimeline([
      { id: 'b1', textSpan: { start: 0, end: 10 }, durationMs: 3000, actions: [
        { type: 'show-stat', params: { value: '+12%', label: 'YoY RAF recruitment' } },
      ]},
      { id: 'b2', textSpan: { start: 11, end: 20 }, durationMs: 3000, actions: [
        { type: 'show-text', params: { text: 'Fast-jet backlog cleared at Cranwell' } },
      ]},
    ]);
    dedupCallouts(t);
    expect(t.beats[0].actions).toHaveLength(1);
    expect(t.beats[1].actions).toHaveLength(1);
  });

  test('protects a callout paired with crossout in the same beat', () => {
    const t = makeTimeline([
      { id: 'b1', textSpan: { start: 0, end: 10 }, durationMs: 3000, actions: [
        { type: 'show-text', params: { text: 'AI-enabled air force planned for 2030s' } },
      ]},
      { id: 'b2', textSpan: { start: 11, end: 20 }, durationMs: 3000, actions: [
        { type: 'show-date', params: { date: '2030s', label: 'original AI-enabled plan' } },
        { type: 'crossout' },
      ]},
    ]);
    dedupCallouts(t);
    // Even though the date label overlaps with b1's tokens, crossout protects it.
    expect(t.beats[1].actions.some(a => a.type === 'show-date')).toBe(true);
    expect(t.beats[1].actions.some(a => a.type === 'crossout')).toBe(true);
  });

  test('drops the third near-duplicate when the section repeats a concept across beats', () => {
    const t = makeTimeline([
      { id: 'b1', textSpan: { start: 0, end: 10 }, durationMs: 3000, actions: [
        { type: 'show-text', params: { text: 'AI-enabled air force' } },
      ]},
      { id: 'b2', textSpan: { start: 11, end: 20 }, durationMs: 3000, actions: [
        { type: 'show-text', params: { text: 'AI-powered uncrewed aircraft sooner' } },
      ]},
      { id: 'b3', textSpan: { start: 21, end: 30 }, durationMs: 3000, actions: [
        { type: 'show-text', params: { text: 'AI air force ready sooner than planned' } },
      ]},
    ]);
    dedupCallouts(t);
    const surviving = t.beats.filter(b => b.actions.some(a => a.type === 'show-text')).length;
    // First callout always survives; aggressive paraphrases later get dropped.
    expect(surviving).toBeLessThan(3);
    expect(t.beats[0].actions.some(a => a.type === 'show-text')).toBe(true);
  });
});
