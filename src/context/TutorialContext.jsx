import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import { useAuth } from './AuthContext'

const TutorialContext = createContext(null)

// ── Tutorial definitions ───────────────────────────────────────────────────────
const TUTORIALS = {
  // Shown to everyone (guests + logged-in) who hasn't done it yet
  welcome: {
    steps: [
      {
        page:  'dashboard',
        title: 'Welcome to SkyWatch',
        body:  'On the dashboard you can view the latest news intel, and keep up to date with recommended categories.',
      },
      {
        page:  'intel-feed',
        title: 'Intel Feed',
        body:  'Grab the latest intel briefs, from news to aircraft and more.',
      },
    ],
  },
  // Shown to everyone (guests + logged-in) on their first intel brief visit
  intel_brief: {
    steps: [
      {
        page:  'intelligence-brief',
        title: 'First Briefing',
        body:  'Here you can learn about a piece of RAF intel. Media, stats, info and even classified games to test your knowledge.',
      },
    ],
  },
  // Shown only to logged-in users; starts on the Profile page
  user: {
    authRequired: true,
    steps: [
      {
        page:  'profile',
        title: 'Your Profile',
        body:  'Here you can see your level and current rank, the leaderboards, profile stats and your daily login streak.',
      },
      {
        page:          'profile',
        title:         'Stay Aware',
        body:          'Any issues or incorrect info? Please report it to us — the link is at the bottom of this page.',
        scrollAction:  'bottom',   // scroll to bottom of page when this step shows
        highlightClass: 'tut-stay-aware-active', // added to <body> while this step is visible
      },
    ],
  },
  // Manually triggered when user first engages targeting/focus mode on a brief page.
  // Shows to everyone — guestBody used for non-logged-in users.
  load_up: {
    manualOnly: true,
    steps: [
      {
        page:      'intelligence-brief',
        title:     'Load Up',
        body:      'Each intel brief gives you a daily ammo allocation based on your subscription tier. Use that ammo to unlock classified keyword dossiers within the brief — no Aircoins spent. Aircoins are earned separately by reading briefs and completing games.',
        guestBody: "You've engaged the targeting system! Each intel brief comes with a daily ammo allocation for unlocking classified keyword dossiers — no Aircoins needed for this. Sign up to receive your ammo allocation and start earning Aircoins.",
      },
    ],
  },
}

const PRIORITY = { unseen: 0, skipped: 1, viewed: 2 }

// ── localStorage helpers (guests) ─────────────────────────────────────────────
function getLocalStatus(id) {
  try { return JSON.parse(localStorage.getItem('skywatch_tutorials') || '{}')[id] ?? 'unseen' }
  catch { return 'unseen' }
}

