import { useEffect, useRef, useState } from 'react'

// The Case Files navbar entry is meant to feel like something you were let in
// on: a classified folder that glances back at you, and a label that decrypts
// itself. Both pieces are used by Sidebar and BottomNav.

// ── Icon ─────────────────────────────────────────────────────────────────────
// A dark case folder with a red CLASSIFIED band and an eye on the front. The
// pupil drifts and the lid blinks now and then (cf-nav-eye-* in main.css).
export function CaseFilesNavIcon({ size = 25, active = false }) {
  const stroke = active ? '#5baaff' : '#8aa3c2'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="cf-nav-icon"
      data-testid="case-files-nav-icon"
    >
      {/* Folder: tab, then body */}
      <path d="M2.5 6.5 a1.5 1.5 0 0 1 1.5-1.5 h4.4 l1.8 2 h9.8 a1.5 1.5 0 0 1 1.5 1.5 v9.5 a1.5 1.5 0 0 1-1.5 1.5 H4 a1.5 1.5 0 0 1-1.5-1.5 z"
        fill="#0c1829" stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
      {/* CLASSIFIED band across the corner */}
      <path d="M13.5 8.5 L21.5 8.5 L21.5 11 L16 11 Z" fill="#e0413a" opacity="0.9" />
      {/* Eye */}
      <g className="cf-nav-eye">
        <path d="M6.5 14 Q11 10 15.5 14 Q11 18 6.5 14 Z" fill="#06101e" stroke={stroke} strokeWidth="1.1" strokeLinejoin="round" />
        <circle className="cf-nav-pupil" cx="11" cy="14" r="1.6" fill={active ? '#5baaff' : '#cfe6ff'} />
      </g>
    </svg>
  )
}

// ── Decrypting label ─────────────────────────────────────────────────────────
// Resolves left to right out of scrambled glyphs. Plays once when it mounts
// (the tab first appearing) and again on hover where there is one.
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$'
const DECRYPT_MS = 650
const TICK_MS    = 40

export function DecryptLabel({ text, replayOnHover = false, className = '' }) {
  const [shown, setShown] = useState(text)
  const timer = useRef(null)

  function play() {
    clearInterval(timer.current)
    const start = Date.now()
    timer.current = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / DECRYPT_MS)
      const settled = Math.floor(t * text.length)
      setShown(
        text
          .split('')
          .map((ch, i) => (i < settled || ch === ' ' ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]))
          .join(''),
      )
      if (t >= 1) clearInterval(timer.current)
    }, TICK_MS)
  }

  useEffect(() => {
    play()
    return () => clearInterval(timer.current)
    // Plays on mount only; the text never changes for a nav label.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <span
      className={`cf-nav-decrypt ${className}`}
      onMouseEnter={replayOnHover ? play : undefined}
      aria-label={text}
    >
      <span aria-hidden="true">{shown}</span>
    </span>
  )
}
