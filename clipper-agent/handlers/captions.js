// Captions job — measure WHEN each word was spoken.
//
// Runs whisper.cpp over the narration this agent already produced, one beat at
// a time. The transcript's *words* are thrown away by the backend; only its
// timings survive (see backend/utils/clipperCaptions.js). We know what was said.
//
// Because the text is never trusted, `base.en` is the right model: a larger one
// would transcribe more accurately, which is precisely the thing we do not need,
// while costing 1.5GB and several times the runtime. Timing accuracy between
// base and medium is not meaningfully different for clean synthetic speech.

const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const { spawn } = require('child_process');

const WHISPER_VERSION = '1.5.5';
const MODEL = process.env.WHISPER_MODEL || 'base.en';
const WHISPER_DIR = process.env.WHISPER_DIR || path.join(os.homedir(), '.skywatch-whisper');

// whisper.cpp only accepts 16kHz mono PCM. Voicebox emits 24kHz, so every file
// has to be converted first — feeding it the raw wav produces silence or noise,
// not an error, which is a nasty way to find out.
function toWhisperWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-i', inputPath,
      '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
      outputPath,
    ], { stdio: 'ignore' });
    ff.on('error', () => reject(new Error('ffmpeg not found on PATH - required to prepare audio for whisper')));
    ff.on('exit', code => code === 0 ? resolve(outputPath) : reject(new Error(`ffmpeg exited ${code}`)));
  });
}

module.exports = async function captionsHandler({ job, progress }) {
  const { installWhisperCpp, downloadWhisperModel, transcribe, toCaptions } =
    require('@remotion/install-whisper-cpp');

  const lines = job.payload?.lines ?? [];
  if (lines.length === 0) throw new Error('captions job has no narration lines');

  await progress(3, 'preparing whisper');
  await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION, printOutput: false });
  await downloadWhisperModel({ model: MODEL, folder: WHISPER_DIR, printOutput: false });

  const tmp = path.join(os.tmpdir(), 'skywatch-clipper', 'whisper');
  await fs.mkdir(tmp, { recursive: true });

  const byBeat = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    await progress(
      Math.round(10 + (i / lines.length) * 85),
      `timing beat ${i + 1} of ${lines.length}`,
    );

    try {
      const wav16 = path.join(tmp, `${line.beatId}-16k.wav`);
      await toWhisperWav(line.wavPath, wav16);

      const { transcription } = await transcribe({
        inputPath: wav16,
        model: MODEL,
        whisperPath: WHISPER_DIR,
        whisperCppVersion: WHISPER_VERSION,
        tokenLevelTimestamps: true,
        printOutput: false,
      });

      const { captions } = toCaptions({ whisperCppOutput: { transcription } });
      byBeat[line.beatId] = (captions ?? [])
        .filter(c => c.text && c.text.trim())
        .map(c => ({ text: c.text.trim(), startMs: Math.round(c.startMs), endMs: Math.round(c.endMs) }));
    } catch (err) {
      // One unreadable line should not lose the whole set. The backend spreads
      // an empty beat evenly across its known duration, so captions still show.
      byBeat[line.beatId] = [];
    }
  }

  await progress(100, 'done');
  return { model: MODEL, byBeat };
};
