/**
 * Unit tests for the render timeline builder (backend/utils/clipperTimeline.js).
 *
 * This is the only place beat timing is decided, so the preview, the render and
 * the captions cannot disagree. Everything here is about that guarantee.
 */

const {
  buildTimeline, buildCaptionPages, clampTrimIn, pathToFileUrl, MIN_BEAT_MS,
} = require('../../utils/clipperTimeline');

const script = (over = {}) => ({
  script: {
    beats: [
      { id: 'b1', text: 'One.', visual: { kind: 'stock' }, overlay: 'FIRST' },
      { id: 'b2', text: 'Two.', visual: { kind: 'stock' }, overlay: '' },
    ],
  },
  footage: {
    b1: { chosen: { downloadUrl: 'a.mp4' }, trim: { inMs: 500 } },
    b2: { chosen: null },
  },
  voice: { lines: [
    { beatId: 'b1', durationMs: 3000, startMs: 0,    audioUrl: 'a.wav' },
    { beatId: 'b2', durationMs: 4000, startMs: 3000, audioUrl: 'b.wav' },
  ] },
  outro: { enabled: false, copy: '' },
  ...over,
});

describe('buildTimeline', () => {
  it('takes each beat duration from the measured narration', () => {
    const t = buildTimeline(script());
    expect(t.beats.map(b => b.durationMs)).toEqual([3000, 4000]);
    expect(t.totalDurationMs).toBe(7000);
  });

  it('falls back to a visible minimum when a beat has no audio yet', () => {
    // Footage should still be previewable before the voice stage has run.
    const t = buildTimeline(script({ voice: null }));
    expect(t.beats.every(b => b.durationMs === MIN_BEAT_MS)).toBe(true);
  });

  it('carries the chosen clip and its trim through', () => {
    const t = buildTimeline(script());
    expect(t.beats[0].videoUrl).toBe('a.mp4');
    expect(t.beats[0].trimInMs).toBe(500);
    expect(t.beats[1].videoUrl).toBeNull();
  });

  // A trim is an offset into one clip for one beat length, and both can move
  // under it — re-record the beat and the clip gets shorter, re-record the
  // voice and the window gets longer. A stale offset seeks past the end and
  // renders a frozen frame, which is the failure trimming exists to avoid.
  it('pulls a trim back when it would seek past the end of the clip', () => {
    const t = buildTimeline(script({
      footage: { b1: { chosen: { downloadUrl: 'a.mp4', durationSec: 4 }, trim: { inMs: 3500 } } },
    }));
    // 4s clip, 3s beat, so the latest usable start is 1s.
    expect(t.beats[0].trimInMs).toBe(1000);
  });

  it('pins to the start when the clip is shorter than the beat', () => {
    const t = buildTimeline(script({
      footage: { b1: { chosen: { downloadUrl: 'a.mp4', durationSec: 2 }, trim: { inMs: 1500 } } },
    }));
    expect(t.beats[0].trimInMs).toBe(0);
  });

  it('leaves the trim alone when the clip length is unknown', () => {
    const t = buildTimeline(script({
      footage: { b1: { chosen: { downloadUrl: 'a.mp4' }, trim: { inMs: 9000 } } },
    }));
    expect(t.beats[0].trimInMs).toBe(9000);
  });
});

