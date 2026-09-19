import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { UI_THEMES, UI_THEME_LABELS } from '../../lib/uiTheme'
import { animateThemeSwitch } from '../../lib/themeTransition'
import { useUiThemeChoice } from '../../hooks/useUiThemeChoice'
import ThemeFlash from './ThemeFlash'

// The phone's theme control: a faint "Switch theme" label between the logo
// and the avatar. Press and hold it for HOLD_MS and the other theme sweeps
// across the page from under the thumb (lib/themeTransition.js), then the
// page flashes once with the theme's name. While the thumb is down a
// thin bar along the very top of the screen fills up, where it can be seen
// past the thumb. A plain tap does nothing except turn the label into the
// hint "Hold to switch" for a moment.
//
// Pointer events so mouse and touch share one path; the pointer is captured
// so a thumb drifting off the label mid-hold still counts, and the long-press
// context menu is suppressed.
//
// While a CBAT test is being played the control is locked: a press then
// does nothing but show "Locked during test" for a moment, so a switch can't
// reskin the test under the player. (Under 600px the bar is off-screen
// during play anyway; between there and the desktop breakpoint it is not.)

export const HOLD_MS = 1200
const TICK_MS = 16
const TIP_MS = 1800
export const TIP_LABEL = 'Hold to switch'
export const LOCKED_LABEL = 'Locked during test'

export default function ThemeHoldSwitch() {
  const [announced, setAnnounced] = useState(null) // theme being flashed, or 'tip'
  const onRevert = useCallback(() => setAnnounced(null), [])
  const clearAnnounced = useCallback(() => setAnnounced(null), [])
  const { current, busy, locked, choose } = useUiThemeChoice({ onRevert })
  const [holdT, setHoldT] = useState(0)          // 0..1 while the thumb is down
  const holdingRef = useRef(false)
  const startRef = useRef(0)
  const tickRef = useRef(null)
  const buttonRef = useRef(null)

  const tipTimerRef = useRef(null)

  const stopTick = () => { clearInterval(tickRef.current); tickRef.current = null }
  useEffect(() => () => { stopTick(); clearTimeout(tipTimerRef.current) }, [])

  const other = UI_THEMES.find(t => t !== current) ?? current

  const complete = () => {
    holdingRef.current = false
    stopTick()
    setHoldT(0)
    navigator.vibrate?.(18)
    const rect = buttonRef.current?.getBoundingClientRect()
    const at = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: 0 }
    const next = other
    // The flash is part of the committed state, so it is in the new page the
    // sweep reveals rather than a beat behind it; a failed save pulls it
    // again through onRevert.
    choose(next, {
      apply: (commit) => animateThemeSwitch(() => { commit(); setAnnounced(next) }, at, next),
    })
  }

  const showTip = () => {
    setAnnounced('tip')
    clearTimeout(tipTimerRef.current)
    tipTimerRef.current = setTimeout(() => setAnnounced(a => (a === 'tip' ? null : a)), TIP_MS)
  }

  const onPointerDown = (e) => {
    if (busy || holdingRef.current) return
    if (e.button != null && e.button !== 0) return
    e.preventDefault()
    if (locked) { showTip(); return }
    // Capture so a thumb drifting off the label mid-hold still counts. Can
    // throw for a pointer the browser is not tracking; the hold works without it.
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* not a live pointer */ }
    holdingRef.current = true
    startRef.current = Date.now()
    setHoldT(0)
    setAnnounced(null)
    clearTimeout(tipTimerRef.current)
    stopTick()
    tickRef.current = setInterval(() => {
      const t = Math.min(1, (Date.now() - startRef.current) / HOLD_MS)
      setHoldT(t)
      if (t >= 1) complete()
    }, TICK_MS)
  }

  const release = () => {
    if (!holdingRef.current) return
    holdingRef.current = false
    stopTick()
    setHoldT(0)
    // Let go early: a tap, or a hold that gave up. Either way the label says
    // how it works for a moment, then goes back to normal.
    showTip()
  }
  const showingTip = announced === 'tip'
  const tipLabel = locked ? LOCKED_LABEL : TIP_LABEL

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onPointerDown={onPointerDown}
        onPointerUp={release}
        onPointerCancel={release}
        onContextMenu={(e) => e.preventDefault()}
        disabled={busy}
        aria-label={locked ? 'Theme is locked while a test is running' : `Hold to switch theme to ${UI_THEME_LABELS[other]}`}
        aria-disabled={locked || undefined}
        title={locked ? 'Theme is locked while a test is running. Finish or quit the test to change it.' : `Press and hold to switch to the ${UI_THEME_LABELS[other]} theme`}
        data-testid="theme-hold-switch"
        className={`theme-hold-switch text-[11px] font-semibold transition-opacity whitespace-nowrap outline-none focus:outline-none ${
          holdT > 0 ? 'opacity-100 text-text-muted' : showingTip ? 'opacity-90 text-brand-600' : locked ? 'opacity-30 text-text-muted' : 'opacity-50 text-text-muted'
        }`}
      >
        {showingTip ? tipLabel : 'Switch theme'}
      </button>
      {holdT > 0 && createPortal(
        <div className="theme-hold-bar" style={{ transform: `scaleX(${holdT})` }} aria-hidden="true" data-testid="theme-hold-bar" />,
        document.body,
      )}
      {announced && !showingTip && <ThemeFlash theme={announced} onDone={clearAnnounced} />}
    </>
  )
}
