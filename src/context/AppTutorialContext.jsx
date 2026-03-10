/**
 * New tutorial system for the redesigned UI.
 * Works with React Router (uses useLocation instead of prop-based currentPage).
 * Stored in localStorage — syncs to DB when user logs in (future enhancement).
 */
import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const Ctx = createContext(null)

// ── Tutorial definitions ───────────────────────────────────────────────────
export const TUTORIAL_STEPS = {
  home: [
    { emoji: '👋', title: 'Welcome to Skywatch!',
      body: 'Your personal RAF intelligence platform. You\'ll learn about aircraft, bases, roles, and operations — one brief at a time. This is designed to help you build real knowledge for your RAF application.' },
    { emoji: '✈️', title: 'Choose a Subject Area',
      body: 'Each card below is a subject — like a school subject but for the RAF. Tap any card to see all the intel briefs inside it. Start with any subject that interests you!' },
    { emoji: '📈', title: 'Track Your Progress',
      body: 'The progress bar on each subject card shows how many briefs you\'ve read. Try to complete every brief in a subject to master it.' },
    { emoji: '🔥', title: 'Daily Streak',
      body: 'Come back every day to keep your streak going! Consistent daily learning is the fastest way to be ready for RAF selection.' },
    { emoji: '⭐', title: 'Earn Aircoins',
      body: 'Reading briefs and completing quizzes earns you Aircoins. These build your level and track your progress through the platform.' },
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
}

const storageKey = (name) => `sw_tut_v2_${name}`

// ── Provider ──────────────────────────────────────────────────────────────
export function AppTutorialProvider({ children }) {
  const [active, setActive] = useState(null) // { name, steps, stepIndex }
  const location = useLocation()

  // Close tutorial on route change
  useEffect(() => {
    setActive(null)
  }, [location.pathname])

  const start = useCallback((name, force = false) => {
    if (!force && localStorage.getItem(storageKey(name))) return
    const steps = TUTORIAL_STEPS[name]
    if (!steps?.length) return
    setActive({ name, steps, stepIndex: 0 })
  }, [])

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
  }, [])

  const skip = useCallback(() => {
    if (active) localStorage.setItem(storageKey(active.name), '1')
    setActive(null)
  }, [active])

  const replay = useCallback((name) => {
    start(name, true)
  }, [start])

  const step    = active ? active.steps[active.stepIndex]  : null
  const total   = active ? active.steps.length             : 0
  const current = active ? active.stepIndex + 1            : 0
  const visible = !!step

  return (
    <Ctx.Provider value={{ start, next, skip, replay, step, total, current, visible }}>
      {children}
    </Ctx.Provider>
  )
}

export const useAppTutorial = () => useContext(Ctx)
