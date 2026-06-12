import { useEffect, useRef, useState } from 'react'
import { input } from '../character/inputStore'

// Touch-only virtual joystick. Fixed bottom-right (level HUD owns bottom-left).
// Writes normalised {x, z} to input.move where +x = right and -z = forward,
// matching the keyboard convention so CharacterController doesn't need to
// branch by input source.

const RADIUS = 56

export default function VirtualJoystick() {
  const baseRef = useRef(null)
  const [thumb, setThumb] = useState({ x: 0, y: 0 })
  const pointerIdRef = useRef(null)
  const originRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    return () => {
      // Ensure movement zeroes out if the component unmounts mid-drag.
      input.move.x = 0
      input.move.z = 0
    }
  }, [])

  const onPointerDown = (e) => {
    if (pointerIdRef.current !== null) return
    const rect = baseRef.current.getBoundingClientRect()
    originRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    pointerIdRef.current = e.pointerId
    baseRef.current.setPointerCapture(e.pointerId)
    update(e)
  }

  const onPointerMove = (e) => {
    if (pointerIdRef.current !== e.pointerId) return
    update(e)
  }

  const onPointerUp = (e) => {
    if (pointerIdRef.current !== e.pointerId) return
    pointerIdRef.current = null
    setThumb({ x: 0, y: 0 })
    input.move.x = 0
    input.move.z = 0
  }

  const update = (e) => {
    const dx = e.clientX - originRef.current.x
    const dy = e.clientY - originRef.current.y
    const len = Math.hypot(dx, dy)
    const k = len > RADIUS ? RADIUS / len : 1
    const px = dx * k
    const py = dy * k
    setThumb({ x: px, y: py })
    // Normalise to [-1, 1]; screen-Y down = move forward (-z in world).
    input.move.x = px / RADIUS
    input.move.z = py / RADIUS
  }

  return (
    <div
      ref={baseRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="fixed bottom-6 right-6 w-32 h-32 rounded-full bg-slate-200/35 border-2 border-slate-300/60 backdrop-blur-sm pointer-events-auto touch-none select-none"
      aria-label="Movement joystick"
    >
      <div
        className="absolute top-1/2 left-1/2 w-14 h-14 -mt-7 -ml-7 rounded-full bg-brand-500/80 border-2 border-brand-300 shadow-md"
        style={{ transform: `translate(${thumb.x}px, ${thumb.y}px)` }}
      />
    </div>
  )
}
