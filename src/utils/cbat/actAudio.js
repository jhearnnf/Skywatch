// ACT (Auditory Capacity Test) audio engine.
//
// Plays sequences of MP3 chunks back-to-back over a shared AudioContext, and
// synthesises the reaction-test bleep at runtime so reaction-time scoring
// isn't skewed by file-load latency.
//
// All MP3s live in /public/sounds/act/ and are decoded once on init.

export const CALLSIGNS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'hotel'];
export const SHAPES    = ['circle', 'square'];

// Combined avoid clips — the connector phrase and shape are baked into a single
// MP3 each ("avoid the next circle.mp3", "avoid the next square.mp3"). Internal
// keys use underscores; the loader translates them to spaces in the URL.
const AVOID_KEYS = SHAPES.map(s => `avoid_the_next_${s}`);

// All audio chunks loaded on init.
const CHUNK_FILES = [
  ...CALLSIGNS,
  ...AVOID_KEYS,
];

// Map internal key → actual filename (no extension). Most are 1:1; the avoid
// keys translate underscores to spaces.
function chunkKeyToFilename(key) {
  if (key.startsWith('avoid_the_next_')) return key.replaceAll('_', ' ');
  return key;
}

export class ActAudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();   // name → AudioBuffer
    this.activeSources = new Set();
    this.bleepListeners = new Set();
    this._lastBleepStartedAt = 0;
    this._staticNodes = null;   // { source, filter, gain, lfoTimer } when static is playing
    this._instructionPlayingUntil = 0;   // audio-ctx time at which the current exclusive sequence ends
  }

  // Lazy-init AudioContext on first user gesture (browsers block autoplay).
  async init() {
    if (this.ctx) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctor();
    await Promise.all(CHUNK_FILES.map(name => this._loadBuffer(name)));
  }

  async _loadBuffer(name) {
    if (this.buffers.has(name)) return;
    const filename = chunkKeyToFilename(name);
    const url = `/sounds/act/${encodeURIComponent(filename)}.mp3`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.buffers.set(name, audioBuffer);
    } catch (err) {
      console.warn(`[ACT] Failed to load ${url}:`, err.message);
    }
  }

  // Play an array of chunk names sequentially. Resolves when the last clip ends.
  // Returns { promise, cancel, played }. `played` is false when the call was
  // dropped because another exclusive sequence is still in progress.
  //
  // `exclusive: true` makes this call skip if another exclusive sequence is
  // currently playing — used for callsign instructions so two voices never
  // overlap.
  playSequence(names, { gap = 0.04, volume = 0.40, exclusive = false } = {}) {
    if (!this.ctx) return { promise: Promise.resolve(), cancel: () => {}, played: false };

    if (exclusive && this._instructionPlayingUntil > this.ctx.currentTime + 0.01) {
      return { promise: Promise.resolve(), cancel: () => {}, played: false };
    }

    let cancelled = false;
    const sources = [];
    let cursor = this.ctx.currentTime + 0.02;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    gain.connect(this.ctx.destination);

    for (const name of names) {
      const buf = this.buffers.get(name);
      if (!buf) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(gain);
      src.start(cursor);
      this.activeSources.add(src);
      src.onended = () => this.activeSources.delete(src);
      sources.push(src);
      cursor += buf.duration + gap;
    }

    if (exclusive) {
      this._instructionPlayingUntil = cursor;
    }

    const totalMs = Math.max(0, (cursor - this.ctx.currentTime) * 1000);
    const promise = new Promise(resolve => setTimeout(resolve, totalMs));

    return {
      promise,
      played: true,
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        for (const src of sources) {
          try { src.stop(); } catch {}
          this.activeSources.delete(src);
        }
      },
    };
  }

  // Synthesised square-wave bleep — sharp, ~220ms, A5 (880Hz).
  // Notifies all bleep listeners with the precise audio-context start time so
  // the game can score reaction time relative to the actual onset.
  playBleep() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.32, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.23);

    this._lastBleepStartedAt = performance.now();
    for (const cb of this.bleepListeners) cb(this._lastBleepStartedAt);
  }

  // Returns the elapsed ms since the most recent bleep onset, or null if none.
  msSinceLastBleep() {
    if (!this._lastBleepStartedAt) return null;
    return performance.now() - this._lastBleepStartedAt;
  }

  onBleep(cb) {
    this.bleepListeners.add(cb);
    return () => this.bleepListeners.delete(cb);
  }

  stopAll() {
    for (const src of this.activeSources) {
      try { src.stop(); } catch {}
    }
    this.activeSources.clear();
    this._instructionPlayingUntil = 0;
  }

  // ── Static / radio-noise distractor ─────────────────────────────────────
  // Plays continuous filtered white noise as a background distractor.
  // The filter's centre frequency wobbles randomly so the texture shifts
  // (like an ill-tuned radio), making it harder to focus on instruction audio.
  startStatic({ volume = 0.07 } = {}) {
    if (!this.ctx) return;
    if (this._staticNodes) return;          // already playing — idempotent

    // Generate ~2 seconds of white noise into a buffer; loop it.
    const bufferLen = Math.floor(this.ctx.sampleRate * 2);
    const buffer = this.ctx.createBuffer(1, bufferLen, this.ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < bufferLen; i++) channel[i] = Math.random() * 2 - 1;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1200;
    filter.Q.value = 0.8;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;

    source.connect(filter).connect(gain).connect(this.ctx.destination);
    source.start();

    // Modulate the filter centre frequency every 350–800ms to a new value
    // in [400, 2400] Hz, ramping smoothly so the texture audibly shifts.
    const lfoTimer = setInterval(() => {
      if (!this.ctx) return;
      const next = 400 + Math.random() * 2000;
      const rampTo = this.ctx.currentTime + 0.25 + Math.random() * 0.4;
      try {
        filter.frequency.cancelScheduledValues(this.ctx.currentTime);
        filter.frequency.linearRampToValueAtTime(next, rampTo);
      } catch {}
    }, 350 + Math.floor(Math.random() * 450));

    this._staticNodes = { source, filter, gain, lfoTimer };
  }

  stopStatic() {
    const nodes = this._staticNodes;
    if (!nodes) return;
    clearInterval(nodes.lfoTimer);
    try {
      // Quick fade so the cut isn't abrupt.
      const t = this.ctx.currentTime;
      nodes.gain.gain.cancelScheduledValues(t);
      nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, t);
      nodes.gain.gain.linearRampToValueAtTime(0, t + 0.15);
      nodes.source.stop(t + 0.18);
    } catch {}
    this._staticNodes = null;
  }

  dispose() {
    this.stopAll();
    this.stopStatic();
    if (this.ctx && this.ctx.state !== 'closed') this.ctx.close();
    this.ctx = null;
  }
}

