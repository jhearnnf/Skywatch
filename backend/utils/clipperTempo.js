// Tempo detection for the music library.
//
// ── Why ─────────────────────────────────────────────────────────────────────
// Until shots existed there was roughly one cut per spoken beat, and beat
// boundaries are set by the narration — so there was nothing to align to
// anything. Now that a beat can carry two or three shots, those internal
// boundaries are free: nothing depends on exactly where they fall. Landing them
// on the music is the cheapest rhythm a video can have.
//
// ── How ─────────────────────────────────────────────────────────────────────
// An onset-strength envelope and an autocorrelation over it. Decode to mono at
// 8kHz (tempo lives far below the frequencies that would need more), take the
// RMS of short frames, keep only the RISES in energy — a drop in level is not
// an onset — and look for the lag at which that signal best repeats.
//
// This is the plain version of what every beat tracker does. It is good on
// anything with a drum in it and honest about the rest: `confidence` is the
// autocorrelation peak against the mean, and a weak peak is reported rather
// than rounded up into a number that looks authoritative.
//
// ── Octave errors, and why the bias runs the way it does ────────────────────
// Half and double tempo both correlate, so any tracker of this kind sometimes
// answers 87 for a 174bpm track. Measured against synthetic click tracks that
// is the only failure this one has, and it only ever errs SLOW — 60, 70 and 75
// come back exactly, never doubled.
//
// That direction is the safe one for what the number is used for. A half-tempo
// grid is every other real beat, so a cut snapped to it still lands on the
// music; a double-tempo grid would put half its lines between beats. The
// preference weighting below is tuned to keep the error on that side rather
// than to eliminate it.
//
// ── What it does not do ─────────────────────────────────────────────────────
// It finds the tempo, not the phase. Nothing here knows where beat one is, so
// the grid used downstream is anchored at the start of the video and a track
// with a lead-in will be a fraction of a beat out. That is why the snap
// tolerance is small: a wrong phase can only ever move a cut by a few frames,
// which is a shrug, where a large tolerance would drag cuts somewhere nobody
// asked for.
//
// Everything degrades to "no idea" rather than to a wrong answer, in the same
// way clipper-agent/audio.js degrades to "leave it alone". ffmpeg missing is
// the ordinary case on a deployed backend, and Clipper only runs locally.

const { spawn } = require('child_process');

const SAMPLE_RATE = 8000;
// 128 samples is 16ms, so the envelope runs at 62.5Hz. Fine enough to separate
// 180bpm from 190bpm, coarse enough that the autocorrelation stays cheap.
const HOP = 128;
const ENVELOPE_HZ = SAMPLE_RATE / HOP;

const MIN_BPM = 60;
const MAX_BPM = 180;

// Half-tempo and double-tempo both correlate, so a bare peak pick reports 70bpm
// for a 140bpm track about as often as not. Weighting towards the middle of the
// range is the standard fix and costs nothing on tracks that were never
// ambiguous.
const PREFERRED_BPM = 120;
const PREFERENCE_WIDTH = 0.9;   // in octaves; wide enough not to force an answer

// Below this the peak is not meaningfully above the noise, and a number would
// be worse than no number.
const MIN_CONFIDENCE = 1.35;

// Decode to raw mono PCM. Returns null when ffmpeg is not installed, which is
// the ordinary state anywhere but the workstation.
function decodePcm(file) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('ffmpeg', [
        '-v', 'error', '-i', file,
        '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', '-',
      ]);
    } catch {
      resolve(null);
      return;
    }

    const chunks = [];
    let bytes = 0;
    // Ten minutes of audio is far more than any bed we would use, and stops a
    // mis-set path from buffering something enormous.
    const LIMIT = SAMPLE_RATE * 2 * 600;

    proc.stdout.on('data', (c) => {
      if (bytes >= LIMIT) return;
      chunks.push(c);
      bytes += c.length;
    });
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      if (code !== 0 || bytes === 0) { resolve(null); return; }
      resolve(Buffer.concat(chunks, Math.min(bytes, LIMIT)));
    });
  });
}

// Frame RMS, then keep only the increases. A fall in level is the tail of a
// sound, not the start of one, and including it smears every onset.
function onsetEnvelope(pcm) {
  const samples = Math.floor(pcm.length / 2);
  const frames = Math.floor(samples / HOP);
  if (frames < 4) return [];

  const rms = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * HOP;
    for (let i = 0; i < HOP; i++) {
      const v = pcm.readInt16LE((start + i) * 2) / 32768;
      sum += v * v;
    }
    rms[f] = Math.sqrt(sum / HOP);
  }

  const out = new Float64Array(frames - 1);
  for (let f = 1; f < frames; f++) out[f - 1] = Math.max(0, rms[f] - rms[f - 1]);
  return out;
}

// Autocorrelation of the envelope at one lag, mean-removed so a loud track does
// not simply score higher than a quiet one.
function correlate(env, mean, lag) {
  let sum = 0;
  const n = env.length - lag;
  if (n <= 0) return 0;
  for (let i = 0; i < n; i++) sum += (env[i] - mean) * (env[i + lag] - mean);
  return sum / n;
}

// Sub-frame peak position from the two samples either side of it. Without this
// the answer is quantised to whole envelope frames, which at fast tempos is
// several bpm.
function refinePeak(scores, i) {
  const [a, b, c] = [scores[i - 1] ?? 0, scores[i], scores[i + 1] ?? 0];
  const denom = a - 2 * b + c;
  if (denom === 0) return i;
  return i + (0.5 * (a - c)) / denom;
}

function bpmFromEnvelope(env) {
  if (env.length < ENVELOPE_HZ * 4) return { bpm: null, confidence: 0, reason: 'track too short to measure' };

  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;

  const minLag = Math.floor((60 / MAX_BPM) * ENVELOPE_HZ);
  const maxLag = Math.ceil((60 / MIN_BPM) * ENVELOPE_HZ);

  const scores = new Float64Array(maxLag + 2);
  let best = -Infinity, bestLag = 0, total = 0, counted = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    const raw = correlate(env, mean, lag);
    const bpm = (60 * ENVELOPE_HZ) / lag;
    // Gaussian in log-tempo space: symmetric between half and double, which is
    // exactly the pair being told apart.
    const octaves = Math.log2(bpm / PREFERRED_BPM);
    const weighted = raw * Math.exp(-0.5 * (octaves / PREFERENCE_WIDTH) ** 2);

    scores[lag] = weighted;
    total += Math.abs(weighted);
    counted++;
    if (weighted > best) { best = weighted; bestLag = lag; }
  }

  const avg = counted ? total / counted : 0;
  if (!bestLag || best <= 0 || avg <= 0) {
    return { bpm: null, confidence: 0, reason: 'no repeating pulse found' };
  }

  const confidence = best / avg;
  if (confidence < MIN_CONFIDENCE) {
    return { bpm: null, confidence, reason: 'pulse too weak to trust' };
  }

  const lag = refinePeak(scores, bestLag);
  return { bpm: Math.round(((60 * ENVELOPE_HZ) / lag) * 10) / 10, confidence };
}

// The tempo of one audio file, or null with a reason.
async function detectBpm(file) {
  const pcm = await decodePcm(file);
  if (!pcm) return { bpm: null, confidence: 0, reason: 'ffmpeg is not available' };
  return bpmFromEnvelope(onsetEnvelope(pcm));
}

module.exports = {
  detectBpm, bpmFromEnvelope, onsetEnvelope, refinePeak,
  SAMPLE_RATE, HOP, ENVELOPE_HZ, MIN_BPM, MAX_BPM, MIN_CONFIDENCE,
};
