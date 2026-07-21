// CBAT menu music controller.
//
// Plays the menu soundtrack across the CBAT selection + instructions screens
// (and the slim landing):
//   1. "cbat menu (start).mp3" plays once, then
//   2. "cbat menu (repeat).mp3" loops continuously.
//
// The soundtrack is a *zone* feature driven from one place (see the
// <CbatMenuMusic> component). Callers don't manage playback directly — they
// declare which zone the user is in and the controller cross-fades / starts /
// stops to match:
//
//   'menu'         → CBAT game-selection page / slim landing → 100% volume
//   'instructions' → a game's pre-play / results screen      →  25% volume
//    null          → in a game, or off the CBAT area         → faded out & stopped
//
// Volume is scaled by BOTH the admin per-sound level (AppSettings
// volumeCbatMenuMusic / soundEnabledCbatMenuMusic, via the sound-settings cache)
// AND the user's master-volume preference (Profile → Sound), both read live.
//
// Presence gating: the track is only audible while the user is actually present
// on the app — minimising, switching tab/app, or backgrounding pauses it, and
// returning resumes the SAME clip (no restart). Leaving the "on" zones (into a
// game or off CBAT) fully stops the sequence; returning restarts from the start
// clip.

import { getMasterVolume, getCbatMenuMusicSetting } from '../sound'

const START_SRC  = '/sounds/cbat menu (start).mp3'
const REPEAT_SRC = '/sounds/cbat menu (repeat).mp3'

const FADE_MS = 700

// Pre-master zone volumes (0..1).
const ZONE_VOL = { menu: 1.0, instructions: 0.25 }

let startAudio  = null   // the one-shot intro clip (null once it has ended)
let repeatAudio = null   // the looping body (null until the intro ends)
let playing     = false  // is a start+repeat sequence currently active?
let zoneVol     = 0      // current target zone volume (pre-master)
let appliedGain = 0      // effective gain currently set on the audio elements
let fadeRAF     = null
let gestureArmed = false // one-shot "retry on user gesture" listener attached?
let presenceBound = false
let present      = true  // is the user currently present (visible + focused)?
let pageVisible  = true  // document not hidden (minimise / tab-switch / background)
let windowFocused = true // window has focus (another app/window on top)

function hasRAF() {
  return typeof requestAnimationFrame === 'function'
}

function masterFactor() {
  try { return Math.min(1, Math.max(0, getMasterVolume() / 100)) }
  catch { return 1 }
}

// Effective gain for the current (or a given) zone volume, after admin-level +
// master scaling.
function targetGain(vol = zoneVol) {
  let adminVol = 1
  try { adminVol = getCbatMenuMusicSetting().volume } catch {}
  return Math.min(1, Math.max(0, vol * adminVol * masterFactor()))
}

// Whichever audio elements currently exist. Only one is audible at a time, but
// during the intro→loop handover both may briefly be non-null, so we set volume
// on all of them.
function liveAudios() {
  const out = []
  if (repeatAudio) out.push(repeatAudio)
  if (startAudio)  out.push(startAudio)
  return out
}

function applyGain(g) {
  appliedGain = g
  for (const a of liveAudios()) {
    try { a.volume = g } catch {}
  }
}

function cancelFade() {
  if (fadeRAF != null) {
    try { cancelAnimationFrame(fadeRAF) } catch {}
    fadeRAF = null
  }
}

// Ramp the applied gain to `target` over FADE_MS, then invoke `onDone`.
// Falls back to an instant jump where requestAnimationFrame isn't available
// (e.g. jsdom) so behaviour stays deterministic in tests.
function fadeTo(target, onDone) {
  cancelFade()
  if (!hasRAF() || appliedGain === target) {
    applyGain(target)
    onDone?.()
    return
  }
  const from   = appliedGain
  const startT = performance.now()
  const step = (now) => {
    const t = Math.min(1, (now - startT) / FADE_MS)
    applyGain(from + (target - from) * t)
    if (t < 1) {
      fadeRAF = requestAnimationFrame(step)
    } else {
      fadeRAF = null
      onDone?.()
    }
  }
  fadeRAF = requestAnimationFrame(step)
}

// ── Presence gating (auto-mute when the user isn't looking) ──────────────────
// Event-driven (not hasFocus() polling) so it's deterministic and testable. The
// user is "present" only while the page is visible AND the window is focused;
// minimising, switching tab/app, or backgrounding drops presence.

function onVisibility() {
  try { pageVisible = document.visibilityState !== 'hidden' } catch { pageVisible = true }
  reconcilePresence()
}
function onFocus()   { windowFocused = true;  reconcilePresence() }
function onBlur()    { windowFocused = false; reconcilePresence() }
function onPageHide() { pageVisible = false;  reconcilePresence() }

