import { useEffect, useRef } from 'react'
import { motion, useAnimate } from 'framer-motion'

// Arrival flourish for the CBAT leaderboard page. A big "THIS WEEK" card appears
// dead-centre over a dimmed backdrop and flashes, then — via framer's shared
// layout — morphs its exact shape, size and position into the "This Week" pill
// of the Weekly / All-Time toggle.
//
// The morph itself is NOT animated here: this card and the toggle's active pill
// share one `layoutId` (INTRO_PILL_LAYOUT_ID). When the parent flips introDone,
// this overlay unmounts and the pill mounts in the same commit, so framer
// animates the pill *from this card's box* — a true shape morph. Here we only
// run the pop-in / flash / backdrop-fade, then hand off.
//
// Props:
//   onDone — called after the flash so the parent can flip introDone (triggering
//            the morph) and reveal the board. Also fired on tap-to-skip.

export const INTRO_PILL_LAYOUT_ID = 'cbat-weekly-pill'

export default function LeaderboardIntro({ onDone }) {
  const [scope, animate] = useAnimate()
  const finishRef = useRef(() => {})

  useEffect(() => {
    let cancelled = false
    let done = false
    const finish = () => {
      if (done) return
      done = true
      onDone?.()
    }
    finishRef.current = finish

    const card = scope.current?.querySelector('[data-intro-card]')
    const glow = scope.current?.querySelector('[data-intro-glow]')
    const backdrop = scope.current?.querySelector('[data-intro-backdrop]')

    // The shared-layout box itself carries no transform — a transform here would
    // fight framer's morph projection — so the pop/flash live on opacity and a
    // separate glow child, leaving the box's geometry clean for the morph.
    async function run() {
      try {
        if (card) {
          await animate(card, { opacity: [0, 1] }, { duration: 0.26, ease: 'easeOut' }) // fade in
          if (cancelled) return
          if (glow) await animate(glow, { opacity: [0, 0.7, 0] }, { duration: 0.42, ease: 'easeInOut' }) // flash
          if (cancelled) return
          await new Promise(r => setTimeout(r, 90)) // brief hold
          if (cancelled) return
        }
        // clear the dim, then hand off — introDone flips and the pill morphs up
        if (backdrop) animate(backdrop, { opacity: 0 }, { duration: 0.35, ease: 'easeInOut' })
        await new Promise(r => setTimeout(r, 230))
      } catch { /* interrupted (skip / unmount) */ }
      if (!cancelled) finish()
    }

    run()
    const safety = setTimeout(finish, 2200) // never leave the board hidden
    return () => { cancelled = true; clearTimeout(safety) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={scope}
      className="fixed inset-0 z-[60] flex items-center justify-center px-6"
      onClick={() => finishRef.current()}
      role="presentation"
    >
      <div data-intro-backdrop className="absolute inset-0 bg-[#06101e]/85 backdrop-blur-sm" />
      <motion.div
        data-intro-card
        layoutId={INTRO_PILL_LAYOUT_ID}
        className="relative flex flex-col items-center gap-1 bg-brand-600 px-8 py-6 text-white shadow-2xl ring-2 ring-brand-300/60"
        style={{ opacity: 0, borderRadius: 16 }}
      >
        <span
          data-intro-glow
          aria-hidden
          className="pointer-events-none absolute -inset-2 bg-brand-400"
          style={{ opacity: 0, borderRadius: 20, filter: 'blur(16px)' }}
        />
        <span className="relative text-4xl leading-none">🏆</span>
        <span className="relative text-lg font-extrabold uppercase tracking-widest">This Week</span>
      </motion.div>
    </div>
  )
}
