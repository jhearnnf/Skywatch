import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppTutorial } from '../../context/AppTutorialContext'
import TutorialModal from '../../components/tutorial/TutorialModal'
import LockedCategoryModal from '../../components/LockedCategoryModal'
import { requiredTier } from '../../utils/subscription'
import { useAppSettings } from '../../context/AppSettingsContext'
import { playSound } from '../../utils/sound'

// ── Keyword bottom-sheet ──────────────────────────────────────────────────
function KeywordSheet({ kw, onClose }) {
  return (
    <AnimatePresence>
      {kw && (
        <>
          <motion.div
            key="kw-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/40"
            onClick={onClose}
          />
          <motion.div
            key="kw-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="fixed bottom-0 inset-x-0 z-50 bg-surface rounded-t-3xl p-6 pb-10 max-w-lg mx-auto shadow-2xl"
          >
            {/* Drag handle */}
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />

            <div className="flex items-start gap-3">
              <span className="text-3xl">🔑</span>
              <div>
                <h3 className="text-lg font-extrabold text-slate-900 mb-1">{kw.keyword}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{kw.generatedDescription}</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="mt-5 w-full py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold transition-colors"
            >
              Got it ✓
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Render one section with highlighted keywords ──────────────────────────
function SectionText({ text, keywords, learnedKws, onKeywordTap }) {
  if (!text) return null

  // Build segments: split text around keyword occurrences
  const segments = []
  if (!keywords?.length) {
    segments.push({ type: 'text', content: text })
  } else {
    const sorted  = [...keywords].sort((a, b) => b.keyword.length - a.keyword.length)
    const pattern = new RegExp(
      `(?<![a-zA-Z0-9])(${sorted.map(k => k.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![a-zA-Z0-9])`,
      'gi'
    )
    let last = 0, match
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > last) segments.push({ type: 'text', content: text.slice(last, match.index) })
      const kw = keywords.find(k => k.keyword.toLowerCase() === match[1].toLowerCase())
      segments.push({ type: 'keyword', content: match[1], keyword: kw })
      last = match.index + match[1].length
    }
    if (last < text.length) segments.push({ type: 'text', content: text.slice(last) })
  }

  return (
    <p className="text-base leading-8 text-slate-700">
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <span key={i}>{seg.content}</span>
        const learned = learnedKws.has(seg.keyword?.keyword?.toLowerCase())
        return (
          <button
            key={i}
            onClick={() => onKeywordTap(seg.keyword)}
            className={`inline rounded px-0.5 -mx-0.5 font-semibold transition-all
              border-b-2 focus:outline-none cursor-pointer
              ${learned
                ? 'text-emerald-700 border-emerald-400 bg-emerald-50'
                : 'text-brand-700 border-brand-300 bg-brand-50 hover:bg-brand-100 hover:border-brand-500'
              }`}
          >
            {seg.content}
          </button>
        )
      })}
    </p>
  )
}

// ── BOO stats panel ───────────────────────────────────────────────────────
function StatRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</span>
      <span className="text-sm font-bold text-white">{value}</span>
    </div>
  )
}

function BooStatsPanel({ brief }) {
  const gd  = brief.gameData
  const cat = brief.category
  if (!gd) return null

  const stats = []

  if (cat === 'Aircrafts') {
    if (gd.topSpeedKph != null)
      stats.push({ label: 'Top Speed', value: `${gd.topSpeedKph.toLocaleString()} km/h · ${Math.round(gd.topSpeedKph * 0.621).toLocaleString()} mph` })
    if (gd.yearIntroduced != null)
      stats.push({ label: 'Introduced', value: String(gd.yearIntroduced) })
    if (gd.yearIntroduced != null)
      stats.push({
        label: 'Status',
        value: gd.yearRetired != null ? `Retired ${gd.yearRetired}` : 'In Service',
      })
  } else if (cat === 'Ranks') {
    if (gd.rankHierarchyOrder != null)
      stats.push({ label: 'Seniority', value: `#${gd.rankHierarchyOrder}${gd.rankHierarchyOrder === 1 ? ' — Most Senior' : ''}` })
  } else if (cat === 'Training') {
    if (gd.trainingWeekStart != null && gd.trainingWeekEnd != null)
      stats.push({ label: 'Duration', value: `Week ${gd.trainingWeekStart} – Week ${gd.trainingWeekEnd}` })
  } else if (['Missions', 'Tech', 'Treaties'].includes(cat)) {
    if (gd.startYear != null)
      stats.push({ label: 'Period', value: `${gd.startYear} – ${gd.endYear != null ? gd.endYear : 'Present'}` })
  }

  if (stats.length === 0) return null

  return (
    <div className="bg-slate-800 rounded-2xl px-4 py-3 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">⚔️ Battle Data</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {stats.map(s => <StatRow key={s.label} label={s.label} value={s.value} />)}
      </div>
    </div>
  )
}

