// ACT (Auditory Capacity Test) audio engine.
//
// Plays sequences of MP3 chunks back-to-back over a shared AudioContext, and
// synthesises the reaction-test bleep at runtime so reaction-time scoring
// isn't skewed by file-load latency.
//
// All MP3s live in /public/sounds/act/ and are decoded once on init.

export const CALLSIGNS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'hotel'];
export const SHAPES    = ['circle', 'square'];

// Each clip exists as a male_ and female_ variant; one voice is chosen at
// random per instruction sequence so the speaker changes throughout the game
// without flipping mid-sentence.
export const VOICES = ['male', 'female'];

// Combined avoid clips — the connector phrase and shape are baked into a single
// MP3 each ("avoid the next circle.mp3", "avoid the next square.mp3"). Internal
// keys use underscores; the loader translates them to spaces in the URL.
const AVOID_KEYS = SHAPES.map(s => `avoid_the_next_${s}`);

// Voice-agnostic chunk identifiers. Voice prefix is added at load + play time.
const CHUNK_FILES = [
  ...CALLSIGNS,
  ...AVOID_KEYS,
];

// Map internal key → actual filename body (no voice prefix, no extension).
// Most are 1:1; the avoid keys translate underscores to spaces.
function chunkKeyToFilename(key) {
  if (key.startsWith('avoid_the_next_')) return key.replaceAll('_', ' ');
  return key;
}

// Buffer-map key for a given voice + chunk pair.
function bufferKey(voice, name) {
  return `${voice}:${name}`;
}

// ── Distraction chatter ─────────────────────────────────────────────────────
// Two long mono recordings (`distractions_male.mp3`, `distractions_female.mp3`)
// of unrelated chatter. On load we slice each into N evenly-spaced windows;
// at play time we pick one at random and play it as a sub-region of the
// loaded buffer (no extra fetches). The two chatter voices are different
// speakers from the instruction voices, so distractions can freely overlap
// instructions; the only rule is a chatter voice can never overlap itself.

const DISTRACTION_SEGMENT_COUNT = 10;
const DISTRACTION_BUMPER_S = 0.5;        // skip this much head/tail to avoid silence/fades
const DISTRACTION_MIN_S = 2;
const DISTRACTION_MAX_S = 4;

// Carve `count` non-overlapping {offset, duration} windows from a chatter file
// of length `totalDuration`. Each window is 2–4s, placed randomly inside its
// equally-sized chunk so successive plays don't always hit the same content.
export function computeDistractionSegments(totalDuration, count = DISTRACTION_SEGMENT_COUNT) {
  const usable = Math.max(0, totalDuration - 2 * DISTRACTION_BUMPER_S);
  if (usable <= 0 || count <= 0) return [];
  const chunk = usable / count;
  const segs = [];
  for (let i = 0; i < count; i++) {
    const chunkStart = DISTRACTION_BUMPER_S + i * chunk;
    const wantedDur = DISTRACTION_MIN_S + Math.random() * (DISTRACTION_MAX_S - DISTRACTION_MIN_S);
    const segDur = Math.min(wantedDur, Math.max(0.5, chunk - 0.1));
    const offset = chunkStart + Math.random() * Math.max(0, chunk - segDur);
    segs.push({ offset, duration: segDur });
  }
  return segs;
}

// Default per-sound gain values when admin settings haven't been applied. Match
// the legacy hardcoded values so an admin who never touches the sliders gets
// exactly the previous behaviour.
const DEFAULT_VOLUMES = {
  voiceCommand: 0.40,
  chatter:      0.40,
  staticNoise:  0.40,
  bleep:        0.22,
};

