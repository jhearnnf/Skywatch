const API = import.meta.env.VITE_API_URL || ''

// ── Typing / terminal sound (Web Audio API — no file, synthesised) ────────────
let typingAudioCtx = null

function getTypingAudioCtx() {
  if (!typingAudioCtx || typingAudioCtx.state === 'closed') {
    typingAudioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  if (typingAudioCtx.state === 'suspended') typingAudioCtx.resume().catch(() => {})
  return typingAudioCtx
}

// Returns a promise that resolves with a running AudioContext.
// Prevents scheduling oscillators while currentTime is frozen (suspended).
let _resumePromise = null
function getRunningAudioCtx() {
  const ctx = getTypingAudioCtx()
  if (ctx.state === 'running') return Promise.resolve(ctx)
  if (_resumePromise) return _resumePromise
  _resumePromise = ctx.resume()
    .then(() => { _resumePromise = null; return ctx })
    .catch(() => { _resumePromise = null; return ctx })
  return _resumePromise
}

function _playTypingOscillator(vol, durMs = 3) {
  if (vol <= 0) return
  try {
    const dur  = Math.max(0.001, durMs / 1000)
    const ctx  = getTypingAudioCtx()
    const now  = ctx.currentTime
    const freq = 300 + Math.random() * 500   // 300–800 Hz — random pitch per key
    const osc  = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.setValueAtTime(freq, now)
    const gain = ctx.createGain()
    const peakGain = vol * 0.3
    // Hold peak for 40% of duration, then decay over the remaining 60%
    const holdEnd = now + dur * 0.4
    const decayEnd = now + dur
    gain.gain.setValueAtTime(peakGain, now)
    gain.gain.setValueAtTime(peakGain, holdEnd)
    gain.gain.exponentialRampToValueAtTime(0.0001, decayEnd)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(decayEnd)
  } catch {}
}

// ── Grid reveal tone (Intel Brief image cell dissolve) ────────────────────────
// Throttle: allow max ~1 tone per 30 ms to prevent additive clipping when
// dozens of setTimeout callbacks land in the same frame.
let _lastGridToneTime = 0

export function playGridRevealTone() {
  const now = performance.now()
  if (now - _lastGridToneTime < 30) return
  _lastGridToneTime = now

  const s = cache || {}
  if (s.soundEnabledGridReveal === false) return
  const vol = masterVol((s.volumeGridReveal ?? 30) / 100)
  if (vol <= 0) return
  const dur = Math.max(0.001, (s.durationGridReveal ?? 12) / 1000)

  getRunningAudioCtx().then(ctx => {
    try {
      const t    = ctx.currentTime
      const freq = 600 + Math.random() * 1400  // 600–2000 Hz — high, airy
      const osc  = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, t)
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(vol * 0.1, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + dur)
    } catch {}
  })
}

// For admin preview of grid reveal — fires a single synthesised tone at the given volume
export function previewGridRevealTone(sliderValue, durationMs) {
  const vol = Math.min(1, (sliderValue ?? 30) / 100)
  if (vol <= 0) return
  const dur = Math.max(0.001, (durationMs ?? 12) / 1000)
  getRunningAudioCtx().then(ctx => {
    try {
      const t    = ctx.currentTime
      const freq = 600 + Math.random() * 1400
      const osc  = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, t)
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(vol * 0.1, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + dur)
    } catch {}
  })
}

// Called per typed character — reads from cache synchronously (zero latency)
export function playTypingSound() {
  const s = cache || {}
  if (s.soundEnabledTypingSound === false) return
  const vol = masterVol((s.volumeTypingSound ?? 30) / 100)
  _playTypingOscillator(vol, s.durationTypingSound ?? 3)
}

// For admin preview — bypasses cache, uses raw slider value directly
export function previewTypingSound(sliderValue, durationMs) {
  _playTypingOscillator(Math.min(1, (sliderValue ?? 30) / 100), durationMs ?? 3)
}

// ── ACT (CBAT Auditory Capacity Test) preview helpers ───────────────────────
// Each preview plays for ~3 seconds at the configured volume. Cancellable: the
// admin row stops the previous preview before starting a new one via
// stopActPreview(). Static + bleep are synthesised here (matching the engine's
// envelope so the admin hears what the player will hear); the voice + chatter
// previews load a representative MP3 fresh each call.

let _actPreviewAudio = null
let _actPreviewStaticNodes = null
let _actPreviewBleepTimer = null

