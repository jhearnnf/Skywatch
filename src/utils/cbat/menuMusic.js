// CBAT menu music controller.
//
// Plays the menu soundtrack across the CBAT selection + instructions screens:
//   1. "cbat menu (start).mp3" plays once, then
//   2. "cbat menu (repeat).mp3" loops continuously.
//
// The soundtrack is a *zone* feature driven from one place (see the
// <CbatMenuMusic> component). Callers don't manage playback directly — they
// declare which zone the user is in and the controller cross-fades / starts /
// stops to match:
//
//   'menu'         → CBAT game-selection page          → 100% volume
//   'instructions' → a game's pre-play / results screen →  25% volume
//    null          → in a game, or off the CBAT area    → faded out & stopped
//
// Volume is always scaled by the user's master-volume preference
// (Profile → Sound), read live so a mid-play change is honoured.
//
// Leaving the "on" zones (into a game or off CBAT entirely) fully stops the
// sequence; returning restarts it from the start clip — matching the spec that
// the start+repeat only plays once the user is back on the selection or
// instructions screen.

import { getMasterVolume } from '../sound'

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

function hasRAF() {
  return typeof requestAnimationFrame === 'function'
}

function masterFactor() {
  try { return Math.min(1, Math.max(0, getMasterVolume() / 100)) }
  catch { return 1 }
}

// Effective gain for the current (or a given) zone volume, after master scaling.
function targetGain(vol = zoneVol) {
  return Math.min(1, Math.max(0, vol * masterFactor()))
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
  // Only resume if we still want to be playing (user hasn't left in the
  // meantime). Re-issue play() on whatever clip should currently be sounding.
  if (!playing) return
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
    safePlay(repeatAudio, armGestureRetry)
  } catch {}
}

function startSequence() {
  playing = true
  // Begin (or restart) from the intro clip. Fade up from silence.
  appliedGain = 0
  try {
    startAudio = makeAudio(START_SRC)
    startAudio.volume = 0
    startAudio.addEventListener('ended', onStartEnded, { once: true })
    safePlay(startAudio, armGestureRetry)
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
export function updateCbatMusic(zone) {
  if (zone == null) { stopSequence(); return }
  zoneVol = ZONE_VOL[zone] ?? ZONE_VOL.menu
  if (!playing) startSequence()
  else fadeTo(targetGain())
}

// Test/HMR helper — hard reset without fades.
export function _resetCbatMusic() {
  cancelFade()
  detachGestureRetry()
  for (const a of liveAudios()) { try { a.pause() } catch {} }
  startAudio = null
  repeatAudio = null
  playing = false
  zoneVol = 0
  appliedGain = 0
}
