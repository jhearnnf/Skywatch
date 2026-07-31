import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useAppSettings } from '../../context/AppSettingsContext'
import DemoGameCard from './DemoGameCard'
import { pickGameDemos, takeWithHeavyCap } from './gameDemoPool'
import { componentForDemo } from './gameDemoRegistry'
import PerfHud from './LiveGameGridPerf'
import { usePerfSweep } from './usePerfSweep'

// The slim-mode landing page's headline: a wall of real CBAT games playing
// themselves. Replaces the single cycling <PreviewWindow> — nine games at once
// says more about the product than one game at a time ever did.
//
// Cost control, in layers:
//   • nothing mounts until the section scrolls into view, and everything
//     unmounts when it scrolls away;
//   • cards boot on a stagger rather than all in one frame;
//   • the picker rations canvas-backed games (see pickGameDemos).

const MOBILE_MAX_WIDTH = 600      // matches the app-wide mobile breakpoint
const DESKTOP_COUNT = 9
const MOBILE_COUNT  = 6
const STAGGER_MS    = 450
// Most of the pool is canvas-backed — seven of twelve, counting Trace Practise
// 2D, which renders its aircraft through <PlaneModel3D> and so costs a WebGL
// context like the rest. These are the ceilings the picker aims for; phones get
// a tighter one because they have far less to spend.
const DESKTOP_MAX_HEAVY = 4
const MOBILE_MAX_HEAVY  = 2

// Phones get a stage shaped like a phone, so games render the layout they were
// designed for at that width rather than a squeezed desktop one.
const DESKTOP_STAGE = { w: 900, h: 600 }
const MOBILE_STAGE  = { w: 430, h: 560 }

const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`

function subscribeToWidth(onChange) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(MOBILE_QUERY)
  mq.addEventListener?.('change', onChange)
  return () => mq.removeEventListener?.('change', onChange)
}
const isMobileSnapshot = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.(MOBILE_QUERY).matches

function useIsMobile() {
  return useSyncExternalStore(subscribeToWidth, isMobileSnapshot, () => false)
}

export default function LiveGameGrid({
  eyebrow = 'CBAT PRACTICE GAMES',
  // Not "every game" — the wall shows a shuffled handful of what's built, and
  // the CBAT battery has tests we don't cover yet, so nothing here promises
  // the full set. Avoid "right now" too: it read as a live feed of other
  // people's sessions.
  heading = 'Train the skills the CBAT tests.',
  subheading = 'Select one of the games below to begin practising.',
}) {
  const { user } = useAuth()
  const { settings } = useAppSettings() ?? {}
  const isMobile = useIsMobile()
  const sectionRef = useRef(null)

  // Fresh shuffle per visit. Keyed on the admin gating rather than on `settings`
  // itself: settings arrive asynchronously and the object identity changes on
  // every refresh, and a reshuffle mid-visit would swap the wall out from under
  // the visitor.
  const enabledKey = JSON.stringify(settings?.cbatGameEnabled ?? null)
  const picks = useMemo(
    () => pickGameDemos(
      { cbatGameEnabled: JSON.parse(enabledKey) ?? {} },
      { count: DESKTOP_COUNT, maxHeavy: DESKTOP_MAX_HEAVY },
    ),
    [enabledKey],
  )

  // Diagnostic only — `?perf=1` steps the number of live cards down and
  // measures each step. See LiveGameGridPerf.jsx.
  const perf = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('perf') === '1'
  const sweep = usePerfSweep(perf)

  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const el = sectionRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.05, rootMargin: '200px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  if (picks.length === 0) return null

  // Mobile draws from the same nine — no reshuffle on rotate — but takes only
  // six, and prefers the lighter ones.
  const visible = isMobile
    ? takeWithHeavyCap(picks, MOBILE_COUNT, MOBILE_MAX_HEAVY)
    : picks
  const stage = isMobile ? MOBILE_STAGE : DESKTOP_STAGE

  return (
    <section
      ref={sectionRef}
      className="py-8 sm:py-12 px-3 sm:px-5 max-w-5xl mx-auto"
      data-testid="live-game-grid"
    >
      <div className="text-center mb-4 sm:mb-6">
        <div className="flex items-center justify-center gap-2 mb-2 sm:mb-3">
          <span className="intel-tag">{eyebrow}</span>
        </div>
        <h2 className="text-xl sm:text-3xl font-bold text-slate-900 mb-1 px-3">{heading}</h2>
        <p className="text-sm text-slate-500 px-3">{subheading}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
        {visible.map((entry, i) => (
          <DemoGameCard
            key={entry.id}
            entry={entry}
            Component={componentForDemo(entry.id)}
            stage={stage}
            loggedIn={!!user}
            // During a perf sweep the cards past the current cap fall back to
            // their posters, which is exactly how a rationed wall would behave.
            active={inView && (!perf || i < sweep.live)}
            startDelayMs={perf ? 0 : i * STAGGER_MS}
          />
        ))}
      </div>

      {perf && <PerfHud {...sweep} />}
    </section>
  )
}