export function stopActPreview() {
  if (_actPreviewAudio) {
    try { _actPreviewAudio.pause(); _actPreviewAudio.currentTime = 0 } catch {}
    _actPreviewAudio = null
  }
  if (_actPreviewStaticNodes) {
    const { source, lfoTimer, gain, ctx } = _actPreviewStaticNodes
    try { clearInterval(lfoTimer) } catch {}
    try {
      const t = ctx.currentTime
      gain.gain.cancelScheduledValues(t)
      gain.gain.setValueAtTime(gain.gain.value, t)
      gain.gain.linearRampToValueAtTime(0, t + 0.1)
      source.stop(t + 0.12)
    } catch {}
    _actPreviewStaticNodes = null
  }
  if (_actPreviewBleepTimer) {
    clearTimeout(_actPreviewBleepTimer)
    _actPreviewBleepTimer = null
  }
}

function _playActMp3(url, sliderValue, durationMs = 3000) {
  stopActPreview()
  const vol = Math.min(1, (sliderValue ?? 40) / 100)
  if (vol <= 0) return
  try {
    const audio = new Audio(url)
    audio.volume = vol
    _actPreviewAudio = audio
    audio.play().catch(() => {})
    _actPreviewBleepTimer = setTimeout(() => {
      if (_actPreviewAudio === audio) {
        try { audio.pause(); audio.currentTime = 0 } catch {}
        _actPreviewAudio = null
      }
    }, durationMs)
  } catch {}
}

// One short spoken sample — covers the bulk of what avoid + distractor cues
// sound like in-game (callsign + "avoid the next circle"). Voice picked
// randomly so the admin doesn't always hear the same speaker.
export function previewActVoiceCommand(sliderValue) {
  const voice = Math.random() < 0.5 ? 'male' : 'female'
  const file  = `${voice}_avoid the next circle`
  const url   = `/sounds/act/${encodeURIComponent(file)}.mp3`
  _playActMp3(url, sliderValue, 3000)
}

// Round-5 memory code — the "remember code" preamble is enough to judge the
// level against the other ACT sounds without playing seven digits at the admin.
export function previewActCode(sliderValue) {
  _playActMp3('/sounds/act/remember_code.mp3', sliderValue ?? 85, 3000)
}

// Background chatter — plays from the same long recording the engine slices
// for distractor playback. Auto-stopped after 3 s.
export function previewActChatter(sliderValue) {
  const voice = Math.random() < 0.5 ? 'male' : 'female'
  const url   = `/sounds/act/distractions_${voice}.mp3`
  _playActMp3(url, sliderValue, 3000)
}

// Synthesised bandpassed noise — mirrors ActAudioEngine.startStatic so the
// admin hears the in-game texture (centre-frequency wobble included). Auto
// stops after 3 s.
export function previewActStatic(sliderValue) {
  stopActPreview()
  const vol = Math.min(1, (sliderValue ?? 40) / 100)
  if (vol <= 0) return
  getRunningAudioCtx().then(ctx => {
    try {
      const bufferLen = Math.floor(ctx.sampleRate * 2)
      const buffer = ctx.createBuffer(1, bufferLen, ctx.sampleRate)
      const channel = buffer.getChannelData(0)
      for (let i = 0; i < bufferLen; i++) channel[i] = Math.random() * 2 - 1
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = 1200
      filter.Q.value = 0.8
      const gain = ctx.createGain()
      gain.gain.value = vol
      source.connect(filter).connect(gain).connect(ctx.destination)
      source.start()
      const lfoTimer = setInterval(() => {
        try {
          const next = 400 + Math.random() * 2000
          const rampTo = ctx.currentTime + 0.25 + Math.random() * 0.4
          filter.frequency.cancelScheduledValues(ctx.currentTime)
          filter.frequency.linearRampToValueAtTime(next, rampTo)
        } catch {}
      }, 400)
      _actPreviewStaticNodes = { source, filter, gain, lfoTimer, ctx }
      _actPreviewBleepTimer = setTimeout(stopActPreview, 3000)
    } catch {}
  })
}

// Synthesised sine bleep — mirrors ActAudioEngine.playBleep envelope so the
// admin hears exactly what scoring will hear. Single 0.46 s bleep; total
// preview wraps in ~3 s of dead air so consecutive previews don't pile up.
export function previewActBleep(sliderValue) {
  stopActPreview()
  const vol = Math.min(1, (sliderValue ?? 22) / 100)
  if (vol <= 0) return
  getRunningAudioCtx().then(ctx => {
    try {
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 660
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(vol, now + 0.020)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.44)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.46)
    } catch {}
  })
}

