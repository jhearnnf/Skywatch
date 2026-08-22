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
    const press = (e) => {
      e.preventDefault()
      if (disabled) return
      onBleep?.()
    }

    const onContextMenu = (e) => e.preventDefault()

    const onPointerDown = (e) => {
      if (e.button !== 2) return
      press(e)
    }

    const onPointerUp = (e) => {
      if (e.button !== 2) return
      onRelease?.()
    }

    // A chorded press — a second button going down while one is already held.
    //
    // This is the case that matters most and the one that silently did nothing
    // at first: steering IS the left button held down, so every right-click
    // made while flying is a chord. Pointer Events deliberately does not fire
    // an overlapping pointerdown/pointerup pair for these; the press and the
    // release both arrive as a `pointermove` whose `button` names the button
    // that changed (it is -1 on an ordinary move) and whose `buttons` bitmask
    // says whether that button is now down.
    const onPointerMove = (e) => {
      if (e.button !== 2) return
      if (e.buttons & 2) press(e)
      else onRelease?.()
    }

    window.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointermove', onPointerMove)
    return () => {
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointermove', onPointerMove)
    }
  }, [onBleep, onRelease, disabled])
}
