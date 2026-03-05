const API = import.meta.env.VITE_API_URL || ''

const OUT_OF_AMMO_VARIANTS = ['out_of_ammo_1.mp3', 'out_of_ammo_2.mp3', 'out_of_ammo_3.mp3']

// Module-level cache — fetched once per session, invalidated when admin saves sound settings
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
      return { volumeIntelBriefOpened: 100, volumeTargetLocked: 100, volumeFire: 100, volumeAircoin: 100, volumeOutOfAmmo: 100 }
    })
  return inflight
}

export function invalidateSoundSettings() {
  cache = null
  inflight = null
}

// name: 'intel_brief_opened' | 'target_locked' | 'fire' | 'out_of_ammo'
export function playSound(name) {
  fetchSettings().then(settings => {
    let file, volumeKey

    if (name === 'intel_brief_opened') {
      file      = 'intel_brief_opened.mp3'
      volumeKey = 'volumeIntelBriefOpened'
    } else if (name === 'target_locked') {
      file      = 'target_locked.mp3'
      volumeKey = 'volumeTargetLocked'
    } else if (name === 'fire') {
      file      = 'fire.mp3'
      volumeKey = 'volumeFire'
    } else if (name === 'aircoin') {
      file      = 'aircoin.mp3'
      volumeKey = 'volumeAircoin'
    } else if (name === 'out_of_ammo') {
      file      = OUT_OF_AMMO_VARIANTS[Math.floor(Math.random() * OUT_OF_AMMO_VARIANTS.length)]
      volumeKey = 'volumeOutOfAmmo'
    } else {
      file = name
    }

    const audio = new Audio(`/sounds/${file}`)
    audio.volume = volumeKey ? Math.min(1, Math.max(0, (settings[volumeKey] ?? 100) / 100)) : 1
    audio.play().catch(() => {})
  })
}
