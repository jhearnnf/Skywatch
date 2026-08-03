// Generic looping-background-music controller factory.
//
// Two soundtracks share this machinery — the CBAT menu music
// (src/utils/cbat/menuMusic.js) and the hangar lobby track
// (src/utils/world3d/hangarMusic.js). Each is a *zone* feature: callers don't
// manage playback directly, they declare which zone the user is in and the
// controller cross-fades / starts / stops to match. A null zone fades out and
// stops the sequence.
//
// A soundtrack is either
//   • an intro clip that plays once, then hands over to a looping body
//     (`startSrc` + `repeatSrc`), or
//   • a single clip that loops from the start (`repeatSrc` only).
//
// Volume is scaled by BOTH the admin per-sound level (AppSettings, via the
// sound-settings cache) AND the user's master-volume preference (Profile →
// Sound), both read live through the injected getters.
//
// Presence gating: the track is only audible while the user is actually present
// on the app — minimising, switching tab/app, or backgrounding pauses it, and
// returning resumes the SAME clip (no restart). Leaving the "on" zones fully
// stops the sequence; returning restarts from the beginning.

const FADE_MS = 700

// `zoneVolumes` maps zone name → pre-master volume (0..1). `getSetting` returns
// the admin `{ volume: 0..1, enabled }` pair; `getMasterVolume` returns 0..100.
export function createLoopingMusic({ startSrc = null, repeatSrc, zoneVolumes, getSetting, getMasterVolume }) {
  const defaultVol = Object.values(zoneVolumes)[0] ?? 1

  let startAudio  = null   // the one-shot intro clip (null once it has ended, or when there is none)
  let repeatAudio = null   // the looping body (null until the intro ends)
  let playing     = false  // is a sequence currently active?
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
    try { adminVol = getSetting().volume } catch {}
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

  // ── Presence gating (auto-mute when the user isn't looking) ────────────────
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

  // ── Autoplay-blocked retry ─────────────────────────────────────────────────

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

  function startLoopClip() {
    try {
      repeatAudio = makeAudio(repeatSrc)
      repeatAudio.loop = true
      repeatAudio.volume = appliedGain
      if (present) safePlay(repeatAudio, armGestureRetry)
    } catch {}
  }

  function onStartEnded() {
    if (!playing) return
    // Intro finished — hand over to the looping body at the same gain.
    startAudio = null
    startLoopClip()
  }

  function startSequence() {
    playing = true
    bindPresence()
    // Begin (or restart) from the top. Fade up from silence.
    appliedGain = 0
    if (startSrc) {
      try {
        startAudio = makeAudio(startSrc)
        startAudio.volume = 0
        startAudio.addEventListener('ended', onStartEnded, { once: true })
        if (present) safePlay(startAudio, armGestureRetry)
      } catch {}
    } else {
      // No intro clip — the looping body is the whole soundtrack.
      startLoopClip()
    }
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

  // Declare the current zone. Idempotent: repeated calls with the same on-zone
  // just retarget the volume. When the admin has disabled the soundtrack, every
  // zone is treated as silent.
  function update(zone) {
    let enabled = true
    try { enabled = getSetting().enabled } catch {}
    if (zone == null || !enabled) { stopSequence(); return }
    zoneVol = zoneVolumes[zone] ?? defaultVol
    if (!playing) startSequence()
    else fadeTo(targetGain())
  }

  // Re-apply the current zone's gain immediately using the latest admin-level +
  // master-volume values. Call this when the user changes their master volume
  // (Profile → Sound) so a soundtrack already playing responds at once rather
  // than only on the next zone change. No-op when nothing is playing.
  function refreshVolume() {
    if (!playing) return
    applyGain(targetGain())
  }

  // Test/HMR helper — hard reset without fades.
  function reset() {
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

  return { update, refreshVolume, reset }
}