// Admin preview for the CBAT menu soundtrack — plays the intro clip at the
// given slider volume. Reuses the ACT preview slot so it's cancelled the same
// way (stopActPreview) when another preview starts.
export function previewCbatMenuMusic(sliderValue) {
  _playActMp3('/sounds/cbat menu (start).mp3', sliderValue ?? 100, 10000)
}

const OUT_OF_AMMO_VARIANTS = ['out_of_ammo_1.mp3', 'out_of_ammo_2.mp3', 'out_of_ammo_3.mp3']

// Module-level settings cache
let cache = null
let inflight = null

function fetchSettings() {
  if (cache) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = fetch(`${API}/api/settings`)
    .then(r => r.json())
    .then(data => { cache = data; inflight = null; return data })
    .catch(() => {
      inflight = null
      // All volumes default to 100, all enabled flags default to true (absent = enabled)
      return {
        volumeIntelBriefOpened: 100, soundEnabledIntelBriefOpened: true,
        volumeTargetLocked: 100,     soundEnabledTargetLocked: true,
        volumeStandDown: 100,        soundEnabledStandDown: true,
        volumeTargetLockedKeyword: 100, soundEnabledTargetLockedKeyword: true,
        volumeFire: 100,             soundEnabledFire: true,
        volumeOutOfAmmo: 100,        soundEnabledOutOfAmmo: true,
        volumeAirstar: 100,          soundEnabledAirstar: true,
        volumeLevelUp: 100,          soundEnabledLevelUp: true,
        volumeRankPromotion: 100,    soundEnabledRankPromotion: true,
        volumeCategoryUnlocked: 100, soundEnabledCategoryUnlocked: true,
        volumeFirstBriefComplete: 100, soundEnabledFirstBriefComplete: true,
        volumeQuizCompleteWin: 100,  soundEnabledQuizCompleteWin: true,
        volumeQuizCompleteLose: 100, soundEnabledQuizCompleteLose: true,
        volumeQuizAnswerCorrect: 100,  soundEnabledQuizAnswerCorrect: true,
        volumeQuizAnswerIncorrect: 100, soundEnabledQuizAnswerIncorrect: true,
        volumeWhereAircraftWin: 100,             soundEnabledWhereAircraftWin: true,
        volumeWhereAircraftLose: 100,            soundEnabledWhereAircraftLose: true,
        volumeWhereAircraftMissionDetected: 100, soundEnabledWhereAircraftMissionDetected: true,
        volumeSkywatchLogo: 100, soundEnabledSkywatchLogo: true,
        volumeBattleOfOrderWon: 100,       soundEnabledBattleOfOrderWon: true,
        volumeBattleOfOrderLost: 100,      soundEnabledBattleOfOrderLost: true,
        volumeBattleOfOrderSelection: 100, soundEnabledBattleOfOrderSelection: true,
        volumeFlashcardStart: 100,     soundEnabledFlashcardStart: true,
        volumeFlashcardCorrect: 100,   soundEnabledFlashcardCorrect: true,
        volumeFlashcardIncorrect: 100, soundEnabledFlashcardIncorrect: true,
        volumeFlashcardCollect: 100,   soundEnabledFlashcardCollect: true,
        volumeTypingSound: 30,         soundEnabledTypingSound: true,
        volumeGridReveal: 30,          soundEnabledGridReveal: true,
        volumeCbatMenuMusic: 100,      soundEnabledCbatMenuMusic: true,
        durationTypingSound: 3,        durationGridReveal: 12,
        freeCategories: ['News'], silverCategories: [],
      }
    })
  return inflight
}

// Warm the cache on module load so synchronous readers have data immediately
fetchSettings()

// ── Master volume (user preference, stored in localStorage) ──────────────────
const MASTER_VOL_KEY = 'skywatch_master_volume'

export function getMasterVolume() {
  const v = parseInt(localStorage.getItem(MASTER_VOL_KEY) ?? '100', 10)
  return isNaN(v) ? 100 : Math.min(100, Math.max(0, v))
}

export function setMasterVolume(v) {
  localStorage.setItem(MASTER_VOL_KEY, String(Math.min(100, Math.max(0, Math.round(v)))))
}

function masterVol(vol) {
  return vol * (getMasterVolume() / 100)
}

