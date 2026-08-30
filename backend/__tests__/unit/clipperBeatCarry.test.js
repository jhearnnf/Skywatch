/**
 * clipperBeatCarry.test.js
 *
 * Beat ids are positional, so a regenerated script reuses b1, b2, b3… for
 * completely different lines. Every stage after the script is keyed by beat id,
 * which meant a rewrite quietly re-attached the previous script's work to
 * whatever line now sat in that slot.
 *
 * The failure that prompted these: a FLAG script regenerated with capture beats
 * at b2 and b5 showed the earlier script's Pexels jet clips there. The footage
 * stage offered no gameplay, and nothing said a recording was missing.
 */

const {
  beatFingerprint, planBeatCarry, pruneFootage, pruneVoice, pruneBeatRows, placeVoiceLines,
} = require('../../utils/clipperBeatCarry');

const stockBeat = (id, text, query = 'fighter jet') => ({
  id, text, visual: { kind: 'stock', query, recipeId: '' },
});

const captureBeat = (id, text, recipeId = 'play-flag') => ({
  id, text, visual: { kind: 'capture', query: '', recipeId },
});

const stockClip = { provider: 'pexels',  playbackUrl: 'clip.mp4' };
const recording = { provider: 'capture', playbackUrl: 'file:///tmp/flag.mp4' };

describe('beatFingerprint', () => {
  it('ignores fields no stage was built from', () => {
    const a = { ...stockBeat('b1', 'Line one.'), factKeys: ['x'], sfxCue: 'whoosh' };
    const b = { ...stockBeat('b1', 'Line one.'), factKeys: ['y'], sfxCue: '' };
    expect(beatFingerprint(a)).toBe(beatFingerprint(b));
  });

  it('separates beats whose visual instruction changed', () => {
    expect(beatFingerprint(stockBeat('b1', 'Line one.')))
      .not.toBe(beatFingerprint(captureBeat('b1', 'Line one.')));
  });
});

describe('planBeatCarry', () => {
  it('keeps a beat that came back unchanged', () => {
    const plan = planBeatCarry([stockBeat('b1', 'Same line.')], [stockBeat('b1', 'Same line.')]);
    expect([...plan.keep]).toEqual(['b1']);
    expect([...plan.keepRecording]).toEqual([]);
  });

  it('keeps nothing when the id was reused for another line', () => {
    const plan = planBeatCarry([stockBeat('b1', 'Old line.')], [stockBeat('b1', 'New line.')]);
    expect([...plan.keep]).toEqual([]);
    expect([...plan.keepRecording]).toEqual([]);
  });

  it('keeps the recording when only the words over it changed', () => {
    const plan = planBeatCarry([captureBeat('b2', 'Old line.')], [captureBeat('b2', 'New line.')]);
    expect([...plan.keepRecording]).toEqual(['b2']);
  });

  it('will not carry a recording of a different game', () => {
    const plan = planBeatCarry(
      [captureBeat('b2', 'Old line.', 'play-dpt')],
      [captureBeat('b2', 'New line.', 'play-flag')],
    );
    expect([...plan.keepRecording]).toEqual([]);
  });

  it('keeps nothing for a beat the rewrite dropped', () => {
    const plan = planBeatCarry([stockBeat('b3', 'Gone.')], []);
    expect(plan.keep.size).toBe(0);
  });
});

