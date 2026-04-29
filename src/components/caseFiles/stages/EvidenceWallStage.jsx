/**
 * EvidenceWallStage
 * The set-piece interactive corkboard stage.
 *
 * Stage contract:
 *   stage          = { id, type: 'evidence_wall', payload }
 *   sessionContext = { caseSlug, chapterSlug, sessionId, priorResults: [...] }
 *   onSubmit(resultPayload) → Promise<void>
 *
 * Payload shape:
 *   { phaseLabel: string, items: [{id, title, type, description, imageUrl, imageCredit, sourceUrl}] }
 *
 * Presentation-only — no fetch calls.
 *
 * CONTRACT-AMBIGUITY: spec says "6-8 per row on desktop" but doesn't define
 * the exact grid. Using auto-fill grid with min 140px cards — naturally lands
 * at 6-8 per row on typical 1200-1400px viewports.
 *
 * CONTRACT-AMBIGUITY: "pre-existing connections (priorResults) are NOT
 * auto-loaded — V1 just starts fresh each session." Confirmed; priorResults
 * is intentionally ignored on mount.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import EvidenceCard from '../EvidenceCard.jsx'
import RedStringConnector from '../RedStringConnector.jsx'
import CorkboardView from '../CorkboardView.jsx'

// Cheap mobile-vs-desktop probe. SSR-safe and jsdom-safe (defaults to desktop
// when matchMedia is missing, so existing tests run the original grid path).
function useIsMobile(breakpointPx = 600) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(`(max-width: ${breakpointPx}px)`).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(`(max-width: ${breakpointPx}px)`)
    const handler = (e) => setIsMobile(e.matches)
    // addEventListener isn't on every legacy MediaQueryList — guard
    if (mql.addEventListener) mql.addEventListener('change', handler)
    else if (mql.addListener) mql.addListener(handler)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler)
      else if (mql.removeListener) mql.removeListener(handler)
    }
  }, [breakpointPx])

  return isMobile
}

// ── Corkboard CSS texture (no asset dependency) ───────────────────────────────
// Repeating radial gradient gives a subtle canvas/cork feel.
const CORKBOARD_BG = {
  backgroundColor: '#0e1c30',
  backgroundImage: [
    'radial-gradient(ellipse 2px 2px at 30% 30%, rgba(91,170,255,0.025) 0%, transparent 100%)',
    'radial-gradient(ellipse 1px 1px at 70% 60%, rgba(91,170,255,0.018) 0%, transparent 100%)',
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='250' height='250'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.5' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='250' height='250' filter='url(%23n)' opacity='0.055'/%3E%3C/svg%3E\")",
  ].join(', '),
  backgroundSize: '300px 300px, 200px 200px, 250px 250px',
}

// ── Connection state helpers ──────────────────────────────────────────────────
function makeConnectionKey(fromId, toId) {
  // Canonical order so A→B === B→A
  return [fromId, toId].sort().join('::')
}

function connectionExists(connections, fromId, toId) {
  const key = makeConnectionKey(fromId, toId)
  return connections.some(c => makeConnectionKey(c.fromItemId, c.toItemId) === key)
}

// ── Main component ────────────────────────────────────────────────────────────
export default function EvidenceWallStage({ stage, sessionContext, onSubmit }) {
  const payload = stage?.payload ?? {}
  const {
    phaseLabel = 'Evidence Analysis',
    items      = [],
  } = payload

  // ── State ─────────────────────────────────────────────────────────────────
  const [connections,     setConnections]     = useState([])           // [{fromItemId, toItemId}]
  const [selectedItemId,  setSelectedItemId]  = useState(null)
  const [submitting,      setSubmitting]      = useState(false)
  const [error,           setError]           = useState(null)

  // Map<itemId, {x, y}> — center-positions in corkboard-relative coords.
  // Updated by each EvidenceCard after mount + by ResizeObserver.
  const posMapRef    = useRef(new Map())
  const boardRef     = useRef(null)
  const [boardSize,  setBoardSize]  = useState({ width: 1000, height: 600 })

  // In-progress string endpoint — follows mouse while first card is selected (desktop)
  const [mousePos, setMousePos] = useState(null)

  // Layout choice — mobile gets the pan/zoom corkboard, desktop keeps grid
  const isMobile = useIsMobile(600)

  // ── ResizeObserver: recompute board size so SVG matches (desktop only) ──
  useEffect(() => {
    if (isMobile || !boardRef.current) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setBoardSize({ width, height })
    })
    ro.observe(boardRef.current)
    return () => ro.disconnect()
  }, [isMobile])

  // ── Mouse tracking for in-progress string (desktop only) ────────────────
  useEffect(() => {
    if (isMobile) return
    if (!selectedItemId) {
      setMousePos(null)
      return
    }
    function onMouseMove(e) {
      if (!boardRef.current) return
      const rect = boardRef.current.getBoundingClientRect()
      setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    window.addEventListener('mousemove', onMouseMove)
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [selectedItemId, isMobile])

  // ── Card position callback ────────────────────────────────────────────────
  const handlePositionChange = useCallback((id, pos) => {
    posMapRef.current.set(id, pos)
  }, [])

  // ── Card click / tap handler ──────────────────────────────────────────────
  function handleCardClick(itemId) {
    if (!selectedItemId) {
      // First selection
      setSelectedItemId(itemId)
      return
    }

    if (selectedItemId === itemId) {
      // Tapped same card twice — deselect
      setSelectedItemId(null)
      return
    }

    // Second selection: commit connection if not already present
    if (!connectionExists(connections, selectedItemId, itemId)) {
      setConnections(prev => [...prev, { fromItemId: selectedItemId, toItemId: itemId }])
    }
    setSelectedItemId(null)
  }

  // ── Remove a connection by clicking its string ────────────────────────────
  function handleRemoveConnection(fromId, toId) {
    const key = makeConnectionKey(fromId, toId)
    setConnections(prev =>
      prev.filter(c => makeConnectionKey(c.fromItemId, c.toItemId) !== key)
    )
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    setSelectedItemId(null)
    try {
      await onSubmit({ connections: [...connections] })
    } catch (err) {
      console.error('[EvidenceWallStage] onSubmit rejected:', err)
      setError('Submission failed. Please try again.')
      setSubmitting(false)
    }
  }

  // ── Dismiss selection on Escape ───────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setSelectedItemId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Grid layout ──────────────────────────────────────────────────────────
  // Deterministic: items render in the order they arrive — no shuffle.

  return (
    <div className="flex flex-col gap-0 min-h-0 h-full w-full">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-300/10 bg-surface">
        <span className="intel-mono text-brand-600">{phaseLabel}</span>
        <span className="intel-mono text-slate-500" aria-live="polite">
          {connections.length} / ∞ connections
        </span>
      </div>

      {/* ── Selection hint banner ─────────────────────────────────────── */}
      <AnimatePresence>
        {selectedItemId && (
          <motion.div
            key="hint"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="px-4 py-1.5 text-[11px] text-brand-600 intel-mono bg-brand-100/40 border-b border-brand-600/20 text-center">
              CARD SELECTED — tap another card to link, or tap the same card to cancel
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Corkboard ─────────────────────────────────────────────────── */}
      {isMobile ? (
        <CorkboardView
          items={items}
          connections={connections}
          selectedItemId={selectedItemId}
          onCardClick={handleCardClick}
          onRemoveConnection={handleRemoveConnection}
        />
      ) : (
        <div
          ref={boardRef}
          className="relative flex-1 min-h-0 overflow-auto"
          style={{ ...CORKBOARD_BG }}
          data-testid="evidence-wall-board"
        >
          {/* SVG layer — one per connection (absolutely over board) */}
          {connections.map(({ fromItemId, toItemId }) => {
            const from = posMapRef.current.get(fromItemId)
            const to   = posMapRef.current.get(toItemId)
            if (!from || !to) return null
            return (
              <RedStringConnector
                key={makeConnectionKey(fromItemId, toItemId)}
                from={from}
                to={to}
                committed
                onClick={() => handleRemoveConnection(fromItemId, toItemId)}
                width={boardSize.width}
                height={boardSize.height}
              />
            )
          })}

          {/* In-progress string (selected card → mouse position) */}
          {selectedItemId && mousePos && posMapRef.current.get(selectedItemId) && (
            <RedStringConnector
              key="in-progress"
              from={posMapRef.current.get(selectedItemId)}
              to={mousePos}
              committed={false}
              width={boardSize.width}
              height={boardSize.height}
            />
          )}

          {/* Evidence cards grid */}
          <div
            className="relative z-10 p-4 grid gap-3"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            }}
            data-testid="evidence-card-grid"
          >
            {items.map(item => (
              <EvidenceCard
                key={item.id}
                item={item}
                isSelected={selectedItemId === item.id}
                onClick={() => handleCardClick(item.id)}
                onPositionChange={handlePositionChange}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Footer: submit + error ─────────────────────────────────────── */}
      <div className="shrink-0 flex flex-col items-end gap-2 px-4 py-3 border-t border-slate-300/10 bg-surface">
        {error && (
          <p role="alert" className="text-xs text-danger self-start">
            {error}
          </p>
        )}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          data-testid="submit-analysis-btn"
          className={[
            'px-6 py-2.5 rounded-btn font-semibold text-sm text-white',
            'bg-brand-600 hover:bg-brand-700 active:bg-brand-500',
            'transition-colors duration-150',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'flex items-center gap-2',
          ].join(' ')}
        >
          {submitting ? (
            <>
              <span
                className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
                aria-hidden="true"
              />
              Submitting…
            </>
          ) : (
            'Submit Analysis'
          )}
        </button>
      </div>
    </div>
  )
}
