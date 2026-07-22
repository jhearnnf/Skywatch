// Radio-call playback for the SAT game.
//
// Two very different engines, chosen by platform:
//
//  • Native Android/iOS (Capacitor WebView) → the @capacitor-community/text-to-
//    speech plugin, which bridges to the OS TextToSpeech engine. The System
//    WebView has no working Web Speech engine of its own — `speechSynthesis`
//    exists but `getVoices()` stays empty and `speak()` is a silent no-op — so
//    the packaged app must go native or it hears nothing.
//  • Web browsers → the Web Speech API, with the two mobile-browser quirks it
//    needs handling for:
//      1. iOS Safari only speaks if the *first* utterance was started inside a
//         user gesture. The SAT's first radio call fires from a timer, so
//         `primeSpeech()` unlocks the engine with a silent utterance from the
//         Start button handler.
//      2. Android Chrome loads voices asynchronously; `speak()` before
//         `getVoices()` is populated is silently dropped, so we queue the
//         utterance until `voiceschanged` fires.
//
// Everything is best-effort: if TTS is unavailable the on-screen caption is
// still the fallback, so failures here must never throw.

import { isNative } from '../isNative'

// ── Native path (Capacitor plugin) ───────────────────────────────────────────
// Loaded lazily so the web bundle and tests never pull the plugin in. Mirrors
// the dynamic-import pattern used for @capacitor/network in src/lib/net.js.
let ttsPlugin = null
let ttsLoading = null

function loadTts() {
  if (ttsPlugin) return Promise.resolve(ttsPlugin)
  if (!ttsLoading) {
    ttsLoading = import('@capacitor-community/text-to-speech')
      .then(m => { ttsPlugin = m.TextToSpeech; return ttsPlugin })
      .catch(() => null) // plugin missing — captions still show
  }
  return ttsLoading
}

function nativeSpeak(text) {
  loadTts().then(tts => {
    if (!tts) return
    // Default QueueStrategy.Flush: a new call interrupts the previous one, which
    // matches how the observe loop switches from one radio call to the next.
    tts.speak({ text, lang: 'en-GB', rate: 1.0, pitch: 1.0 }).catch(() => {})
  })
}

function nativeStop() {
  loadTts().then(tts => { if (tts) tts.stop().catch(() => {}) })
}

// ── Web path (Web Speech API) ────────────────────────────────────────────────
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
 * (e.g. the Start button's onClick) or iOS Safari will refuse every later
 * utterance. On native this instead warm-loads the TTS plugin so the first
 * radio call, fired from the observe timer, doesn't wait on the import.
 */
export function primeSpeech() {
  if (isNative) { loadTts(); return }
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
  if (isNative) { nativeSpeak(text); return }

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
  if (isNative) { nativeStop(); return }
  const s = synth()
  if (!s) return
  clearPendingVoices(s)
  try { s.cancel() } catch { /* noop */ }
}
