/**
 * Unit tests for the render timeline builder (backend/utils/clipperTimeline.js).
 *
 * This is the only place beat timing is decided, so the preview, the render and
 * the captions cannot disagree. Everything here is about that guarantee.
 */

const {
  buildTimeline, buildCaptionPages, clampTrimIn, pathToFileUrl, MIN_BEAT_MS,
  shotLengths, snapLengths, cueTimeMs, defaultCueWord,
  MAX_SHOT_MS, FIRST_SHOT_MS, MIN_SHOT_MS, MAX_SHOTS, SNAP_MS,
  BRAND_DOMAIN, MIN_BRAND_MS, END_CARD_MS,
} = require('../../utils/clipperTimeline');
const { focusFor } = require('../../constants/clipperCapture');

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

  // The end card used to cut to a flat panel and hold it for several seconds,
  // which is both the least watchable frame in the video and a full stop where
  // a loop should be. It now keeps the last beat's picture running underneath.
  it('runs the last beat\'s footage under the end card', () => {
    const t = buildTimeline(script({
      footage: {
        b1: { chosen: { downloadUrl: 'a.mp4' }, trim: { inMs: 500 } },
        b2: { chosen: { downloadUrl: 'b.mp4', durationSec: 30 }, trim: { inMs: 1000 } },
      },
      outro: { enabled: true, copy: 'More tips' },
      voice: { lines: [
        { beatId: 'b2', durationMs: 4000, startMs: 0, audioUrl: 'b.wav' },
        { beatId: 'outro', durationMs: 2600, startMs: 4000, audioUrl: 'o.wav' },
      ] },
    }));

    const outro = t.beats.find(b => b.isEndCard);
    expect(outro.videoUrl).toBe('b.mp4');
    // Picks up where b2 left off: its in-point plus its length.
    expect(outro.trimInMs).toBe(5000);
  });

  it('pulls the end card\'s in-point back when the clip has nothing left', () => {
    const t = buildTimeline(script({
      footage: {
        b1: { chosen: { downloadUrl: 'a.mp4' }, trim: { inMs: 0 } },
        // Only 6s long, and b2 already consumes 4s of it from 1s in.
        b2: { chosen: { downloadUrl: 'b.mp4', durationSec: 6 }, trim: { inMs: 1000 } },
      },
      outro: { enabled: true, copy: 'More tips' },
      voice: { lines: [
        { beatId: 'b2', durationMs: 4000, startMs: 0, audioUrl: 'b.wav' },
        { beatId: 'outro', durationMs: 2600, startMs: 4000, audioUrl: 'o.wav' },
      ] },
    }));

    const outro = t.beats.find(b => b.isEndCard);
    // 6000 - 2600 = the latest start that still plays, rather than seeking to
    // 5000 and freezing on the last frame.
    expect(outro.trimInMs).toBe(3400);
  });

  it('leaves the end card on the backdrop when the last beat had no clip', () => {
    const t = buildTimeline(script({
      outro: { enabled: true, copy: 'More tips' },
      voice: { lines: [{ beatId: 'outro', durationMs: 2600, startMs: 0, audioUrl: 'o.wav' }] },
    }));

    // b2 in the fixture has no chosen clip, so there is nothing to carry.
    const outro = t.beats.find(b => b.isEndCard);
    expect(outro.videoUrl).toBeNull();
    expect(outro.trimInMs).toBe(0);
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

  // Captions are set at roughly 5% of the frame height now, where they used to
  // be 4%. A fourth word at that size either overflows the safe width or wraps,
  // and a two-line caption gets read rather than glanced at.
  // Three short words and three long ones are the same page count but not the
  // same line width, and the renderer pays for the difference by shrinking.
  it('splits a page that would be too wide before it hits three words', () => {
    const pages = buildCaptionPages(
      [w('universally', 0, 100), w('rated', 100, 200), w('worst', 200, 300)],
      { maxChars: 15 },
    );
    expect(pages).toHaveLength(2);
    expect(pages[0].words.map(x => x.text)).toEqual(['universally']);
    expect(pages[1].words.map(x => x.text)).toEqual(['rated', 'worst']);
  });

  it('never drops a single word that is wider than the budget on its own', () => {
    const pages = buildCaptionPages([w('incomprehensibly', 0, 100)], { maxChars: 15 });
    expect(pages).toHaveLength(1);
    expect(pages[0].words[0].text).toBe('incomprehensibly');
  });

  it('defaults to three words a page', () => {
    const pages = buildCaptionPages(
      [w('a', 0, 100), w('b', 100, 200), w('c', 200, 300), w('d', 300, 400)],
    );
    expect(pages).toHaveLength(2);
    expect(pages[0].words).toHaveLength(3);
    expect(pages[1].words).toHaveLength(1);
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

/**
 * Shots.
 *
 * A beat used to be a single picture, which welded the cut rate to the sentence
 * rate: a measured render averaged 4.36 seconds a shot. What matters here is not
 * that beats get split, but that a split is only ever made when the clip has
 * genuinely different frames to cut to.
 */
describe('shotLengths', () => {
  it('leaves a short beat as one shot', () => {
    expect(shotLengths(2000, false)).toEqual([2000]);
  });

  it('splits a long beat and accounts for every millisecond', () => {
    const lens = shotLengths(4360, false);
    expect(lens.length).toBe(2);
    expect(lens.reduce((a, b) => a + b, 0)).toBe(4360);
  });

  it('never emits a shot under the flicker floor', () => {
    for (let ms = MIN_SHOT_MS; ms <= 12000; ms += 137) {
      for (const first of [true, false]) {
        for (const len of shotLengths(ms, first)) {
          expect(len).toBeGreaterThanOrEqual(Math.min(ms, MIN_SHOT_MS));
        }
      }
    }
  });

  it('caps how much cutting one beat can carry', () => {
    expect(shotLengths(30000, false).length).toBeLessThanOrEqual(MAX_SHOTS);
    expect(shotLengths(30000, true).length).toBeLessThanOrEqual(MAX_SHOTS);
  });

  // The opening shot is the one that has to change before the scroll decision
  // is made, so its length is pinned rather than shared out with the rest.
  it("pins the opening shot of the first beat short", () => {
    expect(shotLengths(4000, true)[0]).toBe(FIRST_SHOT_MS);
  });

  it('holds no ordinary shot longer than the cap', () => {
    for (const len of shotLengths(7000, false)) {
      expect(len).toBeLessThanOrEqual(MAX_SHOT_MS);
    }
  });
});

describe('beat shots', () => {
  const shotScript = (over = {}) => ({
    script: { beats: [
      { id: 'b1', text: 'One.', visual: { kind: 'stock' } },
      { id: 'b2', text: 'Two.', visual: { kind: 'stock' } },
    ] },
    footage: {
      b1: { chosen: { downloadUrl: 'a.mp4', durationSec: 30 }, trim: { inMs: 0 } },
      b2: { chosen: { downloadUrl: 'b.mp4', durationSec: 30 }, trim: { inMs: 0 } },
    },
    voice: { lines: [
      { beatId: 'b1', durationMs: 4000, startMs: 0 },
      { beatId: 'b2', durationMs: 6000, startMs: 4000 },
    ] },
    outro: { enabled: false, copy: '' },
    ...over,
  });

  it('covers the beat exactly, with no gap and no overrun', () => {
    const t = buildTimeline(shotScript());
    for (const beat of t.beats) {
      const total = beat.shots.reduce((n, s) => n + s.durationMs, 0);
      expect(total).toBe(beat.durationMs);
    }
  });

  // Continuous playback is not a cut. If the second shot simply resumed where
  // the first left off the picture would not change at all, so each in-point
  // has to land past the end of the shot before it.
  it('cuts to material the previous shot did not already show', () => {
    const shots = buildTimeline(shotScript()).beats[1].shots;
    expect(shots.length).toBeGreaterThan(1);
    for (let i = 1; i < shots.length; i++) {
      const prev = shots[i - 1];
      expect(shots[i].trimInMs).toBeGreaterThan(prev.trimInMs + prev.durationMs);
    }
  });

  it('alternates the move so two shots do not read as one long push', () => {
    const moves = buildTimeline(shotScript()).beats[1].shots.map(s => s.move);
    expect(moves).toEqual(['in', 'out', 'in'].slice(0, moves.length));
  });

  // The whole point of the conservative rule: a six-second beat over a
  // seven-second clip has nowhere to cut to, and cutting back to frames the
  // viewer just watched looks like a fault rather than an edit.
  it('keeps one shot when the clip has nothing new left to give', () => {
    const t = buildTimeline(shotScript({
      footage: {
        b1: { chosen: { downloadUrl: 'a.mp4', durationSec: 30 }, trim: { inMs: 0 } },
        b2: { chosen: { downloadUrl: 'b.mp4', durationSec: 7 },  trim: { inMs: 0 } },
      },
    }));
    expect(t.beats[1].shots.length).toBe(1);
    expect(t.beats[1].shots[0].durationMs).toBe(t.beats[1].durationMs);
  });

  // An unknown length is the same problem wearing a different hat: seeking
  // forward into a clip that may be shorter renders a frozen frame.
  it('keeps one shot when the clip length is unknown', () => {
    const t = buildTimeline(shotScript({
      footage: {
        b1: { chosen: { downloadUrl: 'a.mp4' }, trim: { inMs: 0 } },
        b2: { chosen: { downloadUrl: 'b.mp4' }, trim: { inMs: 0 } },
      },
    }));
    expect(t.beats[1].shots.length).toBe(1);
  });

  it('gives a beat with no footage a single backdrop shot', () => {
    const t = buildTimeline(shotScript({
      footage: { b1: { chosen: null }, b2: { chosen: null } },
    }));
    expect(t.beats[1].shots).toEqual([
      { videoUrl: null, trimInMs: 0, durationMs: 6000, move: 'in', focus: null, framed: false },
    ]);
  });

  it('changes the picture inside the opening seconds', () => {
    const shots = buildTimeline(shotScript()).beats[0].shots;
    expect(shots.length).toBeGreaterThan(1);
    expect(shots[0].durationMs).toBe(FIRST_SHOT_MS);
  });
});

/**
 * Screen recordings.
 *
 * A capture is a demonstration of something happening, so cutting forward
 * inside one is a jump cut in the middle of the thing being shown. They get
 * their framing corrected instead - most waste a fifth of the frame on page
 * background.
 */
describe('capture framing', () => {
  const captureScript = (recipeId) => ({
    script: { beats: [
      { id: 'b1', text: 'One.', visual: { kind: 'stock' } },
      { id: 'b2', text: 'Two.', visual: { kind: 'capture', recipeId } },
    ] },
    footage: {
      b1: { chosen: null },
      b2: {
        chosen: { provider: 'capture', playbackUrl: 'cap.mp4', durationSec: 28 },
        trim: { inMs: 0 },
      },
    },
    voice: { lines: [
      { beatId: 'b1', durationMs: 1000, startMs: 0 },
      { beatId: 'b2', durationMs: 8000, startMs: 1000 },
    ] },
    outro: { enabled: false, copy: '' },
  });

  it('never cuts inside a screen recording', () => {
    expect(buildTimeline(captureScript('play-dpt')).beats[1].shots.length).toBe(1);
  });

  it('crops to the measured rect for the recipe', () => {
    const t = buildTimeline(captureScript('play-dpt'));
    expect(t.beats[1].shots[0].focus).toEqual(focusFor('play-dpt'));
  });

  // A wrong crop cuts the subject in half; no crop only frames it loosely.
  it('leaves an unmeasured recipe uncropped', () => {
    expect(buildTimeline(captureScript('something-new')).beats[1].shots[0].focus).toBeNull();
  });

  it('leaves stock footage uncropped', () => {
    expect(buildTimeline(captureScript('play-dpt')).beats[0].shots[0].focus).toBeNull();
  });
});

/**
 * The phone frame.
 *
 * Screen recordings play inside a slowly turning device from the third beat on.
 * The rule is about the hook, not about taste: short-form platforms render
 * full-bleed natively, so a device mockup on frame 0 reads as an advert and
 * gets scrolled - a cost that has almost entirely decayed by beat three, where
 * the frame buys back sharpness and the whole playthrough instead.
 */
describe('phone framing', () => {
  const beat = (id, kind, recipeId = '') => ({ id, text: `${id}.`, visual: { kind, recipeId } });

  const framedScript = (kinds) => ({
    script: { beats: kinds.map((k, i) => beat(`b${i + 1}`, k, k === 'capture' ? 'play-flag' : '')) },
    footage: Object.fromEntries(kinds.map((k, i) => [
      `b${i + 1}`,
      { chosen: k === 'capture'
        ? { provider: 'capture', playbackUrl: 'cap.mp4', durationSec: 28 }
        : { downloadUrl: 'stock.mp4', durationSec: 12 },
        trim: { inMs: 0 } },
    ])),
    voice: { lines: kinds.map((_, i) => ({
      beatId: `b${i + 1}`, durationMs: 3000, startMs: i * 3000,
    })) },
    outro: { enabled: false, copy: '' },
  });

  const framedFlags = (t) => t.beats.map(b => Boolean(b.shots?.[0]?.framed));

  it('leaves the hook full-bleed even when it is a screen recording', () => {
    const t = buildTimeline(framedScript(['capture', 'capture', 'capture']));
    expect(framedFlags(t)).toEqual([false, false, true]);
  });

  it('never frames stock footage', () => {
    const t = buildTimeline(framedScript(['stock', 'stock', 'stock', 'stock']));
    expect(framedFlags(t)).toEqual([false, false, false, false]);
  });

  it('frames only the captures among later beats', () => {
    const t = buildTimeline(framedScript(['stock', 'stock', 'capture', 'stock', 'capture']));
    expect(framedFlags(t)).toEqual([false, false, true, false, true]);
  });

  // This asserted the opposite at first, on the reasoning that "inside a phone
  // there is no frame to waste, the whole screen is the subject". That only
  // holds for a page that fills its own viewport. DPT does not - it renders at
  // a fixed width and leaves the right fifth of every frame empty, which is why
  // the rect was measured at all. Shown whole on a phone, the dead strip became
  // part of the device's screen and the gameplay sat visibly off to one side.
  it('keeps the recipe rect on a framed shot, so the screen is filled', () => {
    const t = buildTimeline({
      script: { beats: [
        beat('b1', 'stock'), beat('b2', 'stock'),
        { id: 'b3', text: 'Three.', visual: { kind: 'capture', recipeId: 'play-dpt' } },
      ] },
      footage: {
        b1: { chosen: null }, b2: { chosen: null },
        b3: { chosen: { provider: 'capture', playbackUrl: 'cap.mp4', durationSec: 28 }, trim: { inMs: 0 } },
      },
      voice: { lines: [
        { beatId: 'b1', durationMs: 1000, startMs: 0 },
        { beatId: 'b2', durationMs: 1000, startMs: 1000 },
        { beatId: 'b3', durationMs: 8000, startMs: 2000 },
      ] },
      outro: { enabled: false, copy: '' },
    });

    expect(t.beats[2].shots[0].framed).toBe(true);
    expect(t.beats[2].shots[0].focus).toEqual(focusFor('play-dpt'));
  });

  // The input rect is a punch-in for emphasis. A framed shot has already
  // committed to showing the whole screen, and cropping to a corner of a phone
  // is a different - worse - shot than the one that was asked for.
  it('does not punch in on input inside the phone', () => {
    const inputLog = [
      { atMs: 100, x: 0.5, y: 0.5, kind: 'press' },
      { atMs: 200, x: 0.51, y: 0.51, kind: 'press' },
      { atMs: 300, x: 0.49, y: 0.49, kind: 'press' },
    ];
    const t = buildTimeline({
      script: { beats: [
        beat('b1', 'stock'), beat('b2', 'stock'),
        { id: 'b3', text: 'Three.', visual: { kind: 'capture', recipeId: 'play-flag' } },
      ] },
      footage: {
        b1: { chosen: null }, b2: { chosen: null },
        b3: {
          chosen: { provider: 'capture', playbackUrl: 'cap.mp4', durationSec: 28 },
          trim: { inMs: 0 }, inputLog,
        },
      },
      voice: { lines: [
        { beatId: 'b1', durationMs: 1000, startMs: 0 },
        { beatId: 'b2', durationMs: 1000, startMs: 1000 },
        { beatId: 'b3', durationMs: 8000, startMs: 2000 },
      ] },
      outro: { enabled: false, copy: '' },
    });

    // play-flag has no measured rect, and the input rect must not stand in for
    // one here - so a framed FLAG shot is uncropped.
    expect(t.beats[2].shots[0].framed).toBe(true);
    expect(t.beats[2].shots[0].focus).toBeNull();
  });

  it('still crops an early capture, which is playing full-bleed', () => {
    const t = buildTimeline({
      script: { beats: [
        beat('b1', 'stock'),
        { id: 'b2', text: 'Two.', visual: { kind: 'capture', recipeId: 'play-dpt' } },
      ] },
      footage: {
        b1: { chosen: null },
        b2: { chosen: { provider: 'capture', playbackUrl: 'cap.mp4', durationSec: 28 }, trim: { inMs: 0 } },
      },
      voice: { lines: [
        { beatId: 'b1', durationMs: 1000, startMs: 0 },
        { beatId: 'b2', durationMs: 8000, startMs: 1000 },
      ] },
      outro: { enabled: false, copy: '' },
    });

    expect(t.beats[1].shots[0].framed).toBe(false);
    expect(t.beats[1].shots[0].focus).toEqual(focusFor('play-dpt'));
  });

  // Stock beats split into several shots, and a treatment that applied to the
  // first but not the rest would flicker mid-beat.
  it('marks every shot of a beat the same way', () => {
    const t = buildTimeline(framedScript(['stock', 'stock', 'stock', 'stock']));
    for (const b of t.beats) {
      expect(new Set(b.shots.map(sh => sh.framed)).size).toBe(1);
    }
  });
});

/**
 * The title card.
 *
 * Karaoke captions deliver the opening line three words at a time, so the
 * promise of the video is only complete on screen after the moment it was
 * needed. The first beat shows its line whole instead.
 */
describe('title card', () => {
  const hookScript = (text) => ({
    script: { beats: [
      { id: 'b1', text, visual: { kind: 'stock' } },
      { id: 'b2', text: 'Two.', visual: { kind: 'stock' } },
    ] },
    footage: {},
    voice: { lines: [
      { beatId: 'b1', durationMs: 2000, startMs: 0 },
      { beatId: 'b2', durationMs: 2000, startMs: 2000 },
    ] },
    captions: { words: [
      { beatId: 'b1', text: 'Most', startMs: 0,    endMs: 400 },
      { beatId: 'b1', text: 'fail', startMs: 400,  endMs: 900 },
      { beatId: 'b2', text: 'Here', startMs: 2000, endMs: 2400 },
    ] },
    outro: { enabled: false, copy: '' },
  });

  it('marks the opening beat and no other', () => {
    const t = buildTimeline(hookScript('Most people fail this one.'));
    expect(t.beats[0].isTitleCard).toBe(true);
    expect(t.beats[1].isTitleCard).toBe(false);
  });

  // The card already shows the line in full, so keeping the pages would put
  // the same words on screen twice.
  it('drops the captions the card would duplicate', () => {
    const t = buildTimeline(hookScript('Most people fail this one.'));
    expect(t.beats[0].captionPages).toEqual([]);
    expect(t.beats[1].captionPages.length).toBeGreaterThan(0);
  });

  // Past a glance's worth of text a title card is a paragraph, and captions
  // are the better treatment.
  it('leaves a long opening line as ordinary captions', () => {
    const long = 'There is a particular mistake almost everyone makes on this test, '
      + 'and it costs them more marks than any other single thing.';
    const t = buildTimeline(hookScript(long));
    expect(t.beats[0].isTitleCard).toBe(false);
    expect(t.beats[0].captionPages.length).toBeGreaterThan(0);
  });
});

/**
 * Sound-effect placement.
 *
 * Forced alignment already knows when every word was spoken, but SFX could only
 * ever be placed at a beat boundary - so a sound meant to punctuate the end of a
 * line fired at the start of it.
 */
describe('cueTimeMs', () => {
  const words = [
    { text: 'Most', startMs: 0,   endMs: 400 },
    { text: 'people', startMs: 400, endMs: 900 },
    { text: 'fail', startMs: 900, endMs: 1500 },
  ];

  it('places a cue on the word it names', () => {
    expect(cueTimeMs({ atWord: 2, atMs: 0 }, words)).toBe(900);
  });

  // The offset is what you set when you could not say "on that word", so a
  // stale one must not override the thing it was standing in for.
  it('prefers the word over a millisecond offset', () => {
    expect(cueTimeMs({ atWord: 1, atMs: 5000 }, words)).toBe(400);
  });

  it('falls back to the offset when no word is named', () => {
    expect(cueTimeMs({ atWord: null, atMs: 250 }, words)).toBe(250);
    expect(cueTimeMs({ atMs: 250 }, words)).toBe(250);
  });

  // A word index outliving the narration it pointed into is the ordinary
  // consequence of re-recording a shorter line.
  it('falls back when the word no longer exists', () => {
    expect(cueTimeMs({ atWord: 9, atMs: 120 }, words)).toBe(120);
    expect(cueTimeMs({ atWord: 1, atMs: 120 }, [])).toBe(120);
  });
});

describe('defaultCueWord', () => {
  const words = [{ startMs: 0 }, { startMs: 400 }, { startMs: 900 }];

  // A sound that punctuates goes where the emphasis of a short spoken line
  // almost always falls: the last word.
  it('lands a punctuating sound on the final word', () => {
    expect(defaultCueWord('impact', words)).toBe(2);
    expect(defaultCueWord('record-scratch', words)).toBe(2);
  });

  it('leaves a setup sound at the beat start', () => {
    expect(defaultCueWord('riser', words)).toBeNull();
    expect(defaultCueWord('whoosh', words)).toBeNull();
  });

  it('has nothing to place against before alignment has run', () => {
    expect(defaultCueWord('impact', [])).toBeNull();
    expect(defaultCueWord('impact', null)).toBeNull();
  });
});

describe('sfx in the timeline', () => {
  const sfxScript = (over = {}) => ({
    script: { beats: [
      { id: 'b1', text: 'Most people fail.', visual: { kind: 'stock' }, sfxCue: 'impact' },
    ] },
    footage: {},
    voice: { lines: [{ beatId: 'b1', durationMs: 2000, startMs: 0 }] },
    captions: { words: [
      { beatId: 'b1', text: 'Most',   startMs: 0,   endMs: 400 },
      { beatId: 'b1', text: 'people', startMs: 400, endMs: 900 },
      { beatId: 'b1', text: 'fail',   startMs: 900, endMs: 1500 },
    ] },
    outro: { enabled: false, copy: '' },
    ...over,
  });

  it('lands the script writer’s cue on the last word rather than the beat start', () => {
    const t = buildTimeline(sfxScript());
    expect(t.beats[0].sfx[0].atMs).toBe(900);
  });

  it('keeps the cue at the beat start when nothing has been aligned yet', () => {
    const t = buildTimeline(sfxScript({ captions: null }));
    expect(t.beats[0].sfx[0].atMs).toBe(0);
  });

  it('honours a word the admin picked', () => {
    const t = buildTimeline(sfxScript({
      sfx: [{ beatId: 'b1', sfxId: 'ding', atWord: 1, atMs: 0, enabled: true }],
    }));
    expect(t.beats[0].sfx[0].atMs).toBe(400);
  });
});

/**
 * Cutting to the music.
 *
 * Beat boundaries are set by the narration and may not move. The boundaries
 * *inside* a beat are free, which is the only reason this is safe to do at all.
 */
describe('snapLengths', () => {
  const period = 500;   // 120bpm

  it('pulls a nearby boundary onto the grid', () => {
    // Boundary at 1450 with the grid at 1500: 50ms away, so it moves.
    expect(snapLengths([1450, 1550], 0, period)).toEqual([1500, 1500]);
  });

  it('leaves a boundary that is nowhere near a beat', () => {
    expect(snapLengths([1250, 1750], 0, period)).toEqual([1250, 1750]);
  });

  // Whatever one shot gains the next one loses, because the beat still has to
  // last exactly as long as the line spoken over it.
  it('never changes how long the beat runs', () => {
    for (const start of [0, 137, 999, 4321]) {
      const lens = snapLengths([1450, 1550, 1600], start, period);
      expect(lens.reduce((a, b) => a + b, 0)).toBe(4600);
    }
  });

  it('refuses a snap that would leave a shot too short to see', () => {
    // Boundary at 1020, grid line at 1000 - pulling it back would take the
    // first shot under the floor, so it stays where it is.
    expect(snapLengths([MIN_SHOT_MS, 2000], 120, period)).toEqual([MIN_SHOT_MS, 2000]);
  });

  it('does nothing without a tempo', () => {
    expect(snapLengths([1450, 1550], 0, 0)).toEqual([1450, 1550]);
  });

  it('never moves a boundary further than the tolerance', () => {
    const before = [1337, 2222, 1801];
    const after = snapLengths(before, 517, period);
    let a = 0, b = 0;
    for (let i = 0; i < before.length - 1; i++) {
      a += before[i]; b += after[i];
      expect(Math.abs(b - a)).toBeLessThanOrEqual(SNAP_MS);
    }
  });
});

describe('cutting to the music end to end', () => {
  const musicScript = (bpm) => ({
    script: { beats: [
      { id: 'b1', text: 'One.', visual: { kind: 'stock' } },
      { id: 'b2', text: 'Two.', visual: { kind: 'stock' } },
    ] },
    footage: {
      b1: { chosen: { downloadUrl: 'a.mp4', durationSec: 40 }, trim: { inMs: 0 } },
      b2: { chosen: { downloadUrl: 'b.mp4', durationSec: 40 }, trim: { inMs: 0 } },
    },
    voice: { lines: [
      { beatId: 'b1', durationMs: 4000, startMs: 0 },
      { beatId: 'b2', durationMs: 6000, startMs: 4000 },
    ] },
    music: { file: 'bed.mp3', bpm, durationMs: 60000 },
    outro: { enabled: false, copy: '' },
  });

  it('carries the tempo through to the composition', () => {
    expect(buildTimeline(musicScript(120)).music.bpm).toBe(120);
    expect(buildTimeline(musicScript(null)).music.bpm).toBeNull();
  });

  it('leaves the spoken beats exactly where the narration put them', () => {
    const withMusic = buildTimeline(musicScript(120));
    const without   = buildTimeline(musicScript(null));
    expect(withMusic.beats.map(b => b.durationMs)).toEqual(without.beats.map(b => b.durationMs));
    expect(withMusic.totalDurationMs).toBe(without.totalDurationMs);
  });

  // Internal boundaries, as absolute positions in the finished video.
  const cuts = (timeline) => {
    const out = [];
    let beatStart = 0;
    for (const beat of timeline.beats) {
      let at = beatStart;
      for (const shot of beat.shots.slice(0, -1)) { at += shot.durationMs; out.push(at); }
      beatStart += beat.durationMs;
    }
    return out;
  };

  it('moves a cut onto the grid when it is close enough to reach', () => {
    const snapped = cuts(buildTimeline(musicScript(120)));
    const loose   = cuts(buildTimeline(musicScript(null)));

    expect(snapped.length).toBe(loose.length);
    expect(snapped.some((c, i) => c !== loose[i])).toBe(true);

    // And every cut is now either exactly on a beat of the music, or was too
    // far from one to be worth dragging there.
    snapped.forEach((c, i) => {
      const wasFrom = Math.abs(loose[i] - Math.round(loose[i] / 500) * 500);
      expect(c % 500 === 0 || wasFrom > SNAP_MS).toBe(true);
    });
  });
});

/**
 * The brand used to appear once, on the end card, and only when the outro line
 * had not already said the domain - so most viewers, who leave well before it,
 * saw no mark at all. These tests pin the two decisions the builder owns: when
 * the mark arrives, and when it gets out of the way.
 */
describe('branding', () => {
  const brandScript = (kinds, over = {}) => ({
    script: {
      beats: kinds.map((k, i) => ({
        id: `b${i + 1}`, text: `${i + 1}.`,
        visual: { kind: k, recipeId: k === 'capture' ? 'play-flag' : '' },
      })),
    },
    footage: Object.fromEntries(kinds.map((k, i) => [
      `b${i + 1}`,
      { chosen: k === 'capture'
        ? { provider: 'capture', playbackUrl: 'cap.mp4', durationSec: 28 }
        : { downloadUrl: 'stock.mp4', durationSec: 12 },
        trim: { inMs: 0 } },
    ])),
    voice: { lines: kinds.map((_, i) => ({
      beatId: `b${i + 1}`, durationMs: 3000, startMs: i * 3000,
    })) },
    outro: { enabled: false, copy: '' },
    ...over,
  });

  // The one moment where "this is our app" is literally true on screen.
  it('anchors the reveal on the first framed shot', () => {
    const t = buildTimeline(brandScript(['stock', 'stock', 'capture']));
    expect(t.beats[2].shots[0].framed).toBe(true);
    expect(t.branding.revealAtMs).toBe(6000);
    expect(t.branding.domain).toBe(BRAND_DOMAIN);
  });

  // Past the hook, still early. Nothing competes with the opening line.
  it('falls back to the second beat when no phone ever appears', () => {
    const t = buildTimeline(brandScript(['stock', 'stock', 'stock']));
    expect(t.branding.revealAtMs).toBe(3000);
  });

  // The end card carries the brand itself; two lockups on one frame is one too
  // many, and on an outro that says the domain it would be the second printing.
  it('stops where the end card starts', () => {
    const t = buildTimeline(brandScript(['stock', 'stock', 'capture'], {
      outro: { enabled: true, copy: 'More at skywatch.academy' },
    }));
    expect(t.beats[t.beats.length - 1].isEndCard).toBe(true);
    expect(t.totalDurationMs).toBe(9000 + END_CARD_MS);
    expect(t.branding.untilMs).toBe(9000);
  });

  it('is off for a video whose branding was switched off', () => {
    const t = buildTimeline(brandScript(['stock', 'stock', 'capture'], {
      branding: { enabled: false },
    }));
    expect(t.branding).toBeNull();
  });

  // A mark on screen for less time than its own reveal takes reads as a
  // flicker. Drop it rather than flash it.
  it('drops the mark when it would have no time to be read', () => {
    const short = brandScript(['stock', 'stock']);
    short.voice.lines[1].durationMs = MIN_BRAND_MS - 500;
    const t = buildTimeline(short);
    expect(t.branding).toBeNull();
  });

  it('has nothing to brand when there are no beats', () => {
    expect(buildTimeline({ script: { beats: [] }, outro: { enabled: false, copy: '' } }).branding)
      .toBeNull();
  });
});
