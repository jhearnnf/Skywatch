import { useEffect } from 'react'

/**
 * Right-click anywhere = BLEEP.
 *
 * On a mouse you steer ACT by dragging the tunnel, so the cursor is out in the
 * arena at exactly the moment a bleep sounds. Travelling to the button costs
 * reaction time the test is supposed to be measuring, which is the whole
 * problem this solves.
 *
 * The right button is the one input that is genuinely free here: it never
 * starts a steer drag (the canvas ignores non-primary buttons) and it can't be
 * mistaken for one, so the false-alarm penalty still means what it means — a
 * right-click with no bleep playing scores exactly like an impulsive tap on
 * the button.
 *
 * Listeners live on `window` for as long as the hook is mounted, so the
 * context menu is suppressed during a round and nowhere else.
 *
 * @param {object}   opts
 * @param {Function} opts.onBleep    fired on right-button press (unless disabled)
 * @param {Function} [opts.onRelease] fired on right-button release, for press feedback
 * @param {boolean}  [opts.disabled] suppress the menu but don't score — used
 *                                   while the callsign overlay or pause screen
 *                                   is up, matching the button's disabled state
 */
export function useRightClickBleep({ onBleep, onRelease, disabled = false }) {
  useEffect(() => {
    const onContextMenu = (e) => e.preventDefault()
    const onPointerDown = (e) => {
      if (e.button !== 2) return
      e.preventDefault()
      if (disabled) return
      onBleep?.()
    }
    const onPointerUp = (e) => {
      if (e.button !== 2) return
      onRelease?.()
    }
    window.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [onBleep, onRelease, disabled])
}
