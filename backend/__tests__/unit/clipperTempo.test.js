/**
 * Tempo detection (backend/utils/clipperTempo.js).
 *
 * The number is used to land the cuts inside a beat on the music. Beat
 * boundaries themselves are set by the narration and never move, so the worst a
 * wrong tempo can do is put a cut somewhere arbitrary — which is where it was
 * before this existed. That is why "no answer" is an acceptable answer here and
 * a confidently wrong one is not.
 *
 * Measured against synthetic click tracks rather than real music: a click track
 * has a tempo we know exactly, and the failure being guarded against is a
 * number that looks authoritative and is not.
 */

const {
  bpmFromEnvelope, onsetEnvelope, refinePeak, SAMPLE_RATE, MIN_CONFIDENCE,
} = require('../../utils/clipperTempo');

// Raw mono PCM of a click track: a short decaying burst on every beat, with a
// little noise under it so nothing depends on a perfectly silent gap.
function clickTrack(bpm, seconds, { offbeat = false } = {}) {
  const n = SAMPLE_RATE * seconds;
  const buf = Buffer.alloc(n * 2);
  const period = (60 / bpm) * SAMPLE_RATE;

  for (let i = 0; i < n; i++) {
    const onBeat = i % period;
    const offBeat = (i + period / 2) % period;

    let env = onBeat < 400 ? Math.exp(-onBeat / 90) : 0;
    if (offbeat && offBeat < 200) env += 0.4 * Math.exp(-offBeat / 50);

    // Deterministic "noise": a fixed jitter, so a failure is reproducible.
    const noise = ((i * 2654435761) % 1000) / 1000 - 0.5;
    const v = env * Math.sin(i * 0.9) * 0.8 + noise * 0.02;
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  return buf;
}

const measure = (bpm, opts) => bpmFromEnvelope(onsetEnvelope(clickTrack(bpm, 30, opts)));

describe('bpmFromEnvelope', () => {
  it.each([60, 75, 90, 100, 120, 128, 140, 150])('measures a %ibpm pulse', (bpm) => {
    const result = measure(bpm);
    expect(result.bpm).toBeGreaterThan(bpm - 2);
    expect(result.bpm).toBeLessThan(bpm + 2);
    expect(result.confidence).toBeGreaterThan(MIN_CONFIDENCE);
  });

  // Hats on the off-beat are the classic way to trick a tracker into reporting
  // double tempo, which is the one direction of error that matters.
  it('is not fooled into double tempo by off-beat hits', () => {
    for (const bpm of [90, 120, 140]) {
      expect(measure(bpm, { offbeat: true }).bpm).toBeLessThan(bpm * 1.5);
    }
  });

  // A half-tempo answer is every other real beat, so a cut snapped to it still
  // lands on the music. Double tempo would put half its lines between beats,
  // and that is the error worth ruling out.
  it('never errs fast', () => {
    for (const bpm of [60, 70, 75, 90, 174]) {
      const measured = measure(bpm).bpm;
      if (measured) expect(measured).toBeLessThan(bpm * 1.2);
    }
  });

  it('declines to guess at silence', () => {
    const silence = Buffer.alloc(SAMPLE_RATE * 2 * 10);
    const result = bpmFromEnvelope(onsetEnvelope(silence));
    expect(result.bpm).toBeNull();
    expect(result.reason).toBeTruthy();
  });

  it('declines to guess at a clip too short to hold a pulse', () => {
    const result = bpmFromEnvelope(onsetEnvelope(clickTrack(120, 1)));
    expect(result.bpm).toBeNull();
    expect(result.reason).toMatch(/short/);
  });

  it('gives an empty envelope no opinion at all', () => {
    expect(bpmFromEnvelope([]).bpm).toBeNull();
    expect(onsetEnvelope(Buffer.alloc(0))).toEqual([]);
  });
});

describe('onsetEnvelope', () => {
  // A drop in level is the tail of a sound, not the start of one. Keeping it
  // smears every onset across the decay that follows.
  it('keeps rises in energy and discards falls', () => {
    const env = onsetEnvelope(clickTrack(120, 5));
    expect(env.length).toBeGreaterThan(0);
    expect(Array.from(env).every(v => v >= 0)).toBe(true);
    expect(Math.max(...env)).toBeGreaterThan(0);
  });
});

describe('refinePeak', () => {
  // Without interpolation the answer is quantised to whole envelope frames,
  // which at fast tempos is several bpm.
  it('reads a peak between two samples', () => {
    // Symmetric around index 10, so the true peak is exactly there.
    expect(refinePeak([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 1], 10)).toBeCloseTo(10, 5);
    // Leaning right: the peak sits past the sampled maximum.
    expect(refinePeak([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 1.8], 10)).toBeGreaterThan(10);
  });

  it('leaves a flat neighbourhood where it found it', () => {
    expect(refinePeak([0, 0, 0, 1, 1, 1], 4)).toBe(4);
  });
});