describe('clampTrimIn', () => {
  it('keeps an in-point that leaves room for the beat', () => {
    expect(clampTrimIn(2000, 10, 3000)).toBe(2000);
  });

  it('clamps to clip length minus beat length', () => {
    expect(clampTrimIn(9000, 10, 3000)).toBe(7000);
  });

  it('treats a missing or zero clip length as unknown, not as empty', () => {
    expect(clampTrimIn(5000, null, 3000)).toBe(5000);
    expect(clampTrimIn(5000, 0, 3000)).toBe(5000);
  });

  it('never returns a negative offset', () => {
    expect(clampTrimIn(-100, 10, 3000)).toBe(0);
    expect(clampTrimIn(1000, 1, 3000)).toBe(0);
  });

  it('falls back to the script overlay when none was hand-edited', () => {
    const t = buildTimeline(script());
    expect(t.beats[0].overlay.text).toBe('FIRST');
    expect(t.beats[1].overlay).toBeNull();
  });

  it('prefers a hand-edited overlay over the suggestion', () => {
    const t = buildTimeline(script({
      overlays: [{ beatId: 'b1', text: 'EDITED', animation: 'slide' }],
    }));
    expect(t.beats[0].overlay.text).toBe('EDITED');
    expect(t.beats[0].overlay.animation).toBe('slide');
  });

  it('appends the outro as a real end-card beat', () => {
    const t = buildTimeline(script({
      outro: { enabled: true, copy: 'More tips' },
      voice: { lines: [{ beatId: 'outro', durationMs: 2600, startMs: 0, audioUrl: 'o.wav' }] },
    }));
    const last = t.beats[t.beats.length - 1];
    expect(last.id).toBe('outro');
    expect(last.isEndCard).toBe(true);
    expect(last.audioUrl).toBe('o.wav');
  });

  it('rebases caption timings to the start of their own beat', () => {
    // Remotion Sequences are locally timed, so a word 3.4s into the video that
    // belongs to a beat starting at 3.0s must render at 0.4s.
    const t = buildTimeline(script({
      captions: { words: [
        { beatId: 'b2', text: 'Two', startMs: 3400, endMs: 3700 },
      ] },
    }));
    const page = t.beats[1].captionPages[0];
    expect(page.words[0].startMs).toBe(400);
    expect(page.words[0].endMs).toBe(700);
  });

  it('never emits a negative caption time', () => {
    const t = buildTimeline(script({
      captions: { words: [{ beatId: 'b2', text: 'x', startMs: 10, endMs: 20 }] },
    }));
    expect(t.beats[1].captionPages[0].words[0].startMs).toBeGreaterThanOrEqual(0);
  });
});

describe('buildCaptionPages', () => {
  const w = (text, startMs, endMs) => ({ text, startMs, endMs });

  it('groups words a few at a time', () => {
    const pages = buildCaptionPages(
      [w('a', 0, 100), w('b', 100, 200), w('c', 200, 300), w('d', 300, 400), w('e', 400, 500)],
      { maxWords: 4 },
    );
    expect(pages).toHaveLength(2);
    expect(pages[0].words).toHaveLength(4);
    expect(pages[1].words).toHaveLength(1);
  });

  it('breaks a page at a pause in the delivery', () => {
    // Splitting on phrasing keeps captions in step with how the line is spoken.
    const pages = buildCaptionPages(
      [w('a', 0, 100), w('b', 100, 200), w('c', 1500, 1600)],
      { maxWords: 4, maxGapMs: 700 },
    );
    expect(pages).toHaveLength(2);
    expect(pages[1].words[0].text).toBe('c');
  });

  it('spans each page from its first word to its last', () => {
    const pages = buildCaptionPages([w('a', 250, 400), w('b', 400, 900)], { maxWords: 4 });
    expect(pages[0].startMs).toBe(250);
    expect(pages[0].endMs).toBe(900);
  });

  it('returns nothing for no words', () => {
    expect(buildCaptionPages([])).toEqual([]);
  });
});