function setLocalStatus(id, status) {
  try {
    const stored = JSON.parse(localStorage.getItem('skywatch_tutorials') || '{}')
    stored[id] = status
    localStorage.setItem('skywatch_tutorials', JSON.stringify(stored))
  } catch {}
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function TutorialProvider({ children, currentPage, navigate }) {
  const { user, setUser, API } = useAuth()

  const [activeTutorialId,  setActiveTutorialId]  = useState(null)
  const activeTutorialIdRef = useRef(null)
  activeTutorialIdRef.current = activeTutorialId
  const [activeStep,        setActiveStep]         = useState(0)
  const [blocked,           setBlocked]            = useState(false)
  const [contentOverrides,  setContentOverrides]   = useState({}) // keyed by '<id>_<idx>'

  // Fetch tutorial content overrides from the public settings endpoint
  const refreshOverrides = useCallback(() => {
    fetch(`${API}/api/settings`)
      .then(r => r.json())
      .then(data => { if (data.tutorialContent) setContentOverrides(data.tutorialContent) })
      .catch(() => {})
  }, [API])

  useEffect(() => { refreshOverrides() }, [refreshOverrides])

  const navigateRef = useRef(navigate)
  const prevUserRef = useRef(user)
  useEffect(() => { navigateRef.current = navigate }, [navigate])

  // ── Status helpers ───────────────────────────────────────────────────────────
  const getStatus = useCallback((id) => {
    if (user) return user.tutorials?.[id] ?? 'unseen'
    return getLocalStatus(id)
  }, [user])

  const saveStatus = useCallback(async (id, status) => {
    if (user) {
      setUser(u => u ? { ...u, tutorials: { ...(u.tutorials ?? {}), [id]: status } } : u)
      try {
        await fetch(`${API}/api/users/me/tutorials`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tutorialId: id, status }),
        })
      } catch {}
    } else {
      setLocalStatus(id, status)
    }
  }, [user, setUser, API])

  // ── Sync localStorage to DB on login ────────────────────────────────────────
  useEffect(() => {
    const prev = prevUserRef.current
    prevUserRef.current = user
    if (prev || !user) return // only fires on guest → logged-in transition
    const sync = async () => {
      try {
        const stored = JSON.parse(localStorage.getItem('skywatch_tutorials') || '{}')
        if (!Object.keys(stored).length) return
        await fetch(`${API}/api/users/me/tutorials/sync`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(stored),
        })
        localStorage.removeItem('skywatch_tutorials')
        // Reflect synced state locally — only update to more-complete values
        setUser(u => {
          if (!u) return u
          const merged = { ...(u.tutorials ?? {}) }
          for (const [id, status] of Object.entries(stored)) {
            if (PRIORITY[status] > PRIORITY[merged[id] ?? 'unseen']) merged[id] = status
          }
          return { ...u, tutorials: merged }
        })
      } catch {}
    }
    sync()
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Find which tutorial (if any) should auto-start for the given page ────────
  // manualOnly tutorials (load_up) are excluded from auto-detection.
  const findTutorial = useCallback((pageId) => {
    for (const id of ['welcome', 'intel_brief', 'user']) {
      const tut = TUTORIALS[id]
      if (tut.authRequired && !user) continue
      if (getStatus(id) !== 'unseen') continue
      if (tut.steps[0].page === pageId) return id
    }
    return null
  }, [user, getStatus])

  // ── Auto-start a tutorial when page or auth state changes ─────────────────────
  useEffect(() => {
    if (!currentPage || activeTutorialId) return
    const id = findTutorial(currentPage)
    if (id) { setActiveTutorialId(id); setActiveStep(0) }
  }, [currentPage, user?._id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Manually start a tutorial (e.g. triggered by a UI interaction) ────────────
  // Uses activeTutorialIdRef (not the closure value) so this never reads stale state
  // even when called from event-handler callbacks that captured an old version.
  const startTutorial = useCallback((id) => {
    if (!TUTORIALS[id]) return false
    if (getStatus(id) !== 'unseen') return false
    if (activeTutorialIdRef.current) return false // don't interrupt an active tutorial
    setActiveTutorialId(id)
    setActiveStep(0)
    return true
  }, [getStatus])

  // ── Derived overlay state ────────────────────────────────────────────────────
  const stepData = activeTutorialId ? (() => {
    const step = TUTORIALS[activeTutorialId].steps[activeStep] ?? null
    if (!step) return null
    // Merge any admin-saved overrides (non-empty strings only)
    const overrideKey = `${activeTutorialId}_${activeStep}`
    const override    = contentOverrides[overrideKey] ?? {}
    const merged = {
      ...step,
      title:     override.title?.trim()     || step.title,
      body:      override.body?.trim()      || step.body,
      guestBody: override.guestBody?.trim() || step.guestBody,
    }
    // Use guestBody when user is not logged in and guestBody is defined
    if (!user && merged.guestBody) return { ...merged, body: merged.guestBody }
    return merged
  })() : null

  const showOverlay = !!stepData && stepData.page === currentPage && !blocked
  const totalSteps  = activeTutorialId ? TUTORIALS[activeTutorialId].steps.length : 0

  // ── Step side-effects: scroll + body class ────────────────────────────────────
  useEffect(() => {
    if (!showOverlay || !stepData) return

    // Scroll to bottom of page when the step requests it.
    // Two passes: first at 400ms (before data loads), second at 1200ms (after
    // dynamic content like dashboard briefs have rendered and expanded the page).
    // Using a large top value lets the browser clamp to the real maximum.
    if (stepData.scrollAction === 'bottom') {
      const scrollBottom = () => window.scrollTo({ top: 999999, behavior: 'smooth' })
      // Fire multiple times to catch dynamic content (e.g. suggested categories)
      // that loads and expands the page 1–3 seconds after navigation.
      const t1 = setTimeout(scrollBottom, 400)
      const t2 = setTimeout(scrollBottom, 1200)
      const t3 = setTimeout(scrollBottom, 2200)
      const t4 = setTimeout(scrollBottom, 3500)
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4) }
    }
  }, [showOverlay, activeTutorialId, activeStep]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showOverlay || !stepData?.highlightClass) return
    document.body.classList.add(stepData.highlightClass)
    return () => document.body.classList.remove(stepData.highlightClass)
  }, [showOverlay, activeTutorialId, activeStep]) // eslint-disable-line react-hooks/exhaustive-deps

  // Disable page scroll while a tutorial overlay is visible
  useEffect(() => {
    if (!showOverlay) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [showOverlay])

  // ── Actions ──────────────────────────────────────────────────────────────────
  const next = useCallback(() => {
    if (!activeTutorialId) return
    const tut     = TUTORIALS[activeTutorialId]
    const nextIdx = activeStep + 1
    if (nextIdx >= tut.steps.length) {
      saveStatus(activeTutorialId, 'viewed')
      activeTutorialIdRef.current = null  // immediate — closes race-condition window
      setActiveTutorialId(null)
      setActiveStep(0)
    } else {
      setActiveStep(nextIdx)
      const nextStep = tut.steps[nextIdx]
      if (nextStep.page !== currentPage) navigateRef.current(nextStep.page)
    }
  }, [activeTutorialId, activeStep, currentPage, saveStatus])

  const skip = useCallback(() => {
    if (!activeTutorialId) return
    saveStatus(activeTutorialId, 'skipped')
    activeTutorialIdRef.current = null  // immediate — closes race-condition window
    setActiveTutorialId(null)
    setActiveStep(0)
  }, [activeTutorialId, saveStatus])

  return (
    <TutorialContext.Provider value={{ showOverlay, stepData, activeStep, totalSteps, next, skip, setBlocked, getStatus, startTutorial, activeTutorialId, activeTutorialIdRef, refreshOverrides }}>
      {children}
    </TutorialContext.Provider>
  )
}

export const useTutorial = () => useContext(TutorialContext)