// ── Callsign helpers ─────────────────────────────────────────────────────

// Pick `count` distinct callsigns at random (no duplicates).
export function pickCallsigns(count) {
  const pool = [...CALLSIGNS];
  const out = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

// Returns true iff `candidate` is a valid distractor for the given user set.
//   - No reorder/permutation of the user's set.
//   - At least 66% of the words in `candidate` are NOT in the user's set.
//     (2-word: both must differ; 3-word: at most 1 may overlap.)
export function isValidDistractor(candidate, userSet) {
  if (candidate.length !== userSet.length) return false;
  const userPool = new Set(userSet);
  const sameSetIgnoringOrder =
    candidate.every(c => userPool.has(c)) &&
    new Set(candidate).size === candidate.length;
  if (sameSetIgnoringOrder) return false;
  const overlap = candidate.filter(c => userPool.has(c)).length;
  const differentRatio = (candidate.length - overlap) / candidate.length;
  return differentRatio >= 0.66;
}

// Generate a distractor callsign array of the same length as userSet.
// Tries up to 30 candidates before giving up (returns null if no valid one
// exists for some reason — shouldn't with 6-callsign pool).
export function generateDistractorCallsign(userSet) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = pickCallsigns(userSet.length);
    if (isValidDistractor(candidate, userSet)) return candidate;
  }
  return null;
}

// Build the chunk-name sequence for an "avoid" instruction.
// One callsign clip per word, plus a single combined "avoid the next <shape>" clip.
export function buildAvoidSequence(callsigns, shape) {
  return [...callsigns, `avoid_the_next_${shape}`];
}
