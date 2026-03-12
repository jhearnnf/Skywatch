import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppTutorial } from '../../context/AppTutorialContext'
import TutorialModal from '../../components/tutorial/TutorialModal'
import UpgradePrompt from '../../components/UpgradePrompt'
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

// ── Completion screen ─────────────────────────────────────────────────────
function CompletionScreen({ brief, onQuiz, onBack }) {
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
      <h2 className="text-2xl font-extrabold text-slate-900 mb-2">Brief Complete!</h2>
      <p className="text-slate-500 mb-8">You've read all sections of this brief.</p>

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
        <button
          onClick={onQuiz}
          className="w-full py-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-lg transition-colors shadow-lg shadow-brand-200"
        >
          🎮 Take the Quiz → Earn Aircoins
        </button>
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
  const { user, API }  = useAuth()
  const { start }      = useAppTutorial()
  const [brief, setBrief]       = useState(null)
  const [loading, setLoading]   = useState(true)
  const [locked, setLocked]     = useState(false)
  const [sectionIdx, setSection] = useState(() => {
    const saved = sessionStorage.getItem(`sw_brief_sec_${briefId}`)
    return saved ? parseInt(saved, 10) : 0
  })
  const [done, setDone]          = useState(false)
  const [activeKw, setActiveKw]  = useState(null)
  const [learnedKws, setLearned] = useState(new Set())
  const markingRef               = useRef(false)
  const briefOpenedRef           = useRef(false)

  useEffect(() => {
    fetch(`${API}/api/briefs/${briefId}`, { credentials: 'include' })
      .then(r => {
        if (r.status === 403) { setLocked(true); return null }
        return r.json()
      })
      .then(data => {
        if (data?.data?.brief) setBrief(data.data.brief)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [briefId, API])

  // Tutorial on first visit
  useEffect(() => {
    if (!loading && brief && !briefOpenedRef.current) {
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
    // The GET /api/briefs/:id with credentials already creates the IntelligenceBriefRead record.
    // Stamp today's date so Home page can show "mission complete" (user-scoped).
    if (user?._id) localStorage.setItem(`sw_read_today_${user._id}`, new Date().toDateString())
  }, [briefId, user])

  const handleContinue = () => {
    if (isLast) {
      markRead()
      sessionStorage.removeItem(`sw_brief_sec_${briefId}`)
      setDone(true)
    } else {
      setSection(i => {
        const next = i + 1
        sessionStorage.setItem(`sw_brief_sec_${briefId}`, String(next))
        return next
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
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
        <UpgradePrompt variant="page" />
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

      {/* Cover image */}
      {brief.media?.[0]?.mediaUrl && (
        <div className="rounded-2xl overflow-hidden mb-5 aspect-video bg-slate-100">
          <img
            src={brief.media[0].mediaUrl.startsWith('/') ? `http://localhost:5000${brief.media[0].mediaUrl}` : brief.media[0].mediaUrl}
            alt={brief.title}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Completion screen */}
      {done ? (
        <CompletionScreen
          brief={brief}
          onQuiz={() => navigate(`/quiz/${briefId}`)}
          onBack={() => navigate(`/learn/${encodeURIComponent(brief.category)}`)}
        />
      ) : (
        <>
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
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
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

          {/* Continue button */}
          <motion.button
            onClick={handleContinue}
            whileTap={{ scale: 0.97 }}
            className="w-full py-4 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-bold rounded-2xl text-base transition-colors shadow-lg shadow-brand-200"
          >
            {isLast ? '✓ Complete Brief' : 'Continue →'}
          </motion.button>

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
