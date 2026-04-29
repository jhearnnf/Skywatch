/**
 * ColdOpenStage
 * Cinematic briefing stage — manila folder, typewriter animation, thumbnail items.
 *
 * Stage contract:
 *   stage          = { id, type: 'cold_open', payload }
 *   sessionContext = { caseSlug, chapterSlug, sessionId, priorResults: [...] }
 *   onSubmit(resultPayload) → Promise<void>
 *
 * Payload shape:
 *   { dateLabel, directorBriefing, startingItems: [{id, title, thumbnailUrl, imageCredit, oneLineHint}] }
 *
 * Presentation-only — no fetch calls.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ── Typewriter hook ───────────────────────────────────────────────────────────
function useTypewriter(text, charDelay = 30, enabled = true) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)
  const timerIdRef = useRef(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false

    if (!enabled || !text) {
      setDisplayed(text ?? '')
      setDone(true)
      return () => {}
    }

    setDisplayed('')
    setDone(false)

    let i = 0

    function tick() {
      if (cancelledRef.current) return
      i++
      setDisplayed(text.slice(0, i))
      if (i < text.length) {
        timerIdRef.current = setTimeout(tick, charDelay)
      } else {
        setDone(true)
        timerIdRef.current = null
      }
    }

    timerIdRef.current = setTimeout(tick, charDelay)

    return () => {
      cancelledRef.current = true
      if (timerIdRef.current !== null) {
        clearTimeout(timerIdRef.current)
        timerIdRef.current = null
      }
    }
  }, [text, charDelay, enabled])

  return { displayed, done }
}

// ── Thumbnail card (starting items) ──────────────────────────────────────────
function ThumbnailItem({ item, index }) {
  const [hovered, setHovered] = useState(false)
  const { id, title, thumbnailUrl, imageCredit, oneLineHint } = item

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 + index * 0.1, duration: 0.4 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={()    => setHovered(true)}
      onBlur={()     => setHovered(false)}
      className="relative flex flex-col rounded overflow-hidden border border-slate-300/20 bg-surface cursor-default select-none"
      style={{ minWidth: 0 }}
      aria-label={`${title}${oneLineHint ? ` — ${oneLineHint}` : ''}`}
    >
      {/* Thumbnail image or placeholder */}
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={title}
            draggable={false}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-surface-raised flex items-center justify-center">
            <span className="text-2xl" aria-hidden="true">📁</span>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-surface to-transparent pointer-events-none" />
      </div>

      {/* Title */}
      <p className="px-2 py-1.5 text-[10px] font-semibold text-slate-600 leading-tight line-clamp-2">
        {title}
      </p>

      {/* Hover hint overlay */}
      <AnimatePresence>
        {hovered && oneLineHint && (
          <motion.div
            key="hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 flex items-center justify-center bg-surface/90 px-2"
          >
            <p className="text-[10px] text-brand-600 font-medium text-center leading-snug">
              {oneLineHint}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image credit */}
      {imageCredit && (
        <p className="px-2 pb-1 text-[8px] italic text-slate-400">{imageCredit}</p>
      )}
    </motion.div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ColdOpenStage({ stage, sessionContext, onSubmit }) {
  const payload = stage?.payload ?? {}
  const {
    dateLabel        = '',
    directorBriefing = '',
    backgroundPrimer = [],
    startingItems    = [],
  } = payload

  // Typewriter for dateLabel — short, quick
  const { displayed: dateDisplayed, done: dateDone } = useTypewriter(dateLabel, 28)
  // Typewriter for briefing — starts after date finishes
  const { displayed: briefDisplayed } = useTypewriter(
    directorBriefing,
    20,
    dateDone
  )

  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState(null)

  async function handleBegin() {
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({ completed: true })
    } catch (err) {
      console.error('[ColdOpenStage] onSubmit rejected:', err)
      setError('Unable to proceed. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex flex-col w-full h-full min-h-0 bg-surface">
      {/* Scrollable content — vignette applied here so it wraps content not footer */}
      <div
        className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center px-4 py-6"
        style={{
          // Vignette — dark inset shadow on all edges
          boxShadow: 'inset 0 0 120px rgba(0,0,0,0.65)',
        }}
      >
      {/* ── Date label (typewriter) ───────────────────────────────────── */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="intel-mono text-brand-600 mb-6 text-center tracking-widest"
        aria-live="polite"
      >
        {dateDisplayed}
        {/* Blinking cursor while typing */}
        {!dateDone && (
          <span className="inline-block w-[2px] h-[1em] bg-brand-600 ml-0.5 align-middle animate-pulse" />
        )}
      </motion.p>

      {/* ── Manila folder card ────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2, duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-xl rounded-lg border border-amber-200/10 bg-surface-raised card-shadow"
        style={{
          // Warm paper tint layered on top of the dark surface token
          backgroundImage:
            'linear-gradient(135deg, rgba(120, 90, 40, 0.07) 0%, rgba(60, 50, 30, 0.04) 100%), ' +
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E\")",
          backgroundSize: 'auto, 200px 200px',
        }}
      >
        {/* Folder tab accent */}
        <div className="h-1 rounded-t-lg bg-gradient-to-r from-amber-200/20 via-amber-200/10 to-transparent" />

        <div className="px-6 py-5">
          {/* CLASSIFIED header */}
          <div className="flex items-center gap-2 mb-4">
            <span className="classified-tag">DIRECTOR BRIEFING</span>
          </div>

          {/* Background primer — plain-English context bullets shown before
              the briefing for players new to the topic. Optional. */}
          {Array.isArray(backgroundPrimer) && backgroundPrimer.length > 0 && (
            <motion.div
              data-testid="background-primer"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="mb-4 rounded border border-brand-600/20 bg-brand-100/20 px-3 py-2.5"
            >
              <p className="intel-mono text-[10px] tracking-widest text-brand-600 uppercase mb-1.5">
                Background — what you need to know
              </p>
              <ul className="flex flex-col gap-1.5">
                {backgroundPrimer.map((row, i) => (
                  <li key={i} className="text-[12px] text-text leading-snug flex gap-2">
                    {row.label && (
                      <span className="font-semibold text-brand-600 shrink-0">
                        {row.label}:
                      </span>
                    )}
                    <span>{row.text}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}

          {/* Briefing text */}
          <blockquote
            className="font-mono text-sm text-slate-700 leading-relaxed border-l-2 border-amber-200/20 pl-4 min-h-[80px]"
            aria-live="polite"
          >
            {briefDisplayed}
            {dateDone && briefDisplayed.length < directorBriefing.length && (
              <span className="inline-block w-[2px] h-[1em] bg-slate-500 ml-0.5 align-middle animate-pulse" />
            )}
          </blockquote>

          {/* ── Starting item thumbnails ──────────────────────────────── */}
          {startingItems.length > 0 && (
            <div className="mt-5">
              <p className="intel-mono text-slate-500 mb-2">INITIAL EVIDENCE</p>
              <div
                className="grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(startingItems.length, 3)}, 1fr)`,
                }}
              >
                {startingItems.slice(0, 3).map((item, idx) => (
                  <ThumbnailItem key={item.id} item={item} index={idx} />
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>

      </div>

      {/* ── Sticky footer: Begin Briefing button ──────────────────────── */}
      <div className="shrink-0 border-t border-slate-300/10 bg-surface px-4 py-3 flex flex-col items-center gap-2">
        <button
          onClick={handleBegin}
          disabled={submitting}
          data-testid="begin-briefing-btn"
          className={[
            'px-8 py-3 rounded-btn font-semibold text-sm text-white tracking-wide',
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
              <span>Accessing…</span>
            </>
          ) : (
            'Begin Briefing'
          )}
        </button>

        {error && (
          <p role="alert" className="text-xs text-danger text-center">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
