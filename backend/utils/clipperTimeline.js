// Assemble the render timeline from a script's stages.
//
// This is the join between "what the admin approved" and "what Remotion draws".
// It is deliberately the only place that decides beat timing, so the preview,
// the render and the caption alignment can never disagree about when a beat
// starts.
//
// Durations come from the narration, not from estimates. A beat lasts exactly
// as long as its spoken line took, because that is the one measurement we
// actually have — the word-count estimate on the script is only ever used to
// warn about length before any audio exists.

const { resolveCue, sfxPath, SFX_BY_ID } = require('../constants/clipperSfx');
const { MUSIC_DIR } = require('../constants/clipperMusic');
const { focusFor } = require('../constants/clipperCapture');

const MIN_BEAT_MS = 800;       // a beat with no audio still needs to be seen
const END_CARD_MS = 2200;

// The opening line, shown whole instead of three words at a time.
//
// A caption page arrives at the speed of the voice, so the promise of the video
// is only complete on screen a second or two in - by which time the decision to
// keep watching has already been made. A title card puts the whole hook on
// frame 0. Long lines are left as ordinary captions: a title card is something
// you take in at a glance, and past this length it is a paragraph.
const HOOK_MAX_CHARS = 78;

// Group word timings into caption pages. Short-form captions show a few words
// at a time: enough to read in one saccade, few enough that the highlighted
// word is always findable.
//
// Three, not four. Four fitted when captions were set at 76px, which measured
// out at 4% of the frame height against a native 5-6%. At the size they are now
// a fourth word either overflows the safe width or forces a second line, and a
// two-line caption is read as a paragraph rather than glanced at.
// `maxChars` is a second bound on the same thing: three short words and three
// long ones are the same page count but not the same line width. The renderer
// shrinks an over-long page to keep it on one line, so a page that blows past
// this budget is not broken, just smaller than it needed to be — splitting it
// here is what keeps the type at full size.
function buildCaptionPages(words, { maxWords = 3, maxChars = 15, maxGapMs = 700 } = {}) {
  const pages = [];
  let current = [];

  const flush = () => {
    if (current.length === 0) return;
    pages.push({
      startMs: current[0].startMs,
      endMs:   current[current.length - 1].endMs,
      words:   current,
    });
    current = [];
  };

  // Width of the page as it would be laid out: the words plus the space
  // between them.
  const widthWith = (word) =>
    current.reduce((n, w) => n + w.text.length, 0) + current.length + word.text.length;

  for (const word of words) {
    const prev = current[current.length - 1];
    // A pause in the delivery is a natural page break — splitting there keeps
    // captions in step with phrasing rather than cutting mid-thought.
    if (prev && word.startMs - prev.endMs > maxGapMs) flush();
    // A single word longer than the budget still has to go somewhere, so this
    // only splits when there is already something on the page.
    if (current.length > 0 && widthWith(word) > maxChars) flush();
    current.push(word);
    if (current.length >= maxWords) flush();
  }
  flush();

  return pages;
}

// A local path as a file: URL, matching how chosen screen recordings are
// stored (see the note in routes/clipper.js where playbackUrl is written).
//
// The voice stage records only `wavPath`, because the agent's job is to put a
// file on disk. Nothing ever turned that into something playable, so
// `line.audioUrl` was always undefined and every beat rendered silent — in the
// preview and in the MP4 alike. Deriving it here rather than in the agent fixes
// scripts that were already narrated, which would otherwise have to be
// regenerated to gain a voice track.
function pathToFileUrl(localPath) {
  if (!localPath) return null;
  const normalised = String(localPath).replace(/\\/g, '/');
  return normalised.startsWith('file:') ? normalised : `file:///${normalised.replace(/^\/+/, '')}`;
}