export class ActAudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();   // voice:name → AudioBuffer
    this.activeSources = new Set();
    this.bleepListeners = new Set();
    this._lastBleepStartedAt = 0;
    this._staticNodes = null;   // { source, filter, gain, lfoTimer } when static is playing
    this._instructionPlayingUntil = 0;   // audio-ctx time at which the current exclusive sequence ends
    this.distractionBuffers = new Map();        // voice → AudioBuffer (full chatter file)
    this._distractionSegments = new Map();      // voice → [{ offset, duration }, …]
    this._distractionBusyUntil = { male: 0, female: 0 };   // audio-ctx time per voice
    // Per-sound gain (0–1) + on/off flags. Updated by CbatAct after reading
    // AppSettings — see setVolumes(). Each play method honours these unless an
    // explicit volume override is passed (kept for the preview path).
    this._volumes = { ...DEFAULT_VOLUMES };
    this._enabled = { voiceCommand: true, chatter: true, staticNoise: true, bleep: true };
  }

  // Apply admin-configured per-sound levels. Pass any subset; missing keys are
  // left at their previous values. `volumes` are 0–1 gains; `enabled` flips
  // an entire sound off without zeroing the slider.
  setVolumes({ volumes = {}, enabled = {} } = {}) {
    this._volumes = { ...this._volumes, ...volumes };
    this._enabled = { ...this._enabled, ...enabled };
    // Live-update the running static node (if any) so an admin slider change
    // takes effect without restarting the round. Cancel any scheduled fade
    // first — otherwise an in-flight fade-in would keep ramping toward the
    // old target and overwrite the new value a moment later.
    if (this._staticNodes && this.ctx) {
      try {
        const target = this._enabled.staticNoise ? this._volumes.staticNoise : 0;
        const g = this._staticNodes.gain.gain;
        const t = this.ctx.currentTime;
        g.cancelScheduledValues(t);
        g.setValueAtTime(target, t);
      } catch {}
    }
  }

  // Lazy-init AudioContext on first user gesture (browsers block autoplay).
  async init() {
    if (this.ctx) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctor();
    const jobs = [];
    for (const voice of VOICES) {
      for (const name of CHUNK_FILES) jobs.push(this._loadBuffer(voice, name));
      jobs.push(this._loadDistractionBuffer(voice));
    }
    await Promise.all(jobs);
  }

  async _loadDistractionBuffer(voice) {
    if (this.distractionBuffers.has(voice)) return;
    const url = `/sounds/act/distractions_${voice}.mp3`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.distractionBuffers.set(voice, audioBuffer);
      this._distractionSegments.set(voice, computeDistractionSegments(audioBuffer.duration));
    } catch (err) {
      console.warn(`[ACT] Failed to load ${url}:`, err.message);
    }
  }

  async _loadBuffer(voice, name) {
    const key = bufferKey(voice, name);
    if (this.buffers.has(key)) return;
    const filename = `${voice}_${chunkKeyToFilename(name)}`;
    const url = `/sounds/act/${encodeURIComponent(filename)}.mp3`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.buffers.set(key, audioBuffer);
    } catch (err) {
      console.warn(`[ACT] Failed to load ${url}:`, err.message);
    }
  }

  // Pick a voice for a fresh sequence. Random by default; overridable in tests.
  _pickVoice() {
    return VOICES[Math.floor(Math.random() * VOICES.length)];
  }

  // Play an array of chunk names sequentially. Resolves when the last clip ends.
  // Returns { promise, cancel, played }. `played` is false when the call was
  // dropped because another exclusive sequence is still in progress.
  //
  // `exclusive: true` makes this call skip if another exclusive sequence is
  // currently playing — used for callsign instructions so two voices never
  // overlap.
  playSequence(names, { gap = 0.04, volume, exclusive = false, voice } = {}) {
    if (!this.ctx) return { promise: Promise.resolve(), cancel: () => {}, played: false };

    if (exclusive && this._instructionPlayingUntil > this.ctx.currentTime + 0.01) {
      return { promise: Promise.resolve(), cancel: () => {}, played: false };
    }

    // Apply admin-configured volume + enabled flag. Explicit `volume` override
    // wins (preview path); otherwise the engine's stored voice-command gain
    // applies. When the sound is disabled we bail with `played: false` so the
    // exclusive-instruction window isn't reserved for a silent call.
    if (volume === undefined) {
      if (!this._enabled.voiceCommand) return { promise: Promise.resolve(), cancel: () => {}, played: false };
      volume = this._volumes.voiceCommand;
    }

    // One voice per sequence so a sentence doesn't flip speakers mid-utterance.
    const chosenVoice = voice && VOICES.includes(voice) ? voice : this._pickVoice();

    let cancelled = false;
    const sources = [];
    let cursor = this.ctx.currentTime + 0.02;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    gain.connect(this.ctx.destination);

    for (const name of names) {
      const buf = this.buffers.get(bufferKey(chosenVoice, name));
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

  // Synthesised sine-wave bleep — softened attack, ~440ms total, E5 (660Hz).
  // Sine (was square) drops the bright odd harmonics that punch through the
  // bandpassed static; the slower 20 ms attack (was 5 ms) removes the audible
  // click on onset; peak gain is admin-configurable (default 0.22) so the
  // noise floor partially masks the tone. Still detectable for reaction-time
  // scoring — just no longer obvious over the static.
  // Notifies all bleep listeners with the precise audio-context start time so
  // the game can score reaction time relative to the actual onset.
  playBleep({ volume } = {}) {
    if (!this.ctx) return;
    if (volume === undefined) {
      if (!this._enabled.bleep) return;
      volume = this._volumes.bleep;
    }
    if (volume <= 0) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.020);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.44);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.46);

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

  // Play a random pre-sliced chatter segment for the given voice.
  // Same-voice rule: drops if this voice is still mid-segment so two male (or
  // two female) chatter clips never overlap. Distraction voices are different
  // speakers from the instruction voices, so this does not consult
  // `_instructionPlayingUntil` — chatter freely overlaps instruction audio.
  playDistraction({ voice, volume } = {}) {
    if (!this.ctx) return { played: false, cancel: () => {} };
    if (!voice || !VOICES.includes(voice)) return { played: false, cancel: () => {} };

    if (volume === undefined) {
      if (!this._enabled.chatter) return { played: false, cancel: () => {} };
      volume = this._volumes.chatter;
    }

    const buf = this.distractionBuffers.get(voice);
    const segments = this._distractionSegments.get(voice);
    if (!buf || !segments || segments.length === 0) return { played: false, cancel: () => {} };

    const now = this.ctx.currentTime;
    if (this._distractionBusyUntil[voice] > now + 0.01) {
      return { played: false, cancel: () => {} };
    }

    const seg = segments[Math.floor(Math.random() * segments.length)];
    const start = now + 0.02;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    gain.connect(this.ctx.destination);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    src.start(start, seg.offset, seg.duration);
    this.activeSources.add(src);
    src.onended = () => this.activeSources.delete(src);
    this._distractionBusyUntil[voice] = start + seg.duration;

    return {
      played: true,
      cancel: () => {
        try { src.stop(); } catch {}
        this.activeSources.delete(src);
        this._distractionBusyUntil[voice] = 0;
      },
    };
  }

  stopAll() {
    for (const src of this.activeSources) {
      try { src.stop(); } catch {}
    }
    this.activeSources.clear();
    this._instructionPlayingUntil = 0;
    this._distractionBusyUntil = { male: 0, female: 0 };
  }

  // ── Static / radio-noise distractor ─────────────────────────────────────
  // Plays continuous filtered white noise as a background distractor.
  // The filter's centre frequency wobbles randomly so the texture shifts
  // (like an ill-tuned radio), making it harder to focus on instruction audio.
  startStatic({ volume, fadeInMs = 5000 } = {}) {
    if (!this.ctx) return;
    if (this._staticNodes) return;          // already playing — idempotent

    if (volume === undefined) {
      if (!this._enabled.staticNoise) return;
      volume = this._volumes.staticNoise;
    }
    if (volume <= 0) return;

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

    // Fade in from silence to `volume` over `fadeInMs` so the player isn't
    // hit by a wall of noise the instant a static-round begins. Bypassed when
    // fadeInMs is 0 (preview path or any caller that wants the legacy behaviour).
    //
    // Order matters here: GainNode defaults to gain=1, so we must set the
    // immediate value to 0 BEFORE connecting and starting the source.
    // Otherwise the audio thread renders one or more sample blocks at unity
    // gain before the scheduled setValueAtTime(0) takes effect, producing
    // the audible "full-volume blip" we got with the previous order.
    // Scheduling the source ~30 ms in the future gives the param schedule
    // time to commit ahead of any sample output.
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    const startTime = this.ctx.currentTime + 0.03;
    if (fadeInMs > 0) {
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(volume, startTime + fadeInMs / 1000);
    } else {
      gain.gain.setValueAtTime(volume, startTime);
    }

    source.connect(filter).connect(gain).connect(this.ctx.destination);
    source.start(startTime);

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
