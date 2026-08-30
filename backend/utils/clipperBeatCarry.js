// What survives when a script's beats are rewritten.
//
// ── The bug this exists to stop ─────────────────────────────────────────────
// Beat ids are positional: the writer returns b1, b2, b3… and a regenerated
// script reuses the same ids for entirely different lines. Every later stage is
// keyed by beat id — footage[beatId], voice.lines[].beatId, the sfx and overlay
// rows — so a regenerate leaves the old script's work attached to whatever line
// now occupies that slot.
//
// Marking downstream stages 'stale' rather than wiping them is deliberate (see
// models/ClipperScript.js): hand-tuned work should not be silently destroyed.
// But that only holds while a beat is still the same beat. When it isn't,
// "stale" understates the problem — the data is not out of date, it belongs to
// something else, and it looks chosen. The failure that prompted this: a FLAG
// script regenerated with capture beats at b2 and b5 showed the previous
// script's Pexels jet clips there, so the footage stage offered no gameplay and
// no sign that a recording was missing.
//
// ── The rule ────────────────────────────────────────────────────────────────
// A beat keeps its artefacts only if it is recognisably the same beat: same
// spoken line and same visual instruction. One exception, in keepRecording — a
// screen recording is of a game, not of a sentence, so a capture beat still
// pointed at the same recipe keeps its recording when only the wording moved.
// Re-recording is twenty-five seconds of browser automation; nothing about the
// footage got any less true.

// The identity of a beat, for the purposes of "is this still the thing that
// work was done for". Text and visual only: factKeys, sfxCue and overlay are
// either downstream of those or are themselves the artefact being judged.
function beatFingerprint(beat) {
  if (!beat) return null;
  const visual = beat.visual || {};
  return JSON.stringify([
    String(beat.text ?? '').trim(),
    visual.kind || 'stock',
    String(visual.query ?? '').trim(),
    String(visual.recipeId ?? '').trim(),
  ]);
}

const isCapture = (beat) => (beat?.visual?.kind || 'stock') === 'capture';

// Which beat ids may carry work forward, and on what terms.
//
//   keep          - identical beat; everything made for it still applies.
//   keepRecording - a capture beat on the same recipe whose line was rewritten;
//                   the recording survives, the stock search around it does not.
function planBeatCarry(previousBeats, nextBeats) {
  const before = new Map();
  for (const beat of previousBeats || []) {
    if (beat?.id) before.set(String(beat.id), beat);
  }

  const keep = new Set();
  const keepRecording = new Set();

  for (const beat of nextBeats || []) {
    const id  = String(beat?.id ?? '');
    const was = before.get(id);
    if (!was) continue;

    if (beatFingerprint(was) === beatFingerprint(beat)) {
      keep.add(id);
    } else if (isCapture(was) && isCapture(beat)
               && String(was.visual?.recipeId ?? '') === String(beat.visual?.recipeId ?? '')
               && beat.visual?.recipeId) {
      keepRecording.add(id);
    }
  }

  return { keep, keepRecording };
}

// footage: { [beatId]: { term, candidates[], chosen, trim } }
//
// `beatsById` is consulted for one invariant worth enforcing everywhere rather
// than only on the path that broke it: a capture beat must never hold a clip
// that is not a recording. That is what a viewer of the footage stage reads as
// "this beat is handled", and for a capture beat it is the exact opposite.
function pruneFootage(footage, plan, nextBeats) {
  const beatsById = new Map((nextBeats || []).map(b => [String(b?.id ?? ''), b]));
  const out = {};

  for (const [beatId, entry] of Object.entries(footage || {})) {
    if (!entry) continue;
    const beat = beatsById.get(beatId);
    const chosenIsRecording = entry.chosen?.provider === 'capture';

    if (plan.keep.has(beatId)) {
      out[beatId] = isCapture(beat) && entry.chosen && !chosenIsRecording
        ? { ...entry, chosen: null }
        : entry;
      continue;
    }

    // The line moved but the camera did not. Keep the recording and its trim;
    // the term and candidates were a search for words that are gone.
    if (plan.keepRecording.has(beatId) && chosenIsRecording) {
      out[beatId] = { chosen: entry.chosen, ...(entry.trim ? { trim: entry.trim } : {}) };
    }
  }

  return out;
}

// Lay narration lines out in the script's own beat order (outro last, exactly
// as buildTimeline does) and rebase every startMs from zero.
//
// startMs is where a line sits in the finished narration and is what captions
// are rebased against, so a dropped or replaced take slides everything after it
// out of step unless the offsets are rebuilt rather than trusted.
function placeVoiceLines(lines, order) {
  const byId = new Map((lines || []).filter(l => l?.beatId).map(l => [l.beatId, l]));

  let offsetMs = 0;
  const placed = order
    .map(id => byId.get(id))
    .filter(Boolean)
    .map(line => {
      const withOffset = { ...line, startMs: offsetMs };
      offsetMs += Number(line.durationMs) || 0;
      return withOffset;
    });

  return { lines: placed, totalDurationMs: offsetMs };
}

// A take is the sound of a specific sentence, so only an identical beat keeps
// one. keepRecording has no say here: the recipe being unchanged says nothing
// about the words.
function pruneVoice(voice, plan, nextBeats, outroSurvives) {
  if (!voice) return voice ?? null;

  const kept = (Array.isArray(voice.lines) ? voice.lines : []).filter(line => (
    line?.beatId === 'outro' ? outroSurvives : plan.keep.has(String(line?.beatId ?? ''))
  ));

  const order = [...(nextBeats || []).map(b => String(b?.id ?? '')), 'outro'];
  const { lines, totalDurationMs } = placeVoiceLines(kept, order);

  return { ...voice, lines, totalDurationMs };
}

// sfx rows, overlay rows and caption words are all flat and all carry a beatId
// and a time within that beat. A rewritten line invalidates the timing as
// surely as it invalidates the cue.
//
// `extraIds` is for 'outro', which is a real beat to every stage after the
// script but is not in the beats array, so no plan can speak for it.
function pruneBeatRows(rows, plan, extraIds = []) {
  const allowed = new Set([...plan.keep, ...extraIds]);
  return (Array.isArray(rows) ? rows : []).filter(r => allowed.has(String(r?.beatId ?? '')));
}

module.exports = {
  beatFingerprint,
  planBeatCarry,
  pruneFootage,
  placeVoiceLines,
  pruneVoice,
  pruneBeatRows,
};