// Keep a trim in-point inside its clip.
//
// The in-point is stored against a clip and the beat's length is set by the
// narration, so either can move under it: re-recording a beat shortens the
// clip, re-recording the voice lengthens the window. Left alone, a stale
// offset seeks past the end and the beat renders as a frozen last frame — the
// same silent nothing the trim was added to prevent.
//
// Clamping to the same rule the scrubber enforces (start no later than
// clipLength - beatLength) also keeps preview and render honest with each
// other. A clip whose length we do not know is left alone; guessing would be
// worse than trusting what was set.
function clampTrimIn(inMs, clipDurationSec, beatDurationMs) {
  const wanted = Math.max(0, Number(inMs) || 0);
  if (!clipDurationSec) return wanted;

  const latestStart = Math.max(0, clipDurationSec * 1000 - beatDurationMs);
  return Math.min(wanted, Math.round(latestStart));
}

// ── Sound-effect placement ──────────────────────────────────────────────────
//
// Where a cue belongs, given that we know when every word was spoken.
//
// A 'land' sound punctuates something and goes on the beat's final word, which
// is where the emphasis of a short spoken line almost always falls. A 'lead'
// sound sets up what follows and stays at the beat's start. Both fall back to
// the beat start when the captions stage has not run, so a video narrated but
// not yet aligned sounds exactly as it did before.
function defaultCueWord(sfxId, words) {
  if (!Array.isArray(words) || words.length === 0) return null;
  return SFX_BY_ID.get(sfxId)?.placement === 'land' ? words.length - 1 : null;
}

// A row's time within its beat. A word target wins over a millisecond offset:
// the offset is what you set when you could not say "on that word", and a stale
// one should not override the thing it was standing in for.
function cueTimeMs(row, words) {
  const idx = Number.isInteger(row?.atWord) ? row.atWord : null;
  const word = idx != null && Array.isArray(words) ? words[idx] : null;
  if (word) return Math.max(0, Math.round(word.startMs));
  return Math.max(0, Number(row?.atMs) || 0);
}

// ── Shots ───────────────────────────────────────────────────────────────────
//
// A beat is a spoken line. A shot is one framing of one clip. Until now they
// were the same thing, which is the single biggest reason finished videos felt
// slow: one picture was emitted per beat, so the cut rate was welded to the
// sentence rate. A measured render held each shot for 4.36 seconds on average,
// against a short-form rhythm of well under two.
//
// Splitting is deliberately conservative. A second shot is only cut when the
// chosen clip can supply a genuinely different picture - a later in-point, far
// enough past where the previous shot ended that it reads as a cut rather than
// a stutter. Showing the same frames again behind a different zoom would fill
// the time and look like a fault, so a clip with nothing left to give keeps its
// single shot.

const MAX_SHOT_MS   = 2500;  // longest any one framing may hold
const FIRST_SHOT_MS = 1200;  // the opening shot changes sooner - something has to
                             // move inside the window where the scroll is decided
const MIN_SHOT_MS   = 900;   // shorter than this reads as a flicker, not a cut
const MAX_SHOTS     = 3;     // per beat; past this the cutting is doing the talking
const SHOT_JUMP_MS  = 1500;  // how far past continuous playback the next in-point aims
const MIN_JUMP_MS   = 600;   // ... and the least it may land past it once clamped

// Share a span out between equal shots, within a budget of how many it may use.
function evenShots(durationMs, maxShots) {
  // Nothing to gain from cutting a shot that is already short enough, and
  // nothing to gain from cutting one so hard that both halves flicker.
  if (maxShots < 2 || durationMs <= MAX_SHOT_MS || durationMs < 2 * MIN_SHOT_MS) {
    return [durationMs];
  }

  const byCap   = Math.ceil(durationMs / MAX_SHOT_MS);
  const byFloor = Math.floor(durationMs / MIN_SHOT_MS);
  const count   = Math.max(2, Math.min(maxShots, byCap, byFloor));

  const base = Math.floor(durationMs / count);
  // The last shot carries the rounding, so the shots always add back up to the
  // beat. A beat that is a few milliseconds short of its narration is a few
  // milliseconds of backdrop.
  return Array.from({ length: count }, (_, i) =>
    (i === count - 1 ? durationMs - base * (count - 1) : base));
}

