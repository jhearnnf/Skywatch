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
import { Stamp, StickyNote, StageFooter, ActionButton } from '../CaseFileKit'

// ── Typewriter hook ───────────────────────────────────────────────────────────
// While `enabled` is false the text stays blank. It used to show in full while
// it waited, then blank itself and type out again, which read as a glitch:
// the whole briefing flashed up under the date and vanished.
function useTypewriter(text, charDelay = 30, enabled = true) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)
  const timerIdRef = useRef(null)
  const cancelledRef = useRef(false)
  // Once skipped, stay skipped: skipping the date flips the briefing's
  // `enabled`, and without this the briefing would blank and retype itself.
  const skippedForRef = useRef(null)

  useEffect(() => {
    cancelledRef.current = false

    if (text && skippedForRef.current === text) {
      setDisplayed(text)
      setDone(true)
      return () => {}
    }
    if (!text) {
      setDisplayed('')
      setDone(true)
      return () => {}
    }
    if (!enabled) {
      setDisplayed('')
      setDone(false)
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

  // Drop the rest of the line in at once.
  const skip = useCallback(() => {
    skippedForRef.current = text
    cancelledRef.current = true
    if (timerIdRef.current !== null) {
      clearTimeout(timerIdRef.current)
      timerIdRef.current = null
    }
    setDisplayed(text ?? '')
    setDone(true)
  }, [text])

  return { displayed, done, skip }
}

// ── Thumbnail card (starting items) ──────────────────────────────────────────
// Clues tossed onto the folder rather than squared up in a grid.
const THUMB_TILT = [-2, 1.5, -1]

function ThumbnailItem({ item, index }) {
  const [hovered, setHovered] = useState(false)
  const [pinned,  setPinned]  = useState(false)
  const { id, title, thumbnailUrl, imageCredit, oneLineHint } = item

  // The hint used to be revealed on hover alone, with no tabIndex — so on a
  // phone (and in the Android app, which is always mobile) it was unreachable,
  // while the objective banner cheerfully told players to hover for it.
  //
  // Tap pins it open, kept separate from hover on purpose: a touch tap also
  // fires an emulated mouseenter, so a single `hovered` flag would be set true
  // by the tap and then toggled straight back off by the click, and the hint
  // would blink and vanish. Showing on `hovered || pinned` means a tap can
  // only ever reveal.
  const showHint = hovered || pinned

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 + index * 0.1, duration: 0.4 }}
      whileHover={{ y: -3, rotate: 0 }}
      role={oneLineHint ? 'button' : undefined}
      tabIndex={oneLineHint ? 0 : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={()    => setHovered(true)}
      onBlur={()     => setHovered(false)}
      onClick={oneLineHint ? () => setPinned(p => !p) : undefined}
      onKeyDown={oneLineHint ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setPinned(p => !p)
        }
      } : undefined}
      data-testid={`cold-open-thumb-${id}`}
      className={[
        // Always the plain cursor: the click only exists to pin the hint on
        // touch (no hover there). With a mouse, hover already shows it, so a
        // pointer promised an action that never came.
        'relative flex flex-col rounded overflow-hidden border border-slate-300/20 bg-surface select-none cursor-default',
      ].join(' ')}
      style={{ minWidth: 0, rotate: THUMB_TILT[index % THUMB_TILT.length] }}
      aria-label={`${title}${oneLineHint ? `. ${oneLineHint}` : ''}`}
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
        {showHint && oneLineHint && (
          <motion.div
            key="hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 flex items-center justify-center bg-surface/70 p-1.5"
          >
            <StickyNote tilt={index % 2 ? 1.5 : -1.5} className="w-full text-center !text-[11px]">
              {oneLineHint}
            </StickyNote>
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
  const { displayed: dateDisplayed, done: dateDone, skip: skipDate } = useTypewriter(dateLabel, 28)
  // Typewriter for briefing — starts after date finishes
  const { displayed: briefDisplayed, done: briefDone, skip: skipBrief } = useTypewriter(
    directorBriefing,
    20,
    dateDone
  )

  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState(null)

  // Clicking anywhere on the folder finishes the typing, like every dialogue
  // box in every game: a fast reader should never be made to wait for it.
  const typing = !dateDone || !briefDone
  function skipTyping() {
    if (!typing) return
    skipDate()
    skipBrief()
  }

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
      {/* Centring is done with auto margins on the first and last child rather
          than justify-center, which would clip the top of the briefing out of
          reach once the content is taller than the column. Without it the
          folder sat pinned to the top of a full-height stage with a few hundred
          pixels of empty board beneath it on a desktop viewport. */}
      <div
        className="flex-1 min-h-0 overflow-y-auto cf-stage-scroll flex flex-col items-center px-4 py-6"
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
        className="intel-mono text-brand-600 mt-auto mb-6 text-center tracking-widest"
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
        onClick={skipTyping}
        className="relative w-full max-w-xl mb-auto mt-4 rounded-lg rounded-tl-none border border-amber-200/15 bg-surface-raised card-shadow"
        style={{
          // Warm paper tint layered on top of the dark surface token
          backgroundImage:
            'linear-gradient(135deg, rgba(120, 90, 40, 0.07) 0%, rgba(60, 50, 30, 0.04) 100%), ' +
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E\")",
          backgroundSize: 'auto, 200px 200px',
        }}
      >
        {/* Folder tab, sticking up off the top-left like a real file */}
        <div
          aria-hidden="true"
          className="absolute -top-4 left-[-1px] h-4 px-3 flex items-center rounded-t-md border border-b-0 border-amber-200/15 bg-surface-raised font-mono text-[9px] tracking-[0.25em] text-amber-700/80 font-bold"
        >
          CASE FILE
        </div>
        <div className="h-1 rounded-tr-lg bg-gradient-to-r from-amber-200/20 via-amber-200/10 to-transparent" />

        {/* Classification stamp */}
        <div className="absolute top-3 right-4 pointer-events-none" aria-hidden="true">
          <Stamp tone="red" size="sm" rotate={-7} delay={0.55}>Eyes Only</Stamp>
        </div>

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
                Background: what you need to know
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
          {typing && directorBriefing && (
            <p className="mt-1.5 text-right font-mono text-[9px] tracking-widest uppercase text-slate-500">
              Tap or click to skip
            </p>
          )}

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

      {/* ── Sticky footer: continue button ────────────────────────────── */}
      <StageFooter className="!justify-center flex-col !gap-2">
        <ActionButton
          onClick={handleBegin}
          busy={submitting}
          busyLabel="Accessing…"
          testId="begin-briefing-btn"
          className="px-8"
        >
          Open the Evidence Wall
        </ActionButton>

        {error && (
          <p role="alert" className="text-xs text-danger text-center">
            {error}
          </p>
        )}
      </StageFooter>
    </div>
  )
}
