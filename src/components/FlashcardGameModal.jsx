import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useFlashcardBadge } from '../context/FlashcardBadgeContext'
import { playSound } from '../utils/sound'

const COUNT_OPTIONS = [5, 10, 15, 20]
const CARD_TIMER_SECONDS = 30

// ── Urgency timer bar ───────────────────────────────────────────────────────
function TimerBar({ seconds, total }) {
  const pct = Math.max(0, Math.min(100, (seconds / total) * 100))
  const color = pct > 50 ? '#f59e0b' : pct > 20 ? '#f97316' : '#ef4444'
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
      <div
        className="h-full rounded-full transition-all duration-1000 ease-linear"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}

// ── Typeahead input ─────────────────────────────────────────────────────────
function TitleSearch({ allTitles, onSelect, disabled }) {
  const [query,       setQuery]       = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [open,        setOpen]        = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { setQuery(''); setSuggestions([]); setOpen(false) }, [allTitles])
  useEffect(() => { if (!disabled && inputRef.current) inputRef.current.focus() }, [disabled])

  function handleChange(e) {
    const val = e.target.value
    setQuery(val)
    if (val.trim().length < 1) { setSuggestions([]); setOpen(false); return }
    const q = val.toLowerCase()
    const filtered = allTitles.filter(t => t.title.toLowerCase().includes(q)).slice(0, 8)
    setSuggestions(filtered)
    setOpen(filtered.length > 0)
  }

  function handleSelect(item) {
    setQuery(item.title)
    setSuggestions([])
    setOpen(false)
    onSelect(item)
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        disabled={disabled}
        placeholder="Type to search brief titles…"
        autoComplete="off"
        className="w-full px-4 py-3 rounded-2xl text-sm font-medium outline-none transition-all"
        style={{
          background: 'rgba(255,255,255,0.08)',
          border: '1.5px solid rgba(245,158,11,0.4)',
          color: '#f8fafc',
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        data-testid="flashcard-search"
      />
      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute z-50 left-0 right-0 mt-1 rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: '#0f2850', border: '1px solid rgba(245,158,11,0.3)' }}
            data-testid="flashcard-suggestions"
          >
            {suggestions.map(item => (
              <li
                key={item._id}
                onMouseDown={() => handleSelect(item)}
                className="px-4 py-3 text-sm font-medium cursor-pointer transition-colors"
                style={{ color: '#e2e8f0' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(245,158,11,0.15)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                data-testid="flashcard-suggestion-item"
              >
                {item.title}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main modal ──────────────────────────────────────────────────────────────
export default function FlashcardGameModal({ onClose }) {
  const { API, apiFetch, awardAircoins, refreshUser } = useAuth()
  const { clearBadge } = useFlashcardBadge()

  // screen: 'pick' | 'game' | 'result'
  const [screen,        setScreen]        = useState('pick')
  const [available,     setAvailable]     = useState(null)   // number of completed briefs
  const [selectedCount, setSelectedCount] = useState(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState('')

  // game state
  const [gameId,        setGameId]        = useState(null)
  const [gameSessionId, setGameSessionId] = useState(null)
  const [cards,         setCards]         = useState([])
  const [allTitles,     setAllTitles]     = useState([])
  const [cardIdx,       setCardIdx]       = useState(0)
  const [cardResults,   setCardResults]   = useState([])   // { intelBriefId, recalled, timeTakenSeconds }
  const [feedback,      setFeedback]      = useState(null) // { correct, correctTitle }
  const [timeLeft,      setTimeLeft]      = useState(CARD_TIMER_SECONDS)
  const [cardStart,     setCardStart]     = useState(null)
  const [submitting,    setSubmitting]    = useState(false)
  const [resultData,    setResultData]    = useState(null)
  const [expanded,      setExpanded]      = useState(new Set())

  const timerRef      = useRef(null)
  const gameFinished  = useRef(false)  // true once finishGame resolves or game reaches result screen
  const abandonSent   = useRef(false)  // guard against double-sending
  const timeoutFired  = useRef(false)  // guard against React double-invoking state updaters

  // Fetch available brief count on mount
  useEffect(() => {
    apiFetch(`${API}/api/games/flashcard-recall/available-briefs`)
      .then(r => r.json())
      .then(d => {
        const n = d?.data?.count ?? 0
        setAvailable(n)
        // Pre-select the largest valid count
        const valid = COUNT_OPTIONS.filter(c => c <= n)
        if (valid.length) setSelectedCount(valid[valid.length - 1])
      })
      .catch(() => setAvailable(0))
  }, [API])

  // Send abandon record — safe to call multiple times (guarded by ref)
  function sendAbandon(currentCardResults) {
    if (abandonSent.current || gameFinished.current || !gameId || !gameSessionId) return
    abandonSent.current = true
    clearBadge()
    apiFetch(`${API}/api/games/flashcard-recall/abandon`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, cardResults: currentCardResults, gameSessionId }),
    }).catch(() => {})
  }

  // Page refresh / tab close — sendBeacon survives unload
  useEffect(() => {
    if (screen !== 'game') return
    function handleUnload() {
      if (gameFinished.current || abandonSent.current || !gameId || !gameSessionId) return
      abandonSent.current = true
      const payload = JSON.stringify({ gameId, cardResults, gameSessionId })
      navigator.sendBeacon(
        `${API}/api/games/flashcard-recall/abandon`,
        new Blob([payload], { type: 'application/json' }),
      )
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [screen, gameId, gameSessionId, cardResults, API]) // eslint-disable-line react-hooks/exhaustive-deps

  // Component unmount mid-game (modal closed programmatically)
  useEffect(() => {
    return () => {
      if (screen === 'game') sendAbandon(cardResults)
    }
  }, [screen, cardResults]) // eslint-disable-line react-hooks/exhaustive-deps

  // Timer per card
  useEffect(() => {
    if (screen !== 'game' || feedback) { clearInterval(timerRef.current); return }
    timeoutFired.current = false
    setTimeLeft(CARD_TIMER_SECONDS)
    setCardStart(Date.now())
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current); handleTimeout(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [cardIdx, screen]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleTimeout = useCallback(() => {
    if (timeoutFired.current) return
    timeoutFired.current = true
    const card = cards[cardIdx]
    if (!card) return
    const elapsed = Math.round((Date.now() - (cardStart ?? Date.now())) / 1000)
    setFeedback({ correct: false, correctTitle: allTitles.find(t => t._id.toString() === card.intelBriefId.toString())?.title ?? '' })
    playSound('flashcard_incorrect')
    setCardResults(prev => [...prev, { intelBriefId: card.intelBriefId, recalled: false, timeTakenSeconds: elapsed }])
    setTimeout(() => advanceCard(), 1200)
  }, [cards, cardIdx, cardStart]) // eslint-disable-line react-hooks/exhaustive-deps

  function advanceCard() {
    setFeedback(null)
    setCardIdx(i => i + 1)
  }

  async function startGame() {
    if (!selectedCount) return
    setLoading(true)
    setError('')
    try {
      const res  = await apiFetch(`${API}/api/games/flashcard-recall/start`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: selectedCount }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.message || 'Failed to start game'); return }
      gameFinished.current = false
      abandonSent.current  = false
      setGameId(data.data.gameId)
      setGameSessionId(data.data.gameSessionId)
      setCards(data.data.cards)
      setAllTitles(data.data.allBriefTitles)
      setCardIdx(0)
      setCardResults([])
      setFeedback(null)
      setScreen('game')
      playSound('flashcard_start')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSelect(item) {
    clearInterval(timerRef.current)
    const card = cards[cardIdx]
    if (!card || feedback) return
    const elapsed   = Math.round((Date.now() - (cardStart ?? Date.now())) / 1000)
    const correct   = item._id.toString() === card.intelBriefId.toString()
    const correctTitle = allTitles.find(t => t._id.toString() === card.intelBriefId.toString())?.title ?? ''
    setFeedback({ correct, correctTitle })
    playSound(correct ? 'flashcard_correct' : 'flashcard_incorrect')
    setCardResults(prev => [...prev, { intelBriefId: card.intelBriefId, recalled: correct, timeTakenSeconds: elapsed }])

    const isLast = cardIdx >= cards.length - 1
    if (isLast) {
      // Submit after brief delay to show feedback
      setTimeout(() => finishGame([...cardResults, { intelBriefId: card.intelBriefId, recalled: correct, timeTakenSeconds: elapsed }]), 1200)
    } else {
      setTimeout(() => advanceCard(), 1000)
    }
  }

  async function finishGame(results) {
    gameFinished.current = true
    clearBadge()
    setSubmitting(true)
    try {
      const res  = await apiFetch(`${API}/api/games/flashcard-recall/result`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, cardResults: results, gameSessionId }),
      })
      const data = await res.json()
      const earned        = data?.data?.result?.aircoinsEarned ?? 0
      const rankPromotion = data?.data?.rankPromotion  ?? null
      const cycleAfter    = data?.data?.cycleAircoins  ?? null
      const totalAfter    = data?.data?.totalAircoins  ?? undefined

      if (earned > 0 && awardAircoins) {
        awardAircoins(earned, 'Flashcard Recall', { cycleAfter, totalAfter, rankPromotion })
      }

      const correct = results.filter(r => r.recalled).length
      setResultData({
        correct,
        total: results.length,
        aircoinsEarned: earned,
        rankPromotion,
        cardBreakdown:  results.map((r, i) => ({
          ...r,
          briefTitle:      allTitles.find(t => t._id.toString() === r.intelBriefId.toString())?.title ?? 'Unknown',
          cardCategory:    cards[i]?.category ?? '',
          cardSubcategory: cards[i]?.subcategory ?? '',
          contentSnippet:  cards[i]?.contentSnippet ?? '',
        })),
      })
      setScreen('result')
    } catch (err) {
      console.error('[flashcard finish] failed:', err)
      if (refreshUser) refreshUser().catch(() => {})
      setScreen('result')
    } finally {
      setSubmitting(false)
    }
  }

  // When card index advances past last card → finish (handles timer path)
  useEffect(() => {
    if (screen !== 'game') return
    if (cardIdx > 0 && cardIdx >= cards.length && cardResults.length >= cards.length) {
      finishGame(cardResults)
    }
  }, [cardIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  function playAgain() {
    setScreen('pick')
    setCardIdx(0)
    setCardResults([])
    setFeedback(null)
    setResultData(null)
    setExpanded(new Set())
  }

  const currentCard = cards[cardIdx]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(8, 14, 30, 0.88)' }}
      data-testid="flashcard-modal"
    >
      <AnimatePresence mode="wait">

        {/* ── Count picker ─────────────────────────────────────────────── */}
        {screen === 'pick' && (
          <motion.div
            key="pick"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.22 }}
            className="relative w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl"
            style={{ background: 'linear-gradient(160deg, #0d1f3c 0%, #091529 100%)', border: '1px solid rgba(245,158,11,0.25)' }}
          >
            {/* Header */}
            <div className="px-6 pt-7 pb-4 text-center" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="text-3xl mb-2">⚡</div>
              <p className="text-[10px] font-bold tracking-[0.2em] uppercase mb-1" style={{ color: '#f59e0b' }}>Recall Drill</p>
              <h2 className="text-xl font-extrabold" style={{ color: '#f8fafc' }}>Flashcard Round</h2>
              <p className="text-sm mt-2" style={{ color: '#94a3b8' }}>
                Each card shows a brief's content with the title hidden.
                Type to find and select the correct title.
              </p>
            </div>

            <div className="px-6 py-5">
              {available === null ? (
                <p className="text-center text-sm" style={{ color: '#64748b' }}>Loading…</p>
              ) : available < 5 ? (
                <div className="text-center py-3">
                  <p className="text-sm font-semibold mb-1" style={{ color: '#f87171' }}>Not enough completed briefs</p>
                  <p className="text-xs" style={{ color: '#64748b' }}>
                    You have completed {available} brief{available !== 1 ? 's' : ''}.
                    Read at least 5 briefs to unlock Flashcard Round.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-xs font-bold uppercase tracking-widest mb-3 text-center" style={{ color: '#64748b' }}>
                    How many cards? <span style={{ color: '#94a3b8' }}>({available} available)</span>
                  </p>
                  <div className="grid grid-cols-4 gap-2 mb-5">
                    {COUNT_OPTIONS.map(n => {
                      const locked = n > available
                      const active = selectedCount === n
                      return (
                        <button
                          key={n}
                          disabled={locked}
                          onClick={() => setSelectedCount(n)}
                          data-testid={`count-option-${n}`}
                          className="py-3 rounded-2xl text-sm font-bold transition-all"
                          style={{
                            background: locked ? 'rgba(255,255,255,0.04)' : active ? '#f59e0b' : 'rgba(255,255,255,0.07)',
                            color:      locked ? '#334155' : active ? '#0f172a' : '#cbd5e1',
                            cursor:     locked ? 'not-allowed' : 'pointer',
                            border:     `1.5px solid ${locked ? 'transparent' : active ? '#f59e0b' : 'rgba(255,255,255,0.1)'}`,
                          }}
                        >
                          {n}
                        </button>
                      )
                    })}
                  </div>
                  {error && <p className="text-xs text-center mb-3" style={{ color: '#f87171' }}>{error}</p>}
                  <button
                    onClick={startGame}
                    disabled={!selectedCount || loading}
                    data-testid="flashcard-start-btn"
                    className="w-full py-3 rounded-2xl text-sm font-extrabold tracking-wide transition-all"
                    style={{
                      background: selectedCount && !loading ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'rgba(255,255,255,0.06)',
                      color:      selectedCount && !loading ? '#0f172a' : '#475569',
                      cursor:     !selectedCount || loading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {loading ? 'Loading…' : 'START DRILL →'}
                  </button>
                </>
              )}
            </div>

            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full transition-colors"
              style={{ color: '#475569', background: 'rgba(255,255,255,0.06)' }}
              aria-label="Close"
            >
              ✕
            </button>
          </motion.div>
        )}

        {/* ── Game screen ──────────────────────────────────────────────── */}
        {screen === 'game' && currentCard && (
          <motion.div
            key={`card-${cardIdx}`}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.22 }}
            className="w-full max-w-sm"
          >
            {/* Progress header */}
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-xs font-bold" style={{ color: '#f59e0b' }}>
                CARD {cardIdx + 1} / {cards.length}
              </span>
              <span className="text-xs font-mono" style={{ color: timeLeft <= 10 ? '#ef4444' : '#94a3b8' }}>
                {timeLeft}s
              </span>
            </div>
            <div className="mb-3">
              <TimerBar seconds={timeLeft} total={CARD_TIMER_SECONDS} />
            </div>

            {/* Card */}
            <div
              className="rounded-3xl overflow-hidden shadow-2xl mb-4"
              style={{ background: 'linear-gradient(160deg, #0d1f3c 0%, #091529 100%)', border: '1px solid rgba(245,158,11,0.2)' }}
            >
              {/* Blurred title area */}
              <div
                className="px-5 pt-5 pb-3"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
              >
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#f59e0b' }}>
                  {currentCard.category}
                  {currentCard.subcategory ? ` · ${currentCard.subcategory}` : ''}
                </p>
                <div
                  className="h-5 rounded-lg select-none"
                  style={{ background: 'rgba(245,158,11,0.15)', filter: 'blur(4px)', width: '70%' }}
                  aria-hidden="true"
                  data-testid="blurred-title"
                />
              </div>

              {/* Content — section 4 of description (name-free summary) */}
              <div className="px-5 py-4">
                {currentCard.contentSnippet ? (
                  <p className="text-sm leading-relaxed" style={{ color: '#cbd5e1' }}>
                    {currentCard.contentSnippet}
                  </p>
                ) : (
                  <p className="text-xs italic" style={{ color: '#475569' }}>No preview available.</p>
                )}
              </div>
            </div>

            {/* Feedback overlay */}
            <AnimatePresence>
              {feedback && (
                <motion.div
                  key="feedback"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="rounded-2xl px-5 py-3 mb-4 text-center"
                  style={{
                    background: feedback.correct ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                    border: `1.5px solid ${feedback.correct ? '#10b981' : '#ef4444'}`,
                  }}
                  data-testid="flashcard-feedback"
                >
                  <p className="font-extrabold text-sm" style={{ color: feedback.correct ? '#10b981' : '#ef4444' }}>
                    {feedback.correct ? '✓ CORRECT' : '✗ INCORRECT'}
                  </p>
                  {!feedback.correct && feedback.correctTitle && (
                    <p className="text-xs mt-1" style={{ color: '#94a3b8' }}>
                      Answer: <span style={{ color: '#e2e8f0' }}>{feedback.correctTitle}</span>
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Search input */}
            {!feedback && (
              <TitleSearch
                allTitles={allTitles}
                onSelect={handleSelect}
                disabled={!!feedback}
              />
            )}

            <button
              onClick={() => { sendAbandon(cardResults); onClose() }}
              className="mt-4 w-full py-2 text-xs font-semibold rounded-xl transition-colors"
              style={{ color: '#475569', background: 'rgba(255,255,255,0.04)' }}
            >
              Quit drill
            </button>
          </motion.div>
        )}

        {/* ── Results ──────────────────────────────────────────────────── */}
        {screen === 'result' && resultData && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl"
            style={{ background: 'linear-gradient(160deg, #0d1f3c 0%, #091529 100%)', border: '1px solid rgba(245,158,11,0.25)' }}
          >
            {/* Score header */}
            <div className="px-6 pt-7 pb-5 text-center" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="text-4xl mb-2">
                {resultData.correct === resultData.total ? '⚡' : resultData.correct >= resultData.total / 2 ? '✓' : '🔁'}
              </div>
              <p className="text-[10px] font-bold tracking-[0.2em] uppercase mb-1" style={{ color: '#f59e0b' }}>Drill Complete</p>
              <p className="text-3xl font-extrabold mb-1" style={{ color: '#f8fafc' }}>
                {resultData.correct} <span className="text-lg font-bold" style={{ color: '#64748b' }}>/ {resultData.total}</span>
              </p>
              <p className="text-sm" style={{ color: '#94a3b8' }}>
                {Math.round((resultData.correct / resultData.total) * 100)}% recalled
              </p>
              {resultData.aircoinsEarned > 0 && (
                <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-full" style={{ background: 'rgba(148,163,184,0.18)', border: '1px solid rgba(148,163,184,0.35)' }}>
                  <span className="star-silver">⭐</span>
                  <span className="text-sm font-bold text-white">+{resultData.aircoinsEarned} Aircoins</span>
                </div>
              )}
            </div>

            {/* Card breakdown */}
            <div className="px-4 py-4 max-h-64 overflow-y-auto space-y-1.5" data-testid="flashcard-breakdown">
              {resultData.cardBreakdown.map((r, i) => {
                const isOpen = expanded.has(i)
                const hasSnippet = !!r.contentSnippet
                return (
                  <div
                    key={i}
                    className="rounded-xl overflow-hidden"
                    style={{ background: r.recalled ? 'rgba(16,185,129,0.07)' : 'rgba(239,68,68,0.07)' }}
                  >
                    {/* Row header */}
                    <div
                      className="flex items-center gap-3 px-3 py-2"
                      onClick={() => hasSnippet && setExpanded(prev => {
                        const s = new Set(prev)
                        s.has(i) ? s.delete(i) : s.add(i)
                        return s
                      })}
                      style={{ cursor: hasSnippet ? 'pointer' : 'default' }}
                    >
                      <span className="text-sm shrink-0" style={{ color: r.recalled ? '#10b981' : '#ef4444' }}>
                        {r.recalled ? '✓' : '✗'}
                      </span>
                      <p className="text-xs font-medium truncate flex-1" style={{ color: r.recalled ? '#a7f3d0' : '#fca5a5' }}>
                        {r.briefTitle}
                      </p>
                      <span className="text-[10px] shrink-0" style={{ color: '#475569' }}>{r.timeTakenSeconds}s</span>
                      {hasSnippet && (
                        <button
                          className="shrink-0 w-5 h-5 flex items-center justify-center rounded transition-transform"
                          style={{
                            color: '#f59e0b',
                            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                            transition: 'transform 0.18s ease',
                          }}
                          aria-label={isOpen ? 'Collapse' : 'Expand'}
                        >
                          ›
                        </button>
                      )}
                    </div>

                    {/* Expandable snippet */}
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          key="snippet"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: 'easeInOut' }}
                          style={{ overflow: 'hidden' }}
                        >
                          <div
                            className="px-3 pb-3 pt-1"
                            style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
                          >
                            {(r.cardCategory || r.cardSubcategory) && (
                              <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#f59e0b' }}>
                                {r.cardCategory}{r.cardSubcategory ? ` · ${r.cardSubcategory}` : ''}
                              </p>
                            )}
                            <p className="text-xs leading-relaxed" style={{ color: '#94a3b8' }}>
                              {r.contentSnippet}
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>

            {/* Actions */}
            <div className="px-6 pb-6 pt-3 flex flex-col gap-2">
              <button
                onClick={playAgain}
                data-testid="flashcard-play-again"
                className="w-full py-3 rounded-2xl text-sm font-extrabold tracking-wide transition-all"
                style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#0f172a' }}
              >
                DRILL AGAIN ⚡
              </button>
              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-2xl text-sm font-semibold transition-colors"
                style={{ color: '#64748b', background: 'rgba(255,255,255,0.04)' }}
              >
                Close
              </button>
            </div>
          </motion.div>
        )}

        {/* Loading/submitting overlay */}
        {submitting && (
          <motion.div
            key="submitting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-10 flex items-center justify-center"
            style={{ background: 'rgba(8,14,30,0.6)' }}
          >
            <p className="text-sm font-bold" style={{ color: '#f59e0b' }}>Saving results…</p>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  )
}
