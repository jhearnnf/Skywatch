import { useEffect, useRef } from 'react'

export default function OutOfAmmo({ x, y, onDone }) {
  const ref = useRef(null)

  useEffect(() => {
    // Play sound
    const audio = new Audio('/sounds/out_of_ammo.mp3')
    audio.play().catch(() => {}) // ignore if file not yet present

    // Remove component once animation ends
    const el = ref.current
    if (!el) return
    const handler = () => onDone()
    el.addEventListener('animationend', handler)
    return () => el.removeEventListener('animationend', handler)
  }, [onDone])

  return (
    <span
      ref={ref}
      className="out-of-ammo"
      style={{ left: x, top: y }}
      aria-hidden="true"
    >
      out-of-ammo
    </span>
  )
}
