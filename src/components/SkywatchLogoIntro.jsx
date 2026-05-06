import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import Overlay from './ui/Overlay'
import { playSound } from '../utils/sound'

// Total length of the boot animation. Exported so callers can match the phase
// transition timing to ours and so the cue sound length aligns. Don't change
// without auditing the keyframe `times` arrays below — they're all expressed
// as fractions of this duration.
export const SKYWATCH_LOGO_INTRO_MS = 1800

// Full-screen "logo boot" intro shown after a CBAT aircraft selection. The
// caller controls when this mounts (typically gated on a phase==='intro'
// flag), and is notified via onComplete after SKYWATCH_LOGO_INTRO_MS so it
// can flip into the playing phase. Reduced-motion / replay-skip is the
// CALLER's responsibility — it just shouldn't mount us in those cases.
export default function SkywatchLogoIntro({ onComplete }) {
  // Stable mount-only effect — capture onComplete in a ref so passing a
  // fresh inline callback each render doesn't reset the timer.
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { onCompleteRef.current = onComplete })

  useEffect(() => {
    playSound('skywatch_logo')
    const t = setTimeout(() => onCompleteRef.current?.(), SKYWATCH_LOGO_INTRO_MS)
    return () => clearTimeout(t)
  }, [])

  const dur = SKYWATCH_LOGO_INTRO_MS / 1000

  return (
    <Overlay zIndex={1100} backdrop={false} respectSafeArea={false}>
      {/* Black curtain — independent opacity timeline from the logo so it
          can fade out while the lettering persists on its own curve. */}
      <motion.div
        className="absolute inset-0 bg-black"
        initial={{ opacity: 1 }}
        animate={{ opacity: [1, 1, 0] }}
        transition={{ duration: dur, times: [0, 0.61, 1], ease: 'linear' }}
      />

      {/* Centered stage — slam-in scale/rotate applies to the whole group.
          Each child manages its own opacity dissolve so the crosshair can
          fade earlier (matching its zoom-out) while the wordmark/tagline
          persist into the curtain-fade window. */}
      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center"
        initial={{ scale: 0.2, rotate: -45 }}
        animate={{
          scale:  [0.2, 1, 1, 1.4],
          rotate: [-45, 0, 0, 0],
        }}
        transition={{
          duration: dur,
          times: [0, 0.28, 0.72, 1],
          ease: [0.16, 1, 0.3, 1],
        }}
      >
        {/* Crosshair opacity wrapper — owns the early dissolve so the
            crosshair fades with the zoom-out, independent of the lettering
            below which holds longer. */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 1, 0] }}
          transition={{
            duration: dur,
            times: [0, 0.28, 0.72, 1],
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          <motion.div
            style={{ width: 'min(75vw, 75vh)', height: 'min(75vw, 75vh)' }}
            animate={{
              filter: [
                'drop-shadow(0 0 40px rgba(91,170,255,0.6)) brightness(1)',
                'drop-shadow(0 0 40px rgba(91,170,255,0.6)) brightness(1)',
                'drop-shadow(0 0 80px rgba(255,255,255,0.95)) brightness(2.5)',
                'drop-shadow(0 0 40px rgba(91,170,255,0.6)) brightness(1)',
                'drop-shadow(0 0 80px rgba(255,255,255,0.95)) brightness(2.5)',
                'drop-shadow(0 0 40px rgba(91,170,255,0.6)) brightness(1)',
                'drop-shadow(0 0 80px rgba(255,255,255,0.95)) brightness(2.5)',
                'drop-shadow(0 0 40px rgba(91,170,255,0.6)) brightness(1)',
              ],
            }}
            transition={{
              duration: dur,
              times: [0, 0.44, 0.49, 0.54, 0.59, 0.64, 0.69, 0.72],
              ease: 'linear',
            }}
          >
            <svg viewBox="0 0 40 40" fill="none" width="100%" height="100%" aria-hidden="true">
              <circle cx="20" cy="20" r="17" stroke="#1d4ed8" strokeWidth="2.2"/>
              <line x1="20" y1="1"  x2="20" y2="12" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round"/>
              <line x1="20" y1="28" x2="20" y2="39" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round"/>
              <line x1="1"  y1="20" x2="12" y2="20" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round"/>
              <line x1="28" y1="20" x2="39" y2="20" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round"/>
              <circle cx="20" cy="20" r="7" stroke="#5baaff" strokeWidth="1.8"/>
              <circle cx="20" cy="20" r="2.5" fill="#5baaff"/>
            </svg>
          </motion.div>
        </motion.div>

        {/* Wordmark — letters rise sequentially (typewriter feel) and HOLD
            past the crosshair's dissolve so the brand reads against the
            fading curtain. Final keyframe drops opacity to 0 between 0.92
            and 1.0 — by then the curtain is at ~13% opacity and the arena
            is mostly visible. */}
        <div
          className="text-brand-600 font-extrabold tracking-[0.4em] mt-6 text-center"
          style={{ fontSize: 'clamp(1.5rem, 6vmin, 4rem)' }}
        >
          {Array.from('SKYWATCH').map((ch, i) => {
            const start = 0.5 + i * 0.06
            const peak  = start + 0.15
            return (
              <motion.span
                key={i}
                className="inline-block"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: [0, 0, 1, 1, 0], y: [20, 20, 0, 0, 0] }}
                transition={{
                  duration: dur,
                  times: [0, start / dur, peak / dur, 0.92, 1],
                }}
              >
                {ch}
              </motion.span>
            )
          })}
        </div>

        {/* Small accent-coloured tagline — same late-hold pattern as the
            wordmark so the two stay together through the curtain fade. */}
        <motion.div
          className="text-amber-400 font-semibold tracking-[0.5em] mt-2 text-center"
          style={{ fontSize: 'clamp(0.6rem, 1.6vmin, 1rem)' }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: [0, 0, 1, 1, 0], y: [8, 8, 0, 0, 0] }}
          transition={{
            duration: dur,
            times: [0, 0.62, 0.72, 0.92, 1],
          }}
        >
          EXCLUSIVE
        </motion.div>

        {/* Expanding shockwave ring during the flash window. */}
        <motion.div
          className="absolute top-1/2 left-1/2 rounded-full border-2 border-brand-400 pointer-events-none"
          style={{
            width: '20vmin', height: '20vmin',
            translateX: '-50%', translateY: '-50%',
          }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: [0, 0, 6], opacity: [0, 1, 0] }}
          transition={{
            duration: dur,
            times: [0, 0.5, 0.85],
            ease: 'easeOut',
          }}
        />
      </motion.div>
    </Overlay>
  )
}
