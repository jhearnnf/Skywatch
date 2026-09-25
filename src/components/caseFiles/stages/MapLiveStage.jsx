/**
 * MapLiveStage — animated live map with phase-by-phase unit movements and
 * per-phase sub-decisions.
 *
 * Stage payload shape:
 *   {
 *     mapBounds:  { south, west, north, east },
 *     hotspots:   [{ id, label, lat, lng, kind }],
 *     phases: [{
 *       id,
 *       timeLabel,        // e.g. 'Feb 24, 04:00'
 *       units: [{
 *         id, side: 'ru'|'ua', kind,
 *         fromHotspotId, toHotspotId, animationMs
 *       }],
 *       subDecision: {
 *         id, prompt,
 *         options: [{ id, text }],
 *         selectionMode: 'single' | 'multi'
 *       } | null
 *     }]
 *   }
 *
 * onSubmit({ subDecisions: [{ subDecisionId, selectedOptionIds: [string] }] })
 *
 * Unit rendering is split in two, because the two questions a player has are
 * different: "what is happening right now" and "what has happened so far".
 *   • The CURRENT phase's units are handed to MapCanvas as `movements` and
 *     played by MapMotionLayer — they fly their route from origin to target on
 *     a loop, with an impact at the far end.
 *   • Every unit from phase 0 up to the current one is also passed as `units`,
 *     snapped to its destination, so earlier phases stay on the map as quiet
 *     rings rather than a screen full of competing animations.
 *
 * CONTRACT-AMBIGUITY: phase progression — V1 is player-driven ("Advance" button).
 * Auto-timer (animationMs) is noted for V2.
 *
 * Presentation-only — no fetch.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import MapCanvas from '../MapCanvas'
import { Stamp, StageHeader, StageFooter, ActionButton } from '../CaseFileKit'
import { kindStyle, sideColor } from '../../../utils/caseFiles/motionGeometry'

// How long an answered question stays up, stamped LOGGED, before it clears.
const LOGGED_HOLD_MS = 650

// ── Phase header chip ─────────────────────────────────────────────────────────

function PhaseChip({ phaseIndex, totalPhases, timeLabel, isLive }) {
  return (
    <motion.div
      key={`chip-${phaseIndex}`}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      data-testid="phase-chip"
      className={[
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold tracking-wider font-mono transition-all duration-300',
        isLive
          ? 'bg-brand-200/60 border-brand-400/70 text-brand-600 shadow-[0_0_12px_rgba(91,170,255,0.35)]'
          : 'bg-surface-raised border-slate-300/30 text-text-muted',
      ].join(' ')}
    >
      {/* Pulsing live dot */}
      {isLive && (
        <span
          aria-hidden="true"
          className="w-1.5 h-1.5 rounded-full bg-brand-600 animate-pulse shrink-0"
        />
      )}
      <span>
        PHASE {phaseIndex + 1} / {totalPhases}
        {timeLabel ? ` · ${timeLabel}` : ''}
      </span>
    </motion.div>
  )
}

// ── Sub-decision card — slides up from bottom when a phase has one ────────────

