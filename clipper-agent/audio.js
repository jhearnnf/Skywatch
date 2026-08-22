// ffmpeg audio helpers, shared by the voice and render jobs.
//
// Everything here exists because the finished MP4 was measured rather than
// watched. Two defects showed up that no amount of previewing had caught:
//
//   1. Every Voicebox wav carries silence at both ends. The first render opened
//      with 402ms of dead air and closed with 803ms of it, and because a beat's
//      length is its narration's length, that padding was also stretching every
//      beat and pushing the end card out to 4.2 seconds.
//   2. The mix landed at -18.8 LUFS integrated. Short-form platforms normalise
//      to about -14, so the video played audibly quieter than whatever preceded
//      it in the feed.
//
// Neither is worth failing a job over: a slightly padded or slightly quiet
// video is still a video. Every function here degrades to "leave it alone" when
// ffmpeg is missing or misbehaves, and says so in its return value so the
// caller can report it rather than silently pretending it worked.

const { spawn } = require('child_process');
const fs = require('fs/promises');

// Short-form delivery targets. TP is -1 rather than 0 because the platforms
// re-encode, and a stream that already peaks at 0 clips when they do.
const TARGET = { I: -14, TP: -1, LRA: 7 };

// Silence quieter than this counts as nothing being said. -50dB is below room
// tone but above the noise floor of a synthesised read.
const SILENCE_THRESHOLD = '-50dB';
// What to leave behind. Cutting to the exact first sample clips the attack of a
// plosive, and a line that ends the instant the last vowel does sounds clipped
// off rather than finished.
const HEAD_PAD_SEC = 0.06;
const TAIL_PAD_SEC = 0.12;

// Spawn a tool and collect both streams. ffmpeg writes almost everything of
// interest to stderr, including the loudnorm measurement, so both are kept.
function run(bin, args) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(bin, args);
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('error', () => resolve({ ok: false, missing: true, stdout, stderr }));
    proc.on('exit', code => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}

// Duration of an audio or video file, measured. Returns null when it cannot be
// read — callers fall back to whatever they were told the duration was.
async function probeDurationMs(file) {
  const res = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    file,
  ]);
  if (!res.ok) return null;
  const seconds = Number(String(res.stdout).trim());
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
}

// The filter chain that trims silence from both ends.
//
// silenceremove only works on the front of a stream, so the tail is done by
// reversing, trimming the new front, and reversing back. That is the standard
// idiom and it is cheap here: these are single sentences, not albums.
function trimFilter() {
  const head = `silenceremove=start_periods=1:start_silence=${HEAD_PAD_SEC}`
    + `:start_threshold=${SILENCE_THRESHOLD}:detection=peak`;
  const tail = `silenceremove=start_periods=1:start_silence=${TAIL_PAD_SEC}`
    + `:start_threshold=${SILENCE_THRESHOLD}:detection=peak`;
  return `${head},areverse,${tail},areverse`;
}

// Trim the silence off one narration wav, in place.
//
// Writes to a sibling temp file and swaps, because ffmpeg cannot read and write
// the same path. On any failure the original is left exactly as it was, and
// `trimmed: false` tells the caller the reported duration is still Voicebox's.
async function trimSilence(wavPath) {
  const before = await probeDurationMs(wavPath);
  const tmpPath = `${wavPath}.trim.wav`;

  const res = await run('ffmpeg', [
    '-y', '-v', 'error',
    '-i', wavPath,
    '-af', trimFilter(),
    tmpPath,
  ]);

  if (!res.ok) {
    await fs.rm(tmpPath, { force: true });
    return { trimmed: false, durationMs: before, removedMs: 0, reason: res.missing ? 'ffmpeg not on PATH' : 'ffmpeg failed' };
  }

  const after = await probeDurationMs(tmpPath);

  // A trim that produced nothing, or that we cannot measure, is not a trim we
  // are willing to swap in. Silence detection on an unusually quiet read can
  // eat the whole line, and a silent beat is far worse than a padded one.
  if (!after || after < 200) {
    await fs.rm(tmpPath, { force: true });
    return { trimmed: false, durationMs: before, removedMs: 0, reason: 'trim produced no usable audio' };
  }

  await fs.rm(wavPath, { force: true });
  await fs.rename(tmpPath, wavPath);

  return {
    trimmed: true,
    durationMs: after,
    removedMs: before != null ? Math.max(0, before - after) : 0,
  };
}

// Parse the JSON block loudnorm prints on stderr in measurement mode.
function parseLoudnormJson(stderr) {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(stderr.slice(start, end + 1));
    return parsed.input_i != null ? parsed : null;
  } catch {
    return null;
  }
}

// Bring a finished render to the platform target.
//
// Two passes, not one. Single-pass loudnorm is a dynamic normaliser: it decides
// the gain as it goes and audibly pumps under a ducked music bed. Measuring
// first and then applying a fixed correction is linear, so the mix that was
// approved in the preview is the mix that ships, just at the right level.
//
// The video is stream-copied. Only the audio is touched, so this costs seconds
// rather than another encode.
async function normaliseLoudness(inPath, outPath) {
  const measure = await run('ffmpeg', [
    '-v', 'info', '-nostats',
    '-i', inPath,
    '-af', `loudnorm=I=${TARGET.I}:TP=${TARGET.TP}:LRA=${TARGET.LRA}:print_format=json`,
    '-f', 'null', '-',
  ]);

  if (!measure.ok) {
    return { normalised: false, reason: measure.missing ? 'ffmpeg not on PATH' : 'loudness measurement failed' };
  }

  const stats = parseLoudnormJson(measure.stderr);
  if (!stats) return { normalised: false, reason: 'could not read the loudness measurement' };

  const applied = `loudnorm=I=${TARGET.I}:TP=${TARGET.TP}:LRA=${TARGET.LRA}`
    + `:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}`
    + `:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}`
    + `:offset=${stats.target_offset}:linear=true:print_format=summary`;

  const apply = await run('ffmpeg', [
    '-y', '-v', 'error',
    '-i', inPath,
    '-c:v', 'copy',
    '-af', applied,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    outPath,
  ]);

  if (!apply.ok) {
    await fs.rm(outPath, { force: true });
    return { normalised: false, reason: 'loudness correction failed' };
  }

  return {
    normalised: true,
    measuredLufs: Number(stats.input_i),
    targetLufs: TARGET.I,
  };
}

module.exports = {
  probeDurationMs, trimSilence, normaliseLoudness, parseLoudnormJson, trimFilter,
  TARGET, SILENCE_THRESHOLD, HEAD_PAD_SEC, TAIL_PAD_SEC,
};