// How to carve a beat's duration into shots. Returns one length per shot, and a
// single-entry list when the beat is too short to be worth cutting.
function shotLengths(durationMs, first) {
  // The opening shot is pinned rather than shared out evenly: its length is the
  // whole point of treating the first beat differently. What remains is then
  // split by the ordinary rule, within what is left of the shot budget - doing
  // it the other way round (pick a count, then pin the first) hands the tail
  // whatever is left over and can leave shots below the floor.
  if (first && durationMs >= FIRST_SHOT_MS + MIN_SHOT_MS) {
    return [FIRST_SHOT_MS, ...evenShots(durationMs - FIRST_SHOT_MS, MAX_SHOTS - 1)];
  }
  return evenShots(durationMs, MAX_SHOTS);
}

// Nudge shot boundaries onto the music's beat grid.
//
// Only the boundaries INSIDE a beat may move. A beat boundary is set by the
// narration and moving it would desynchronise the voice, but a cut within a
// beat is free — nothing depends on exactly where it falls, which is what makes
// this worth doing at all.
//
// The tolerance is small on purpose. Tempo detection finds the pulse but not
// the phase (see utils/clipperTempo.js), so the grid is anchored at the start
// of the video and a track with a lead-in sits slightly off. At three frames a
// wrong phase can only ever move a cut by a shrug; at half a second it would
// drag cuts somewhere nobody asked for.
const SNAP_MS = 100;

function snapLengths(lens, startMs, periodMs) {
  if (!periodMs || lens.length < 2) return lens;

  const out = lens.slice();
  let at = startMs;
  for (let i = 0; i < out.length - 1; i++) {
    const boundary = at + out[i];
    const delta = Math.round(Math.round(boundary / periodMs) * periodMs - boundary);
    // Give the time to the neighbour rather than to the beat, so the shots
    // still add up to exactly the narration.
    if (Math.abs(delta) <= SNAP_MS
      && out[i] + delta >= MIN_SHOT_MS
      && out[i + 1] - delta >= MIN_SHOT_MS) {
      out[i] += delta;
      out[i + 1] -= delta;
    }
    at += out[i];
  }
  return out;
}

// Cover one beat with shots taken from its clip.
function buildShots({
  videoUrl, trimInMs, durationMs, clipDurationSec,
  focus = null, splittable = true, first = false,
  startMs = 0, beatPeriodMs = 0,
}) {
  const single = [{ videoUrl, trimInMs, durationMs, move: 'in', focus }];
  if (!videoUrl || !splittable) return single;

  // Without a clip length there is no telling whether a later in-point has
  // anything behind it, and seeking past the end renders as a frozen frame.
  // One honest shot beats two where the second might be a still.
  if (!clipDurationSec) return single;

  // Snapped before the in-points are worked out, not after, so the clamping
  // below still sees the lengths the shots will actually have.
  const lens = snapLengths(shotLengths(durationMs, first), startMs, beatPeriodMs);
  if (lens.length === 1) return single;

  const shots = [];
  let wanted = trimInMs;

  for (let i = 0; i < lens.length; i++) {
    const inMs = clampTrimIn(wanted, clipDurationSec, lens[i]);
    const prev = shots[i - 1];
    // Clamping pulled this shot back into what the last one already showed, so
    // the clip has run out of new material. Abandon the split entirely rather
    // than cutting to something the viewer has just watched.
    if (prev && inMs - prev.trimInMs < prev.durationMs + MIN_JUMP_MS) return single;

    shots.push({
      videoUrl,
      trimInMs: inMs,
      durationMs: lens[i],
      // Alternating the move stops consecutive shots reading as one long push,
      // and gives the cut a change of direction to land on.
      move: i % 2 === 0 ? 'in' : 'out',
      focus,
    });

    wanted = inMs + lens[i] + SHOT_JUMP_MS;
  }

  return shots;
}

