/**
 * Tutorial system.
 * Steps are sourced from GET /api/tutorials (DB-backed Tutorial model, admin-editable).
 * The hardcoded TUTORIAL_STEPS below is a fallback used until the fetch settles
 * (and as a key registry for the localStorage reset/sync loops). It's kept in
 * sync with backend/seeds/tutorialDefaults.js so the runtime works pre-fetch.
 */
import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { useAppSettings } from './AppSettingsContext'

const Ctx = createContext(null)

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'
// Bumped to v2 when the cache shape changed from { id: stepsArray }
// to { id: tutorialObject } (so showToGuests + name + inline travel with the steps).
const TUTORIALS_CACHE_KEY = 'sw_tutorials_cache_v2'

// ── Tutorial fallback definitions ──────────────────────────────────────────
// Mirrors backend/seeds/tutorialDefaults.js. Used until /api/tutorials returns
// (warm-cache miss only) and as a key registry for reset/sync loops. The
// runtime always prefers fetched data when available.
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
      body: 'Reading briefs and completing Intel Recalls earns you Airstars. Collect enough Airstars to level up — the more you learn, the higher your level climbs.' },
  ],
  briefReader: [
    { emoji: '📋', title: 'Reading Intel Briefs',
      body: 'Each brief is split into short sections — swipe left or tap Continue to move forward, swipe right to go back. The counter in the top corner of each card shows where you are in the brief.' },
    { emoji: '🔵', title: 'Keyword Hotspots',
      body: 'Words highlighted in blue are important RAF terms. Tap any highlighted word to see a full explanation. Building this vocabulary is essential for mastering the subject.' },
    { emoji: '📊', title: 'Key Stats & Memory Aids',
      body: 'Each section shows a key fact about the subject. If you see a 💡 next to a stat, tap it — a mnemonic memory aid will help you lock that fact in before your interview.' },
    { emoji: '🎮', title: 'Unlock Intel Recall',
      body: 'Once you\'ve read all sections, Intel Recall becomes available. Complete it to test your knowledge, earn Airstars, and mark the brief as complete.' },
    { emoji: '⚡', title: 'Speed-Read with RSVP',
      body: 'Press and hold a section description for ~1 second to engage rapid serial reading. Slide right to advance, left to re-read, up to speed up, down to slow down. Release to exit.' },
  ],
  quiz: [
    { emoji: '🎯', title: 'Recall Time!',
      body: 'All questions are based on the brief you just read. If you\'re unsure about something, think back to what you read — every answer is in there.' },
    { emoji: '✅', title: 'How It Works',
      body: 'Tap an answer to select it. You\'ll see immediately if it\'s right or wrong. Wrong answers show the correct answer so you learn from every mistake.' },
    { emoji: '⭐', title: 'Earn Airstars',
      body: 'Every correct answer earns Airstars. Complete the recall to lock in your score. You can retake any Intel Recall to improve your understanding!' },
  ],
  play: [
    { emoji: '🎮', title: 'Play Hub',
      body: 'This is your training games hub. Four game modes test your aviation knowledge in different ways — from recall drills to aircraft identification and tactical ordering.' },
    { emoji: '🧠', title: 'Intel Recall',
      body: 'Test yourself on briefs you\'ve already read. Choose Standard for recall-based questions or Advanced for tougher contextual challenges. Earn Airstars for every correct answer.' },
    { emoji: '✈️', title: "Where's That Aircraft?",
      body: 'Live now! Study RAF aircraft and their home bases, then random identification missions begin appearing. Spot the aircraft from an image, then locate its base on a UK map.' },
    { emoji: '🗺️', title: 'Battle of Order',
      body: 'Live now! Arrange aircraft, ranks, and missions in the correct tactical sequence. Read the associated brief and pass its Intel Recall first to unlock each Battle of Order game.' },
    { emoji: '👆', title: 'Choose Your Game',
      body: 'Tap any of the game type cards to jump straight to that section below. All four modes are live and ready to play.',
      highlightSelector: '[data-tutorial-target="play-grid"]', highlightPage: '/play', advanceOnTargetClick: true },
  ],
  profile: [
    { emoji: '👤', title: 'Your Agent Profile',
      body: 'This is your personal stats dashboard. Track your level, Airstars, reading streak, and recall performance all in one place.' },
    { emoji: '📊', title: 'Stats Tab',
      body: 'The Stats tab shows briefs read, games played, average recall score, and total Airstars. Tap any stat to see its history.' },
    { emoji: '🏆', title: 'Leaderboard Tab',
      body: 'Switch to the Leaderboard tab to see how you rank against other learners by total Airstars.' },
    { emoji: '⚙️', title: 'Open Settings',
      body: 'Tap the Settings tab to find Recall Difficulty and other preferences.',
      highlightSelector: '[data-tutorial-target="profile-tab-settings"]', highlightPage: '/profile', advanceOnTargetClick: true },
    { emoji: '🎯', title: 'Step Up Your Difficulty',
      body: 'Tap Advanced under "Recall Difficulty" for tougher, interview-level questions and bigger Airstars rewards. You can switch back to Standard at any time.',
      highlightSelector: '[data-tutorial-target="profile-difficulty"]', highlightPage: '/profile', advanceOnTargetClick: true },
  ],
  rankings: [
    { emoji: '🎖️', title: 'Level Progression',
      body: 'The Agent Level tab shows your progress through Levels 1–10. Each level requires more Airstars than the last. Reach Level 10 to trigger a Rank Promotion!' },
    { emoji: '🏅', title: 'RAF Ranks',
      body: 'The RAF Ranks tab shows all real RAF rank designations. Earn rank promotions by reaching Level 10 repeatedly — working your way up from Aircraftman to Marshal of the RAF.' },
    { emoji: '⭐', title: 'How to Level Up',
      body: 'Earn Airstars by reading briefs and completing Intel Recalls. Collect enough Airstars and your level increases automatically — the Airstars bar shows your progress to the next level.' },
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
    { emoji: '👣', title: 'Stepping Stones',
      body: 'Each stone represents an Intel Brief. Tap it to open and read it. Completed stones are marked with a tick — work through them in order for the best results.' },
    { emoji: '🔓', title: 'Unlock More Paths',
      body: 'Level up to unlock new learning pathways covering Aircrafts, Ranks, Squadrons, and more. Some pathways also require a Silver or Gold subscription.' },
  ],
  caseFile_coldOpen: [
    { emoji: '📂', title: 'Scene Briefing',
      body: 'Read the situation. Tap Continue when you\'re ready to proceed to the first stage.' },
  ],
  caseFile_evidenceWall: [
    { emoji: '🔍', title: 'Inspect the Evidence',
      body: 'Click any evidence card to examine it. Look for connections between items.' },
    { emoji: '🧵', title: 'Link & Remove',
      body: 'Click two cards to draw a link between them. Click an existing string to remove it. Submit when your links are placed.' },
  ],
  caseFile_actorInterrogations: [
    { emoji: '🎙️', title: 'Question Key Actors',
      body: 'Select a question to put to each actor. You have 3 questions per actor — choose carefully.' },
    { emoji: '📝', title: 'Answers Carry Forward',
      body: 'What actors tell you informs the stages ahead. You can\'t revisit questions once submitted.' },
  ],
  caseFile_decisionPoint: [
    { emoji: '⚖️', title: 'Make Your Call',
      body: 'Pick the outcome you think will occur, then lock it in. You can\'t change your answer after submitting.' },
  ],
  caseFile_mapPredictive: [
    { emoji: '📍', title: 'Place Your Pins',
      body: 'Drag pins onto the map to mark where you predict forces will appear or move.' },
    { emoji: '✅', title: 'Submit Your Forecast',
      body: 'Confirm your pin placements and submit. Your accuracy is scored against the real outcome.' },
  ],
  caseFile_phaseReveal: [
    { emoji: '📡', title: 'Reality Check',
      body: 'This is what actually happened. Compare the outcome against your earlier predictions.' },
  ],
  caseFile_mapLive: [
    { emoji: '🗺️', title: 'Contested Zones',
      body: 'Tap each highlighted zone on the map to see the situation there.' },
    { emoji: '🎯', title: 'Choose Your Response',
      body: 'For each zone, select how to respond. Submit all decisions when ready.' },
  ],
  caseFile_debrief: [
    { emoji: '🏁', title: 'Mission Summary',
      body: 'Your score breakdown and Airstars earned are shown here. Review what you got right and wrong.' },
  ],
  // Inline mini-tutorials — modal never triggered. Kept here so the
  // localStorage reset/sync loops can iterate every known tutorial key.
  pathway_swipe: [
    { emoji: '👆', title: 'Switch Pathways',
      body: 'Swipe left or right anywhere on the pathway to switch between your unlocked subjects.' },
  ],
  stat_mnemonic: [
    { emoji: '💡', title: 'Memory Aids',
      body: 'Press and hold the 💡 icon next to a stat to reveal a memory aid that helps you retain that fact.' },
  ],
  swipe: [
    { emoji: '👆', title: 'Navigate Sections',
      body: 'Swipe left to advance to the next section, or swipe right to go back.' },
  ],
  quiz_difficulty_nudge: [
    { emoji: '🎚️', title: 'Difficulty Check',
      body: 'One-time nudge shown after a first-attempt win on easy difficulty — asks if the user wants to step up to Advanced.' },
  ],
}

