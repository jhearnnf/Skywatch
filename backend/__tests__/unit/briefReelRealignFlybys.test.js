const { realignFlybys } = require('../../services/briefReelAi');

function makeTimeline(beats) {
  return { version: 1, totalDurationMs: 10000, actors: [], props: [], beats };
}

describe('realignFlybys', () => {
  test('moves a flyby off a non-aircraft closing beat onto the beat whose textSpan mentions aircraft', () => {
    const body = 'The chief spoke. Drones now fly sooner. He waved goodbye.';
    //            0               16                   42
    const t = makeTimeline([
      { id: 'b1', textSpan: { start: 0,  end: 16 }, durationMs: 3000, actions: [{ type: 'show-text', params: { text: 'Speaks' } }] },
      { id: 'b2', textSpan: { start: 17, end: 41 }, durationMs: 3000, actions: [{ type: 'show-text', params: { text: 'Drones now fly sooner' } }] },
      { id: 'b3', textSpan: { start: 42, end: body.length }, durationMs: 3000, actions: [{ type: 'show-text', params: { text: 'Closing' } }, { type: 'flyby' }] },
    ]);
    realignFlybys(t, body);
    expect(t.beats[2].actions.some(a => a.type === 'flyby')).toBe(false);
    expect(t.beats[1].actions.some(a => a.type === 'flyby')).toBe(true);
  });

  test('leaves a flyby alone when it is already on an aircraft beat', () => {
    const body = 'Typhoon jets scrambled to intercept the bomber.';
    const t = makeTimeline([
      { id: 'b1', textSpan: { start: 0, end: body.length }, durationMs: 3000, actions: [{ type: 'flyby' }] },
    ]);
    realignFlybys(t, body);
    expect(t.beats[0].actions).toHaveLength(1);
    expect(t.beats[0].actions[0].type).toBe('flyby');
  });

  test('drops the flyby entirely when no beat mentions aircraft', () => {
    const body = 'The recruitment policy was revised this quarter.';
    const t = makeTimeline([
      { id: 'b1', textSpan: { start: 0, end: 25 }, durationMs: 3000, actions: [{ type: 'show-text', params: { text: 'Policy revised' } }] },
      { id: 'b2', textSpan: { start: 26, end: body.length }, durationMs: 3000, actions: [{ type: 'flyby' }] },
    ]);
    realignFlybys(t, body);
    expect(t.beats[1].actions.some(a => a.type === 'flyby')).toBe(false);
    expect(t.beats[0].actions.some(a => a.type === 'flyby')).toBe(false);
  });

  test('does not match aircraft keywords inside other words ("craftsman" is not "aircraft")', () => {
    const body = 'The craftsman watched as the policy was signed.';
    const t = makeTimeline([
      { id: 'b1', textSpan: { start: 0, end: body.length }, durationMs: 3000, actions: [{ type: 'flyby' }] },
    ]);
    realignFlybys(t, body);
    expect(t.beats[0].actions.some(a => a.type === 'flyby')).toBe(false);
  });
});
