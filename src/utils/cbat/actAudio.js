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

// ── Round-5 memory code ─────────────────────────────────────────────────────
// The player is read a 7-digit code a quarter of the way through the final
// round and asked to type it back at the end. Its clips ("remember_code.mp3",
// "1.mp3" … "9.mp3") are single recordings with no male/female variant, so they
// live under their own pseudo-voice in the buffer map rather than being keyed
// by speaker.
//
// There is deliberately no zero: no 0.mp3 was recorded, and a dead key on the
// recall pad would tell the player which digit can never appear.
export const CODE_VOICE = 'code';
export const CODE_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
export const CODE_PREAMBLE = 'remember_code';
const CODE_FILES = [CODE_PREAMBLE, ...CODE_DIGITS];

// Digits are spaced far wider than the 0.04s used between instruction words.
// Run together they blur into one number the player can't chunk or rehearse;
// the pause is what makes seven digits holdable.
export const CODE_DIGIT_GAP_S = 0.4;

// While the code is being read, the static distractor ducks to this fraction of
// its configured level. Raising the code's own gain alone doesn't help much —
// the static is bandpassed right through the speech range, so it masks rather
// than sits under it.
const CODE_DUCK_FACTOR = 0.25;
const CODE_DUCK_FADE_S = 0.3;

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
// The memory code sits deliberately louder than the rest: the round-5
// challenge is holding seven digits for a whole round, not straining to hear
// them over the static.
const DEFAULT_VOLUMES = {
  voiceCommand: 0.40,
  chatter:      0.40,
  staticNoise:  0.40,
  bleep:        0.22,
  code:         0.85,
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
    this._enabled = { voiceCommand: true, chatter: true, staticNoise: true, bleep: true, code: true };
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
    for (const name of CODE_FILES) jobs.push(this._loadCodeBuffer(name));
    await Promise.all(jobs);
  }

  // Code clips are bare filenames (no voice prefix), keyed under CODE_VOICE so
  // playSequence can walk them like any other chunk list.
  async _loadCodeBuffer(name) {
    const key = bufferKey(CODE_VOICE, name);
    if (this.buffers.has(key)) return;
    const url = `/sounds/act/${encodeURIComponent(name)}.mp3`;
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
  // `soundKey` selects which admin-configured level and on/off flag apply —
  // 'voiceCommand' for callsign instructions, 'code' for the round-5 memory
  // code, which is deliberately louder and switchable on its own.
  playSequence(names, { gap = 0.04, volume, exclusive = false, voice, soundKey = 'voiceCommand' } = {}) {
    if (!this.ctx) return { promise: Promise.resolve(), cancel: () => {}, played: false };

    if (exclusive && this._instructionPlayingUntil > this.ctx.currentTime + 0.01) {
      return { promise: Promise.resolve(), cancel: () => {}, played: false };
    }

    // Apply admin-configured volume + enabled flag. Explicit `volume` override
    // wins (preview path); otherwise the engine's stored gain for this sound
    // applies. When the sound is disabled we bail with `played: false` so the
    // exclusive-instruction window isn't reserved for a silent call.
    if (volume === undefined) {
      if (!this._enabled[soundKey]) return { promise: Promise.resolve(), cancel: () => {}, played: false };
      volume = this._volumes[soundKey];
    }

    // One voice per sequence so a sentence doesn't flip speakers mid-utterance.
    const knownVoice = voice && (VOICES.includes(voice) || voice === CODE_VOICE);
    const chosenVoice = knownVoice ? voice : this._pickVoice();

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

  // Read the round-5 memory code: "remember code" followed by each digit.
  // Exclusive like any instruction, but the planner reserves a cue-free block
  // around it — nothing else should be in flight to drop it.
  playCode(digits, { volume } = {}) {
    const result = this.playSequence([CODE_PREAMBLE, ...digits], {
      voice: CODE_VOICE,
      soundKey: 'code',
      exclusive: true,
      gap: CODE_DIGIT_GAP_S,
      volume,
    });
    if (result.played) this._duckStatic(this.codeDurationS(digits));
    return result;
  }

  // Pull the static down for `durationS`, then bring it back to its configured
  // level. No-op when static isn't running.
  _duckStatic(durationS, factor = CODE_DUCK_FACTOR) {
    if (!this._staticNodes || !this.ctx) return;
    const full = this._enabled.staticNoise ? this._volumes.staticNoise : 0;
    const g = this._staticNodes.gain.gain;
    const t = this.ctx.currentTime;
    const hold = Math.max(CODE_DUCK_FADE_S, durationS);
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(full * factor, t + CODE_DUCK_FADE_S);
      g.setValueAtTime(full * factor, t + hold);
      g.linearRampToValueAtTime(full, t + hold + CODE_DUCK_FADE_S * 2);
    } catch { /* param scheduling unavailable — leave the static as-is */ }
  }

  // Real playback length of a code readout, in seconds, from the decoded
  // buffers. The planner works off a fixed estimate (it's pure and has no
  // engine); this is the runtime's actual figure, used to hold chatter off
  // until the readout finishes. Returns 0 if the clips never loaded.
  codeDurationS(digits, { gap = CODE_DIGIT_GAP_S } = {}) {
    let total = 0;
    for (const name of [CODE_PREAMBLE, ...digits]) {
      const buf = this.buffers.get(bufferKey(CODE_VOICE, name));
      if (!buf) continue;
      total += buf.duration + gap;
    }
    return total;
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

  // ── Freeze / thaw (screen lock, tab switch, app backgrounded) ───────────
  // Suspending the context silences everything at once — the looping static,
  // any in-flight instruction chunks, and queued chatter — without tearing the
  // graph down, so a resume picks up exactly where the player left off.
  //
  // It also freezes ctx.currentTime, which is what keeps the scheduling
  // bookkeeping (_instructionPlayingUntil, _distractionBusyUntil, every
  // src.start(t)) honest across the pause instead of expiring while nothing
  // is audible.
  //
  // Both are safe to call at any time; a missing or closed context is a no-op.
  suspend() {
    if (!this.ctx || this.ctx.state === 'closed') return;
    try {
      const p = this.ctx.suspend();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
  }

  // Must be called from a user gesture on iOS, where resuming a suspended
  // context outside one is silently refused.
  resume() {
    if (!this.ctx || this.ctx.state === 'closed') return;
    try {
      const p = this.ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
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
      // While the context is suspended currentTime is frozen, so every tick
      // would pile another ramp onto the same instant and they'd all unwind
      // at once on resume. Nothing is audible anyway — skip.
      if (this.ctx.state !== 'running') return;
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
