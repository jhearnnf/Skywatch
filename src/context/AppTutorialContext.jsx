/**
 * Tutorial system for the redesigned UI.
 * Tutorial steps can be overridden via AppSettings.tutorialContent (admin-editable).
 * Falls back to hardcoded defaults when no override is set.
 */
import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { useAppSettings } from './AppSettingsContext'

const Ctx = createContext(null)

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'

// ── Tutorial default definitions ───────────────────────────────────────────
// Single source of truth for all tutorial keys.
// When adding a new tutorial: add it here AND add the field to backend/models/User.js tutorials schema.
export const TUTORIAL_STEPS = {
  home: [
    { emoji: '👋', title: 'Welcome to SkyWatch!',
      body: 'Your personal RAF intelligence platform. You\'ll learn about aircraft, bases, roles, and operations — one brief at a time. This is designed to help you build real aviation knowledge.' },
    { emoji: '✈️', title: 'Choose a Subject Area',
      body: 'Each card below is a subject — like a school subject but for the RAF. Tap any card to see all the intel briefs inside it. Start with any subject that interests you!' },
    { emoji: '📈', title: 'Track Your Progress',
      body: 'The progress bar on each subject card shows how many briefs you\'ve read. Try to complete every brief in a subject to master it.' },
    { emoji: '🔥', title: 'Daily Streak',
      body: 'Come back every day to keep your streak going! Consistent daily learning is the fastest way to build deep knowledge.' },
    { emoji: '⭐', title: 'Earn Airstars',
      body: 'Reading briefs and completing quizzes earns you Airstars. Collect enough Airstars to level up — the more you learn, the higher your level climbs.' },
  ],
  briefReader: [
    { emoji: '📋', title: 'Reading Intel Briefs',
      body: 'Each brief is split into short sections — swipe left or tap Continue to move forward, swipe right to go back. The counter in the top corner of each card shows where you are in the brief.' },
    { emoji: '🔵', title: 'Keyword Hotspots',
      body: 'Words highlighted in blue are important RAF terms. Tap any highlighted word to see a full explanation. Building this vocabulary is essential for mastering the subject.' },
    { emoji: '📊', title: 'Key Stats & Memory Aids',
      body: 'Each section shows a key fact about the subject. If you see a 💡 next to a stat, tap it — a mnemonic memory aid will help you lock that fact in before your interview.' },
    { emoji: '🎮', title: 'Unlock the Quiz',
      body: 'Once you\'ve read all sections, a quiz becomes available. Complete it to test your knowledge, earn Airstars, and mark the brief as complete.' },
  ],
  quiz: [
    { emoji: '🎯', title: 'Quiz Time!',
      body: 'All questions are based on the brief you just read. If you\'re unsure about something, think back to what you read — every answer is in there.' },
    { emoji: '✅', title: 'How It Works',
      body: 'Tap an answer to select it. You\'ll see immediately if it\'s right or wrong. Wrong answers show the correct answer so you learn from every mistake.' },
    { emoji: '⭐', title: 'Earn Airstars',
      body: 'Every correct answer earns Airstars. Complete the quiz to lock in your score. You can retake quizzes to improve your understanding!' },
  ],
  play: [
    { emoji: '🎮', title: 'Play Hub',
      body: 'This is your training games hub. Four game modes test your aviation knowledge in different ways — from quizzes to aircraft identification and tactical ordering.' },
    { emoji: '🧠', title: 'Intel Quiz',
      body: 'Test yourself on briefs you\'ve already read. Choose Standard for recall-based questions or Advanced for tougher contextual challenges. Earn Airstars for every correct answer.' },
    { emoji: '✈️', title: "Where's That Aircraft?",
      body: 'Live now! Study RAF aircraft and their home bases, then random identification missions begin appearing. Spot the aircraft from an image, then locate its base on a UK map.' },
    { emoji: '🗺️', title: 'Battle of Order',
      body: 'Live now! Arrange aircraft, ranks, and missions in the correct tactical sequence. Read the associated brief and pass its quiz first to unlock each Battle of Order game.' },
    { emoji: '👆', title: 'Choose Your Game',
      body: 'Tap any of the game type cards to jump straight to that section below. Flashcard Recall is coming soon — the other three are live and ready to play!', highlightGrid: true },
  ],
  profile: [
    { emoji: '👤', title: 'Your Agent Profile',
      body: 'This is your personal stats dashboard. Track your level, Airstars, reading streak, and quiz performance all in one place.' },
    { emoji: '📊', title: 'Stats Tab',
      body: 'The Stats tab shows briefs read, games played, average quiz score, and total Airstars. Tap any stat to see its history.' },
    { emoji: '🏆', title: 'Leaderboard Tab',
      body: 'Switch to the Leaderboard tab to see how you rank against other learners by total Airstars.' },
    { emoji: '🎯', title: 'Step Up Your Difficulty',
      body: 'Find the "Quiz Difficulty" section below — tap Advanced to unlock tougher, interview-level questions and bigger Airstars rewards. You can switch back to Standard at any time.', highlightDifficulty: true },
  ],
  rankings: [
    { emoji: '🎖️', title: 'Level Progression',
      body: 'The Agent Level tab shows your progress through Levels 1–10. Each level requires more Airstars than the last. Reach Level 10 to trigger a Rank Promotion!' },
    { emoji: '🏅', title: 'RAF Ranks',
      body: 'The RAF Ranks tab shows all real RAF rank designations. Earn rank promotions by reaching Level 10 repeatedly — working your way up from Aircraftman to Marshal of the RAF.' },
    { emoji: '⭐', title: 'How to Level Up',
      body: 'Earn Airstars by reading briefs and completing quizzes. Collect enough Airstars and your level increases automatically — the Airstars bar shows your progress to the next level.' },
  ],
  wheres_aircraft: [
    { emoji: '✈️', title: "Where's That Aircraft?",
      body: 'This mission has two rounds. First, you\'ll be shown an aircraft image and asked to identify it from 5 options. Stay sharp — one wrong move and the mission is over!' },
    { emoji: '🗺️', title: 'Round 2 — Find the Base',
      body: 'If you identify the aircraft correctly, Round 2 begins! A UK map appears with RAF bases marked. Select the home base(s) for that aircraft to complete the mission.' },
    { emoji: '⭐', title: 'Earn Airstars',
      body: 'Correct identification earns coins. A correct base selection earns more. Complete both rounds successfully for a full mission bonus. The more you read, the more missions become available!' },
  ],
  'learn-priority': [
    { emoji: '🗺️', title: 'Welcome to the Pathway',
      body: 'This is your guided learning path. Follow the stepping stones in order to build your knowledge systematically — arranged from the most essential topics first.' },
    { emoji: '🪨', title: 'Stepping Stones',
      body: 'Each stone represents an Intel Brief. Tap it to open and read it. Completed stones are marked with a tick — work through them in order for the best results.' },
    { emoji: '🔓', title: 'Unlock More Paths',
      body: 'Level up to unlock new learning pathways covering Aircrafts, Ranks, Squadrons, and more. Some pathways also require a Silver or Gold subscription.' },
  ],
  // pathway_swipe is an inline mini-tutorial — the modal is never triggered for this key.
  // It lives here solely so the admin reset loop clears its localStorage entry.
  pathway_swipe: [
    { emoji: '👆', title: 'Switch Pathways',
      body: 'Swipe left or right anywhere on the pathway to switch between your unlocked subjects.' },
  ],
  // stat_mnemonic is an inline mini-tutorial — the modal is never triggered for this key.
  // It lives here solely so the admin reset loop clears its localStorage entry.
  stat_mnemonic: [
    { emoji: '💡', title: 'Memory Aids',
      body: 'Press and hold the 💡 icon next to a stat to reveal a memory aid that helps you retain that fact.' },
  ],
  // swipe is an inline mini-tutorial — the modal is never triggered for this key.
  // It lives here solely so the admin reset loop clears its localStorage entry.
  swipe: [
    { emoji: '👆', title: 'Navigate Sections',
      body: 'Swipe left to advance to the next section, or swipe right to go back.' },
  ],
  // quiz_difficulty_nudge is an inline card — the modal is never triggered for this key.
  // It lives here solely so the admin reset loop clears its localStorage entry.
  quiz_difficulty_nudge: [
    { emoji: '🎚️', title: 'Difficulty Check',
      body: 'One-time nudge shown after a first-attempt win on easy difficulty — asks if the user wants to step up to Advanced.' },
  ],
}

