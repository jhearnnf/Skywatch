// Radio-call playback for the SAT game (Web Speech API).
//
// Mobile browsers are much stricter than desktop about speech synthesis:
//
//  1. iOS Safari will only speak if the *first* utterance of the page is
//     started inside a user gesture. The SAT's first radio call fires from a
//     timer once the observe phase starts, which is outside the gesture — so
//     nothing is ever heard. `primeSpeech()` is called synchronously from the
//     Start button handler to unlock the engine with a silent utterance.
//  2. Android Chrome loads voices asynchronously; `speak()` before
//     `getVoices()` is populated is silently dropped. So when no voices are
//     loaded yet we queue the utterance until `voiceschanged` fires.
//
// Everything is best-effort: if TTS is unavailable the on-screen caption is
// still the fallback, so failures here must never throw.

function synth() {
  if (typeof window === 'undefined') return null
  if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return null
  return window.speechSynthesis
}

let primed = false
let pendingVoicesHandler = null
let pendingVoicesTimer = null

/** Reset module state — tests only. */
export function _resetSpeech() {
  primed = false
  clearPendingVoices(synth())
}

function clearPendingVoices(s) {
  if (pendingVoicesTimer) { clearTimeout(pendingVoicesTimer); pendingVoicesTimer = null }
  if (pendingVoicesHandler) {
    if (s && typeof s.removeEventListener === 'function') s.removeEventListener('voiceschanged', pendingVoicesHandler)
    pendingVoicesHandler = null
  }
}

/**
 * Unlock speech synthesis. Must be called synchronously from a user gesture
 * (e.g. the Start button's onClick) or iOS will refuse every later utterance.
 */
export function primeSpeech() {
  const s = synth()
  if (!s || primed) return
  try {
    const u = new window.SpeechSynthesisUtterance(' ')
    u.volume = 0
    s.speak(u)
    primed = true
  } catch { /* TTS unavailable — captions still show */ }
}

function speakNow(s, text) {
  try {
    const u = new window.SpeechSynthesisUtterance(text)
    u.rate = 1.0
    u.pitch = 1.0
    u.lang = 'en-GB'
    const voices = typeof s.getVoices === 'function' ? (s.getVoices() || []) : []
    const voice = voices.find(v => v.lang === 'en-GB') || voices.find(v => (v.lang || '').startsWith('en'))
    if (voice) u.voice = voice
    s.speak(u)
  } catch { /* noop */ }
}

/** Speak a radio call. `enabled` is the player's mute toggle. */
export function speak(text, enabled) {
  if (!enabled || !text) return
  const s = synth()
  if (!s) return

  clearPendingVoices(s)

  const voices = typeof s.getVoices === 'function' ? (s.getVoices() || []) : []
  if (voices.length === 0 && typeof s.addEventListener === 'function') {
    // Android Chrome: voices not loaded yet — speaking now would be dropped.
    // Wait for them, but don't wait forever: some engines never fire the event
    // yet still speak, so fall back after a short delay.
    const fire = () => { clearPendingVoices(s); speakNow(s, text) }
    pendingVoicesHandler = fire
    s.addEventListener('voiceschanged', fire)
    pendingVoicesTimer = setTimeout(fire, 600)
    return
  }
  speakNow(s, text)
}

export function stopSpeech() {
  const s = synth()
  if (!s) return
  clearPendingVoices(s)
  try { s.cancel() } catch { /* noop */ }
}