function buildTimeline(script) {
  const beats = script?.script?.beats ?? [];
  const footage = script?.footage ?? {};
  const voiceLines = script?.voice?.lines ?? [];
  const captions = script?.captions ?? null;
  const overlays = Array.isArray(script?.overlays) ? script.overlays : [];

  const sfxRows = Array.isArray(script?.sfx) ? script.sfx : [];

  const lineFor = (beatId) => voiceLines.find(l => l.beatId === beatId) || null;
  const overlayFor = (beatId) => overlays.find(o => o.beatId === beatId) || null;

  // Approved SFX for a beat, falling back to the script writer's cue so a video
  // that skipped the SFX stage still gets its stingers.
  //
  // `words` is the beat's aligned narration, rebased to the beat's own start.
  // Given it, a cue can be placed on a WORD rather than at a millisecond
  // offset, which is the difference between a sound that punctuates the line
  // and one that merely happens during it. Every path degrades to the old
  // behaviour when there is no alignment yet.
  const sfxFor = (beat, words) => {
    // The fallback keys off whether the admin has touched this beat AT ALL, not
    // on whether anything survived the enabled filter. Keying it off the
    // filtered list means switching every sound off resurrects the original
    // cue — the one thing the admin just said they did not want.
    const forBeat = sfxRows.filter(s => s.beatId === beat.id);
    const cueId = beat.sfxCue ? resolveCue(beat.sfxCue) : null;
    const rows = forBeat.length
      ? forBeat.filter(s => s.enabled !== false)
      : (cueId
        ? [{ beatId: beat.id, sfxId: cueId, atMs: 0, atWord: defaultCueWord(cueId, words), gain: 0.6 }]
        : []);

    return rows
      .map(s => ({
        src: sfxPath(s.sfxId),
        atMs: cueTimeMs(s, words),
        gain: s.gain ?? 0.6,
      }))
      .filter(s => s.src);
  };

  const out = [];

  // The music's beat grid, if its tempo is known. Anchored at the start of the
  // video, so `cursor` below is the position a shot boundary would fall at.
  const bpm = Number(script?.music?.bpm) || 0;
  const beatPeriodMs = bpm > 0 ? 60000 / bpm : 0;
  let cursor = 0;

  for (const [index, beat] of beats.entries()) {
    const line = lineFor(beat.id);
    const chosen = footage[beat.id]?.chosen || null;
    const trim = footage[beat.id]?.trim || {};

    // Prefer an overlay the admin edited; fall back to the AI's suggestion so a
    // script that skipped the overlay stage still gets its callouts.
    const overlayRow = overlayFor(beat.id);
    const overlay = overlayRow
      ? { ...overlayRow }
      : (beat.overlay ? { text: beat.overlay, animation: 'pop' } : null);

    // Caption words for this beat, rebased so page timings are relative to the
    // beat's own start — Remotion Sequences are locally timed.
    const beatWords = (captions?.words ?? [])
      .filter(w => w.beatId === beat.id)
      .map(w => ({
        text: w.text,
        startMs: Math.max(0, w.startMs - (line?.startMs ?? 0)),
        endMs:   Math.max(0, w.endMs   - (line?.startMs ?? 0)),
      }));

    const durationMs = Math.max(MIN_BEAT_MS, line?.durationMs ?? 0) || MIN_BEAT_MS;

    const videoUrl = chosen?.playbackUrl || chosen?.downloadUrl || null;
    const trimInMs = clampTrimIn(trim.inMs, chosen?.durationSec, durationMs);

    // A screen recording is a demonstration of something happening, and cutting
    // forward inside one is a jump cut in the middle of it. Captures get their
    // framing corrected instead - most of them waste a fifth of the frame on
    // page background (see constants/clipperCapture.js).
    const isCapture = chosen?.provider === 'capture' || beat.visual?.kind === 'capture';

    const shots = buildShots({
      videoUrl,
      trimInMs,
      durationMs,
      clipDurationSec: chosen?.durationSec,
      focus: isCapture ? focusFor(beat.visual?.recipeId) : null,
      splittable: !isCapture,
      first: index === 0,
      startMs: cursor,
      beatPeriodMs,
    });

    const isTitleCard = index === 0 && String(beat.text || '').trim().length <= HOOK_MAX_CHARS;

    out.push({
      id: beat.id,
      text: beat.text,
      durationMs,
      videoUrl,
      trimInMs,
      shots,
      audioUrl: line?.audioUrl || pathToFileUrl(line?.wavPath),
      overlay,
      sfx: sfxFor(beat, beatWords),
      // The title card already shows this line in full, so the karaoke pages
      // would be the same words a second time.
      captionPages: (!isTitleCard && beatWords.length) ? buildCaptionPages(beatWords) : [],
      isTitleCard,
      isEndCard: false,
    });

    cursor += durationMs;
  }

  // The outro is a real beat so it flows through voice, captions and render
  // like any other — see the note in models/ClipperScript.js.
  if (script?.outro?.enabled && script.outro.copy) {
    const line = lineFor('outro');
    const durationMs = Math.max(END_CARD_MS, line?.durationMs ?? 0);

    // Carry the last beat's clip under the call to action, picking up where
    // that beat left off so the two read as one continuous shot rather than a
    // cut to a title. Without this the video ends on a static panel for its
    // final few seconds, which is where a viewer leaves rather than loops.
    //
    // The in-point is clamped by the same rule as any other beat, so a clip
    // with nothing left to give falls back to a frame it can actually play
    // instead of seeking past its own end.
    const tail = out[out.length - 1] ?? null;
    const tailBeatId = tail?.id ?? null;
    const tailClip = tailBeatId ? footage[tailBeatId]?.chosen : null;

    out.push({
      id: 'outro',
      text: script.outro.copy,
      durationMs,
      videoUrl: tail?.videoUrl ?? null,
      trimInMs: tail?.videoUrl
        ? clampTrimIn((tail.trimInMs ?? 0) + tail.durationMs, tailClip?.durationSec, durationMs)
        : 0,
      audioUrl: line?.audioUrl || pathToFileUrl(line?.wavPath),
      overlay: null,
      sfx: [],
      captionPages: [],
      isTitleCard: false,
      isEndCard: true,
    });
  }

  const totalDurationMs = out.reduce((n, b) => n + b.durationMs, 0);

  return {
    beats: out,
    captionStyle: script?.captions?.style ?? {},
    music: buildMusic(script, out, totalDurationMs),
    totalDurationMs,
  };
}