// ── FLAG (CBAT) contact bleep ────────────────────────────────────────────────
// Short synthesised blip fired when a circled ("callsign") aircraft enters or
// leaves the FLAG play field. No asset file — mirrors the grid-reveal/ACT-bleep
// synthesis approach. Entry is a higher tone, exit a lower one, so the ear can
// tell a fresh contact from a departing one. Respects master volume; these
// events are naturally sparse so no concurrency cap is needed.
export function playFlagBleep(kind = 'enter') {
  const vol = masterVol(0.28)
  if (vol <= 0) return
  const freq = kind === 'exit' ? 440 : 760
  getRunningAudioCtx().then(ctx => {
    try {
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(vol, now + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.17)
    } catch {}
  })
}

// Synchronous read of the CBAT menu-music admin setting from the settings cache.
// Returns { volume: 0..1, enabled }. Falls back to full-volume/enabled until the
// settings fetch has warmed the cache (matches how other sounds behave on a
// cold start).
export function getCbatMenuMusicSetting() {
  const s = cache || {}
  return {
    volume:  Math.min(1, Math.max(0, (s.volumeCbatMenuMusic ?? 100) / 100)),
    enabled: s.soundEnabledCbatMenuMusic !== false,
  }
}

export function invalidateSoundSettings() {
  cache = null
  inflight = null
  // Re-fetch immediately so synchronous readers (playTypingSound, playGridRevealTone)
  // pick up fresh values as soon as the new fetch completes
  fetchSettings()
}

// Warm the browser's audio cache for a specific sound so the first playSound()
// call lands without file-fetch latency. Safe to call repeatedly — only the
// first call per name actually allocates an Audio element.
const preloadedAudio = new Map()

export function preloadSound(name) {
  if (preloadedAudio.has(name)) return
  let file
  if (name === 'flashcard_collect') file = 'flashcard_collect.mp3'
  else return
  const audio = new Audio(`/sounds/${file}`)
  audio.preload = 'auto'
  audio.load()
  preloadedAudio.set(name, audio)
}

// Stop the current sound immediately and drain the pending queue
export function stopAllSounds() {
  for (const entry of queue) entry.resolve()
  queue.length = 0
  if (currentSlot) interruptCurrent()
}

// ── Sound queue ───────────────────────────────────────────────────────────────
// Sounds are played one at a time in the order they are requested.
// playSound() returns a Promise that resolves when the sound finishes.
// The optional onAudio(audio) callback fires the moment the Audio element
// starts playing, giving callers access to currentTime / duration for progress.

const queue       = []    // [{ name, file, volume, onAudio, resolve }]
let   currentSlot = null  // { audio, name, finish }

function interruptCurrent() {
  if (!currentSlot) return
  const { audio, finish } = currentSlot
  audio.removeEventListener('ended', finish)
  audio.removeEventListener('error', finish)
  audio.pause()
  finish()
}

function processQueue() {
  if (currentSlot || queue.length === 0) return

  const { name, file, volume, onAudio, resolve } = queue.shift()
  const audio = new Audio(`/sounds/${file}`)
  audio.volume = volume

  const finish = () => {
    currentSlot = null
    resolve()
    processQueue()
  }

  currentSlot = { audio, name, finish }

  audio.addEventListener('ended', finish, { once: true })
  audio.addEventListener('error', finish, { once: true })

  audio.play()
    .then(() => onAudio?.(audio))
    .catch(finish)
}

// ── Out-of-ammo: bypasses the queue, plays immediately, max 10 concurrent ────
const OOA_MAX = 10
let   ooaActive = 0

function playOutOfAmmo(volume) {
  if (ooaActive >= OOA_MAX) return
  const file  = OUT_OF_AMMO_VARIANTS[Math.floor(Math.random() * OUT_OF_AMMO_VARIANTS.length)]
  const audio = new Audio(`/sounds/${file}`)
  audio.volume = volume
  ooaActive++
  const done = () => { ooaActive-- }
  audio.addEventListener('ended', done, { once: true })
  audio.addEventListener('error', done, { once: true })
  audio.play().catch(done)
}

// ── Skywatch logo: singleton — only one instance plays at a time ─────────────
let _skywatchLogoAudio = null

// ── Keyword locked: bypasses the queue, plays immediately, max 5 concurrent ──
const KWL_MAX = 5
let   kwlActive = 0

function playKeywordLocked(volume) {
  if (kwlActive >= KWL_MAX) return
  const audio = new Audio('/sounds/target_locked_keyword.mp3')
  audio.volume = volume
  kwlActive++
  const done = () => { kwlActive-- }
  audio.addEventListener('ended', done, { once: true })
  audio.addEventListener('error', done, { once: true })
  audio.play().catch(done)
}

