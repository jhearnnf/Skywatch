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

    lines.push({
      beatId: beat.id,
      text,
      wavPath,
      generationId: result.generationId,
      durationMs: result.durationMs,
      startMs: offsetMs,
    });
    offsetMs += result.durationMs;
  }

  await progress(100, 'done');

  return {
    provider: 'voicebox',
    profileId: payload.profileId,
    lines,
    totalDurationMs: offsetMs,
  };
};