// The background track, plus the windows where it has to get out of the way.
//
// Ducking is computed here rather than in the composition for the same reason
// beat timing is: this is the one place that knows when narration actually
// plays, so the preview and the render cannot disagree about it. Music at a
// constant level buries the voice; music that ducks on a guess drifts out of
// step with it.
//
// Windows are absolute milliseconds from the start of the video, which is what
// the composition needs to turn them into frames.
function buildMusic(script, beats, totalDurationMs) {
  const music = script?.music;
  if (!music?.file) return null;

  const duckWindows = [];
  let cursor = 0;
  for (const beat of beats) {
    // Only narration ducks. SFX are short and deliberately sit on top, and an
    // end card with no voice is where a track is allowed to come back up.
    if (beat.audioUrl) {
      const last = duckWindows[duckWindows.length - 1];
      // Merge touching windows so a run of narrated beats is one duck rather
      // than a level that pumps between every line.
      if (last && cursor - last.endMs <= 120) last.endMs = cursor + beat.durationMs;
      else duckWindows.push({ startMs: cursor, endMs: cursor + beat.durationMs });
    }
    cursor += beat.durationMs;
  }

  return {
    src: `${MUSIC_DIR}/${music.file}`,
    title: music.title || '',
    licence: music.licence || '',
    volume:     Number.isFinite(music.volume) ? music.volume : 0.18,
    duckVolume: Number.isFinite(music.duckVolume) ? music.duckVolume : 0.06,
    fadeOutMs:  Number.isFinite(music.fadeOutMs) ? music.fadeOutMs : 1500,
    // A track shorter than the video loops; one longer is cut off by the
    // composition's length. Either way the fade lands on the video's end.
    trackDurationMs: Number(music.durationMs) || 0,
    bpm: Number(music.bpm) || null,
    totalDurationMs,
    duckWindows,
  };
}

module.exports = {
  buildTimeline, buildCaptionPages, clampTrimIn, pathToFileUrl, buildMusic,
  buildShots, shotLengths, snapLengths, cueTimeMs, defaultCueWord,
  MIN_BEAT_MS, END_CARD_MS, HOOK_MAX_CHARS,
  MAX_SHOT_MS, FIRST_SHOT_MS, MIN_SHOT_MS, MAX_SHOTS, SHOT_JUMP_MS, MIN_JUMP_MS,
  SNAP_MS,
};
