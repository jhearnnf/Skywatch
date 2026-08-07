// How much footage a beat actually uses.
//
// The trim window is not a free selection: a beat lasts exactly as long as its
// narration, so the amount of footage that reaches the screen is fixed and only
// its *position* in the clip is yours to choose. This works out that length so
// the scrubber and the render agree about it.
//
// Mirrors backend/utils/clipperTimeline.js — the same floor, and the same
// preference for measured audio over any estimate.

// Matches MIN_BEAT_MS in clipperTimeline.js: a beat with no audio still needs
// to be on screen long enough to be seen.
export const MIN_BEAT_MS = 800;

// Words per second, matching the backend's estDurationSec (wordCount / 2.6).
// Only ever used before narration exists.
const WORDS_PER_SECOND = 2.6;

const wordsIn = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

// { ms, estimated }. `estimated` is true when the length came from word count
// rather than from recorded audio, so the UI can say so instead of implying a
// precision it does not have.
export function beatWindow(script, beatId) {
  const line = (script?.voice?.lines ?? []).find(l => l.beatId === beatId);
  if (line?.durationMs) {
    return { ms: Math.max(MIN_BEAT_MS, line.durationMs), estimated: false };
  }

  const beat = (script?.script?.beats ?? []).find(b => b.id === beatId);
  const words = wordsIn(beat?.text);
  if (!words) return { ms: MIN_BEAT_MS, estimated: true };

  return {
    ms: Math.max(MIN_BEAT_MS, Math.round((words / WORDS_PER_SECOND) * 1000)),
    estimated: true,
  };
}

// Keep an in-point inside the clip, given the window that has to fit after it.
// A clip shorter than the window can only start at 0 — there is nowhere to
// slide to, and a negative maximum would let the window run off the front.
export function clampInMs(inMs, clipDurationMs, windowMs) {
  const maxIn = Math.max(0, (clipDurationMs || 0) - (windowMs || 0));
  return Math.min(Math.max(0, Math.round(inMs || 0)), maxIn);
}
