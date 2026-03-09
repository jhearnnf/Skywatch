const API = import.meta.env.VITE_API_URL || ''

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
        volumeAircoin: 100,          soundEnabledAircoin: true,
        volumeLevelUp: 100,          soundEnabledLevelUp: true,
        volumeRankPromotion: 100,    soundEnabledRankPromotion: true,
        volumeQuizCompleteWin: 100,  soundEnabledQuizCompleteWin: true,
        volumeQuizCompleteLose: 100, soundEnabledQuizCompleteLose: true,
        volumeBattleOfOrderWon: 100,       soundEnabledBattleOfOrderWon: true,
        volumeBattleOfOrderLost: 100,      soundEnabledBattleOfOrderLost: true,
        volumeBattleOfOrderSelection: 100, soundEnabledBattleOfOrderSelection: true,
        freeCategories: ['News'], silverCategories: [],
      }
    })
  return inflight
}

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

export function invalidateSoundSettings() {
  cache = null
  inflight = null
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

// name: 'intel_brief_opened' | 'target_locked' | 'fire' | 'out_of_ammo' | 'aircoin'
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

    // Battle of Order sounds — all bypass the queue
    if (name === 'battle_of_order_won' || name === 'battle_of_order_lost' || name === 'battle_of_order_selection') {
      const enabledKey = name === 'battle_of_order_won'       ? 'soundEnabledBattleOfOrderWon'
                       : name === 'battle_of_order_lost'      ? 'soundEnabledBattleOfOrderLost'
                       :                                        'soundEnabledBattleOfOrderSelection'
      const volumeKey  = name === 'battle_of_order_won'       ? 'volumeBattleOfOrderWon'
                       : name === 'battle_of_order_lost'      ? 'volumeBattleOfOrderLost'
                       :                                        'volumeBattleOfOrderSelection'
      if (settings[enabledKey] === false) return Promise.resolve()
      const volume = masterVol(Math.min(1, Math.max(0, (settings[volumeKey] ?? 100) / 100)))
      const audio  = new Audio(`/sounds/${name}.mp3`)
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
      } else if (name === 'aircoin') {
        file       = 'aircoin.mp3'
        volumeKey  = 'volumeAircoin'
        enabledKey = 'soundEnabledAircoin'
      } else if (name === 'level_up') {
        file       = 'level_up.mp3'
        volumeKey  = 'volumeLevelUp'
        enabledKey = 'soundEnabledLevelUp'
      } else if (name === 'rank_promotion') {
        file       = 'rank_promotion.mp3'
        volumeKey  = 'volumeRankPromotion'
        enabledKey = 'soundEnabledRankPromotion'
      } else if (name === 'quiz_complete_win') {
        file       = 'quiz_complete_win.mp3'
        volumeKey  = 'volumeQuizCompleteWin'
        enabledKey = 'soundEnabledQuizCompleteWin'
      } else if (name === 'quiz_complete_lose') {
        file       = 'quiz_complete_lose.mp3'
        volumeKey  = 'volumeQuizCompleteLose'
        enabledKey = 'soundEnabledQuizCompleteLose'
      } else if (name === 'stand_down') {
        file       = 'stand_down.mp3'
        volumeKey  = 'volumeStandDown'
        enabledKey = 'soundEnabledStandDown'
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
