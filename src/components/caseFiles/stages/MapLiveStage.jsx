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
 * CONTRACT-AMBIGUITY: unit animation strategy — V1 uses destination-snap with
 * a motion.div fade-in rather than smooth path-following animation.
 * Rationale: MapCanvas renders units via react-leaflet CircleMarker which cannot
 * be driven by framer-motion directly without piercing the Leaflet layer.
 * Implementing a full SVG overlay that projects lat/lng to pixel coordinates
 * (and tracks map pan/zoom) is correct but complex for V1.
 * V2 can replace UnitsLayer with an animated SVG pane overlay using Leaflet's
 * containerPointToLatLng + map 'moveend'/'zoomend' events.
 * For V1: units appear at their DESTINATION position when the phase activates,
 * with a fade-in animation. The cumulative unit list is passed to MapCanvas as
 * `units` so the existing UnitsLayer renders them as CircleMarkers.
 *
 * CONTRACT-AMBIGUITY: phase progression — V1 is player-driven ("Advance" button).
 * Auto-timer (animationMs) is noted for V2.
 *
 * Presentation-only — no fetch.
 */

import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import MapCanvas from '../MapCanvas'

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
      className="rounded-2xl border border-brand-400/40 bg-surface p-5 flex flex-col gap-4 shadow-[0_4px_32px_rgba(91,170,255,0.18)]"
    >
      {/* Lock stamp overlay when committed */}
      {committed && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 rounded-2xl overflow-hidden">
          <span className="text-[10px] font-black tracking-[0.3em] uppercase px-4 py-2 rounded border-4 border-brand-600/80 text-brand-600/90 rotate-[-12deg] select-none font-mono">
            Logged
          </span>
        </div>
      )}

      <p
        data-testid="sub-decision-prompt"
        className="text-sm font-bold text-text leading-snug"
      >
        {prompt}
      </p>

      <div className="flex flex-col gap-2">
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
                'flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm text-left transition-all duration-150 w-full',
                committed ? 'cursor-default opacity-70' : 'cursor-pointer',
                isSelected
                  ? 'border-brand-500 bg-brand-100/50 text-text'
                  : 'border-slate-300/30 bg-surface-raised text-text hover:border-brand-400/50',
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
              'px-5 py-2 rounded-xl text-sm font-bold tracking-wide transition-opacity duration-150',
              multiSelected.size > 0
                ? 'bg-brand-600 text-white hover:opacity-90'
                : 'bg-surface-raised text-text-faint border border-slate-300/30 cursor-not-allowed',
            ].join(' ')}
          >
            Confirm Selection
          </button>
        </div>
      )}
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

  const chapterTitle  = sessionContext?.chapterSlug ?? ''
  const totalPhases   = phases.length

  // Track which phase we're on (0-indexed), and which are complete
  const [currentPhaseIndex,  setCurrentPhaseIndex]  = useState(0)
  const [completedPhases,    setCompletedPhases]     = useState(new Set())
  const [subDecisionAnswers, setSubDecisionAnswers]  = useState([])
  const [awaitingDecision,   setAwaitingDecision]    = useState(false)
  const [submitting,         setSubmitting]          = useState(false)

  const currentPhase = phases[currentPhaseIndex] ?? null
  const isLastPhase  = currentPhaseIndex === totalPhases - 1
  const allPhasesComplete = completedPhases.size === totalPhases

  // Accumulate all units from all phases that are at or before current phase
  // CONTRACT-AMBIGUITY: V1 destination-snap — we show units at their
  // DESTINATION position. They fade in when the phase that introduced them
  // becomes active. All units from phase 0..currentPhaseIndex are rendered.
  const visibleUnits = phases
    .slice(0, currentPhaseIndex + 1)
    .flatMap(p => p.units ?? [])

  // ── Sub-decision commit callback ─────────────────────────────────────────

  const handleSubDecisionCommit = useCallback(
    (subDecisionId, selectedOptionIds) => {
      setSubDecisionAnswers(prev => [
        ...prev,
        { subDecisionId, selectedOptionIds },
      ])
      setAwaitingDecision(false)
    },
    []
  )

  // ── Advance to next phase ─────────────────────────────────────────────────

  function handleAdvance() {
    if (awaitingDecision) return
    const phase = phases[currentPhaseIndex]
    if (!phase) return

    // Mark phase complete
    setCompletedPhases(prev => new Set([...prev, currentPhaseIndex]))

    if (phase.subDecision) {
      // Show sub-decision card; user must answer before advancing further
      setAwaitingDecision(true)
      if (currentPhaseIndex < totalPhases - 1) {
        setCurrentPhaseIndex(i => i + 1)
      }
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

  // Determine the sub-decision to show: the PREVIOUS phase's subDecision
  // (since we advance the index when setting awaitingDecision).
  // CONTRACT-AMBIGUITY: when awaitingDecision is true, the sub-decision
  // belongs to the phase that was just advanced past (currentPhaseIndex - 1).
  const activeSubDecision = awaitingDecision
    ? phases[currentPhaseIndex - 1]?.subDecision ?? null
    : null

  // Phase is "live" (glowing chip) if it has not been completed yet
  const isLive = !completedPhases.has(currentPhaseIndex)

  return (
    <div
      className="flex flex-col h-full min-h-0 w-full"
      data-testid="map-live-stage"
    >
      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          {chapterTitle && (
            <p className="text-[10px] font-bold tracking-widest uppercase text-text-muted font-mono mb-1">
              {chapterTitle}
            </p>
          )}
          <h3 className="text-base font-bold text-text">Live Situation Map</h3>
        </div>

        {currentPhase && (
          <PhaseChip
            phaseIndex={currentPhaseIndex}
            totalPhases={totalPhases}
            timeLabel={currentPhase.timeLabel}
            isLive={isLive}
          />
        )}
      </div>

      {/* ── Map — capped at 45vh so sub-decision card + footer remain visible */}
      {/* CONTRACT-AMBIGUITY: units passed to MapCanvas as the cumulative list
          from phases 0..currentPhaseIndex. The UnitsLayer in MapCanvas renders
          them at their destination (fromHotspotId is used as origin by MapCanvas
          V1 stub, which renders at fromHotspotId position). For MapLive we want
          units at their DESTINATION — we therefore pass a transformed list where
          fromHotspotId = toHotspotId so MapCanvas places the dot at the endpoint.
          This is fully compatible with MapCanvas's existing UnitsLayer without
          modifying it. */}
      <MapCanvas
        bounds={mapBounds}
        hotspots={hotspots}
        units={visibleUnits.map(u => ({
          ...u,
          fromHotspotId: u.toHotspotId,   // snap to destination
        }))}
        height="45vh"
      />

      {/* ── Sub-decision card (slides in when phase has one) ───────────── */}
      <AnimatePresence>
        {awaitingDecision && activeSubDecision && (
          <div className="relative">
            <SubDecisionCard
              key={activeSubDecision.id}
              subDecision={activeSubDecision}
              onCommit={handleSubDecisionCommit}
            />
          </div>
        )}
      </AnimatePresence>
      </div>

      {/* ── Sticky footer controls ─────────────────────────────────────── */}
      <div className="shrink-0 border-t border-slate-300/10 bg-surface px-4 py-3 flex items-center justify-between gap-4">
        {/* Phase indicator dots */}
        <div className="flex gap-1.5" aria-label="Phase progress">
          {phases.map((_, i) => (
            <div
              key={i}
              className={[
                'h-1.5 w-6 rounded-full transition-colors duration-300',
                completedPhases.has(i)
                  ? 'bg-brand-600'
                  : i === currentPhaseIndex
                    ? 'bg-brand-400 animate-pulse'
                    : 'bg-slate-300/30',
              ].join(' ')}
            />
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          {/* Advance button — shown when not on last phase OR last phase not yet complete */}
          {!allPhasesComplete && !awaitingDecision && (
            <button
              type="button"
              data-testid="advance-phase-btn"
              onClick={handleAdvance}
              className="px-5 py-2 rounded-xl text-sm font-bold tracking-wide bg-surface-raised border border-slate-300/40 text-text hover:border-brand-400/50 transition-colors duration-150"
            >
              {isLastPhase ? 'Complete Phase' : 'Advance ›'}
            </button>
          )}

          {/* Final submit — shown after all phases complete */}
          {allPhasesComplete && (
            <motion.button
              type="button"
              data-testid="submit-analysis"
              disabled={submitting}
              onClick={handleFinalSubmit}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className={[
                'px-6 py-2.5 rounded-xl text-sm font-bold tracking-wide transition-opacity duration-150',
                'bg-brand-600 text-white shadow-[0_0_18px_rgba(91,170,255,0.35)]',
                submitting ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90',
              ].join(' ')}
            >
              {submitting ? 'Submitting…' : 'Submit Analysis'}
            </motion.button>
          )}
        </div>
      </div>
    </div>
  )
}