// name: 'intel_brief_opened' | 'target_locked' | 'fire' | 'out_of_ammo' | 'airstar'
// options.onAudio(audio) — called with the Audio element once playback starts
export function playSound(name, { onAudio } = {}) {
  return fetchSettings().then(settings => {
    // out_of_ammo bypasses the queue entirely
    if (name === 'out_of_ammo') {
      if (settings.soundEnabledOutOfAmmo === false) return Promise.resolve()
      const volume = masterVol(Math.min(1, Math.max(0, (settings.volumeOutOfAmmo ?? 100) / 100)))
      playOutOfAmmo(volume)
      return Promise.resolve()
    }

    // target_locked_keyword bypasses the queue entirely — plays the instant a keyword is highlighted
    if (name === 'target_locked_keyword') {
      if (settings.soundEnabledTargetLockedKeyword === false) return Promise.resolve()
      const volume = masterVol(Math.min(1, Math.max(0, (settings.volumeTargetLockedKeyword ?? 100) / 100)))
      playKeywordLocked(volume)
      return Promise.resolve()
    }

    // Where's That Aircraft — mission detected: bypasses the queue
    if (name === 'where_aircraft_mission_detected') {
      if (settings.soundEnabledWhereAircraftMissionDetected === false) return Promise.resolve()
      const volume = masterVol(Math.min(1, Math.max(0, (settings.volumeWhereAircraftMissionDetected ?? 100) / 100)))
      const audio  = new Audio('/sounds/where_aircraft_mission_detected.mp3')
      audio.volume = volume
      audio.play().catch(() => {})
      return Promise.resolve()
    }

    // Skywatch logo cue: bypasses the queue so it fires instantly alongside
    // any logo-reveal animation and isn't held back by other sounds.
    // Singleton — stop any prior instance before starting a new one so a
    // re-mount of <SkywatchLogoIntro> (StrictMode double-invoke, fast double
    // clicks, HMR) can't stack two plays on top of each other.
    if (name === 'skywatch_logo') {
      if (settings.soundEnabledSkywatchLogo === false) return Promise.resolve()
      const volume = masterVol(Math.min(1, Math.max(0, (settings.volumeSkywatchLogo ?? 100) / 100)))
      if (_skywatchLogoAudio) {
        try { _skywatchLogoAudio.pause() } catch {}
        _skywatchLogoAudio = null
      }
      const audio  = new Audio('/sounds/skywatch_logo.mp3')
      audio.volume = volume
      _skywatchLogoAudio = audio
      const clear = () => { if (_skywatchLogoAudio === audio) _skywatchLogoAudio = null }
      audio.addEventListener('ended', clear, { once: true })
      audio.addEventListener('error', clear, { once: true })
      audio.play().catch(clear)
      return Promise.resolve()
    }

    // Battle of Order selection — bypasses the queue (fires during roulette spin)
    if (name === 'battle_of_order_selection') {
      if (settings.soundEnabledBattleOfOrderSelection === false) return Promise.resolve()
      const volume = masterVol(Math.min(1, Math.max(0, (settings.volumeBattleOfOrderSelection ?? 100) / 100)))
      const audio  = new Audio('/sounds/battle_of_order_selection.mp3')
      audio.volume = volume
      audio.play().catch(() => {})
      return Promise.resolve()
    }

    return new Promise(resolve => {
      let file, volumeKey, enabledKey

      if (name === 'intel_brief_opened') {
        file       = 'intel_brief_opened.mp3'
        volumeKey  = 'volumeIntelBriefOpened'
        enabledKey = 'soundEnabledIntelBriefOpened'
      } else if (name === 'target_locked') {
        file       = 'target_locked.mp3'
        volumeKey  = 'volumeTargetLocked'
        enabledKey = 'soundEnabledTargetLocked'
      } else if (name === 'fire') {
        file       = 'fire.mp3'
        volumeKey  = 'volumeFire'
        enabledKey = 'soundEnabledFire'
      } else if (name === 'airstar') {
        file       = 'airstar.mp3'
        volumeKey  = 'volumeAirstar'
        enabledKey = 'soundEnabledAirstar'
      } else if (name === 'level_up') {
        file       = 'level_up.mp3'
        volumeKey  = 'volumeLevelUp'
        enabledKey = 'soundEnabledLevelUp'
      } else if (name === 'rank_promotion') {
        file       = 'rank_promotion.mp3'
        volumeKey  = 'volumeRankPromotion'
        enabledKey = 'soundEnabledRankPromotion'
      } else if (name === 'category_unlocked') {
        file       = 'category_unlocked.mp3'
        volumeKey  = 'volumeCategoryUnlocked'
        enabledKey = 'soundEnabledCategoryUnlocked'
      } else if (name === 'quiz_complete_win') {
        file       = 'quiz_complete_win.mp3'
        volumeKey  = 'volumeQuizCompleteWin'
        enabledKey = 'soundEnabledQuizCompleteWin'
      } else if (name === 'quiz_complete_lose') {
        file       = 'quiz_complete_lose.mp3'
        volumeKey  = 'volumeQuizCompleteLose'
        enabledKey = 'soundEnabledQuizCompleteLose'
      } else if (name === 'first_brief_complete') {
        file       = 'first_brief_complete.mp3'
        volumeKey  = 'volumeFirstBriefComplete'
        enabledKey = 'soundEnabledFirstBriefComplete'
      } else if (name === 'stand_down') {
        file       = 'stand_down.mp3'
        volumeKey  = 'volumeStandDown'
        enabledKey = 'soundEnabledStandDown'
      } else if (name === 'quiz_answer_correct') {
        file       = 'quiz_answer_correct.mp3'
        volumeKey  = 'volumeQuizAnswerCorrect'
        enabledKey = 'soundEnabledQuizAnswerCorrect'
      } else if (name === 'quiz_answer_incorrect') {
        file       = 'quiz_answer_incorrect.mp3'
        volumeKey  = 'volumeQuizAnswerIncorrect'
        enabledKey = 'soundEnabledQuizAnswerIncorrect'
      } else if (name === 'where_aircraft_win') {
        file       = 'where_aircraft_win.mp3'
        volumeKey  = 'volumeWhereAircraftWin'
        enabledKey = 'soundEnabledWhereAircraftWin'
      } else if (name === 'where_aircraft_lose') {
        file       = 'where_aircraft_lose.mp3'
        volumeKey  = 'volumeWhereAircraftLose'
        enabledKey = 'soundEnabledWhereAircraftLose'
      } else if (name === 'battle_of_order_won') {
        file       = 'battle_of_order_won.mp3'
        volumeKey  = 'volumeBattleOfOrderWon'
        enabledKey = 'soundEnabledBattleOfOrderWon'
      } else if (name === 'battle_of_order_lost') {
        file       = 'battle_of_order_lost.mp3'
        volumeKey  = 'volumeBattleOfOrderLost'
        enabledKey = 'soundEnabledBattleOfOrderLost'
      } else if (name === 'flashcard_start') {
        file       = 'flashcard_start.mp3'
        volumeKey  = 'volumeFlashcardStart'
        enabledKey = 'soundEnabledFlashcardStart'
      } else if (name === 'flashcard_correct') {
        file       = 'flashcard_correct.mp3'
        volumeKey  = 'volumeFlashcardCorrect'
        enabledKey = 'soundEnabledFlashcardCorrect'
      } else if (name === 'flashcard_incorrect') {
        file       = 'flashcard_incorrect.mp3'
        volumeKey  = 'volumeFlashcardIncorrect'
        enabledKey = 'soundEnabledFlashcardIncorrect'
      } else if (name === 'flashcard_collect') {
        file       = 'flashcard_collect.mp3'
        volumeKey  = 'volumeFlashcardCollect'
        enabledKey = 'soundEnabledFlashcardCollect'
      } else {
        file = name
      }

      if (enabledKey && settings[enabledKey] === false) { resolve(); return }

      const volume = masterVol(Math.min(1, Math.max(0, (settings[volumeKey] ?? 100) / 100)))

      // target_locked: dedup — skip if already waiting in queue
      if (name === 'target_locked') {
        if (queue.some(e => e.name === 'target_locked')) { resolve(); return }
      }

      // stand_down: remove any target_locked + existing stand_down from queue,
      // then interrupt target_locked if it is currently playing
      if (name === 'stand_down') {
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].name === 'target_locked' || queue[i].name === 'stand_down') {
            queue[i].resolve()
            queue.splice(i, 1)
          }
        }
        queue.push({ name, file, volume, onAudio, resolve })
        if (currentSlot?.name === 'target_locked') interruptCurrent()
        else processQueue()
        return
      }

      queue.push({ name, file, volume, onAudio, resolve })
      processQueue()
    })
  })
}
