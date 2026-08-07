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

// Where the whisper archive is unpacked from. See installWhisper below.
const INSTALL_STAGING = path.join(os.tmpdir(), 'skywatch-clipper', 'whisper-install');

// Where the binary lands, mirroring getWhisperExecutablePath in
// @remotion/install-whisper-cpp — which is not part of its public API, so it
// cannot simply be imported. Releases before 1.7.4 put it at the root as
// `main`; later ones use build/bin/whisper-cli. WHISPER_VERSION is pinned
// above, so this only needs revisiting when that moves.
function whisperExecutable() {
  const legacy = WHISPER_VERSION.localeCompare('1.7.4', undefined, { numeric: true }) < 0;
  const name = legacy ? 'main' : 'whisper-cli';
  const folder = legacy ? [] : ['build', 'bin'];
  return path.join(WHISPER_DIR, ...folder, process.platform === 'win32' ? `${name}.exe` : name);
}

// Install whisper.cpp from a directory whose path has no spaces in it.
//
// @remotion/install-whisper-cpp downloads the archive to `process.cwd()` and
// then runs `Expand-Archive -Force <zip> <dest>` through PowerShell — via
// spawn(bin, args, { shell: 'powershell' }), which joins argv into a single
// command string and quotes nothing. This agent's cwd is inside "Cursor
// Projects", so PowerShell split the path at the space, took
// `C:\Users\James\Desktop\Cursor` as the archive, and failed with exit code 1.
//
// The library's quoting is not ours to fix, but the paths it uses are: run the
// install with the cwd pointed at a staging directory under the system temp
// folder, which has no spaces on any normal Windows install.
//
// chdir is process-global. That is safe here only because the agent runs one
// job at a time (see the poll loop in index.js), and it is restored in a
// finally. Every other path in this file is absolute.
async function installWhisper(installWhisperCpp) {
  if (/\s/.test(WHISPER_DIR)) {
    throw new Error(
      `The whisper install path contains a space (${WHISPER_DIR}). The installer passes it to ` +
      'PowerShell unquoted, so it cannot be unpacked there. Set WHISPER_DIR to a path without spaces.',
    );
  }

  // A previous failed extract can leave the folder present but empty, which the
  // installer reports as "exists but the executable is missing. Delete it and
  // try again". Clearing it here makes that recoverable by pressing the button
  // again rather than by reading an error and deleting a folder by hand.
  const { existsSync } = require('fs');
  if (existsSync(WHISPER_DIR) && !existsSync(whisperExecutable())) {
    await fs.rm(WHISPER_DIR, { recursive: true, force: true });
  }

  await fs.mkdir(INSTALL_STAGING, { recursive: true });
  const cwd = process.cwd();
  process.chdir(INSTALL_STAGING);
  try {
    await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION, printOutput: false });
  } finally {
    process.chdir(cwd);
    // The installer deletes the archive on success and leaves it on failure.
    await fs.rm(path.join(INSTALL_STAGING, 'whisper-bin-x64.zip'), { force: true }).catch(() => {});
  }
}

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
  await installWhisper(installWhisperCpp);
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

// Exported for tests and for verifying the install in isolation: unpacking
// whisper is the step that fails on a machine whose paths contain spaces, and
// it should be checkable without transcribing anything.
module.exports.installWhisper = installWhisper;
module.exports.WHISPER_DIR = WHISPER_DIR;
module.exports.whisperExecutable = whisperExecutable;
