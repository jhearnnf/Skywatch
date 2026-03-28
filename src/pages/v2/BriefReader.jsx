import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppTutorial } from '../../context/AppTutorialContext'
import TutorialModal from '../../components/tutorial/TutorialModal'
import LockedCategoryModal from '../../components/LockedCategoryModal'
import MissionDetectedModal from '../../components/MissionDetectedModal'
import { requiredTier } from '../../utils/subscription'
import { useAppSettings } from '../../context/AppSettingsContext'
import { playSound } from '../../utils/sound'

// ── Keyword bottom-sheet ──────────────────────────────────────────────────
function KeywordSheet({ kw, onClose, navigate }) {
  const isLinked = !!kw?.linkedBriefId

  const handleOpenBrief = () => {
    onClose()
    navigate(`/brief/${kw.linkedBriefId}`)
  }

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
              <span className="text-3xl">{isLinked ? '📋' : '🔑'}</span>
              <div>
                <h3 className="text-lg font-extrabold text-slate-900 mb-1">{kw.keyword}</h3>
                {isLinked ? (
                  <p className="text-sm text-slate-600 leading-relaxed">
                    This subject has its own Intel Brief. Open it to learn more.
                  </p>
                ) : (
                  <p className="text-sm text-slate-600 leading-relaxed">{kw.generatedDescription}</p>
                )}
              </div>
            </div>

            {isLinked ? (
              <div className="mt-5 flex flex-col gap-2">
                <button
                  onClick={handleOpenBrief}
                  className="w-full py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold transition-colors"
                >
                  Open Intel Brief →
                </button>
                <button
                  onClick={onClose}
                  className="w-full py-2 rounded-2xl text-slate-500 text-sm font-semibold hover:text-slate-700 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            ) : (
              <button
                onClick={onClose}
                className="mt-5 w-full py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold transition-colors"
              >
                Got it ✓
              </button>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Media carousel ────────────────────────────────────────────────────────
function MediaCarousel({ media, title, API }) {
  const [idx, setIdx] = useState(0)
  const images = media.filter(m => m?.cloudinaryPublicId)
  if (!images.length) return null
  const src = images[idx].mediaUrl
  const multi = images.length > 1
  return (
    <div className="relative rounded-2xl overflow-hidden mb-5 aspect-video bg-slate-100 group">
      <img src={src} alt={title} className="w-full h-full object-cover" />
      {multi && (
        <>
          <button
            onClick={() => setIdx(i => (i - 1 + images.length) % images.length)}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-colors"
            aria-label="Previous image"
          >‹</button>
          <button
            onClick={() => setIdx(i => (i + 1) % images.length)}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-colors"
            aria-label="Next image"
          >›</button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${i === idx ? 'bg-white' : 'bg-white/40'}`}
                aria-label={`Image ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
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
    <div className="bg-brand-100 border border-brand-200 rounded-xl px-3 py-2.5">
      <span className="text-[9px] font-bold uppercase tracking-widest text-brand-500 block mb-1">{label}</span>
      <span className="text-sm font-bold text-text leading-tight">{value}</span>
    </div>
  )
}

function BriefPill({ b, navigate }) {
  const isStub = b.status === 'stub'
  return (
    <button
      onClick={() => navigate(`/brief/${b._id}`)}
      className={`text-xs font-semibold px-2.5 py-1 rounded-full transition-all ${
        isStub
          ? 'bg-slate-200 text-slate-500 opacity-50 hover:opacity-70'
          : 'bg-brand-200 text-brand-700 hover:bg-brand-300 hover:text-brand-800'
      }`}
    >
      {isStub ? `🔒 ${b.title}` : b.title}
    </button>
  )
}

function BooStatsPanel({ brief, navigate }) {
  const gd  = brief.gameData ?? {}
  const cat = brief.category

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
  } else if (['Bases', 'Squadrons', 'Threats'].includes(cat)) {
    const L = {
      Bases:     { start: 'Opened',     active: 'Active',     closed: 'Closed'    },
      Squadrons: { start: 'Formed',     active: 'Active',     closed: 'Disbanded' },
      Threats:   { start: 'Introduced', active: 'In Service', closed: 'Retired'   },
    }[cat]
    if (gd.startYear != null)
      stats.push({ label: L.start, value: String(gd.startYear) })
    if (gd.startYear != null)
      stats.push({ label: 'Status', value: gd.endYear != null ? `${L.closed} ${gd.endYear}` : L.active })
  }

  // Typed relationship sections per category
  const bases     = (brief.associatedBaseBriefIds     ?? []).filter(b => b?._id)
  const squadrons = (brief.associatedSquadronBriefIds ?? []).filter(b => b?._id)
  const aircraft  = (brief.associatedAircraftBriefIds ?? []).filter(b => b?._id)
  const missions  = (brief.associatedMissionBriefIds  ?? []).filter(b => b?._id)
  const training  = (brief.associatedTrainingBriefIds ?? []).filter(b => b?._id)
  const related         = (brief.relatedBriefIds ?? []).filter(b => b?._id)
  const historicRelated = (brief.relatedHistoric ?? []).filter(b => b?._id)

  const sections = []
  if (['Aircrafts', 'Squadrons'].includes(cat) && bases.length > 0)
    sections.push({ label: `🗺️ Home Base${bases.length > 1 ? 's' : ''}`, items: bases })
  if (['Bases', 'Aircrafts'].includes(cat) && squadrons.length > 0)
    sections.push({ label: '✈️ Squadrons', items: squadrons })
  if (['Bases', 'Squadrons', 'Tech'].includes(cat) && aircraft.length > 0)
    sections.push({ label: '🛩️ Aircraft', items: aircraft })
  if (['Aircrafts', 'Squadrons'].includes(cat) && missions.length > 0)
    sections.push({ label: '🎖️ Missions', items: missions })
  if (['Roles'].includes(cat) && training.length > 0)
    sections.push({ label: '🎓 Training', items: training })
  if (related.length > 0)
    sections.push({ label: '🔗 Related', items: related })
  if (['Bases', 'Squadrons', 'Missions', 'AOR'].includes(cat) && historicRelated.length > 0)
    sections.push({ label: '🏛️ Historic Intelligence', items: historicRelated, historic: true })

  if (stats.length === 0 && sections.length === 0) return null

  return (
    <div className="bg-surface-raised border border-brand-200 rounded-2xl px-4 py-4 mb-5">
      {stats.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-0.5 h-3.5 bg-brand-400 rounded-full" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-brand-500">Intel Stats</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {stats.map(s => <StatRow key={s.label} label={s.label} value={s.value} />)}
          </div>
        </>
      )}
      {sections.map((sec, i) => (
        <div key={sec.label} className={stats.length > 0 || i > 0 ? 'mt-4 pt-4 border-t border-brand-200' : ''}>
          <span className={`text-[10px] font-bold uppercase tracking-widest block mb-2 ${sec.historic ? 'text-amber-600' : 'text-brand-500'}`}>{sec.label}</span>
          <div className="flex flex-wrap gap-1.5">
            {sec.items.map(b => <BriefPill key={b._id} b={b} navigate={navigate} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Continue Learning cards ───────────────────────────────────────────────
function ContinueLearning({ brief, navigate }) {
  const seen = new Set()
  const cards = [
    ...(brief.associatedBaseBriefIds     ?? []),
    ...(brief.associatedSquadronBriefIds ?? []),
    ...(brief.associatedAircraftBriefIds ?? []),
    ...(brief.associatedMissionBriefIds  ?? []),
    ...(brief.associatedTrainingBriefIds ?? []),
    ...(brief.relatedBriefIds            ?? []),
  ]
    .filter(b => b?._id && !seen.has(String(b._id)) && seen.add(String(b._id)))
    .sort((a, b) => (a.status === 'stub' ? 1 : 0) - (b.status === 'stub' ? 1 : 0))
    .slice(0, 5)

  if (cards.length === 0) return null

  return (
    <div className="bg-surface rounded-2xl p-4 border border-slate-200 mb-6 card-shadow">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
        📡 Continue Learning
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {cards.map(b => (
          <button
            key={b._id}
            onClick={() => navigate(`/brief/${b._id}`)}
            className="shrink-0 flex flex-col gap-1 p-3 rounded-xl border border-slate-200 hover:border-brand-300 hover:bg-brand-50 transition-all text-left w-36"
          >
            <span className="text-[10px] font-bold text-brand-600 uppercase tracking-wide">
              {b.category}
            </span>
            <span className={`text-xs font-semibold leading-tight ${b.status === 'stub' ? 'text-slate-400' : 'text-slate-700'}`}>
              {b.status === 'stub' ? `🔒 ${b.title}` : b.title}
            </span>
            {b.status === 'stub' && (
              <span className="text-[10px] text-slate-400 font-medium">Coming soon</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Completion screen ─────────────────────────────────────────────────────
function CompletionScreen({ brief, onQuiz, booState, onBattleOrder, onBack, user, isFirstCompletion, coinReward, navigate }) {
  const { API, setUser, awardAircoins } = useAuth()
  const [email, setEmail] = useState('')
  const googleBtnRef     = useRef(null)

  // Google One Tap + inline button — guests only
  useEffect(() => {
    if (user) return
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId || !window.google) return

    const handleCredential = async (response) => {
      try {
        // 1. Authenticate
        const authRes  = await fetch(`${API}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ credential: response.credential }),
        })
        const authData = await authRes.json()
        if (!authData?.data?.user) return
        setUser(authData.data.user)

        // 2. Complete the brief now that we're authenticated — cookie is set by the auth response above
        const completeRes  = await fetch(`${API}/api/briefs/${brief._id}/complete`, {
          method: 'POST', credentials: 'include',
        })
        const completeData = await completeRes.json()

        // 3. Award coins directly — no navigation needed, we're already on the completion screen
        if (completeRes.ok && completeData?.data) {
          const d     = completeData.data
          const total = (d.aircoinsEarned ?? 0) + (d.dailyCoinsEarned ?? 0)
          if (total > 0) {
            awardAircoins(total, d.dailyCoinsEarned > 0 ? 'Daily Brief' : 'Brief read', {
              cycleAfter:    d.newCycleAircoins,
              totalAfter:    d.newTotalAircoins,
              rankPromotion: d.rankPromotion ?? null,
            })
          }
        }
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
    localStorage.setItem('sw_pending_brief', brief._id)
    navigate(`/login?tab=register&pendingBrief=${brief._id}${email ? `&email=${encodeURIComponent(email)}` : ''}`)
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

      {/* Continue Learning */}
      <ContinueLearning brief={brief} navigate={navigate} />

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
                  onClick={() => { localStorage.setItem('sw_pending_brief', brief._id); navigate(`/login?tab=signin&pendingBrief=${brief._id}`) }}
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

// ── Already-read screen ──────────────────────────────────────────────────
const BOO_CATS = ['Aircrafts', 'Ranks', 'Training', 'Missions', 'Tech', 'Treaties']

function AlreadyReadScreen({ brief, quizPassed, booState, onReRead, navigate }) {
  const showBoo    = BOO_CATS.includes(brief.category)
  const booVisible = showBoo && booState !== 'unavailable'

  return (
    <div>
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
        {brief.nickname && (
          <p className="text-sm text-slate-400 italic mt-0.5">"{brief.nickname}"</p>
        )}
        {brief.subtitle && (
          <p className="text-sm text-slate-500 mt-1.5">{brief.subtitle}</p>
        )}
      </div>

      {/* Read badge / re-read */}
      <button
        onClick={onReRead}
        className="w-full flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 mb-6 hover:bg-emerald-100 hover:border-emerald-300 transition-colors text-left cursor-pointer"
      >
        <span className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
          <span className="text-white text-xs font-bold">✓</span>
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-emerald-800">Intel brief classified as read</p>
          <p className="text-xs text-emerald-600">You've completed this brief before</p>
        </div>
        <span className="text-xs font-semibold text-emerald-700 shrink-0">↩ Re-read →</span>
      </button>

      {/* Game cards */}
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Test your knowledge</p>
      <div className="space-y-3 mb-6">

        {/* Quiz card */}
        {quizPassed === null ? (
          <div className="h-20 bg-slate-100 rounded-2xl animate-pulse" />
        ) : (
          <button
            onClick={() => navigate(`/quiz/${brief._id}`)}
            className={`w-full text-left flex items-center gap-4 p-4 rounded-2xl border transition-all group cursor-pointer
              ${quizPassed
                ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-300'
                : 'bg-surface border-slate-200 hover:border-brand-300 hover:bg-brand-50 card-shadow hover:card-shadow-hover'
              }`}
          >
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-xl
              ${quizPassed ? 'bg-emerald-100' : 'bg-brand-100'}`}
            >
              🧠
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-slate-800">Intel Quiz</p>
              <p className={`text-xs mt-0.5 ${quizPassed ? 'text-emerald-600' : 'text-slate-400'}`}>
                {quizPassed ? '✓ Passed' : 'Test your understanding of this brief'}
              </p>
            </div>
            <span className={`text-sm font-bold shrink-0 ${quizPassed ? 'text-emerald-600' : 'text-brand-600 group-hover:text-brand-700'}`}>
              {quizPassed ? 'Replay →' : 'Take Quiz →'}
            </span>
          </button>
        )}

        {/* BOO card */}
        {booVisible && quizPassed !== null && (
          booState === 'completed' ? (
            <button
              onClick={() => navigate(`/battle-of-order/${brief._id}`)}
              className="w-full text-left flex items-center gap-4 p-4 rounded-2xl border bg-emerald-50 border-emerald-200 hover:border-emerald-300 transition-all group cursor-pointer"
            >
              <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0 text-xl">
                🗺️
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-slate-800">Battle of Order</p>
                <p className="text-xs text-emerald-600 mt-0.5">✓ Completed</p>
              </div>
              <span className="text-sm font-bold text-emerald-600 shrink-0">Replay →</span>
            </button>
          ) : booState === 'available' ? (
            <button
              onClick={() => navigate(`/battle-of-order/${brief._id}`)}
              className="w-full text-left flex items-center gap-4 p-4 rounded-2xl border bg-surface border-slate-200 hover:border-brand-300 hover:bg-brand-50 transition-all group card-shadow hover:card-shadow-hover cursor-pointer"
            >
              <div className="w-11 h-11 rounded-xl bg-brand-100 flex items-center justify-center shrink-0 text-xl">
                🗺️
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-slate-800">Battle of Order</p>
                <p className="text-xs text-slate-400 mt-0.5">Rank and order {brief.category.toLowerCase()} by performance data</p>
              </div>
              <span className="text-sm font-bold text-brand-600 group-hover:text-brand-700 shrink-0">Play →</span>
            </button>
          ) : (
            <div className="flex items-center gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50 opacity-60">
              <div className="w-11 h-11 rounded-xl bg-slate-200 flex items-center justify-center shrink-0 text-xl">
                🗺️
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-slate-500">Battle of Order</p>
                <p className="text-xs text-slate-400 mt-0.5">Pass the quiz to unlock</p>
              </div>
              <span className="text-xs font-semibold text-slate-400 shrink-0">🔒 Locked</span>
            </div>
          )
        )}
      </div>

    </div>
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
  const [done, setDone]          = useState(
    () => sessionStorage.getItem('sw_brief_just_completed') === briefId
  )
  const [activeKw, setActiveKw]    = useState(null)
  const [learnedKws, setLearned]   = useState(new Set())
  const [readRecord, setReadRecord] = useState(null)
  // 'unavailable' | 'locked-quiz' | 'available'
  const [booState, setBooState]   = useState('unavailable')
  const [quizPassed, setQuizPassed] = useState(null) // null=loading, true/false once fetched
  const [reReadMode, setReReadMode] = useState(false)
  const [missionData,       setMissionData]       = useState(null)  // spawn-check result when spawn: true
  const [spawnCheckPending, setSpawnCheckPending] = useState(false) // true while spawn-check is in-flight
  const [wtaSpawn,          setWtaSpawn]          = useState(null)  // { remaining, prereqsMet } from API
  const [navDir, setNavDir]        = useState(1) // 1 = forward, -1 = backward
  const markingRef                 = useRef(false)
  const contentRef                 = useRef(null)
  const briefOpenedRef             = useRef(false)
  const accSecondsRef              = useRef(0)
  const lastTickRef                = useRef(null)

  // Layer 2 safety net: if user navigated away before spawn modal appeared, restore it
  useEffect(() => {
    const pending = localStorage.getItem('pendingWtaGame')
    if (pending) {
      try { setMissionData(JSON.parse(pending)) } catch { localStorage.removeItem('pendingWtaGame') }
    }
  }, [])

  const BOO_CATEGORIES = BOO_CATS

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
    if (!user || loading || !brief || done || brief.status === 'stub') return

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

  // Fetch WTA spawn status whenever brief or user resolves — handles mobile where auth loads after brief
  useEffect(() => {
    if (!brief || brief.category !== 'Aircrafts' || !user) return
    fetch(`${API}/api/users/me/wta-spawn`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d?.data) setWtaSpawn(d.data) })
      .catch(() => {})
  }, [brief, user, API])

  // Clean up the sw_brief_just_completed signal after mount (kept out of the lazy
  // init to avoid render-phase side effects, which React can invoke multiple times)
  useEffect(() => {
    if (sessionStorage.getItem('sw_brief_just_completed') === briefId) {
      sessionStorage.removeItem('sw_brief_just_completed')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fire coin notification if we arrived here after a post-login brief completion.
  // Depends on [user] so it waits until auth resolves — prevents stale sessionStorage
  // from triggering a phantom notification when a logged-out user visits a brief.
  useEffect(() => {
    if (!user) return
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
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback: if user just logged in and this brief was the pending one, complete it
  // here rather than relying purely on the sessionStorage signal from consumePendingBrief
  useEffect(() => {
    if (!user || !brief) return
    const pendingId = localStorage.getItem('sw_pending_brief')
    if (!pendingId || pendingId !== String(brief._id)) return
    localStorage.removeItem('sw_pending_brief')
    fetch(`${API}/api/briefs/${brief._id}/complete`, { method: 'POST', credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (!data?.data) return
        const briefCoins  = data.data.aircoinsEarned  ?? 0
        const dailyCoins  = data.data.dailyCoinsEarned ?? 0
        const total = briefCoins + dailyCoins
        if (total > 0) {
          awardAircoins(total, dailyCoins > 0 ? 'Daily Brief' : 'Brief read', {
            cycleAfter:    data.data.newCycleAircoins,
            totalAfter:    data.data.newTotalAircoins,
            rankPromotion: data.data.rankPromotion ?? null,
          })
        }
        setDone(true)
      })
      .catch(() => {})
  }, [user, brief]) // eslint-disable-line react-hooks/exhaustive-deps

  // Check quiz status + BOO availability once the brief is completed (covers both
  // the fresh CompletionScreen and returning visits via the AlreadyReadScreen)
  useEffect(() => {
    if (!(done || readRecord?.completed) || !brief || !user) return
    let cancelled = false
    async function check() {
      try {
        const quizRes  = await fetch(`${API}/api/games/quiz/status/${briefId}`, { credentials: 'include' })
        const quizData = await quizRes.json()
        if (cancelled) return
        const passed = quizData.data?.hasCompleted ?? false
        setQuizPassed(passed)

        if (!BOO_CATEGORIES.includes(brief.category)) return
        const booRes  = await fetch(`${API}/api/games/battle-of-order/options?briefId=${briefId}`, { credentials: 'include' })
        const booData = await booRes.json()
        if (cancelled) return
        const booAvail = booData.data?.available ?? false
        if      (!booAvail) { setBooState('unavailable'); return }
        if      (!passed)   { setBooState('locked-quiz'); return }
        const statusRes  = await fetch(`${API}/api/games/battle-of-order/status/${briefId}`, { credentials: 'include' })
        const statusData = await statusRes.json()
        if (cancelled) return
        const booCompleted = statusData.data?.hasCompleted ?? false
        setBooState(booCompleted ? 'completed' : 'available')
      } catch { /* silently ignore */ }
    }
    check()
    return () => { cancelled = true }
  }, [done, readRecord?.completed, brief, user, briefId, API]) // eslint-disable-line react-hooks/exhaustive-deps

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
          .then(() => {
            // Spawn-check for Where's That Aircraft (Aircrafts category only)
            if (brief?.category !== 'Aircrafts') return
            const willSpawn = wtaSpawn?.prereqsMet && wtaSpawn?.remaining === 1
            if (willSpawn) setSpawnCheckPending(true)
            fetch(`${API}/api/games/wheres-aircraft/spawn-check`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ briefId }),
            })
              .then(r => r.json())
              .then(d => {
                setSpawnCheckPending(false)
                if (d?.data?.spawn) {
                  const data = {
                    aircraftBriefId: d.data.aircraftBriefId,
                    aircraftTitle:   d.data.aircraftTitle,
                    mediaUrl:        d.data.mediaUrl,
                  }
                  localStorage.setItem('pendingWtaGame', JSON.stringify(data))
                  setMissionData(data)
                }
              })
              .catch(() => { setSpawnCheckPending(false) })
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
          pendingBriefId={briefId}
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

  if (brief.status === 'stub') {
    return (
      <>
        <button
          onClick={() => navigate(`/learn/${encodeURIComponent(brief.category)}`)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
        >
          ← {brief.category}
        </button>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-bold bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full border border-brand-200">
            {brief.category}
          </span>
          {brief.subcategory && (
            <span className="text-xs text-slate-400 font-medium">{brief.subcategory}</span>
          )}
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 leading-tight mb-6">{brief.title}</h1>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900 rounded-2xl p-8 text-center"
        >
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-xl font-extrabold text-white mb-2 tracking-wide">
            Intelligence Surveillance Underway
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed max-w-xs mx-auto">
            Our analysts are currently compiling this brief. Check back here soon for the full intelligence report.
          </p>
          <div className="mt-6 flex justify-center">
            <motion.div
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              className="flex items-center gap-2 text-xs font-bold tracking-[0.2em] text-red-400 uppercase"
            >
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
              Surveillance Active
            </motion.div>
          </div>
          {user?.isAdmin && (
            <button
              onClick={() => navigate('/admin', { state: { openLeads: true, leadsSearch: brief.title } })}
              className="mt-5 px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 transition-colors"
            >
              ✦ Generate Brief →
            </button>
          )}
        </motion.div>
        <button
          onClick={() => navigate(`/learn/${encodeURIComponent(brief.category)}`)}
          className="mt-5 w-full py-3 border border-slate-200 text-slate-600 font-semibold rounded-2xl hover:bg-slate-50 transition-colors"
        >
          ← Back to {brief.category}
        </button>
      </>
    )
  }

  if (!sections.length && !done) {
    return (
      <>
        <button
          onClick={() => navigate(`/learn/${encodeURIComponent(brief.category)}`)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
        >
          ← {brief.category}
        </button>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-bold bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full border border-brand-200">
            {brief.category}
          </span>
          {brief.subcategory && (
            <span className="text-xs text-slate-400 font-medium">{brief.subcategory}</span>
          )}
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 leading-tight mb-6">{brief.title}</h1>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900 rounded-2xl p-8 text-center"
        >
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-xl font-extrabold text-white mb-2 tracking-wide">
            Intelligence Surveillance Underway
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed max-w-xs mx-auto">
            Our analysts are currently compiling this brief. Check back here soon for the full intelligence report.
          </p>
          <div className="mt-6 flex justify-center">
            <motion.div
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              className="flex items-center gap-2 text-xs font-bold tracking-[0.2em] text-red-400 uppercase"
            >
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
              Surveillance Active
            </motion.div>
          </div>
          {user?.isAdmin && (
            <button
              onClick={() => navigate('/admin', { state: { openLeads: true, leadsSearch: brief.title } })}
              className="mt-5 px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 transition-colors"
            >
              ✦ Generate Brief →
            </button>
          )}
        </motion.div>
        <button
          onClick={() => navigate(`/learn/${encodeURIComponent(brief.category)}`)}
          className="mt-5 w-full py-3 border border-slate-200 text-slate-600 font-semibold rounded-2xl hover:bg-slate-50 transition-colors"
        >
          ← Back to {brief.category}
        </button>
      </>
    )
  }

  // Already-read screen: shown when returning to a previously completed brief
  if (readRecord?.completed && user && !reReadMode && !done) {
    return (
      <AlreadyReadScreen
        brief={brief}
        quizPassed={quizPassed}
        booState={booState}
        onReRead={() => setReReadMode(true)}
        navigate={navigate}
      />
    )
  }

  return (
    <>
      <TutorialModal />
      <KeywordSheet kw={activeKw} onClose={() => { playSound('stand_down'); setActiveKw(null) }} navigate={navigate} />

      {/* Layer 1: block navigation while spawn-check is in-flight */}
      {spawnCheckPending && (
        <motion.div
          key="spawn-check-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[300] bg-slate-950/85 flex flex-col items-center justify-center gap-5 pointer-events-all"
        >
          <motion.div
            animate={{ scale: [1, 1.5, 1], opacity: [0.6, 0.1, 0.6] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            className="w-14 h-14 rounded-full border-2 border-red-500"
          />
          <p className="text-xs font-bold tracking-[0.3em] text-red-400 uppercase">
            Incoming message
          </p>
        </motion.div>
      )}

      {/* Where's That Aircraft — mission spawn */}
      {missionData && (
        <MissionDetectedModal
          aircraftBriefId={missionData.aircraftBriefId}
          aircraftTitle={missionData.aircraftTitle}
          mediaUrl={missionData.mediaUrl}
          onAccept={() => localStorage.removeItem('pendingWtaGame')}
          onDismiss={() => { localStorage.removeItem('pendingWtaGame'); setMissionData(null) }}
        />
      )}

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
        {brief.nickname && (
          <p className="text-sm text-slate-400 italic mt-0.5">"{brief.nickname}"</p>
        )}
        {brief.subtitle && (
          <p className="text-sm text-slate-500 mt-1.5">{brief.subtitle}</p>
        )}
      </div>

      {/* BOO stats */}
      <BooStatsPanel brief={brief} navigate={navigate} />

      {/* Cover image(s) */}
      {brief.media?.[0]?.mediaUrl && (
        <MediaCarousel media={brief.media} title={brief.title} API={API} />
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
          navigate={navigate}
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
                    {s.articleDate && <span className="text-slate-400 ml-1">· {new Date(s.articleDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
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