describe('pruneFootage', () => {
  it('drops the clip a rewritten line inherited', () => {
    const previous = [stockBeat('b1', 'Old line.')];
    const next     = [stockBeat('b1', 'New line.', 'radar screen')];
    const footage  = { b1: { term: 'fighter jet', candidates: [stockClip], chosen: stockClip } };

    expect(pruneFootage(footage, planBeatCarry(previous, next), next)).toEqual({});
  });

  // The reported bug, in one assertion.
  it('never leaves a capture beat holding a stock clip', () => {
    const previous = [stockBeat('b2', 'Old line.')];
    const next     = [captureBeat('b2', 'New line.')];
    const footage  = { b2: { term: 'fighter jet', candidates: [stockClip], chosen: stockClip } };

    expect(pruneFootage(footage, planBeatCarry(previous, next), next)).toEqual({});
  });

  it('strips a stock clip from an otherwise unchanged capture beat', () => {
    const beats   = [captureBeat('b2', 'Same line.')];
    const footage = { b2: { term: 'jets', candidates: [stockClip], chosen: stockClip } };

    const out = pruneFootage(footage, planBeatCarry(beats, beats), beats);
    expect(out.b2.chosen).toBeNull();
  });

  it('keeps a recording, and its trim, across a reworded line', () => {
    const previous = [captureBeat('b2', 'Old line.')];
    const next     = [captureBeat('b2', 'New line.')];
    const footage  = {
      b2: { chosen: recording, trim: { startSec: 4 }, term: 'x', candidates: [stockClip] },
    };

    const out = pruneFootage(footage, planBeatCarry(previous, next), next);
    expect(out.b2).toEqual({ chosen: recording, trim: { startSec: 4 } });
  });

  it('leaves an untouched beat exactly as it was', () => {
    const beats = [stockBeat('b1', 'Same line.')];
    const entry = { term: 'fighter jet', candidates: [stockClip], chosen: stockClip };
    const out   = pruneFootage({ b1: entry }, planBeatCarry(beats, beats), beats);
    expect(out.b1).toBe(entry);
  });
});

describe('pruneVoice', () => {
  const line = (beatId, durationMs) => ({ beatId, durationMs, wavPath: beatId + '.wav', startMs: 999 });

  it('drops the take of a line that no longer exists and rebases the rest', () => {
    const previous = [stockBeat('b1', 'One.'), stockBeat('b2', 'Two.')];
    const next     = [stockBeat('b1', 'One.'), stockBeat('b2', 'Rewritten.')];
    const voice    = {
      profileId: 'v1',
      lines: [line('b1', 1000), line('b2', 2000), line('outro', 500)],
    };

    const out = pruneVoice(voice, planBeatCarry(previous, next), next, true);

    expect(out.lines.map(l => l.beatId)).toEqual(['b1', 'outro']);
    expect(out.lines.map(l => l.startMs)).toEqual([0, 1000]);
    expect(out.totalDurationMs).toBe(1500);
    expect(out.profileId).toBe('v1');
  });

  it('will not keep a recipe-matched capture beat take - the words changed', () => {
    const previous = [captureBeat('b2', 'Old line.')];
    const next     = [captureBeat('b2', 'New line.')];
    const out = pruneVoice({ lines: [line('b2', 900)] }, planBeatCarry(previous, next), next, false);
    expect(out.lines).toEqual([]);
  });

  it('drops the outro take when the outro copy was rewritten', () => {
    const beats = [stockBeat('b1', 'One.')];
    const out = pruneVoice({ lines: [line('outro', 500)] }, planBeatCarry(beats, beats), beats, false);
    expect(out.lines).toEqual([]);
  });

  it('leaves a script that was never narrated alone', () => {
    expect(pruneVoice(null, planBeatCarry([], []), [], false)).toBeNull();
  });
});

describe('placeVoiceLines', () => {
  it('lays lines out in beat order, whatever order they arrived in', () => {
    const lines = [
      { beatId: 'outro', durationMs: 500 },
      { beatId: 'b2',    durationMs: 2000 },
      { beatId: 'b1',    durationMs: 1000 },
      { beatId: 'ghost', durationMs: 9000 },
    ];
    const { lines: placed, totalDurationMs } = placeVoiceLines(lines, ['b1', 'b2', 'outro']);

    expect(placed.map(l => l.beatId)).toEqual(['b1', 'b2', 'outro']);
    expect(placed.map(l => l.startMs)).toEqual([0, 1000, 3000]);
    expect(totalDurationMs).toBe(3500);
  });
});

describe('pruneBeatRows', () => {
  const plan = planBeatCarry([stockBeat('b1', 'Same.')], [stockBeat('b1', 'Same.')]);

  it('keeps rows on surviving beats and drops the rest', () => {
    const rows = [{ beatId: 'b1', sfxId: 'whoosh' }, { beatId: 'b2', sfxId: 'impact' }];
    expect(pruneBeatRows(rows, plan)).toEqual([{ beatId: 'b1', sfxId: 'whoosh' }]);
  });

  it('keeps outro rows only when the outro survived', () => {
    const rows = [{ beatId: 'outro', text: 'skywatch.academy' }];
    expect(pruneBeatRows(rows, plan, ['outro'])).toEqual(rows);
    expect(pruneBeatRows(rows, plan)).toEqual([]);
  });
});
