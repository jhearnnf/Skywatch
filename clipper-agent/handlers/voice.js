// Voice job — narrate every beat of a script.
//
// One generation per beat, not one for the whole script. That gives an exact
// per-beat duration straight from Voicebox, which is what the timeline needs to
// place footage and captions, and it means re-recording one line does not
// invalidate the rest.
//
// It is tempting to go finer still (a generation per caption group would hand
// us word-level timing for free) but each generation is a separate utterance:
// chopping mid-sentence makes the delivery robotic. Caption timing is solved at
// the captions stage instead.

const path = require('path');
const os = require('os');
const voicebox = require('../voicebox');
const audio = require('../audio');

const WORK_DIR = path.join(os.tmpdir(), 'skywatch-clipper');

module.exports = async function voiceHandler({ job, progress }) {
  const { scriptId, payload } = job;
  const beats = Array.isArray(payload?.beats) ? payload.beats : [];
  if (beats.length === 0) throw new Error('voice job has no beats');
  if (!payload?.profileId) throw new Error('voice job has no Voicebox profileId');

  await progress(2, 'starting voicebox');
  await voicebox.ensureRunning({ log: () => {} });

  const lines = [];
  let offsetMs = 0;
  let trimmedMs = 0;

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const text = String(beat.text || '').trim();
    if (!text) continue;

    await progress(
      Math.round(5 + (i / beats.length) * 90),
      `narrating beat ${i + 1} of ${beats.length}`,
    );

    const result = await voicebox.synthesise({
      text,
      profileId: payload.profileId,
      instruct:  payload.instruct,
      // Derive a per-beat seed from the script's so each line is stable
      // individually — a fixed seed across every beat would be reproducible but
      // would also push identical prosody onto every sentence.
      seed: Number.isInteger(payload.seed) ? payload.seed + i : undefined,
    });

    const wavPath = path.join(WORK_DIR, String(scriptId), `${beat.id}.wav`);
    await voicebox.downloadAudio(result.generationId, wavPath);

    // Trim the silence Voicebox leaves at both ends of every generation.
    //
    // This is not cosmetic. A beat lasts exactly as long as its narration, so
    // padding on the wav becomes padding in the video: the first measured
    // render opened on 402ms of dead air, held 403ms between two beats, and
    // ran the end card 803ms past the last word. Trimming here rather than at
    // render time keeps the one duration everything downstream trusts honest,
    // and means whisper aligns captions against the same audio that ships.
    const trim = await audio.trimSilence(wavPath);
    const durationMs = trim.durationMs ?? result.durationMs;
    trimmedMs += trim.removedMs ?? 0;

    lines.push({
      beatId: beat.id,
      text,
      wavPath,
      generationId: result.generationId,
      durationMs,
      startMs: offsetMs,
      // Kept so a beat that could not be trimmed is visible in the job result
      // rather than quietly reintroducing the padding it was meant to remove.
      silenceTrimmed: trim.trimmed === true,
    });
    offsetMs += durationMs;
  }

  await progress(100, 'done');

  return {
    provider: 'voicebox',
    profileId: payload.profileId,
    lines,
    totalDurationMs: offsetMs,
    silenceTrimmedMs: trimmedMs,
  };
};
