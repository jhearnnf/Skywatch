import { useEffect } from 'react'
import { input } from './inputStore'

const FORWARD = new Set(['KeyW', 'ArrowUp'])
const BACK    = new Set(['KeyS', 'ArrowDown'])
const LEFT    = new Set(['KeyA', 'ArrowLeft'])
const RIGHT   = new Set(['KeyD', 'ArrowRight'])
const ACTION  = new Set(['KeyE', 'Enter'])
const JUMP    = new Set(['Space'])
const RUN     = new Set(['ShiftLeft', 'ShiftRight'])

export function useKeyboardInput() {
  useEffect(() => {
    const held = new Set()

    const sync = () => {
      const fwd = [...held].some(c => FORWARD.has(c)) ? -1 : 0
      const bck = [...held].some(c => BACK.has(c))    ?  1 : 0
      const lft = [...held].some(c => LEFT.has(c))    ? -1 : 0
      const rgt = [...held].some(c => RIGHT.has(c))   ?  1 : 0
      // Only override joystick when a key is actually held — otherwise let
      // the joystick value persist.
      const z = fwd + bck
      const x = lft + rgt
      if (z !== 0 || x !== 0 || held.size === 0) {
        // Normalize diagonals (length-1 movement vector)
        const len = Math.hypot(x, z) || 1
        input.move.x = x / len
        input.move.z = z / len
      }
    }

    const down = (e) => {
      if (RUN.has(e.code)) { input.run = true; return }
      if (e.repeat) return
      if (ACTION.has(e.code)) { input.setAction(); return }
      if (JUMP.has(e.code)) { input.setJump(); return }
      if (FORWARD.has(e.code) || BACK.has(e.code) || LEFT.has(e.code) || RIGHT.has(e.code)) {
        held.add(e.code)
        sync()
      }
    }
    const up = (e) => {
      if (RUN.has(e.code)) { input.run = false; return }
      if (held.delete(e.code)) sync()
    }
    const blur = () => { held.clear(); input.run = false; sync() }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
}