// Pause/resume the current clip to match presence. Never restarts the sequence —
// a quick tab-away keeps its place and resumes the same clip.
function reconcilePresence() {
  const now = pageVisible && windowFocused
  if (now === present) return
  present = now
  if (!playing) return
  if (present) {
    const a = repeatAudio || startAudio
    if (a) safePlay(a)
  } else {
    for (const a of liveAudios()) { try { a.pause() } catch {} }
  }
}

function bindPresence() {
  if (presenceBound || typeof window === 'undefined') return
  presenceBound = true
  try { pageVisible = document.visibilityState !== 'hidden' } catch { pageVisible = true }
  windowFocused = true
  present = pageVisible && windowFocused
  try {
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pagehide', onPageHide)
  } catch { presenceBound = false }
}

function unbindPresence() {
  if (!presenceBound) return
  presenceBound = false
  try {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('pagehide', onPageHide)
  } catch {}
}

// ── Autoplay-blocked retry ───────────────────────────────────────────────────

function detachGestureRetry() {
  if (!gestureArmed) return
  gestureArmed = false
  try {
    window.removeEventListener('pointerdown', onGesture)
    window.removeEventListener('keydown', onGesture)
  } catch {}
}

function onGesture() {
  detachGestureRetry()
  // Only resume if we still want to be playing and the user is present.
  if (!playing || !present) return
  const audio = repeatAudio || startAudio
  if (audio) safePlay(audio)
}

// Browsers block audio without a prior user gesture. If the initial play() is
// rejected, arm a one-shot listener that retries on the next interaction.
function armGestureRetry() {
  if (gestureArmed || typeof window === 'undefined') return
  gestureArmed = true
  try {
    window.addEventListener('pointerdown', onGesture, { once: true })
    window.addEventListener('keydown', onGesture, { once: true })
  } catch { gestureArmed = false }
}

function makeAudio(src) {
  const a = new Audio(src)
  a.volume = appliedGain
  return a
}

// play() returns a promise in modern browsers, but can return undefined (jsdom,
// some older engines). Guard so a missing/rejected promise never throws.
function safePlay(audio, onFail) {
  try {
    const p = audio.play()
    if (p && typeof p.catch === 'function') p.catch(() => onFail?.())
  } catch { onFail?.() }
}

function onStartEnded() {
  if (!playing) return
  // Intro finished — hand over to the looping body at the same gain.
  startAudio = null
  try {
    repeatAudio = makeAudio(REPEAT_SRC)
    repeatAudio.loop = true
    repeatAudio.volume = appliedGain
    if (present) safePlay(repeatAudio, armGestureRetry)
  } catch {}
}

function startSequence() {
  playing = true
  bindPresence()
  // Begin (or restart) from the intro clip. Fade up from silence.
  appliedGain = 0
  try {
    startAudio = makeAudio(START_SRC)
    startAudio.volume = 0
    startAudio.addEventListener('ended', onStartEnded, { once: true })
    if (present) safePlay(startAudio, armGestureRetry)
  } catch {}
  fadeTo(targetGain())
}

function stopSequence() {
  if (!playing && !startAudio && !repeatAudio) return
  playing = false
  zoneVol = 0
  detachGestureRetry()
  const audios = liveAudios()
  fadeTo(0, () => {
    for (const a of audios) {
      try { a.pause() } catch {}
    }
    // Only clear if a new sequence hasn't started in the meantime.
    if (!playing) {
      startAudio = null
      repeatAudio = null
      appliedGain = 0
    }
  })
}

// Public API ────────────────────────────────────────────────────────────────

// Declare the current CBAT zone. `zone` is 'menu' | 'instructions' | null.
// Idempotent: repeated calls with the same on-zone just retarget the volume.
// When the admin has disabled the soundtrack, every zone is treated as silent.
export function updateCbatMusic(zone) {
  let enabled = true
  try { enabled = getCbatMenuMusicSetting().enabled } catch {}
  if (zone == null || !enabled) { stopSequence(); return }
  zoneVol = ZONE_VOL[zone] ?? ZONE_VOL.menu
  if (!playing) startSequence()
  else fadeTo(targetGain())
}

// Re-apply the current zone's gain immediately using the latest admin-level +
// master-volume values. Call this when the user changes their master volume
// (Profile → Sound) so a soundtrack already playing responds at once rather than
// only on the next zone change (i.e. after navigating away). No-op when nothing
// is playing.
export function refreshCbatMusicVolume() {
  if (!playing) return
  applyGain(targetGain())
}

// Test/HMR helper — hard reset without fades.
export function _resetCbatMusic() {
  cancelFade()
  detachGestureRetry()
  unbindPresence()
  for (const a of liveAudios()) { try { a.pause() } catch {} }
  startAudio = null
  repeatAudio = null
  playing = false
  present = true
  pageVisible = true
  windowFocused = true
  zoneVol = 0
  appliedGain = 0
}