// Derived key list — import this anywhere that needs to know all tutorial names.
export const TUTORIAL_KEYS = Object.keys(TUTORIAL_STEPS)

// Convert the array shape returned by /api/tutorials into a {tutorialId: tutorialObject} map.
// Stores the full tutorial so showToGuests / inline / name travel alongside the steps.
function tutorialsArrayToMap(arr) {
  const out = {}
  for (const t of arr || []) {
    if (t?.tutorialId && Array.isArray(t.steps)) {
      out[t.tutorialId] = {
        tutorialId:   t.tutorialId,
        name:         t.name,
        inline:       !!t.inline,
        showToGuests: t.showToGuests !== false, // default true
        steps:        t.steps,
      }
    }
  }
  return out
}

// ── Provider ──────────────────────────────────────────────────────────────
export function AppTutorialProvider({ children }) {
  const [active,         setActive]         = useState(null) // { name, steps, stepIndex }
  // tutorialsMap: { tutorialId: stepsArray } — DB-sourced via /api/tutorials.
  // Initialised from localStorage so step content paints instantly on cold load.
  const [tutorialsMap,   setTutorialsMap]   = useState(() => {
    try {
      const cached = localStorage.getItem(TUTORIALS_CACHE_KEY)
      if (cached) return JSON.parse(cached)
    } catch { /* corrupt cache — ignore */ }
    return {}
  })
  const location     = useLocation()
  const { user, loading: authLoading } = useAuth()
  const { settings } = useAppSettings()
  const mnemonicsEnabled = settings?.mnemonicsClickEnabled === true
  const mnemonicsEnabledRef = useRef(mnemonicsEnabled)
  useEffect(() => { mnemonicsEnabledRef.current = mnemonicsEnabled }, [mnemonicsEnabled])
  const rsvpEnabled = settings?.rsvpReaderEnabled === true
  const rsvpEnabledRef = useRef(rsvpEnabled)
  useEffect(() => { rsvpEnabledRef.current = rsvpEnabled }, [rsvpEnabled])
  const isGuest = !user?._id
  const isGuestRef = useRef(isGuest)
  useEffect(() => { isGuestRef.current = isGuest }, [isGuest])
  const pendingRef    = useRef(null) // tutorial name waiting for auth to resolve
  const pendingNavRef = useRef(null) // { name, stepIndex } — fires after next route change
  const tutorialsRef  = useRef(tutorialsMap) // mirror for use in route-change effect

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

  // Keep ref in sync so route-change effect can read latest map without a dep
  useEffect(() => { tutorialsRef.current = tutorialsMap }, [tutorialsMap])

  // Fetch tutorials from the DB on mount. Caches in localStorage so subsequent
  // cold loads paint immediately without waiting for the round-trip.
  const fetchTutorials = useCallback(() => {
    return fetch(`${API}/api/tutorials`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const arr = d?.data?.tutorials
        if (!Array.isArray(arr)) return
        const map = tutorialsArrayToMap(arr)
        setTutorialsMap(map)
        try { localStorage.setItem(TUTORIALS_CACHE_KEY, JSON.stringify(map)) } catch { /* quota */ }
      })
      .catch(() => {})
  }, [])

  useEffect(() => { fetchTutorials() }, [fetchTutorials])

  // Resolve the active step list for a tutorial: prefer DB-sourced data, fall
  // back to hardcoded TUTORIAL_STEPS, then apply runtime filters in this order:
  //   1. Tutorial-level showToGuests — if false and user is a guest, return null
  //      so the tutorial never starts.
  //   2. Step-level showToGuests — drop steps the admin marked as logged-in-only
  //      when the current viewer is a guest.
  //   3. Feature-flag filters for the briefReader tutorial (RSVP / mnemonics).
  // `isGuest` is whether the current viewer is logged-out.
  const resolveSteps = useCallback((name, { mnemonicsOn, rsvpOn, isGuest, map }) => {
    const fromMap = map && map[name]
    const fromCode = TUTORIAL_STEPS[name]
    // map values are { steps, showToGuests, ... }; code values are stepsArray
    let steps        = fromMap ? fromMap.steps : (Array.isArray(fromCode) ? fromCode : null)
    const showGuests = fromMap ? fromMap.showToGuests !== false : true
    if (!steps) return null
    if (isGuest && !showGuests) return null
    if (isGuest) steps = steps.filter(s => s?.showToGuests !== false)
    if (name === 'briefReader' && !mnemonicsOn) {
      steps = steps.filter(s => s.title !== 'Key Stats & Memory Aids')
    }
    if (name === 'briefReader' && !rsvpOn) {
      steps = steps.filter(s => s.title !== 'Speed-Read with RSVP')
    }
    return steps
  }, [])

  // On route change: fire any pending post-nav tutorial, otherwise clear active
  useEffect(() => {
    if (pendingNavRef.current) {
      const { name, stepIndex } = pendingNavRef.current
      pendingNavRef.current = null
      const steps = resolveSteps(name, {
        mnemonicsOn: mnemonicsEnabledRef.current,
        rsvpOn:      rsvpEnabledRef.current,
        isGuest:     isGuestRef.current,
        map:         tutorialsRef.current,
      })
      if (steps?.length) {
        const idx = Math.min(stepIndex, steps.length - 1)
        setActive({ name, steps, stepIndex: idx })
      }
    } else {
      setActive(null)
    }
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // Public API — returns live-resolved steps for a named tutorial
  const getSteps = useCallback((name) => {
    return resolveSteps(name, { mnemonicsOn: mnemonicsEnabled, rsvpOn: rsvpEnabled, isGuest, map: tutorialsMap })
  }, [resolveSteps, tutorialsMap, mnemonicsEnabled, rsvpEnabled, isGuest])

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

  // ── Universal spotlight ──────────────────────────────────────────────
  // When the active step has a highlightSelector, find the matching DOM
  // element, apply .tutorial-spotlight (lifts above the modal backdrop +
  // glow), and (when advanceOnTargetClick) advance the tutorial when the
  // user clicks the highlighted element. MutationObserver handles late-
  // mounting targets (e.g. tab switch revealing a card) for up to 3s.
  const selector       = step?.highlightSelector || null
  const advanceOnClick = selector ? step?.advanceOnTargetClick !== false : false
  useEffect(() => {
    if (!selector) return
    let cleanupTarget = null
    let observer      = null
    let observeTimer  = null

    const tryFind = () => {
      const el = document.querySelector(selector)
      if (!el) return false

      el.classList.add('tutorial-spotlight')
      let removeListener = () => {}
      if (advanceOnClick) {
        const onClick = () => next()
        el.addEventListener('click', onClick)
        removeListener = () => el.removeEventListener('click', onClick)
      }
      cleanupTarget = () => {
        el.classList.remove('tutorial-spotlight')
        removeListener()
      }

      observer?.disconnect()
      observer = null
      clearTimeout(observeTimer)
      return true
    }

    if (!tryFind()) {
      observer = new MutationObserver(tryFind)
      observer.observe(document.body, { childList: true, subtree: true })
      observeTimer = setTimeout(() => observer?.disconnect(), 3000)
    }

    return () => {
      observer?.disconnect()
      clearTimeout(observeTimer)
      cleanupTarget?.()
    }
  }, [selector, advanceOnClick, next])

  return (
    <Ctx.Provider value={{ start, next, skip, back, canGoBack, startAfterNav, replay, resetAll, step, total, current, visible, activeName, hasSeen, refreshTutorials: fetchTutorials }}>
      {children}
    </Ctx.Provider>
  )
}

export const useAppTutorial = () => useContext(Ctx)
