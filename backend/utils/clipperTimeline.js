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

const { resolveCue, sfxPath } = require('../constants/clipperSfx');
const { MUSIC_DIR } = require('../constants/clipperMusic');

const MIN_BEAT_MS = 800;       // a beat with no audio still needs to be seen
const END_CARD_MS = 2200;

// Group word timings into caption pages. Short-form captions show 3-4 words at
// a time: enough to read in one saccade, few enough that the highlighted word
// is always findable.
function buildCaptionPages(words, { maxWords = 4, maxGapMs = 700 } = {}) {
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

  for (const word of words) {
    const prev = current[current.length - 1];
    // A pause in the delivery is a natural page break — splitting there keeps
    // captions in step with phrasing rather than cutting mid-thought.
    if (prev && word.startMs - prev.endMs > maxGapMs) flush();
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
  const sfxFor = (beat) => {
    // The fallback keys off whether the admin has touched this beat AT ALL, not
    // on whether anything survived the enabled filter. Keying it off the
    // filtered list means switching every sound off resurrects the original
    // cue — the one thing the admin just said they did not want.
    const forBeat = sfxRows.filter(s => s.beatId === beat.id);
    const rows = forBeat.length
      ? forBeat.filter(s => s.enabled !== false)
      : (beat.sfxCue ? [{ beatId: beat.id, sfxId: resolveCue(beat.sfxCue), atMs: 0, gain: 0.6 }] : []);

    return rows
      .map(s => ({ src: sfxPath(s.sfxId), atMs: Math.max(0, Number(s.atMs) || 0), gain: s.gain ?? 0.6 }))
      .filter(s => s.src);
  };

  const out = [];

  for (const beat of beats) {
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

    out.push({
      id: beat.id,
      text: beat.text,
      durationMs,
      videoUrl: chosen?.playbackUrl || chosen?.downloadUrl || null,
      trimInMs: clampTrimIn(trim.inMs, chosen?.durationSec, durationMs),
      audioUrl: line?.audioUrl || pathToFileUrl(line?.wavPath),
      overlay,
      sfx: sfxFor(beat),
      captionPages: beatWords.length ? buildCaptionPages(beatWords) : [],
      isEndCard: false,
    });
  }

  // The outro is a real beat so it flows through voice, captions and render
  // like any other — see the note in models/ClipperScript.js.
  if (script?.outro?.enabled && script.outro.copy) {
    const line = lineFor('outro');
    out.push({
      id: 'outro',
      text: script.outro.copy,
      durationMs: Math.max(END_CARD_MS, line?.durationMs ?? 0),
      videoUrl: null,
      trimInMs: 0,
      audioUrl: line?.audioUrl || pathToFileUrl(line?.wavPath),
      overlay: null,
      sfx: [],
      captionPages: [],
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
    totalDurationMs,
    duckWindows,
  };
}

module.exports = {
  buildTimeline, buildCaptionPages, clampTrimIn, pathToFileUrl, buildMusic,
  MIN_BEAT_MS, END_CARD_MS,
};
