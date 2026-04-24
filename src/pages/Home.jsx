import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppTutorial } from '../context/AppTutorialContext'
import TutorialModal from '../components/tutorial/TutorialModal'
import WelcomeAgentFlow from '../components/onboarding/WelcomeAgentFlow'
import FlashcardGameModal from '../components/FlashcardGameModal'
import { CATEGORY_ICONS } from '../data/mockData'
import { useAppSettings } from '../context/AppSettingsContext'
import { getLevelInfo } from '../utils/levelUtils'
import SEO from '../components/SEO'
import BriefImageBackdrop from '../components/BriefImageBackdrop'
import { PENDING_ONBOARDING_KEY, lastSeenStreakKey } from '../utils/storageKeys'

// XP progress ring
function XPRing({ pct = 0, level = 1, size = 72 }) {
  const r = (size / 2) - 6
  const circ = 2 * Math.PI * r
  const dash = circ * (pct / 100)
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1a3060" strokeWidth="5"/>
        <circle
          cx={size/2} cy={size/2} r={r}
          fill="none" stroke="#5baaff" strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xl font-black text-brand-600">{level}</span>
      </div>
    </div>
  )
}


export default function Home() {
  const { user, API, apiFetch, notifQueue = [] } = useAuth()
  const { start }      = useAppTutorial()
  const navigate       = useNavigate()
  const { levels: liveLevels } = useAppSettings()
  const [latestBriefs,      setLatestBriefs]      = useState([])
  const [showCROFlow,       setShowCROFlow]       = useState(false)
  const [missionLoading,    setMissionLoading]    = useState(false)
  const [showFlashcard,     setShowFlashcard]     = useState(false)
  const [jumpBackBrief,     setJumpBackBrief]     = useState(null)
  const [newsLoading,       setNewsLoading]       = useState(true)
  const [flashcardAvail,    setFlashcardAvail]    = useState(null)
  // Ref (not state) guards the locked-flashcard tap so re-renders don't cause
  // the "Read →" chip to flicker while the fetch is in flight.
  const unlockReadBusyRef   = useRef(false)
  // Mission drawer phase: 'pending' (not yet evaluated — render nothing so the
  // drawer can't briefly reserve space and shove Quick Actions down) |
  // 'available' (amber, clickable) | 'complete' (green, about to retract) |
  // 'hidden' (removed — already animated or no pending bump)
  const [missionPhase,      setMissionPhase]      = useState('pending')
  const [displayStreak,     setDisplayStreak]     = useState(user?.loginStreak ?? 0)
  const [flamePulsing,      setFlamePulsing]      = useState(false)
  // Non-null when a streak-bump retract is staged but waiting for the
  // notification queue to drain. Shape: { currentStreak, storageKey }.
  const [pendingRetract,    setPendingRetract]    = useState(null)
  const streakAnimRan = useRef(false)
  const retractStartedRef = useRef(false)
  const prefersReducedMotion = useReducedMotion()
  const levelInfo = user ? getLevelInfo(user.cycleAirstars ?? 0, liveLevels) : null

  // Mission done if the user completed a brief today (server-authoritative via
  // lastStreakDate). Derived synchronously so it's correct on the very first
  // render — using state here would default to false on render 1 and cause the
  // mission drawer to briefly render as 'available' before settling, which
  // pushes Quick Actions down then snaps it back up.
  const missionDone = user?.lastStreakDate
    ? new Date(user.lastStreakDate).toDateString() === new Date().toDateString()
    : false

  // Streak-bump reveal (stage): when the user returns to Home after completing
  // today's mission, show the "Mission complete" drawer and stage a retract.
  // The actual timer sequence is kicked off in a separate effect below, once
  // the notification queue has drained, so reward notifications (airstars,
  // level up, etc.) land first without competing with this animation.
  useEffect(() => {
    if (!user) {
      // User context still loading — keep 'pending' so the drawer slot stays
      // collapsed instead of flashing in then disappearing.
      setMissionPhase('pending')
      return
    }
    const currentStreak = user.loginStreak ?? 0

    if (!missionDone) {
      setMissionPhase('available')
      setDisplayStreak(currentStreak)
      return
    }

    if (streakAnimRan.current) return

    const key = lastSeenStreakKey(user._id)
    const stored = Number(localStorage.getItem(key))
    const lastSeen = Number.isFinite(stored) && stored > 0
      ? stored
      : Math.max(0, currentStreak - 1)

    // Streak went backwards (progress reset, admin action, etc.) — resync
    // lastSeen to one below current so this completion is treated as a
    // genuine bump and the animation fires. Without this, the stale value
    // would block every completion until the streak climbed past it.
    if (currentStreak < lastSeen) {
      const reset = Math.max(0, currentStreak - 1)
      try { localStorage.setItem(key, String(reset)) } catch {}
      // Fall through to animation path below.
    } else if (currentStreak === lastSeen) {
      setMissionPhase('hidden')
      setDisplayStreak(currentStreak)
      return
    }

    setDisplayStreak(currentStreak - 1)
    // Hold the 'complete' card off-screen for a beat after the page settles,
    // then mount it so the user sees a clear "wasn't there → drops in →
    // exits" sequence. Without this delay the card is essentially present on
    // arrival, which the user wouldn't register as a completion event.
    // pendingRetract is staged inside the timer so the 2s visible pause
    // starts from the moment the card actually appears.
    //
    // streakAnimRan is flipped INSIDE the timer (not before scheduling) so
    // React StrictMode's double-mount in dev — which cancels this timer via
    // the cleanup below and immediately re-runs the effect — can re-schedule
    // a fresh timer instead of bailing on the early-return guard.
    const revealDelay = prefersReducedMotion ? 0 : 650
    const revealTimer = setTimeout(() => {
      streakAnimRan.current = true
      setMissionPhase('complete')
      setPendingRetract({ currentStreak, storageKey: key })
    }, revealDelay)
    return () => clearTimeout(revealTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id, user?.loginStreak, missionDone])

  // Streak-bump reveal (fire): once the notification queue is empty, start the
  // retract timers. Presents the "Mission complete" card for 2s — long enough
  // for the user to read it — then animates it back behind the XP card while
  // the streak number ticks up and the flame pulses.
  useEffect(() => {
    if (retractStartedRef.current) return
    if (!pendingRetract) return
    if (notifQueue.length > 0) return
    retractStartedRef.current = true

    const { currentStreak, storageKey } = pendingRetract
    const presentDelay  = 2000
    const exitDuration  = prefersReducedMotion ? 250 : 520
    // Matches the flame-pulse keyframe in main.css — first ~800ms is the big
    // bump, last ~1000ms is the subtler aftershock so the user has time to
    // register the streak number ticking up.
    const pulseDuration = 1800
    const timeouts = []

    timeouts.push(setTimeout(() => {
      setMissionPhase('hidden')
    }, presentDelay))

    timeouts.push(setTimeout(() => {
      setDisplayStreak(currentStreak)
      setFlamePulsing(true)
      try { localStorage.setItem(storageKey, String(currentStreak)) } catch {}
    }, presentDelay + exitDuration))

    timeouts.push(setTimeout(() => {
      setFlamePulsing(false)
    }, presentDelay + exitDuration + pulseDuration))

    return () => timeouts.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRetract, notifQueue.length])

  // Clean up legacy onboarding session flag — CRO is now driven by the
  // first-mission card for signed-in zero-read users, not a one-shot flag.
  useEffect(() => {
    sessionStorage.removeItem(PENDING_ONBOARDING_KEY)
  }, [])

  // Signed-in user who has never completed a brief (no streak ever set).
  // Drives the first-mission card variant that opens the CRO picker.
  const isZeroRead = !!user && !user.lastStreakDate

  // Start tutorial on first visit — skip when the CRO modal is showing
  useEffect(() => {
    if (showCROFlow) return
    const t = setTimeout(() => start('home'), 600)
    return () => clearTimeout(t)
  }, [showCROFlow]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch a random in-progress brief for "Jump Back In"
  useEffect(() => {
    if (!user) { setJumpBackBrief(null); return }
    apiFetch(`${API}/api/briefs/random-in-progress`)
      .then(r => r.json())
      .then(d => setJumpBackBrief(d.data ?? null))
      .catch(() => {})
  }, [user, API])

  // Prefetch completed-brief count to gate Flashcard Round (min 5 to play)
  useEffect(() => {
    if (!user) { setFlashcardAvail(null); return }
    apiFetch(`${API}/api/games/flashcard-recall/available-briefs`)
      .then(r => r.json())
      .then(d => setFlashcardAvail(d?.data?.count ?? 0))
      .catch(() => setFlashcardAvail(0))
  }, [user, API])

  // Fetch latest 4 News briefs — re-fetch on user change so isRead/isStarted resets after logout
  useEffect(() => {
    setNewsLoading(true)
    apiFetch(`${API}/api/briefs?limit=4&status=published&category=News`)
      .then(r => r.json())
      .then(data => setLatestBriefs(data.data?.briefs ?? []))
      .catch(() => {})
      .finally(() => setNewsLoading(false))
  }, [user, API])

  const today      = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const firstName  = user?.displayName?.split(' ')[0] || 'Agent'
  const greetPrefix = user ? 'Welcome back,' : 'Good to see you'

  // Scroll-driven fades. Top cluster fades out as user scrolls; news list fades in.
  // Thresholds are absolute px — the transition happens in the first ~350px regardless of viewport.
  const { scrollY }     = useScroll()
  const topOpacity      = useTransform(scrollY, [0, 120, 260], [1, 1, 0])
  const topTranslateY   = useTransform(scrollY, [0, 260], [0, -20])
  const newsListOpacity = useTransform(scrollY, [160, 360], [0, 1])
  const newsListY       = useTransform(scrollY, [160, 360], [24, 0])
  // NEWS heading brightens as the list scrolls into view — from ghost amber
  // (matches the dimmed idle state) up toward the "Latest Intel" eyebrow amber.
  const newsHeadingColor  = useTransform(scrollY, [80, 300], ['rgba(234,179,8,0.16)', 'rgba(234,179,8,0.55)'])
  const newsHeadingShadow = useTransform(scrollY, [80, 300], ['0 0 60px rgba(234,179,8,0.15)', '0 0 80px rgba(234,179,8,0.45)'])
  // "Latest Intel" eyebrow mirrors the NEWS heading's idle→active brighten so
  // both feel equally muted at top-of-page and equally lit once scrolled.
  const newsEyebrowOpacity = useTransform(scrollY, [80, 300], [0.55, 1])
  // Chevron fades out as the news list scrolls into view — once the user is
  // already looking at the items, the "scroll down" cue is redundant.
  const chevronOpacity = useTransform(scrollY, [120, 260], [1, 0])
  // Topographic parallax — parallax drift + scale only. Base positioning (size
  // and edge offsets) is handled by clamp()-based CSS on the SVGs themselves so
  // the ranges grow into the gutters on wide screens; these motion values just
  // add scroll-driven drift on top.
  const mtTopY     = useTransform(scrollY, [0, 600], [0, -40])
  const mtTopScale = useTransform(scrollY, [0, 600], [1, 1.08])
  const mtBotY     = useTransform(scrollY, [0, 600], [0, 26])
  const mtBotScale = useTransform(scrollY, [0, 600], [1, 1.06])

  return (
    <div className="relative">
      <SEO title="Home" description="Browse RAF intel briefs by category — aircraft, bases, ranks, squadrons, operations, and more." />
      <TutorialModal />
      {showCROFlow && <WelcomeAgentFlow onClose={() => setShowCROFlow(false)} />}
      {showFlashcard && <FlashcardGameModal onClose={() => setShowFlashcard(false)} />}

      {/* Top-right topographic contour — abstract mountain range viewed top-down.
          Per-path stroke opacity is graded from dim outer rings (0.05) to bright
          summit (0.24), reading as elevation rather than a flat set of rings.
          Parallax transform drifts the range outward on scroll. */}
      <motion.svg
        aria-hidden="true"
        className="absolute pointer-events-none"
        viewBox="0 0 200 200"
        style={{
          // Grows from 320px (mobile) up to 900px (ultrawide) at 60vw — bigger SVG
          // gives the shift more pixels to work with before the peak clips.
          width: 'clamp(320px, 60vw, 900px)',
          aspectRatio: '1',
          // Mobile stays at -89. Above the 992px breakpoint, shift grows as 1.2×
          // of (viewport - 992) so the mountain's visual center lands well into
          // the right gutter, not just the edge of it. clamp min caps ultrawide.
          right: 'clamp(-850px, calc(-89px - (100vw - 992px) * 1.2), -89px)',
          top:   'clamp(-240px, -10vw, -58px)',
          y: mtTopY,
          scale: mtTopScale,
          zIndex: 0,
          opacity: 0.9,
          willChange: 'transform',
        }}
      >
        <g fill="none" strokeWidth="0.5" strokeLinejoin="round">
          <path stroke="rgba(91,170,255,0.05)" d="M 28 108 C 18 62 58 28 104 36 C 152 44 178 82 170 128 C 162 168 118 184 82 172 C 46 162 18 142 28 108 Z" />
          <path stroke="rgba(91,170,255,0.08)" d="M 40 108 C 32 70 62 42 102 48 C 144 54 168 84 160 124 C 152 160 118 172 86 162 C 54 154 32 138 40 108 Z" />
          <path stroke="rgba(91,170,255,0.11)" d="M 52 108 C 44 78 68 56 100 60 C 134 66 158 86 150 118 C 144 150 116 160 90 152 C 62 146 44 130 52 108 Z" />
          <path stroke="rgba(91,170,255,0.15)" d="M 64 108 C 56 86 74 68 100 72 C 128 76 148 90 140 114 C 134 140 114 148 94 142 C 72 138 56 124 64 108 Z" />
          <path stroke="rgba(91,170,255,0.19)" d="M 76 106 C 70 92 80 80 100 82 C 120 86 138 94 132 110 C 128 128 112 138 98 132 C 82 128 72 118 76 106 Z" />
          <path stroke="rgba(91,170,255,0.24)" strokeWidth="0.6" d="M 86 102 C 82 94 88 88 100 90 C 112 92 126 96 122 104 C 120 116 108 124 100 120 C 90 118 84 112 86 102 Z" />
          {/* Secondary smaller peak — gives "range" rather than single mountain */}
          <path stroke="rgba(91,170,255,0.10)" d="M 135 55 C 128 40 148 30 162 38 C 175 44 178 58 168 66 C 158 74 142 72 138 66 C 132 62 130 58 135 55 Z" />
          <path stroke="rgba(91,170,255,0.19)" strokeWidth="0.55" d="M 142 55 C 138 44 152 38 162 44 C 170 48 172 56 166 62 C 158 66 148 64 144 60 C 140 58 140 56 142 55 Z" />
          {/* Peak dots — filled + glow, marking summit apex */}
          <circle fill="rgba(91,170,255,0.55)" stroke="rgba(91,170,255,0.25)" strokeWidth="0.4" cx="103" cy="104" r="1.4" />
          <circle fill="rgba(91,170,255,0.40)" stroke="rgba(91,170,255,0.18)" strokeWidth="0.3" cx="155" cy="52"  r="1.0" />
        </g>
      </motion.svg>

      {/* Bottom-left topographic contour — mirrors the top-right range in every
          respect (graded rings + glowing summit dots + scroll parallax) so both
          corners feel anchored to the same terrain language. */}
      <motion.svg
        aria-hidden="true"
        className="absolute pointer-events-none"
        viewBox="0 0 200 200"
        style={{
          width: 'clamp(320px, 60vw, 900px)',
          aspectRatio: '1',
          left:   'clamp(-850px, calc(-89px - (100vw - 992px) * 1.2), -89px)',
          bottom: 'clamp(-240px, -6vw, -32px)',
          y: mtBotY,
          scale: mtBotScale,
          zIndex: 0,
          opacity: 0.9,
          willChange: 'transform',
        }}
      >
        <g fill="none" strokeWidth="0.5" strokeLinejoin="round">
          <path stroke="rgba(91,170,255,0.05)" d="M 170 100 C 180 56 144 26 98 34 C 52 42 22 78 30 122 C 38 162 80 180 118 170 C 156 160 182 138 170 100 Z" />
          <path stroke="rgba(91,170,255,0.08)" d="M 158 100 C 168 64 140 40 98 46 C 58 52 36 80 42 118 C 50 154 82 168 114 160 C 148 152 168 136 158 100 Z" />
          <path stroke="rgba(91,170,255,0.11)" d="M 146 100 C 154 74 136 54 100 58 C 66 64 44 82 52 112 C 60 144 84 156 110 150 C 138 144 154 130 146 100 Z" />
          <path stroke="rgba(91,170,255,0.15)" d="M 134 100 C 140 84 126 68 100 70 C 72 74 54 88 60 108 C 66 134 86 144 106 140 C 128 136 140 124 134 100 Z" />
          <path stroke="rgba(91,170,255,0.19)" d="M 122 102 C 128 90 120 80 100 82 C 80 86 64 94 68 108 C 72 126 88 134 102 130 C 118 128 128 118 122 102 Z" />
          <path stroke="rgba(91,170,255,0.24)" strokeWidth="0.6" d="M 112 102 C 116 94 112 90 100 90 C 88 92 76 96 78 104 C 80 114 92 122 100 118 C 110 116 114 110 112 102 Z" />
          {/* Secondary smaller peak — mirrored position */}
          <path stroke="rgba(91,170,255,0.10)" d="M 65 50 C 72 38 58 30 48 38 C 38 44 34 56 44 62 C 52 68 62 66 66 60 C 70 56 68 54 65 50 Z" />
          <path stroke="rgba(91,170,255,0.19)" strokeWidth="0.55" d="M 60 52 C 64 44 54 40 48 44 C 42 48 40 54 48 58 C 54 62 60 60 62 56 C 64 54 60 54 60 52 Z" />
          {/* Peak dots — filled + glow */}
          <circle fill="rgba(91,170,255,0.55)" stroke="rgba(91,170,255,0.25)" strokeWidth="0.4" cx="96" cy="104" r="1.4" />
          <circle fill="rgba(91,170,255,0.40)" stroke="rgba(91,170,255,0.18)" strokeWidth="0.3" cx="55" cy="48"  r="1.0" />
        </g>
      </motion.svg>

      {/* First screen: top cluster + NEWS hero. min-h = calc(100dvh - chrome) fills
          exactly the visible content area — TopBar (56) + py-6 (48) + main pb-20 (80)
          = 184 on mobile; 128 on desktop. 100dvh handles mobile address bar collapse.
          Safe-area buffer + iOS BottomNav overlap are handled by the NEWS hero's
          sticky bottom positioning below, not by this min-h. */}
      <div className="relative min-h-[calc(100dvh_-_184px)] md:min-h-[calc(100dvh_-_128px)] flex flex-col">
      <motion.div
        className="relative z-10"
        style={{ opacity: topOpacity, y: topTranslateY }}
      >
      {/* Greeting + stats */}
      <div className="relative mb-6">
        {/* Eyebrow — asymmetric section-break treatment (leading line + trailing fade) */}
        <div className="flex items-center gap-3 mb-2">
          <div className="h-px w-8" style={{ background: 'rgba(91,170,255,0.35)' }} />
          <span
            className="text-[10px] font-bold uppercase tracking-[0.35em] whitespace-nowrap"
            style={{ color: 'rgba(91,170,255,0.7)' }}
          >
            {today}
          </span>
          <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, rgba(91,170,255,0.25), transparent)' }} />
        </div>
        <h1 className="text-3xl font-black text-slate-900 leading-tight tracking-tight">
          {greetPrefix}
          {user && (
            <>
              {' '}
              <span style={{ color: '#5baaff' }}>{firstName}</span>
            </>
          )}
        </h1>
        {!user && (
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => setShowCROFlow(true)}
              className="flex-1 text-center text-sm font-bold bg-brand-600 text-slate-900 px-4 py-2.5 rounded-xl hover:bg-brand-500 transition-colors"
            >
              Start for Free
            </button>
            <Link
              to="/login"
              className="flex-1 text-center text-sm font-semibold border border-brand-300/60 text-brand-600 px-4 py-2.5 rounded-xl hover:border-brand-400 transition-colors"
            >
              Sign In
            </Link>
          </div>
        )}
      </div>

      {/* User XP card + Daily mission drawer — the drawer tucks ~12px behind
          the XP card's bottom edge so it reads as "peeking out." When today's
          mission is done and the streak just bumped, the drawer retracts up
          into the XP card, the flame pulses, and the streak number ticks up.
          When levelInfo isn't loaded yet, the drawer renders as a standalone
          card (no tuck) so the mission is never hidden on the user. */}
      {user && (
        <div className="relative mb-6">
          {levelInfo && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative z-20 rounded-2xl p-4 card-shadow border border-brand-300/40"
              style={{ background: 'linear-gradient(135deg, #0f2850 0%, #081930 100%)' }}
            >
              <div className="flex items-center gap-4">
                <XPRing pct={levelInfo.progress} level={levelInfo.level} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-brand-600 mb-0.5 intel-mono uppercase tracking-[0.2em]">
                    Level {levelInfo.level}
                  </p>
                  <div className="h-2 bg-brand-200/60 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-brand-600 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${levelInfo.progress}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                    />
                  </div>
                  <p className="text-xs text-slate-600 mt-1">
                    {levelInfo.coinsInLevel} / {levelInfo.coinsNeeded} Airstars to Level {levelInfo.level + 1}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-2xl flame-blue${flamePulsing ? ' flame-pulsing' : ''}`}>🔥</div>
                  <div className="text-xl font-black text-brand-700">
                    {displayStreak}
                  </div>
                  <div className="text-[10px] text-slate-600 intel-mono uppercase tracking-[0.25em]">streak</div>
                </div>
              </div>
            </motion.div>
          )}

          <AnimatePresence mode="popLayout">
            {(missionPhase === 'available' || missionPhase === 'complete') && (
              <motion.div
                layout
                key="mission-drawer"
                initial={(missionPhase === 'available' || missionPhase === 'complete') && !prefersReducedMotion
                  ? { y: -60, clipPath: 'inset(100% 0% 0% 0%)', scale: 0.95, opacity: 1 }
                  : { opacity: 0, y: -8 }}
                animate={(missionPhase === 'available' || missionPhase === 'complete') && !prefersReducedMotion
                  ? {
                      opacity:  1,
                      y:        0,
                      clipPath: 'inset(0% 0% 0% 0%)',
                      // Single subtle overshoot → settle, no extra recoil.
                      scale:    [0.95, 1.04, 1],
                    }
                  : { opacity: 1, y: 0, scale: 1, clipPath: 'inset(0% 0% 0% 0%)' }}
                exit={prefersReducedMotion
                  ? { opacity: 0, transition: { duration: 0.25 } }
                  : { opacity: 0, y: -48, scale: 0.94, clipPath: 'inset(100% 0% 0% 0%)', transition: { duration: 0.52, ease: [0.4, 0, 0.2, 1] } }}
                transition={(missionPhase === 'available' || missionPhase === 'complete') && !prefersReducedMotion
                  ? {
                      clipPath: { duration: 0.45, delay: 0.15, ease: [0.22, 1, 0.36, 1] },
                      y:        { type: 'spring', stiffness: 260, damping: 18, delay: 0.15 },
                      scale:    { duration: 0.6, delay: 0.15, times: [0, 0.55, 1], ease: 'easeOut' },
                    }
                  : { duration: 0.35, delay: 0 }}
                onClick={missionPhase === 'available' && !missionLoading
                  ? (isZeroRead
                      ? () => setShowCROFlow(true)
                      : async () => {
                          setMissionLoading(true)
                          try {
                            const res = await apiFetch(`${API}/api/briefs/next-pathway-brief`, { credentials: 'include' })
                            const data = await res.json()
                            if (data.status === 'success') {
                              navigate(`/brief/${data.data.briefId}`)
                            } else {
                              navigate('/learn-priority')
                            }
                          } catch {
                            navigate('/learn-priority')
                          } finally {
                            setMissionLoading(false)
                          }
                        })
                  : undefined}
                className={`relative z-10 rounded-2xl flex items-center gap-3 border transition-colors card-shadow
                  ${levelInfo ? '-mt-3 mx-3 px-4 pt-7 pb-4' : 'p-4'}
                  ${missionPhase === 'complete'
                    ? 'border-emerald-200'
                    : missionLoading
                      ? 'border-amber-200 opacity-60 cursor-wait'
                      : 'border-amber-200 cursor-pointer hover:border-amber-400 hover:card-shadow-hover'
                  }`}
                style={{
                  background: missionPhase === 'complete'
                    ? 'linear-gradient(135deg, #002d1a 0%, #001a10 100%)'
                    : 'linear-gradient(135deg, #2d2000 0%, #1a1200 100%)',
                }}
              >
                <span className={`text-2xl w-7 flex items-center justify-center shrink-0${missionPhase === 'available' && !missionLoading ? ' target-amber' : ''}`}>
                  {missionPhase === 'complete' ? (
                    /* Emerald reticle — mirrors the read-receipt tick used on
                       completed items in the Latest Intel list below, scaled
                       up so it keeps the banner's visual weight. */
                    <span
                      className="relative flex items-center justify-center rounded-full"
                      style={{
                        width:      30,
                        height:     30,
                        background: 'rgba(16,185,129,0.9)',
                        boxShadow:  '0 0 0 2px rgba(16,185,129,0.25), 0 0 12px rgba(16,185,129,0.35)',
                      }}
                      aria-label="Mission complete"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="5 13 10 18 19 7" />
                      </svg>
                    </span>
                  ) : missionLoading ? '…' : '🎯'}
                </span>
                <div className="flex-1 min-w-0">
                  {missionPhase === 'complete' ? (
                    <>
                      <p className="text-sm font-bold text-emerald-800">Mission complete!</p>
                      <p className="text-xs text-emerald-600">You've read a brief today — streak secured. Keep it up!</p>
                    </>
                  ) : isZeroRead ? (
                    <>
                      <p className="text-sm font-bold text-amber-800">Choose your first mission area</p>
                      <p className="text-xs text-amber-600">Pick a subject to begin — your training starts here.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-bold text-amber-800">Daily mission available</p>
                      <p className="text-xs text-amber-600">Read one brief today to keep your streak going.</p>
                    </>
                  )}
                </div>
                {missionPhase === 'available' && (
                  <span className="shrink-0 text-xs font-bold bg-amber-500 text-white px-3 py-1.5 rounded-xl">
                    {missionLoading ? '…' : isZeroRead ? 'Start →' : 'Go →'}
                  </span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Quick Actions */}
      {user && (
        <motion.div
          layout
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{
            delay: 0.3,
            // Smoothly slide into the space freed when the mission drawer
            // exits via AnimatePresence mode="popLayout" — without this the
            // card would snap to its new position.
            layout: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
          }}
          className="mb-6"
        >
          {/* Eyebrow heading — echoes the NEWS hero / greeting treatment */}
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px w-8" style={{ background: 'rgba(91,170,255,0.35)' }} />
            <span
              className="text-[10px] font-bold uppercase tracking-[0.35em]"
              style={{ color: 'rgba(91,170,255,0.7)' }}
            >
              Quick Actions
            </span>
            <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, rgba(91,170,255,0.25), transparent)' }} />
          </div>
          <div className="space-y-2">
            {jumpBackBrief && (
              <button
                type="button"
                onClick={() => navigate(`/brief/${jumpBackBrief.briefId}`)}
                className="w-full flex items-center gap-3 rounded-2xl p-4 border transition-all card-shadow hover:card-shadow-hover hover:-translate-y-0.5 cursor-pointer border-brand-300/40 hover:border-brand-400/60"
                style={{ background: 'linear-gradient(135deg, #0c2042 0%, #0a1a30 100%)' }}
              >
                <span className="text-2xl w-7 text-center shrink-0 text-brand-600">◑</span>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-bold text-white truncate">{jumpBackBrief.title}</p>
                  <p className="text-xs text-brand-600">{jumpBackBrief.category} · In Progress</p>
                </div>
                <span className="text-xs font-bold bg-brand-600 text-slate-900 px-3 py-1.5 rounded-xl shrink-0">
                  Resume →
                </span>
              </button>
            )}
            {(() => {
              // Hide until we know the lock state (prevents unlocked→locked flash for logged-in users)
              if (user && flashcardAvail === null) return null
              const locked = user && flashcardAvail < 5
              const needed = locked ? 5 - flashcardAvail : 0
              // Locked-state action: instead of a dead-end, route the user to
              // the next priority brief so the card becomes a forward path
              // toward unlocking Flashcard Round.
              const handleLockedClick = async () => {
                if (unlockReadBusyRef.current) return
                unlockReadBusyRef.current = true
                try {
                  const res = await apiFetch(`${API}/api/briefs/next-pathway-brief`, { credentials: 'include' })
                  const data = await res.json()
                  if (data.status === 'success') {
                    navigate(`/brief/${data.data.briefId}`)
                  } else {
                    navigate('/learn-priority')
                  }
                } catch {
                  navigate('/learn-priority')
                } finally {
                  unlockReadBusyRef.current = false
                }
              }
              return (
                <button
                  onClick={locked ? handleLockedClick : () => setShowFlashcard(true)}
                  data-testid="home-flashcard-btn"
                  title={locked ? `Complete ${needed} more brief${needed === 1 ? '' : 's'} to unlock — tap to start reading` : undefined}
                  className={
                    locked
                      ? 'w-full flex items-center gap-3 rounded-2xl p-4 border transition-all card-shadow hover:card-shadow-hover hover:-translate-y-0.5 cursor-pointer border-amber-200/40 hover:border-amber-200/70'
                      : 'w-full flex items-center gap-3 rounded-2xl p-4 border transition-all card-shadow hover:card-shadow-hover hover:-translate-y-0.5 cursor-pointer border-amber-200 hover:border-amber-400'
                  }
                  style={{
                    background: locked
                      ? 'linear-gradient(135deg, #1a1407 0%, #0f0b04 100%)'
                      : 'linear-gradient(135deg, #2d2000 0%, #1a1200 100%)',
                  }}
                >
                  <span className={`text-2xl w-7 text-center shrink-0 ${locked ? 'grayscale' : ''}`}>
                    {locked ? '🔒' : '⚡'}
                  </span>
                  <div className="flex-1 min-w-0 text-left">
                    <p className={`text-sm font-bold ${locked ? 'text-amber-900/80' : 'text-amber-900'}`}>
                      Flashcard Round
                    </p>
                    <p className={`text-xs ${locked ? 'text-amber-600/80' : 'text-amber-600'}`}>
                      {locked
                        ? `Complete ${needed} more brief${needed === 1 ? '' : 's'} to unlock`
                        : 'Identify briefs from content alone — title hidden'}
                    </p>
                  </div>
                  <span className="text-xs font-bold px-3 py-1.5 rounded-xl shrink-0 bg-amber-500 text-white">
                    {locked ? 'Read →' : 'Play →'}
                  </span>
                </button>
              )
            })()}
          </div>
        </motion.div>
      )}

      {/* End of top cluster — close the fading motion wrapper */}
      </motion.div>

      {/* NEWS landmark — pinned to bottom of the visible area.
          Wrapper takes the mt-auto (pushes to bottom of min-h flex container) and a
          pt-8 buffer so the hero's top hairline accent never overlaps the Flashcard
          card above on small screens when content overflows min-h.
          Inner hero is sticky on all viewports so the NEWS + radar unit stays pinned
          above the bottom chrome until the user scrolls past it. Bottom offset:
          mobile = BottomNav (64) + safe-area + ~8 breathing = 72 + env();
          desktop  = main's pb-6 (24). Radar is absolute inset-0 of this sticky
          container, so it always moves as a unit with the NEWS text above it. */}
      {(newsLoading || latestBriefs.length > 0) && (
        <div className="mt-auto pt-8 md:pt-12">
        <div
          className="relative py-4 md:py-10 flex flex-col items-center select-none sticky"
          style={{ bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))' }}
        >
            {/* Ambient blue radial glow for depth — matches radar tint below */}
            <div
              className="absolute inset-0 pointer-events-none"
              aria-hidden="true"
              style={{
                background: 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(91,170,255,0.10) 0%, rgba(91,170,255,0.04) 40%, transparent 75%)',
              }}
            />
            {/* Radar scan — static rings + slow-rotating conic sweep. Sits behind the
                NEWS word. Opacities are low (0.04–0.09) so the radar reads as
                atmospheric backdrop rather than competing with the (semi-transparent)
                NEWS letters. Explicit zIndex:0 keeps it below the zIndex:1 text. */}
            <div
              className="absolute inset-0 pointer-events-none flex items-center justify-center"
              aria-hidden="true"
              style={{ zIndex: 0 }}
            >
              <div
                className="relative"
                style={{
                  width: 'min(110vh, 900px)',
                  aspectRatio: '1',
                  // Soft radial fade so the outer ring + sweep dissolve into the bg
                  // instead of ending at a hard circle edge.
                  WebkitMaskImage: 'radial-gradient(circle, black 20%, rgba(0,0,0,0.6) 45%, transparent 75%)',
                  maskImage: 'radial-gradient(circle, black 20%, rgba(0,0,0,0.6) 45%, transparent 75%)',
                }}
              >
                {/* Static rings + crosshair */}
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 200">
                  <g fill="none" stroke="rgba(91,170,255,0.07)" strokeWidth="0.4">
                    <circle cx="100" cy="100" r="95" />
                    <circle cx="100" cy="100" r="72" />
                    <circle cx="100" cy="100" r="48" />
                    <circle cx="100" cy="100" r="24" />
                    <line x1="5"  y1="100" x2="195" y2="100" />
                    <line x1="100" y1="5" x2="100" y2="195" />
                  </g>
                  <g stroke="rgba(91,170,255,0.04)" strokeWidth="0.3">
                    <line x1="33" y1="33"  x2="167" y2="167" />
                    <line x1="33" y1="167" x2="167" y2="33"  />
                  </g>
                </svg>
                {/* Rotating sweep — conic gradient fades from blue to transparent over 90deg.
                    CSS keyframe animation (not framer-motion) so it runs independently of
                    any motion-value updates elsewhere on the page. */}
                <div
                  className="absolute inset-0 rounded-full home-radar-sweep"
                  style={{
                    background: 'conic-gradient(from 0deg, transparent 0deg, rgba(91,170,255,0.09) 22deg, rgba(91,170,255,0.03) 60deg, transparent 95deg, transparent 360deg)',
                  }}
                />
              </div>
            </div>
            {/* Top hairline accent */}
            <div
              className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-28"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(234,179,8,0.35), transparent)' }}
            />
            <motion.h2
              aria-label="Latest News"
              className="relative font-black leading-none tracking-[0.15em] text-[3rem] sm:text-[6rem]"
              style={{
                color: newsHeadingColor,
                textShadow: newsHeadingShadow,
                fontFamily: 'inherit',
                zIndex: 1,
              }}
            >
              NEWS
            </motion.h2>
            <motion.div
              className="relative flex items-center gap-3 mt-2 md:mt-3"
              style={{ zIndex: 1, opacity: newsEyebrowOpacity }}
            >
              <div className="h-px w-8" style={{ background: 'rgba(234,179,8,0.35)' }} />
              <span
                className="text-[10px] font-bold uppercase tracking-[0.35em]"
                style={{ color: 'rgba(234,179,8,0.6)' }}
              >
                Latest Intel
              </span>
              <div className="h-px w-8" style={{ background: 'rgba(234,179,8,0.35)' }} />
            </motion.div>
            <motion.div
              className="relative mt-3 md:mt-5"
              aria-hidden="true"
              style={{ color: 'rgba(234,179,8,0.55)', zIndex: 1, opacity: chevronOpacity }}
            >
              <div className="home-chevron-sway">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </motion.div>
          </div>
        </div>
      )}

      {/* End of first screen — close the min-h-screen flex container */}
      </div>

      {/* Items list — fades in as user scrolls past the NEWS landmark */}
      {(newsLoading || latestBriefs.length > 0) && (
        <motion.div style={{ opacity: newsListOpacity, y: newsListY }}>
          {newsLoading && latestBriefs.length === 0 ? (
            <div className="space-y-2 mb-3">
              {[0,1,2,3].map(i => (
                <div
                  key={i}
                  className="relative overflow-hidden flex items-center gap-3 pl-5 pr-4 py-3.5 rounded-2xl border border-amber-500/15 bg-surface animate-pulse card-shadow"
                >
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-500/30" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="h-3.5 rounded bg-slate-700/30" style={{ width: `${60 + (i % 3) * 15}%` }} />
                    <div className="h-2.5 rounded bg-slate-700/20" style={{ width: '40%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
          <div className="space-y-2 mb-3">
            {latestBriefs.map((brief, i) => {
              const locked = brief.isLocked

              const accentBar = locked
                ? 'bg-slate-600/30'
                : brief.isRead
                  ? 'bg-emerald-500/80'
                  : brief.isStarted
                    ? 'bg-amber-400'
                    : 'bg-yellow-500'

              const eventDate = brief.eventDate
                ? new Date(brief.eventDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                : null

              const metaSuffix = brief.isRead ? 'Read' : brief.isStarted ? 'In Progress' : null
              const metaLine = locked
                ? 'Sign in to read'
                : [eventDate, metaSuffix ?? (eventDate ? null : brief.category)].filter(Boolean).join(' · ')

              const hasBackdrop = !locked && Array.isArray(brief.images) && brief.images.length > 0

              const inner = (
                <>
                  {/* CRT-tinted image backdrop — only on unlocked items with images.
                      Sits underneath the accent bar, legibility gradient, and text. */}
                  {hasBackdrop && (
                    <BriefImageBackdrop images={brief.images} />
                  )}
                  {/* Legibility wash — strong on the left where text sits, fading
                      right so the image still reads through on the trailing edge. */}
                  {hasBackdrop && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      aria-hidden="true"
                      style={{ background: 'linear-gradient(90deg, rgba(6,16,30,0.92) 0%, rgba(6,16,30,0.55) 55%, rgba(6,16,30,0.2) 100%)' }}
                    />
                  )}
                  {/* left accent bar */}
                  <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${accentBar}`} />
                  {/* subtle amber gradient wash on unread items for depth — skip when
                      the image backdrop already provides it */}
                  {!hasBackdrop && !locked && !brief.isRead && !brief.isStarted && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      aria-hidden="true"
                      style={{ background: 'linear-gradient(90deg, rgba(234,179,8,0.06) 0%, transparent 35%)' }}
                    />
                  )}
                  <div className="relative flex-1 min-w-0">
                    <p className={`text-sm truncate leading-snug
                      ${locked ? 'font-semibold text-slate-500'
                        : brief.isRead ? 'font-semibold text-slate-600'
                        : brief.isStarted ? 'font-bold text-amber-300'
                        : 'font-semibold text-slate-900'}`}>
                      {brief.title}
                    </p>
                    <p className={`text-xs mt-0.5 intel-mono truncate
                      ${locked ? 'text-slate-600'
                        : brief.isRead ? 'text-slate-500'
                        : brief.isStarted ? 'text-amber-600'
                        : 'text-slate-500'}`}>
                      {metaLine}
                    </p>
                  </div>
                  {!locked && (
                    brief.isRead ? (
                      /* Read-receipt reticle — emerald filled circle + white tick.
                         Echoes the radar/targeting motif used elsewhere on this
                         page and matches the emerald "complete" language used by
                         the Mission Complete drawer. */
                      <span
                        className="relative shrink-0 flex items-center justify-center rounded-full"
                        style={{
                          width:      22,
                          height:     22,
                          background: 'rgba(16,185,129,0.9)',
                          boxShadow:  '0 0 0 2px rgba(16,185,129,0.25), 0 0 10px rgba(16,185,129,0.35)',
                        }}
                        aria-label="Read"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="5 13 10 18 19 7" />
                        </svg>
                      </span>
                    ) : (
                      <span className={`relative text-sm shrink-0 transition-colors
                        ${brief.isStarted ? 'text-amber-500/80 group-hover:text-amber-300'
                          : 'text-slate-500 group-hover:text-yellow-400'}`}>→</span>
                    )
                  )}
                </>
              )

              const baseClass = `relative overflow-hidden flex items-center gap-3 pl-5 pr-4 py-3.5 rounded-2xl border transition-all card-shadow`

              return (
                <motion.div
                  key={brief._id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                >
                  {locked ? (
                    <div className={`${baseClass} opacity-50 cursor-not-allowed bg-surface border-amber-500/15`}>
                      {inner}
                    </div>
                  ) : (
                    <Link
                      to={`/brief/${brief._id}`}
                      className={`group ${baseClass} bg-surface hover:-translate-y-0.5 hover:card-shadow-hover
                        ${brief.isRead
                          ? 'border-slate-700/25 hover:border-slate-600/50'
                          : brief.isStarted
                            ? 'border-amber-500/20 hover:border-amber-500/40'
                            : 'border-amber-500/30 hover:border-yellow-500/60'}`}
                    >
                      {inner}
                    </Link>
                  )}
                </motion.div>
              )
            })}
          </div>
          )}

          {/* Closing eyebrow — mirrors the "Latest Intel" opener above the
              list so the section bookends as a radar-console label pair.
              Hover brightens the amber to signal interactivity. */}
          <div className="mb-8 flex items-center justify-center gap-3">
            <div className="h-px w-8" style={{ background: 'rgba(234,179,8,0.35)' }} />
            <Link
              to="/learn-priority"
              state={{ category: 'News' }}
              className="text-[10px] font-bold uppercase tracking-[0.35em] text-yellow-500/60 hover:text-yellow-500 transition-colors"
            >
              See all news
            </Link>
            <div className="h-px w-8" style={{ background: 'rgba(234,179,8,0.35)' }} />
          </div>
        </motion.div>
      )}

    </div>
  )
}