function SubDecisionCard({ subDecision, onCommit }) {
  const { id, prompt, options = [], selectionMode = 'single' } = subDecision

  // Single-mode: string | null. Multi-mode: Set<string>.
  const [singleSelected, setSingleSelected]   = useState(null)
  const [multiSelected,  setMultiSelected]    = useState(new Set())
  const [committed,      setCommitted]        = useState(false)

  function handleSingleClick(optId) {
    if (committed) return
    setSingleSelected(optId)
    // Auto-commit on single selection
    setCommitted(true)
    onCommit(id, [optId])
  }

  function handleMultiToggle(optId) {
    if (committed) return
    setMultiSelected(prev => {
      const next = new Set(prev)
      if (next.has(optId)) next.delete(optId)
      else next.add(optId)
      return next
    })
  }

  function handleMultiSubmit() {
    if (committed || multiSelected.size === 0) return
    setCommitted(true)
    onCommit(id, [...multiSelected])
  }

  const isMulti = selectionMode === 'multi'

  return (
    <motion.div
      key={`subdecision-${id}`}
      data-testid="sub-decision-card"
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 60, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className="relative rounded-sm border border-[#e0413a]/40 bg-surface-raised flex flex-col overflow-hidden shadow-[0_4px_32px_rgba(224,65,58,0.18)]"
    >
      {/* Flash message header: the signal that the clock has stopped for you */}
      <div className="flex items-center gap-2 px-4 py-1.5 bg-[#e0413a]/15 border-b border-[#e0413a]/30">
        <span aria-hidden="true" className="w-2 h-2 rounded-full bg-[#e0413a] cf-flash-blink" />
        <span className="font-mono text-[10px] font-black tracking-[0.3em] uppercase text-[#ff6b63]">
          Flash message
        </span>
        <span className="ml-auto font-mono text-[9px] tracking-widest uppercase text-text-muted">
          {isMulti ? 'Pick all that apply' : 'Pick one'}
        </span>
      </div>

      {/* Lock stamp overlay when committed */}
      {committed && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <Stamp tone="blue" size="md" rotate={-12}>Logged</Stamp>
        </div>
      )}

      <div className="p-4 pt-3 flex flex-col gap-3">
      <p
        data-testid="sub-decision-prompt"
        className="text-sm sm:text-base font-bold text-text leading-snug"
      >
        {prompt}
      </p>

      <div className="flex flex-col gap-1.5">
        {options.map(opt => {
          const isSelected = isMulti
            ? multiSelected.has(opt.id)
            : singleSelected === opt.id

          return (
            <button
              key={opt.id}
              type="button"
              data-testid={`sub-option-${opt.id}`}
              disabled={committed}
              onClick={() =>
                isMulti ? handleMultiToggle(opt.id) : handleSingleClick(opt.id)
              }
              className={[
                'flex items-center gap-3 rounded-sm border px-3 py-2 text-sm text-left transition-all duration-150 w-full',
                committed ? 'cursor-default opacity-70' : 'cursor-pointer active:scale-[0.99]',
                isSelected
                  ? 'border-brand-500 bg-brand-100/50 text-text'
                  : 'border-slate-300/30 bg-surface text-text hover:border-brand-400/60 hover:translate-x-0.5',
              ].join(' ')}
            >
              {/* Indicator */}
              <span
                aria-hidden="true"
                className={[
                  'w-4 h-4 shrink-0 flex items-center justify-center border-2 transition-colors',
                  isMulti ? 'rounded' : 'rounded-full',
                  isSelected
                    ? 'border-brand-500 bg-brand-500'
                    : 'border-slate-400',
                ].join(' ')}
              >
                {isSelected && (
                  <span className={['bg-white block', isMulti ? 'w-2 h-2 rounded-sm' : 'w-2 h-2 rounded-full'].join(' ')} />
                )}
              </span>
              {opt.text}
            </button>
          )
        })}
      </div>

      {/* Multi-mode submit button */}
      {isMulti && !committed && (
        <div className="flex justify-end">
          <button
            type="button"
            data-testid="sub-decision-submit"
            disabled={multiSelected.size === 0}
            onClick={handleMultiSubmit}
            className={[
              'px-5 py-2 rounded-btn text-sm font-bold tracking-wide transition-opacity duration-150',
              multiSelected.size > 0
                ? 'bg-brand-600 text-white hover:opacity-90'
                : 'bg-surface-raised text-text-faint border border-slate-300/30 cursor-not-allowed',
            ].join(' ')}
          >
            Confirm Selection
          </button>
        </div>
      )}
      </div>
    </motion.div>
  )
}

// ── MapLiveStage ──────────────────────────────────────────────────────────────

