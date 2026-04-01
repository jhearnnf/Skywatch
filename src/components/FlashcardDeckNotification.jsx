import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'

const NOTIF_W   = 280
const NOTIF_H   = 64
const NOTIF_TOP = 72   // below the navbar

function getPlayNavElement() {
  const els = document.querySelectorAll('[data-nav="play"]')
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}

export default function FlashcardDeckNotification({ cardRect, onDone }) {
  // phase: 'flying-in' | 'showing' | 'flying-out'
  const [phase,       setPhase]   = useState('flying-in')
  const playNavRectRef            = useRef(null)   // populated just before flying-out
  const phaseGenRef               = useRef(0)      // increments each phase advance
  const handledGenRef             = useRef(-1)     // last generation handled
  const flyOutTimerRef            = useRef(null)

  const notifLeft = Math.round((window.innerWidth - NOTIF_W) / 2)

  // Cleanup timer on unmount
  useEffect(() => () => clearTimeout(flyOutTimerRef.current), [])

  function advancePhase(next) {
    phaseGenRef.current += 1
    setPhase(next)
  }

  function handleAnimationComplete() {
    const gen = phaseGenRef.current
    if (handledGenRef.current === gen) return
    handledGenRef.current = gen

    if (phase === 'flying-in') {
      advancePhase('showing')
      flyOutTimerRef.current = setTimeout(() => {
        const el = getPlayNavElement()
        if (!el) { onDone(); return }
        playNavRectRef.current = el.getBoundingClientRect()
        advancePhase('flying-out')
      }, 1600)
    } else if (phase === 'flying-out') {
      const el = getPlayNavElement()
      if (el) {
        el.classList.add('play-nav-flash')
        setTimeout(() => el.classList.remove('play-nav-flash'), 1200)
      }
      onDone()
    }
  }

  // Animate target — fly-out collapses card to the centre of the Play nav button
  const navRect = playNavRectRef.current
  const animateTarget = (phase === 'flying-out' && navRect)
    ? {
        top:          navRect.top  + navRect.height / 2 - 18,
        left:         navRect.left + navRect.width  / 2 - 18,
        width:        36,
        height:       36,
        borderRadius: 50,
        background:   '#1d4ed8',
        border:       '1px solid transparent',
        boxShadow:    '0 0 0 0 rgba(29,78,216,0)',
        opacity:      0,
      }
    : {
        top:          NOTIF_TOP,
        left:         notifLeft,
        width:        NOTIF_W,
        height:       NOTIF_H,
        borderRadius: 20,
        background:   '#1d4ed8',
        border:       '1px solid transparent',
        boxShadow:    '0 10px 30px rgba(29,78,216,0.4)',
        opacity:      1,
      }

  const transition = (phase === 'flying-out')
    ? { duration: 0.45, ease: [0.4, 0, 0.8, 0.2] }
    : { duration: 0.5,  ease: [0.4, 0, 0.2, 1] }

  return createPortal(
    <div
      data-testid="flashcard-deck-notif"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1200 }}
    >
      {/* Ghost deck cards — only visible in showing phase */}
      {phase === 'showing' && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
            style={{
              position: 'fixed',
              top:    NOTIF_TOP + 3,
              left:   notifLeft + 5,
              width:  NOTIF_W,
              height: NOTIF_H,
              borderRadius: 20,
              background: '#2563eb',
              rotate: '-3deg',
              zIndex: 1201,
            }}
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18, delay: 0.06 }}
            style={{
              position: 'fixed',
              top:    NOTIF_TOP + 6,
              left:   notifLeft + 10,
              width:  NOTIF_W,
              height: NOTIF_H,
              borderRadius: 20,
              background: '#3b82f6',
              rotate: '-6deg',
              zIndex: 1200,
            }}
          />
        </>
      )}

      {/* Main card — flies in, displays, then flies to Play nav */}
      <motion.div
        initial={{
          top:          cardRect.top,
          left:         cardRect.left,
          width:        cardRect.width,
          height:       cardRect.height,
          borderRadius: 16,
          background:   'var(--color-surface, #ffffff)',
          border:       '1px solid #cbd5e1',
          boxShadow:    '0 1px 3px rgba(0,0,0,0.08)',
          opacity:      1,
        }}
        animate={animateTarget}
        transition={transition}
        onAnimationComplete={handleAnimationComplete}
        style={{ position: 'fixed', overflow: 'hidden', zIndex: 1202 }}
      >

        {/* Notification content — visible in showing phase */}
        {phase === 'showing' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.2 }}
            style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center',
              gap: 12, padding: '0 18px',
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>⚡</span>
            <div>
              <p style={{ color: '#ffffff', fontWeight: 800, fontSize: 13, margin: 0, lineHeight: 1.25 }}>
                Flashcard added to deck
              </p>
              <p style={{ color: 'rgba(255,255,255,0.65)', fontWeight: 600, fontSize: 10, margin: '2px 0 0', lineHeight: 1 }}>
                Available in Flashcard Recall
              </p>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>,
    document.body
  )
}