// ── Completion screen ─────────────────────────────────────────────────────
function CompletionScreen({ brief, onQuiz, booState, onBattleOrder, onBack, user, isFirstCompletion, coinReward }) {
  const navigate         = useNavigate()
  const { API, setUser } = useAuth()
  const [email, setEmail] = useState('')
  const googleBtnRef     = useRef(null)

  // Google One Tap + inline button — guests only
  useEffect(() => {
    if (user) return
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId || !window.google) return

    const handleCredential = async (response) => {
      try {
        const res  = await fetch(`${API}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ credential: response.credential }),
        })
        const data = await res.json()
        if (data?.data?.user) setUser(data.data.user)
      } catch { /* ignore */ }
    }

    window.google.accounts.id.initialize({ client_id: clientId, callback: handleCredential })
    window.google.accounts.id.prompt() // One Tap overlay
    if (googleBtnRef.current) {
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline', size: 'large', text: 'signup_with', width: 280, logo_alignment: 'center',
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleEmailContinue() {
    sessionStorage.setItem('sw_pending_brief', brief._id)
    navigate(`/login?tab=register${email ? `&email=${encodeURIComponent(email)}` : ''}`)
  }

  const heading    = isFirstCompletion && user ? '🎖️ First Brief — Mission Complete!' : 'Brief Complete!'
  const subheading = isFirstCompletion && user
    ? 'Your first intel brief is done. Now test what you\'ve learned.'
    : 'You\'ve read all sections of this brief.'

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center py-8"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', damping: 14, delay: 0.1 }}
        className="text-6xl mb-4"
      >
        🎉
      </motion.div>
      <h2 className="text-2xl font-extrabold text-slate-900 mb-2">{heading}</h2>
      <p className="text-slate-500 mb-8">{subheading}</p>

      {/* Keywords learned */}
      {brief.keywords?.length > 0 && (
        <div className="bg-surface rounded-2xl p-4 border border-slate-200 mb-6 text-left card-shadow">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
            🔑 Keywords in this brief
          </p>
          <div className="flex flex-wrap gap-2">
            {brief.keywords.map(kw => (
              <span key={kw._id ?? kw.keyword} className="text-xs font-semibold bg-brand-100 text-brand-700 px-2 py-1 rounded-full border border-brand-200">
                {kw.keyword}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {user ? (
          <>
            <button
              onClick={onQuiz}
              className="w-full py-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-lg transition-colors shadow-lg shadow-brand-200"
            >
              🎮 Take the Quiz → Earn Aircoins
            </button>
            {booState === 'available' && (
              <button
                onClick={onBattleOrder}
                className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-2xl text-base transition-colors"
              >
                🗺️ Battle Order → Earn Aircoins
              </button>
            )}
            {booState === 'locked-quiz' && (
              <button
                disabled
                className="w-full py-4 border border-dashed border-slate-200 text-slate-400 font-semibold rounded-2xl text-sm cursor-not-allowed flex items-center justify-center gap-2"
              >
                <span>🗺️ Battle Order</span>
                <span className="text-xs bg-slate-100 px-2 py-0.5 rounded-full">🔒 Pass the quiz first</span>
              </button>
            )}
          </>
        ) : (
          <>
            {/* Investment hook */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left flex items-center gap-3">
              <span className="text-2xl shrink-0">⭐</span>
              <div>
                <p className="text-sm font-bold text-slate-700">{coinReward} Aircoins waiting to be claimed</p>
                <p className="text-xs text-slate-500">Sign up to collect your reward and keep your streak</p>
              </div>
            </div>

            {/* Sign-up panel */}
            <div className="bg-surface border border-slate-200 rounded-2xl p-5 text-left card-shadow">
              <p className="font-bold text-slate-900 mb-3">Don't lose this progress</p>
              <ul className="space-y-1.5 mb-5">
                <li className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="text-emerald-600 font-bold shrink-0">✓</span>
                  Claim your {coinReward} Aircoins for this brief
                </li>
                <li className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="text-emerald-600 font-bold shrink-0">✓</span>
                  Take the quiz — test what you've just learned
                </li>
                <li className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="text-emerald-600 font-bold shrink-0">✓</span>
                  Track your reading streak
                </li>
                <li className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="text-emerald-600 font-bold shrink-0">✓</span>
                  5-day Silver trial included on sign-up
                </li>
              </ul>

              {/* Google button (fallback if One Tap suppressed) */}
              <div ref={googleBtnRef} className="flex justify-center mb-3" />
              {!import.meta.env.VITE_GOOGLE_CLIENT_ID && (
                <p className="text-xs text-slate-400 text-center mb-3">Google sign-in unavailable</p>
              )}

              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 h-px bg-slate-100" />
                <span className="text-xs text-slate-400">or continue with email</span>
                <div className="flex-1 h-px bg-slate-100" />
              </div>

              <div className="flex gap-2 mb-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleEmailContinue() }}
                  placeholder="your@email.com"
                  className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm"
                />
                <button
                  onClick={handleEmailContinue}
                  className="px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors"
                >
                  Continue →
                </button>
              </div>

              <p className="text-center text-xs text-slate-400">
                Already have an account?{' '}
                <button
                  onClick={() => { sessionStorage.setItem('sw_pending_brief', brief._id); navigate('/login?tab=signin') }}
                  className="text-brand-600 font-semibold hover:underline"
                >
                  Sign in
                </button>
              </p>
            </div>
          </>
        )}
        <button
          onClick={onBack}
          className="w-full py-3 border border-slate-200 text-slate-600 font-semibold rounded-2xl hover:bg-slate-50 transition-colors"
        >
          Back to Subject
        </button>
      </div>
    </motion.div>
  )
}

// ── Main component ────────────────────────────────────────────────────────
export default function BriefReader() {
  const { briefId }    = useParams()
  const navigate       = useNavigate()
  const { user, API, awardAircoins, setUser } = useAuth()
  const { start }      = useAppTutorial()
  const { settings }            = useAppSettings()
  const [brief, setBrief]       = useState(null)
  const [loading, setLoading]   = useState(true)
  const [locked, setLocked]     = useState(false)
  const [lockedCategory, setLockedCategory] = useState(null)
  const [sectionIdx, setSection] = useState(() => {
    const saved = sessionStorage.getItem(`sw_brief_sec_${briefId}`)
    return saved ? parseInt(saved, 10) : 0
  })
  const [isFirstCompletion, setIsFirstCompletion] = useState(false)
  const [done, setDone]          = useState(() => {
    const justCompleted = sessionStorage.getItem('sw_brief_just_completed')
    if (justCompleted === briefId) {
      sessionStorage.removeItem('sw_brief_just_completed')
      return true
    }
    return false
  })
  const [activeKw, setActiveKw]    = useState(null)
  const [learnedKws, setLearned]   = useState(new Set())
  const [readRecord, setReadRecord] = useState(null)
  // 'unavailable' | 'locked-quiz' | 'available'
  const [booState, setBooState] = useState('unavailable')
  const [navDir, setNavDir]        = useState(1) // 1 = forward, -1 = backward
  const markingRef                 = useRef(false)
  const contentRef                 = useRef(null)
  const briefOpenedRef             = useRef(false)
  const accSecondsRef              = useRef(0)
  const lastTickRef                = useRef(null)

  const BOO_CATEGORIES = ['Aircrafts', 'Ranks', 'Training', 'Missions', 'Tech', 'Treaties']

  // Flush accumulated read time to the server
  const flushTime = useCallback(() => {
    const secs = Math.round(accSecondsRef.current)
    if (!user || secs < 1 || !brief) return
    accSecondsRef.current = 0
    fetch(`${API}/api/briefs/${briefId}/time`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds: secs }),
    }).catch(() => {})
  }, [user, brief, briefId, API])

  // Accumulate read time while the user is on the page reading
  useEffect(() => {
    if (!user || loading || !brief || done) return

    lastTickRef.current   = Date.now()
    accSecondsRef.current = 0

    const tick = () => {
      if (document.hidden) return
      const now   = Date.now()
      const delta = (now - (lastTickRef.current ?? now)) / 1000
      lastTickRef.current = now
      // Ignore gaps > 2 min (tab suspended / device slept)
      if (delta > 0 && delta < 120) accSecondsRef.current += delta
    }

    const interval = setInterval(() => { tick(); flushTime() }, 10_000)

    const onVisibility = () => {
      if (document.hidden) { tick(); flushTime() }
      else lastTickRef.current = Date.now()
    }

    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      tick()
      flushTime()
    }
  }, [user, loading, brief, done, flushTime])

  useEffect(() => {
    fetch(`${API}/api/briefs/${briefId}`, { credentials: 'include' })
      .then(r => {
        if (r.status === 403) {
          r.json().then(d => setLockedCategory(d?.category ?? null)).catch(() => {})
          setLocked(true); return null
        }
        return r.json()
      })
      .then(data => {
        if (data?.data?.brief) setBrief(data.data.brief)
        if (data?.data?.readRecord) setReadRecord(data.data.readRecord)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [briefId, API])

  // Fire coin notification if we arrived here after a post-login brief completion
  useEffect(() => {
    const raw = sessionStorage.getItem('sw_brief_coins')
    if (!raw) return
    sessionStorage.removeItem('sw_brief_coins')
    try {
      const d           = JSON.parse(raw)
      const briefCoins  = d.aircoinsEarned  ?? 0
      const dailyCoins  = d.dailyCoinsEarned ?? 0
      const totalEarned = briefCoins + dailyCoins
      if (totalEarned > 0) {
        awardAircoins(totalEarned, dailyCoins > 0 ? 'Daily Brief' : 'Brief read', {
          cycleAfter:    d.newCycleAircoins,
          totalAfter:    d.newTotalAircoins,
          rankPromotion: d.rankPromotion ?? null,
        })
      }
      if (d.loginStreak !== undefined) {
        setUser(u => u ? {
          ...u,
          loginStreak:    d.loginStreak,
          lastStreakDate: d.lastStreakDate ?? u.lastStreakDate,
        } : u)
      }
    } catch { /* malformed — skip */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Check BOO availability + quiz prerequisite once the completion screen is shown
  useEffect(() => {
    if (!done || !brief || !user || !BOO_CATEGORIES.includes(brief.category)) return
    let cancelled = false
    async function checkBoo() {
      try {
        const [booRes, quizRes] = await Promise.all([
          fetch(`${API}/api/games/battle-of-order/options?briefId=${briefId}`, { credentials: 'include' }),
          fetch(`${API}/api/games/quiz/status/${briefId}`,                     { credentials: 'include' }),
        ])
        const [booData, quizData] = await Promise.all([booRes.json(), quizRes.json()])
        if (cancelled) return
        const booAvail   = booData.data?.available    ?? false
        const quizPassed = quizData.data?.hasCompleted ?? false
        if      (!booAvail)   setBooState('unavailable')
        else if (!quizPassed) setBooState('locked-quiz')
        else                  setBooState('available')
      } catch { /* silently ignore */ }
    }
    checkBoo()
    return () => { cancelled = true }
  }, [done, brief, user, briefId, API]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tutorial on first visit
  useEffect(() => {
    if (!loading && brief && !briefOpenedRef.current && !done) {
      briefOpenedRef.current = true
      playSound('intel_brief_opened')
      const t = setTimeout(() => start('briefReader'), 800)
      return () => clearTimeout(t)
    }
  }, [loading, brief]) // eslint-disable-line react-hooks/exhaustive-deps

  const sections = brief?.descriptionSections?.filter(Boolean) ?? []
  const total    = sections.length
  const isLast   = sectionIdx >= total - 1

  const markRead = useCallback(() => {
    if (markingRef.current || !user) return
    markingRef.current = true
  }, [briefId, user])

  const handleGoBack = () => {
    if (sectionIdx <= 0) return
    setNavDir(-1)
    setSection(i => {
      const prev = i - 1
      sessionStorage.setItem(`sw_brief_sec_${briefId}`, String(prev))
      return prev
    })
    contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleContinue = () => {
    if (isLast) {
      const first = !localStorage.getItem('skywatch_first_brief')
      if (first) localStorage.setItem('skywatch_first_brief', '1')
      setIsFirstCompletion(first)
      if (!user) playSound('first_brief_complete')
      markRead()
      sessionStorage.removeItem(`sw_brief_sec_${briefId}`)
      setDone(true)
      // Award coins now that the user has finished reading
      if (user) {
        fetch(`${API}/api/briefs/${briefId}/complete`, {
          method: 'POST',
          credentials: 'include',
        })
          .then(r => r.json())
          .then(data => {
            const briefCoins = data?.data?.aircoinsEarned ?? 0
            const dailyCoins = data?.data?.dailyCoinsEarned ?? 0
            const totalEarned = briefCoins + dailyCoins
            if (totalEarned > 0) {
              awardAircoins(totalEarned, dailyCoins > 0 ? 'Daily Brief' : 'Brief read', {
                cycleAfter:    data.data.newCycleAircoins,
                totalAfter:    data.data.newTotalAircoins,
                rankPromotion: data.data.rankPromotion ?? null,
              })
            }
            if (data?.data?.loginStreak !== undefined) {
              setUser(u => u ? {
                ...u,
                loginStreak:    data.data.loginStreak,
                lastStreakDate: data.data.lastStreakDate ?? u.lastStreakDate,
              } : u)
            }
          })
          .catch(() => {})
      }
    } else {
      setNavDir(1)
      setSection(i => {
        const next = i + 1
        sessionStorage.setItem(`sw_brief_sec_${briefId}`, String(next))
        return next
      })
      contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const handleKeywordTap = (kw) => {
    if (kw) playSound('target_locked_keyword')
    setActiveKw(kw)
    if (kw) setLearned(s => new Set([...s, kw.keyword.toLowerCase()]))
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 bg-slate-200 rounded-xl w-1/2" />
        <div className="h-4 bg-slate-100 rounded w-3/4" />
        <div className="h-32 bg-slate-100 rounded-2xl" />
      </div>
    )
  }

  if (locked) {
    return (
      <>
        <button
          onClick={() => navigate('/learn')}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
        >
          ← Back
        </button>
        <LockedCategoryModal
          category={lockedCategory ?? ''}
          tier={lockedCategory ? requiredTier(lockedCategory, settings) : 'silver'}
          user={user}
          onClose={() => navigate('/learn')}
        />
      </>
    )
  }

  if (!brief) {
    return (
      <div className="text-center py-16 text-slate-400">
        <div className="text-4xl mb-3">📭</div>
        <p>Brief not found.</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-brand-600 font-semibold">← Go back</button>
      </div>
    )
  }

  return (
    <>
      <TutorialModal />
      <KeywordSheet kw={activeKw} onClose={() => { playSound('stand_down'); setActiveKw(null) }} />

      {/* Back */}
      <button
        onClick={() => navigate(`/learn/${encodeURIComponent(brief.category)}`)}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
      >
        ← {brief.category}
      </button>

      {/* Brief header */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full border border-brand-200">
            {brief.category}
          </span>
          {brief.subcategory && (
            <span className="text-xs text-slate-400 font-medium">{brief.subcategory}</span>
          )}
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 leading-tight">{brief.title}</h1>
        {brief.subtitle && (
          <p className="text-sm text-slate-500 mt-1.5">{brief.subtitle}</p>
        )}
      </div>

      {/* BOO stats */}
      <BooStatsPanel brief={brief} />

      {/* Cover image */}
      {brief.media?.[0]?.mediaUrl && (
        <div className="rounded-2xl overflow-hidden mb-5 aspect-video bg-slate-100">
          <img
            src={brief.media[0].mediaUrl.startsWith('/') ? `${API}${brief.media[0].mediaUrl}` : brief.media[0].mediaUrl}
            alt={brief.title}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Completion screen */}
      {done ? (
        <CompletionScreen
          brief={brief}
          user={user}
          isFirstCompletion={isFirstCompletion}
          coinReward={settings?.aircoinsPerBriefRead ?? 5}
          onQuiz={() => navigate(`/quiz/${briefId}`)}
          booState={booState}
          onBattleOrder={booState === 'available' ? () => navigate(`/battle-of-order/${briefId}`) : null}
          onBack={() => navigate(`/learn/${encodeURIComponent(brief.category)}`)}
        />
      ) : (
        <>
          <div ref={contentRef} />
          {/* Section progress bar */}
          {total > 1 && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-500">
                  Section {sectionIdx + 1} of {total}
                </span>
                <span className="text-xs text-slate-400">
                  {Math.round(((sectionIdx + 1) / total) * 100)}% through
                </span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-brand-500 rounded-full"
                  animate={{ width: `${((sectionIdx + 1) / total) * 100}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
              {/* Dot indicators */}
              <div className="flex gap-1.5 mt-2 justify-center">
                {sections.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${
                      i < sectionIdx       ? 'bg-emerald-500 w-3' :
                      i === sectionIdx     ? 'bg-brand-600 w-4'   :
                                             'bg-slate-200 w-1.5'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Section content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={sectionIdx}
              initial={{ opacity: 0, x: navDir * 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: navDir * -20 }}
              transition={{ duration: 0.25 }}
              className="bg-surface rounded-2xl p-5 border border-slate-200 mb-4 card-shadow"
            >
              <SectionText
                text={sections[sectionIdx]}
                keywords={brief.keywords}
                learnedKws={learnedKws}
                onKeywordTap={handleKeywordTap}
              />
            </motion.div>
          </AnimatePresence>

          {/* Keyword hint */}
          {brief.keywords?.some(kw =>
            sections[sectionIdx]?.toLowerCase().includes(kw.keyword.toLowerCase())
          ) && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-xs text-brand-500 text-center mb-4"
            >
              💡 Tap a <span className="font-semibold text-brand-600">blue word</span> to learn its meaning
            </motion.p>
          )}

          {/* Continue / Back buttons */}
          <div className="flex gap-3">
            {sectionIdx > 0 && (
              <button
                onClick={handleGoBack}
                aria-label="Previous section"
                className="py-4 px-5 border border-slate-200 text-slate-500 font-semibold rounded-2xl hover:bg-slate-50 transition-colors"
              >
                ←
              </button>
            )}
            <motion.button
              onClick={handleContinue}
              whileTap={{ scale: 0.97 }}
              className="flex-1 py-4 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-bold rounded-2xl text-base transition-colors shadow-lg shadow-brand-200"
            >
              {isLast
                ? (user && !readRecord?.coinsAwarded
                    ? '⭐ Complete Brief & Collect Aircoins'
                    : '✓ Complete Brief')
                : 'Continue →'
              }
            </motion.button>
          </div>

          {/* Sources */}
          {brief.sources?.length > 0 && (
            <div className="mt-6 pt-4 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Sources</p>
              <div className="space-y-1">
                {brief.sources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-brand-600 hover:underline truncate"
                  >
                    {s.siteName || s.url}
                    {s.articleDate && <span className="text-slate-400 ml-1">· {s.articleDate}</span>}
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
