import { useEffect, useRef, useState } from 'react'
import { playSound } from '../utils/sound'

const VARIANTS = ['bulletCasingR1', 'bulletCasingR2', 'bulletCasingL1', 'bulletCasingL2']

export default function OutOfAmmo({ x, y, onDone }) {
  const ref = useRef(null)
  const [variant] = useState(() => VARIANTS[Math.floor(Math.random() * VARIANTS.length)])

  // Play sound exactly once on mount
  useEffect(() => { playSound('out_of_ammo') }, [])

  // Animation-end listener — kept separate so sound isn't re-triggered if onDone ref changes
  useEffect(() => {
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
      style={{ left: x, top: y, animation: `${variant} 1.6s linear forwards` }}
      aria-hidden="true"
    >
      out-of-ammo
    </span>
  )
}