// The voice stage records only `wavPath` — the agent's job is to put a file on
// disk. Nothing turned that into something playable, so line.audioUrl was
// always undefined and every beat rendered silent, in the preview and the MP4
// alike. Deriving it here rather than in the agent also gives already-narrated
// scripts a voice track without regenerating them.
describe('narration audio', () => {
  const withVoice = (line) => script({
    voice: { lines: [{ beatId: 'b1', durationMs: 3000, startMs: 0, ...line }] },
  });

  it('derives a playable URL from the wav the agent wrote', () => {
    const t = buildTimeline(withVoice({ wavPath: 'C:\\Temp\\skywatch-clipper\\s1\\b1.wav' }));
    expect(t.beats[0].audioUrl).toBe('file:///C:/Temp/skywatch-clipper/s1/b1.wav');
  });

  it('handles POSIX paths', () => {
    const t = buildTimeline(withVoice({ wavPath: '/tmp/skywatch-clipper/s1/b1.wav' }));
    expect(t.beats[0].audioUrl).toBe('file:///tmp/skywatch-clipper/s1/b1.wav');
  });

  it('prefers an explicit audioUrl when the agent supplies one', () => {
    const t = buildTimeline(withVoice({
      wavPath: 'C:\\Temp\\b1.wav',
      audioUrl: 'https://cdn.example.com/b1.wav',
    }));
    expect(t.beats[0].audioUrl).toBe('https://cdn.example.com/b1.wav');
  });

  it('leaves a beat with no narration silent rather than inventing a URL', () => {
    const t = buildTimeline(withVoice({}));
    expect(t.beats[0].audioUrl).toBeNull();
    expect(t.beats[1].audioUrl).toBeNull();
  });

  it('gives the outro its narration too', () => {
    const t = buildTimeline(script({
      outro: { enabled: true, copy: 'More at skywatch.academy' },
      voice: { lines: [{ beatId: 'outro', durationMs: 2000, wavPath: 'C:\\Temp\\outro.wav' }] },
    }));
    const outro = t.beats.find(b => b.isEndCard);
    expect(outro.audioUrl).toBe('file:///C:/Temp/outro.wav');
  });
});

describe('pathToFileUrl', () => {
  it('returns null for nothing', () => {
    expect(pathToFileUrl(null)).toBeNull();
    expect(pathToFileUrl('')).toBeNull();
  });

  it('passes an existing file URL through unchanged', () => {
    expect(pathToFileUrl('file:///C:/Temp/a.wav')).toBe('file:///C:/Temp/a.wav');
  });
});

// Background music runs the length of the video and has to get out of the way
// of the narration. The duck windows are computed here, not in the composition,
// for the same reason beat timing is: this is the only place that knows when
// anyone is actually speaking.
describe('background music', () => {
  const withMusic = (music, over = {}) => script({
    music: { file: 'bed.mp3', title: 'Bed', licence: 'CC0 1.0', ...music },
    ...over,
  });

  it('is absent when no track is chosen', () => {
    expect(buildTimeline(script()).music).toBeNull();
    expect(buildTimeline(script({ music: {} })).music).toBeNull();
  });

  it('resolves the track under the music folder for staticFile', () => {
    expect(buildTimeline(withMusic({})).music.src).toBe('sounds/music/bed.mp3');
  });

  it('carries the licence through to the render', () => {
    expect(buildTimeline(withMusic({})).music.licence).toBe('CC0 1.0');
  });

  it('ducks across the beats that have narration', () => {
    // b1 0-3000 narrated, b2 3000-7000 narrated: one merged window.
    const m = buildTimeline(withMusic({})).music;
    expect(m.duckWindows).toEqual([{ startMs: 0, endMs: 7000 }]);
  });

  // An end card with no voice is exactly where a track should come back up.
  it('leaves a silent beat unducked', () => {
    const t = buildTimeline(withMusic({}, {
      outro: { enabled: true, copy: 'More at skywatch.academy' },
    }));
    const m = t.music;
    // The outro has no narration line, so the duck stops at the end of b2.
    expect(m.duckWindows).toEqual([{ startMs: 0, endMs: 7000 }]);
    expect(m.totalDurationMs).toBeGreaterThan(7000);
  });

  it('does not duck at all when nothing is narrated', () => {
    const t = buildTimeline(withMusic({}, { voice: null }));
    expect(t.music.duckWindows).toEqual([]);
  });

  it('uses sensible levels by default and honours overrides', () => {
    expect(buildTimeline(withMusic({})).music).toMatchObject({
      volume: 0.18, duckVolume: 0.06, fadeOutMs: 1500,
    });
    expect(buildTimeline(withMusic({ volume: 0.4, duckVolume: 0, fadeOutMs: 0 })).music)
      .toMatchObject({ volume: 0.4, duckVolume: 0, fadeOutMs: 0 });
  });

  it('reports the video length so the fade can land on the end', () => {
    const t = buildTimeline(withMusic({}));
    expect(t.music.totalDurationMs).toBe(t.totalDurationMs);
  });
});