export default function MapLiveStage({ stage, sessionContext, onSubmit }) {
  const {
    mapBounds,
    hotspots = [],
    phases   = [],
  } = stage?.payload ?? {}

  // Prefer the real title; the slug is a last resort so the eyebrow does not
  // read "road-to-invasion".
  const chapterTitle  = sessionContext?.chapterTitle || sessionContext?.chapterSlug || ''
  const totalPhases   = phases.length

  // Track which phase we're on (0-indexed), and which are complete
  const [currentPhaseIndex,  setCurrentPhaseIndex]  = useState(0)
  const [completedPhases,    setCompletedPhases]     = useState(new Set())
  const [subDecisionAnswers, setSubDecisionAnswers]  = useState([])
  const [awaitingDecision,   setAwaitingDecision]    = useState(false)
  const [submitting,         setSubmitting]          = useState(false)
  const dismissTimerRef = useRef(null)

  const currentPhase = phases[currentPhaseIndex] ?? null
  const isLastPhase  = currentPhaseIndex === totalPhases - 1
  const allPhasesComplete = completedPhases.size === totalPhases

  // Everything that has happened up to and including the phase on screen.
  const visibleUnits = phases
    .slice(0, currentPhaseIndex + 1)
    .flatMap(p => p.units ?? [])

  // Just the phase on screen — these are the ones that actually fly.
  const activeMovements = currentPhase?.units ?? []

  // Key for the moving pieces, built from what is actually in the air. Without
  // it a red dart arcing into Kyiv is atmosphere; with it, it is information.
  const movementLegend = []
  for (const unit of activeMovements) {
    const key = `${unit.side}:${unit.kind}`
    if (movementLegend.some(l => l.key === key)) continue
    movementLegend.push({
      key,
      label: kindStyle(unit.kind).label,
      color: sideColor(unit.side),
    })
  }

  // ── Sub-decision commit callback ─────────────────────────────────────────

  const handleSubDecisionCommit = useCallback(
    (subDecisionId, selectedOptionIds) => {
      setSubDecisionAnswers(prev => [
        ...prev,
        { subDecisionId, selectedOptionIds },
      ])
      // Hold the card long enough for its LOGGED stamp to land. Dismissing it
      // in the same click meant the stamp was never seen and the map lurched
      // wider underneath the pointer.
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = setTimeout(() => {
        setAwaitingDecision(false)
        // The clock only moves once the call has been made. Answering is what
        // reveals the next phase's units, so the read is "you predicted this —
        // here is what actually happened".
        setCurrentPhaseIndex(i => (i < totalPhases - 1 ? i + 1 : i))
      }, LOGGED_HOLD_MS)
    },
    [totalPhases]
  )

  useEffect(() => () => clearTimeout(dismissTimerRef.current), [])

  // ── Advance to next phase ─────────────────────────────────────────────────

  function handleAdvance() {
    if (awaitingDecision) return
    const phase = phases[currentPhaseIndex]
    if (!phase) return

    // Mark phase complete
    setCompletedPhases(prev => new Set([...prev, currentPhaseIndex]))

    if (phase.subDecision) {
      // Stay on this phase while its question is open. Advancing the index
      // here used to put the NEXT phase's time and headline above a question
      // about the phase just gone — "24 Feb 06:00, Hostomel airfield assault"
      // sitting over "what would they hit in the opening hour?".
      setAwaitingDecision(true)
    } else {
      // No sub-decision: just move to next phase (or flag last complete)
      if (currentPhaseIndex < totalPhases - 1) {
        setCurrentPhaseIndex(i => i + 1)
      }
    }
  }

  // ── Final submit ──────────────────────────────────────────────────────────

  async function handleFinalSubmit() {
    if (submitting) return
    setSubmitting(true)
    try {
      await onSubmit({ subDecisions: subDecisionAnswers })
    } finally {
      setSubmitting(false)
    }
  }

  // The open question always belongs to the phase on screen.
  const activeSubDecision = awaitingDecision
    ? phases[currentPhaseIndex]?.subDecision ?? null
    : null

  // Phase is "live" (glowing chip) if it has not been completed yet
  const isLive = !completedPhases.has(currentPhaseIndex)

  return (
    <div
      className="flex flex-col h-full min-h-0 w-full"
      data-testid="map-live-stage"
    >
      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto cf-stage-scroll px-4 py-4 flex flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <StageHeader
        eyebrow={chapterTitle || 'Live situation'}
        title="Live Situation Map"
        aside={currentPhase && (
          <PhaseChip
            phaseIndex={currentPhaseIndex}
            totalPhases={totalPhases}
            timeLabel={currentPhase.timeLabel}
            isLive={isLive}
          />
        )}
      />

      {/* UnitsLayer draws a ring at each unit's `fromHotspotId`, so the settled
          history is passed with that field rewritten to the destination. The
          live phase goes through `movements` untouched, because MapMotionLayer
          needs both ends of the journey to fly it. */}
      {/* The map takes whatever height is left rather than a fixed 45vh, and
          sits beside the question on wide screens, above it on narrow ones.
          Stacked, a 4-option question under a fixed map could not fit a
          laptop screen, so the stage scrolled for no reason. The floors keep
          the map usable on a very short screen, where scrolling is fair. */}
      <div className="flex-1 flex flex-col gap-4 min-[900px]:flex-row min-[900px]:min-h-0">
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="relative flex-1 min-h-[160px] min-[900px]:min-h-[240px]">
            {/* Live-feed tag in the map corner */}
            <div className="absolute top-2 right-2 z-[500] pointer-events-none flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-[#06101e]/80 border border-[#e0413a]/40">
              <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[#e0413a] cf-flash-blink" />
              <span className="font-mono text-[9px] font-black tracking-[0.25em] text-[#ff6b63]">LIVE</span>
            </div>
            <MapCanvas
              bounds={mapBounds}
              hotspots={hotspots}
              units={visibleUnits.map(u => ({
                ...u,
                fromHotspotId: u.toHotspotId,   // snap to destination
              }))}
              movements={activeMovements}
              // The moving piece is now a drawn missile / convoy / aircraft and
              // the key under the map names each one, so the per-route labels
              // only landed on top of place names.
              showMovementLabels={false}
              height="100%"
            />
          </div>

          {/* Key for what is moving on the map right now. */}
          {movementLegend.length > 0 && (
            <motion.div
              key={`legend-${currentPhaseIndex}`}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              data-testid="movement-legend"
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1"
            >
              <span className="text-[10px] uppercase tracking-widest text-slate-500 intel-mono">
                On the map now
              </span>
              {movementLegend.map(item => (
                <span
                  key={item.key}
                  className="flex items-center gap-1.5 text-[11px] text-text-muted"
                >
                  <span
                    aria-hidden="true"
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: item.color, boxShadow: `0 0 8px ${item.color}` }}
                  />
                  {item.label}
                </span>
              ))}
            </motion.div>
          )}
        </div>

        {/* ── Sub-decision card (slides in when phase has one) ───────────── */}
        <AnimatePresence>
          {awaitingDecision && activeSubDecision && (
            <motion.div
              key={activeSubDecision.id}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
              className="relative min-[900px]:w-[340px] min-[900px]:shrink-0 min-[900px]:overflow-y-auto"
            >
              <SubDecisionCard
                subDecision={activeSubDecision}
                onCommit={handleSubDecisionCommit}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </div>

      {/* ── Sticky footer controls ─────────────────────────────────────── */}
      <StageFooter
        left={
          <div className="flex items-center gap-1.5" aria-label="Phase progress">
            {phases.map((_, i) => (
              <div
                key={i}
                className={[
                  'h-2 w-5 sm:w-7 rounded-sm transition-all duration-300',
                  completedPhases.has(i)
                    ? 'bg-brand-600 shadow-[0_0_6px_rgba(91,170,255,0.6)]'
                    : i === currentPhaseIndex
                      ? 'bg-brand-400 animate-pulse'
                      : 'bg-slate-500/15 border border-slate-500/50',
                ].join(' ')}
              />
            ))}
          </div>
        }
      >
        {/* Advance button — shown when not on last phase OR last phase not yet complete */}
        {!allPhasesComplete && !awaitingDecision && (
          <ActionButton testId="advance-phase-btn" onClick={handleAdvance}>
            {isLastPhase ? 'Finish the Timeline' : 'Next Step ›'}
          </ActionButton>
        )}

        {/* Final submit — shown after all phases complete */}
        {allPhasesComplete && (
          <ActionButton
            testId="submit-analysis"
            busy={submitting}
            busyLabel="Saving…"
            onClick={handleFinalSubmit}
          >
            See Your Debrief
          </ActionButton>
        )}
      </StageFooter>
    </div>
  )
}
