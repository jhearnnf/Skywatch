/**
 * Unit tests for caption alignment (backend/utils/clipperCaptions.js).
 *
 * The behaviour under test is the one that makes captions usable: we already
 * know what was said, so whisper is consulted only for WHEN a word was spoken,
 * never for WHICH word it was.
 */

const { buildCaptions, alignBeat, alignTokens, normalise } = require('../../utils/clipperCaptions');

const w = (text, startMs, endMs) => ({ text, startMs, endMs });

describe('normalise', () => {
  it('strips punctuation and case so whisper styling cannot cause a mismatch', () => {
    expect(normalise('Aircraft,')).toBe('aircraft');
    expect(normalise('"CBAT"')).toBe('cbat');
    expect(normalise('12%')).toBe('12');
  });
});

describe('alignBeat', () => {
  it('uses whisper timings but the script spelling', () => {
    // The headline case: whisper mishears "CBAT" as "see bat". The caption must
    // still read CBAT, positioned where whisper heard those sounds.
    const aligned = alignBeat('The CBAT is hard', [
      w('The', 0, 200), w('see', 200, 400), w('bat', 400, 600), w('is', 600, 750), w('hard', 750, 950),
    ]);

    expect(aligned.map(a => a.text)).toEqual(['The', 'CBAT', 'is', 'hard']);
    // "is" and "hard" matched, so they keep their measured times exactly.
    expect(aligned[2]).toMatchObject({ startMs: 600, endMs: 750 });
    expect(aligned[3]).toMatchObject({ startMs: 750, endMs: 950 });
  });

  it('never emits a word whisper invented', () => {
    const aligned = alignBeat('Only circled aircraft', [
      w('Only', 0, 200), w('circled', 200, 400), w('aircraft', 400, 600), w('um', 600, 700),
    ]);
    expect(aligned.map(a => a.text)).toEqual(['Only', 'circled', 'aircraft']);
  });

  it('takes exact timings when every word matches', () => {
    const aligned = alignBeat('one two three', [w('one', 0, 300), w('two', 300, 600), w('three', 600, 900)]);
    expect(aligned).toEqual([
      { text: 'one', startMs: 0, endMs: 300 },
      { text: 'two', startMs: 300, endMs: 600 },
      { text: 'three', startMs: 600, endMs: 900 },
    ]);
  });

  it('interpolates across words whisper dropped entirely', () => {
    const aligned = alignBeat('alpha bravo charlie delta', [w('alpha', 0, 200), w('delta', 800, 1000)]);
    expect(aligned.map(a => a.text)).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    // The two missing words share the gap rather than piling up at one instant.
    expect(aligned[1].startMs).toBe(200);
    expect(aligned[2].startMs).toBeGreaterThan(aligned[1].startMs);
    expect(aligned[3].startMs).toBe(800);
  });

  it('spreads the line evenly when whisper returns nothing', () => {
    const aligned = alignBeat('one two three four', [], { fallbackDurationMs: 4000 });
    expect(aligned).toHaveLength(4);
    expect(aligned[0].startMs).toBe(0);
    expect(aligned[3].endMs).toBe(4000);
  });

  it('keeps timings monotonic even when whisper overlaps spans', () => {
    // A highlight that jumps backwards is very visible.
    const aligned = alignBeat('one two', [w('one', 0, 500), w('two', 300, 700)]);
    expect(aligned[1].startMs).toBeGreaterThanOrEqual(aligned[0].endMs);
  });

  it('handles an empty line', () => {
    expect(alignBeat('', [w('x', 0, 1)])).toEqual([]);
  });

  it('preserves script punctuation in the caption text', () => {
    const aligned = alignBeat("Don't panic.", [w('dont', 0, 300), w('panic', 300, 600)]);
    expect(aligned.map(a => a.text)).toEqual(["Don't", 'panic.']);
  });
});

describe('alignTokens', () => {
  it('marks a substitution as unmatched rather than borrowing its timing', () => {
    const pairs = alignTokens(['cbat'], ['seebat']);
    expect(pairs).toEqual([{ scriptIndex: 0, whisperIndex: null }]);
  });

  it('returns one entry per script token regardless of transcript length', () => {
    expect(alignTokens(['a', 'b', 'c'], [])).toHaveLength(3);
    expect(alignTokens(['a'], ['x', 'y', 'z'])).toHaveLength(1);
  });
});

describe('buildCaptions', () => {
  const script = {
    script: { beats: [
      { id: 'b1', text: 'Only circled aircraft' },
      { id: 'b2', text: 'Ignore the rest' },
    ] },
    voice: { lines: [
      { beatId: 'b1', startMs: 0,    durationMs: 1500 },
      { beatId: 'b2', startMs: 1500, durationMs: 1200 },
    ] },
    outro: { enabled: true, copy: 'More tips' },
  };

  it('offsets each beat by where its narration starts', () => {
    const rows = buildCaptions(script, {
      b1: [w('Only', 0, 400), w('circled', 400, 900), w('aircraft', 900, 1400)],
      b2: [w('Ignore', 0, 400), w('the', 400, 600), w('rest', 600, 1100)],
    });

    const b2 = rows.filter(r => r.beatId === 'b2');
    // b2's audio starts at 1500ms, so its first word lands there, not at 0.
    expect(b2[0].startMs).toBe(1500);
    expect(b2[2].endMs).toBe(2600);
  });

  it('captions the outro too', () => {
    const withOutro = {
      ...script,
      voice: { lines: [...script.voice.lines, { beatId: 'outro', startMs: 2700, durationMs: 900 }] },
    };
    const rows = buildCaptions(withOutro, {});
    expect(rows.some(r => r.beatId === 'outro')).toBe(true);
  });

  it('skips beats that were never narrated', () => {
    const rows = buildCaptions({ ...script, voice: { lines: [script.voice.lines[0]] } }, {});
    expect(rows.every(r => r.beatId === 'b1')).toBe(true);
  });

  it('tags every row with its beat so the timeline can rebase it', () => {
    const rows = buildCaptions(script, {});
    expect(rows.every(r => typeof r.beatId === 'string' && r.beatId.length > 0)).toBe(true);
  });
});