// Derived key list — import this anywhere that needs to know all tutorial names.
export const TUTORIAL_KEYS = Object.keys(TUTORIAL_STEPS)

// Apply admin-configured overrides to the default steps.
// tutorialContent shape: { 'home_0': { title, body }, 'learn_2': { body }, ... }
function applyOverrides(steps, tutorialContent) {
  if (!tutorialContent || typeof tutorialContent !== 'object') return steps
  const out = {}
  for (const [name, arr] of Object.entries(steps)) {
    out[name] = arr.map((step, i) => {
      const override = tutorialContent[`${name}_${i}`]
      if (!override) return step
      return {
        ...step,
        ...(override.title?.trim() ? { title: override.title } : {}),
        ...(override.body?.trim()  ? { body:  override.body  } : {}),
        ...(override.emoji?.trim() ? { emoji: override.emoji } : {}),
      }
    })
  }
  return out
}

// ── Provider ──────────────────────────────────────────────────────────────
export function AppTutorialProvider({ children }) {
  const [active,          setActive]          = useState(null) // { name, steps, stepIndex }
  const [tutorialContent, setTutorialContent] = useState(null)
  const location     = useLocation()
  const { user, loading: authLoading } = useAuth()
  const { settings } = useAppSettings()
  const mnemonicsEnabled = settings?.mnemonicsClickEnabled === true
  const mnemonicsEnabledRef = useRef(mnemonicsEnabled)
  useEffect(() => { mnemonicsEnabledRef.current = mnemonicsEnabled }, [mnemonicsEnabled])
  const pendingRef        = useRef(null) // tutorial name waiting for auth to resolve
  const pendingNavRef     = useRef(null) // { name, stepIndex } — fires after next route change
  const tutContentRef     = useRef(null) // mirror of tutorialContent for use in effects

  // Keys are user-scoped so tutorials seen on one account don't suppress them on another
  const storageKey = useCallback((name) => {
    return user?._id ? `sw_tut_v2_${user._id}_${name}` : `sw_tut_v2_anon_${name}`
  }, [user?._id])

  // Check both user-scoped key AND anon key — so "seen as guest" counts when logged in.
  // Fall back to the server's user.tutorials state so a fresh browser with empty
  // localStorage still respects tutorials already viewed/skipped on another device.
  const hasSeen = useCallback((name) => {
    if (user?._id && localStorage.getItem(`sw_tut_v2_${user._id}_${name}`)) return true
    if (localStorage.getItem(`sw_tut_v2_anon_${name}`)) return true
    const serverStatus = user?.tutorials?.[name.replace(/-/g, '_')]
    if (serverStatus && serverStatus !== 'unseen') return true
    return false
  }, [user?._id, user?.tutorials])

  // When admin resets tutorials, clear localStorage entries so they show again
  useEffect(() => {
    if (!user?._id || !user?.tutorialsResetAt) return
    const clearedAtKey = `sw_tut_v2_${user._id}_clearedAt`
    const clearedAt    = localStorage.getItem(clearedAtKey)
    const resetAt      = new Date(user.tutorialsResetAt).getTime()
    if (!clearedAt || resetAt > Number(clearedAt)) {
      ;[...Object.keys(TUTORIAL_STEPS)].forEach(name => {
        localStorage.removeItem(`sw_tut_v2_${user._id}_${name}`)
        localStorage.removeItem(`sw_tut_v2_anon_${name}`)
      })
      localStorage.setItem(clearedAtKey, String(resetAt))
    }
  }, [user?._id, user?.tutorialsResetAt])

  // Backfill localStorage from the server's tutorials state — so fresh browsers
  // don't re-show tutorials the user already completed on another device.
  useEffect(() => {
    if (!user?._id || !user?.tutorials) return
    for (const name of Object.keys(TUTORIAL_STEPS)) {
      const status = user.tutorials[name.replace(/-/g, '_')]
      if (status === 'viewed' || status === 'skipped') {
        localStorage.setItem(`sw_tut_v2_${user._id}_${name}`, '1')
      }
    }
  }, [user?._id, user?.tutorials])

  // Keep ref in sync so route-change effect can read latest content without a dep
  useEffect(() => { tutContentRef.current = tutorialContent }, [tutorialContent])

  // Load tutorial content overrides from public settings on mount
  const fetchContent = useCallback(() => {
    return fetch(`${API}/api/settings`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.tutorialContent) setTutorialContent(d.tutorialContent) })
      .catch(() => {})
  }, [])

  useEffect(() => { fetchContent() }, [fetchContent])

  // On route change: fire any pending post-nav tutorial, otherwise clear active
  useEffect(() => {
    if (pendingNavRef.current) {
      const { name, stepIndex } = pendingNavRef.current
      pendingNavRef.current = null
      let steps = applyOverrides(TUTORIAL_STEPS, tutContentRef.current)[name] ?? null
      if (steps && name === 'briefReader' && !mnemonicsEnabledRef.current) {
        steps = steps.filter(s => s.title !== 'Key Stats & Memory Aids')
      }
      if (steps?.length) {
        const idx = Math.min(stepIndex, steps.length - 1)
        setActive({ name, steps, stepIndex: idx })
      }
    } else {
      setActive(null)
    }
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // Returns steps for a named tutorial, with DB overrides applied
  const getSteps = useCallback((name) => {
    const overridden = applyOverrides(TUTORIAL_STEPS, tutorialContent)
    let steps = overridden[name] ?? null
    // When the mnemonic feature flag is off, drop the "Key Stats & Memory Aids"
    // step from the briefReader tutorial so users aren't taught a disabled feature.
    if (steps && name === 'briefReader' && !mnemonicsEnabled) {
      steps = steps.filter(s => s.title !== 'Key Stats & Memory Aids')
    }
    return steps
  }, [tutorialContent, mnemonicsEnabled])

  // When auth finishes loading, fire any tutorial that was queued during the loading window
  useEffect(() => {
    if (authLoading || !pendingRef.current) return
    const name = pendingRef.current
    pendingRef.current = null
    if (hasSeen(name)) return
    const steps = getSteps(name)
    if (steps?.length) setActive({ name, steps, stepIndex: 0 })
  }, [authLoading, hasSeen, getSteps])

  const start = useCallback((name, force = false) => {
    if (authLoading) { pendingRef.current = name; return }
    if (!force && hasSeen(name)) return
    const steps = getSteps(name)
    if (!steps?.length) return
    setActive({ name, steps, stepIndex: 0 })
  }, [authLoading, hasSeen, getSteps])

  const markSeenOnServer = useCallback((name, status) => {
    if (!user?._id) return
    fetch(`${API}/api/users/me/tutorials`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tutorialId: name, status }),
    }).catch(() => {})
  }, [user?._id])

  const next = useCallback(() => {
    setActive(prev => {
      if (!prev) return null
      const nextIdx = prev.stepIndex + 1
      if (nextIdx >= prev.steps.length) {
        localStorage.setItem(storageKey(prev.name), '1')
        markSeenOnServer(prev.name, 'viewed')
        return null
      }
      return { ...prev, stepIndex: nextIdx }
    })
  }, [storageKey, markSeenOnServer])

  const skip = useCallback(() => {
    if (active) {
      localStorage.setItem(storageKey(active.name), '1')
      markSeenOnServer(active.name, 'skipped')
    }
    setActive(null)
  }, [active, storageKey, markSeenOnServer])

  const back = useCallback(() => {
    setActive(prev => {
      if (!prev || prev.stepIndex === 0) return prev
      return { ...prev, stepIndex: prev.stepIndex - 1 }
    })
  }, [])

  // Queue a tutorial to start after the next route change.
  // Call this before navigate() — the pending tutorial fires once the new route mounts.
  const startAfterNav = useCallback((name, stepIndex = 0) => {
    pendingNavRef.current = { name, stepIndex }
  }, [])

  const replay = useCallback((name) => {
    start(name, true)
  }, [start])

  const resetAll = useCallback(() => {
    Object.keys(TUTORIAL_STEPS).forEach(name => {
      localStorage.removeItem(storageKey(name))
      localStorage.removeItem(`sw_tut_v2_anon_${name}`)
    })
  }, [storageKey])

  const step        = active ? active.steps[active.stepIndex]  : null
  const total       = active ? active.steps.length             : 0
  const current     = active ? active.stepIndex + 1            : 0
  const visible     = !!step
  const activeName  = active?.name ?? null
  const canGoBack   = active ? active.stepIndex > 0            : false

  return (
    <Ctx.Provider value={{ start, next, skip, back, canGoBack, startAfterNav, replay, resetAll, step, total, current, visible, activeName, hasSeen, tutorialContent, refreshContent: fetchContent }}>
      {children}
    </Ctx.Provider>
  )
}

export const useAppTutorial = () => useContext(Ctx)
