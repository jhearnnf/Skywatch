/**
 * Tutorial system for the redesigned UI.
 * Tutorial steps can be overridden via AppSettings.tutorialContent (admin-editable).
 * Falls back to hardcoded defaults when no override is set.
 */
import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

const Ctx = createContext(null)

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'

// ── Tutorial default definitions ───────────────────────────────────────────
export const TUTORIAL_STEPS = {
  home: [
    { emoji: '👋', title: 'Welcome to SkyWatch!',
      body: 'Your personal RAF intelligence platform. You\'ll learn about aircraft, bases, roles, and operations — one brief at a time. This is designed to help you build real knowledge for your RAF application.' },
    { emoji: '✈️', title: 'Choose a Subject Area',
      body: 'Each card below is a subject — like a school subject but for the RAF. Tap any card to see all the intel briefs inside it. Start with any subject that interests you!' },
    { emoji: '📈', title: 'Track Your Progress',
      body: 'The progress bar on each subject card shows how many briefs you\'ve read. Try to complete every brief in a subject to master it.' },
    { emoji: '🔥', title: 'Daily Streak',
      body: 'Come back every day to keep your streak going! Consistent daily learning is the fastest way to be ready for RAF selection.' },
    { emoji: '⭐', title: 'Earn Aircoins',
      body: 'Reading briefs and completing quizzes earns you Aircoins. Collect enough Aircoins to level up — the more you learn, the higher your level climbs.' },
  ],
  learn: [
    { emoji: '📚', title: 'Subject Areas',
      body: 'Every subject covers a different part of RAF knowledge — from aircraft and bases to roles, squadrons, and live news. Pick any subject to start reading intel briefs.' },
    { emoji: '🔍', title: 'Search Subjects',
      body: 'Use the search bar at the top to find a specific subject quickly. Great if you already know what you want to study!' },
    { emoji: '📊', title: 'Brief Counts',
      body: 'Each subject card shows how many intel briefs are available inside it. Aim to read every brief in a subject to fully master that area.' },
  ],
  briefReader: [
    { emoji: '📋', title: 'Reading Intel Briefs',
      body: 'Each brief is broken into short, clear sections. Read one section at a time by pressing Continue — no rushing, just learning at your own pace.' },
    { emoji: '🔵', title: 'Keyword Hotspots',
      body: 'Words highlighted in blue are important RAF terms. Tap any highlighted word to see a detailed explanation. Building this vocabulary is key for your selection process!' },
    { emoji: '💡', title: 'Take Your Time',
      body: 'These briefs cover real RAF knowledge. The more carefully you read, the better you\'ll perform in the quiz — and in your actual RAF interviews.' },
    { emoji: '🎮', title: 'Unlock the Quiz',
      body: 'Once you\'ve read all sections, a quiz becomes available. Complete the quiz to earn Aircoins and mark the brief as complete.' },
  ],
  quiz: [
    { emoji: '🎯', title: 'Quiz Time!',
      body: 'All questions are based on the brief you just read. If you\'re unsure about something, think back to what you read — every answer is in there.' },
    { emoji: '✅', title: 'How It Works',
      body: 'Tap an answer to select it. You\'ll see immediately if it\'s right or wrong. Wrong answers show the correct answer so you learn from every mistake.' },
    { emoji: '⭐', title: 'Earn Aircoins',
      body: 'Every correct answer earns Aircoins. Complete the quiz to lock in your score. You can retake quizzes to improve your understanding!' },
  ],
  play: [
    { emoji: '🎮', title: 'Play Hub',
      body: 'This is your training games hub. Each game mode tests your RAF knowledge in a different way — from quizzes to flashcards and aircraft identification.' },
    { emoji: '🧠', title: 'Start a Quiz',
      body: 'The Intel Quiz lets you test yourself on any brief you\'ve read. Choose Standard for basic recall or Advanced for deeper questions. Earn Aircoins for every correct answer!' },
    { emoji: '⚡', title: 'More Games Coming',
      body: 'Flashcard Recall, Who\'s at Aircraft, and Battle Order are all in development. Check back as new game modes are added to keep training fresh.' },
  ],
  profile: [
    { emoji: '👤', title: 'Your Agent Profile',
      body: 'This is your personal stats dashboard. Track your level, Aircoins, reading streak, and quiz performance all in one place.' },
    { emoji: '📊', title: 'Stats Tab',
      body: 'The Stats tab shows briefs read, games played, average quiz score, and total Aircoins. Tap any stat to see its history.' },
    { emoji: '🏆', title: 'Leaderboard Tab',
      body: 'Switch to the Leaderboard tab to see how you rank against other RAF applicants by total Aircoins.' },
    { emoji: '🎯', title: 'Quiz Difficulty',
      body: 'You can change your preferred quiz difficulty here at any time — Standard for direct recall questions, or Advanced for tougher contextual challenges.' },
  ],
  rankings: [
    { emoji: '🎖️', title: 'Level Progression',
      body: 'The Agent Level tab shows your progress through Levels 1–10. Each level requires more Aircoins than the last. Reach Level 10 to trigger a Rank Promotion!' },
    { emoji: '🪖', title: 'RAF Ranks',
      body: 'The RAF Ranks tab shows all real RAF rank designations. Earn rank promotions by reaching Level 10 repeatedly — working your way up from Aircraftman to Marshal of the RAF.' },
    { emoji: '⭐', title: 'How to Level Up',
      body: 'Earn Aircoins by reading briefs and completing quizzes. Collect enough Aircoins and your level increases automatically — the Aircoins bar shows your progress to the next level.' },
  ],
  wheres_aircraft: [
    { emoji: '✈️', title: "Where's That Aircraft?",
      body: 'This mission has two rounds. First, you\'ll be shown an aircraft image and asked to identify it from 5 options. Stay sharp — one wrong move and the mission is over!' },
    { emoji: '🗺️', title: 'Round 2 — Find the Base',
      body: 'If you identify the aircraft correctly, Round 2 begins! A UK map appears with RAF bases marked. Select the home base(s) for that aircraft to complete the mission.' },
    { emoji: '🪙', title: 'Earn Aircoins',
      body: 'Correct identification earns coins. A correct base selection earns more. Complete both rounds successfully for a full mission bonus. The more you read, the more missions become available!' },
  ],
}

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
  const pendingRef   = useRef(null) // tutorial name waiting for auth to resolve

  // Keys are user-scoped so tutorials seen on one account don't suppress them on another
  const storageKey = useCallback((name) => {
    return user?._id ? `sw_tut_v2_${user._id}_${name}` : `sw_tut_v2_anon_${name}`
  }, [user?._id])

  // Check both user-scoped key AND anon key — so "seen as guest" counts when logged in
  const hasSeen = useCallback((name) => {
    if (user?._id && localStorage.getItem(`sw_tut_v2_${user._id}_${name}`)) return true
    if (localStorage.getItem(`sw_tut_v2_anon_${name}`)) return true
    return false
  }, [user?._id])

  // Load tutorial content overrides from public settings on mount
  useEffect(() => {
    fetch(`${API}/api/settings`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.tutorialContent) setTutorialContent(d.tutorialContent) })
      .catch(() => {})
  }, [])

  // Close tutorial on route change
  useEffect(() => {
    setActive(null)
  }, [location.pathname])

  // Returns steps for a named tutorial, with DB overrides applied
  const getSteps = useCallback((name) => {
    const overridden = applyOverrides(TUTORIAL_STEPS, tutorialContent)
    return overridden[name] ?? null
  }, [tutorialContent])

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

  const next = useCallback(() => {
    setActive(prev => {
      if (!prev) return null
      const nextIdx = prev.stepIndex + 1
      if (nextIdx >= prev.steps.length) {
        localStorage.setItem(storageKey(prev.name), '1')
        return null
      }
      return { ...prev, stepIndex: nextIdx }
    })
  }, [storageKey])

  const skip = useCallback(() => {
    if (active) localStorage.setItem(storageKey(active.name), '1')
    setActive(null)
  }, [active, storageKey])

  const replay = useCallback((name) => {
    start(name, true)
  }, [start])

  const step    = active ? active.steps[active.stepIndex]  : null
  const total   = active ? active.steps.length             : 0
  const current = active ? active.stepIndex + 1            : 0
  const visible = !!step

  return (
    <Ctx.Provider value={{ start, next, skip, replay, step, total, current, visible, tutorialContent }}>
      {children}
    </Ctx.Provider>
  )
}

export const useAppTutorial = () => useContext(Ctx)
