/**
 * MapPredictiveStage — player draws expected military thrust axes between hotspots.
 *
 * Stage payload shape:
 *   {
 *     mapBounds:  { south, west, north, east },
 *     hotspots:   [{ id, label, lat, lng, kind }],
 *     tokenCount: number,   // max axes (typically 3)
 *     prompt:     string,   // e.g. "Draw expected thrust axes"
 *   }
 *
 * onSubmit({ axes: [{ fromHotspotId, toHotspotId, markedAsMain: boolean }] })
 *
 * Interaction:
 *   • Click hotspot #1 → "selected" (focusedHotspotId set)
 *   • Click hotspot #2 → axis committed (1 token consumed)
 *   • Disallows self-axes and duplicates
 *   • Click committed axis label → deletes it (token returned)
 *   • "Main effort" toggle: at most one axis marked; clicking another moves the flag
 *   • "Commit Analysis" → calls onSubmit; button disabled while pending
 *
 * Presentation-only — no fetch.
 */

import React, { useState, useCallback, useId } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import MapCanvas from '../MapCanvas'
import { StageHeader, StageFooter, ActionButton, Stamp } from '../CaseFileKit'

// ── Helpers ──────────────────────────────────────────────────────────────────

function axisKey(fromId, toId) {
  return `${fromId}→${toId}`
}

function isDuplicateAxis(axes, fromId, toId) {
  return axes.some(
    a =>
      (a.fromHotspotId === fromId && a.toHotspotId === toId) ||
      (a.fromHotspotId === toId   && a.toHotspotId === fromId)
  )
}

// ── AxisList — one slot per route the player may draw ────────────────────────
// Every slot is on screen from the start, empty ones as dashed placeholders.
// The list used to grow a row per route, which shrank the map above it in one
// jump every time a route was drawn. Fixed slots keep the map still, and read
// as a loadout to fill.

const SLOT_CLASS = 'h-[52px] rounded-sm'

function AxisList({ axes, hotspots, mainAxisId, onDelete, onToggleMain, tokenCount, selecting }) {
  function label(hs, id) {
    const h = hs.find(h => h.id === id)
    return h?.label ?? id
  }

  const empties = Array.from({ length: Math.max(0, tokenCount - axes.length) }, (_, k) => axes.length + k)

  return (
    <ul className="flex flex-col gap-2">
      <AnimatePresence initial={false} mode="popLayout">
      {axes.map((axis, i) => {
        const isMain = axis.id === mainAxisId
        return (
          <motion.li
            key={axis.id}
            layout
            initial={{ opacity: 0, x: -16, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 16, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className={[
              SLOT_CLASS,
              'relative flex items-center gap-2 pl-3 pr-2 bg-surface-raised border border-l-4 transition-colors',
              isMain ? 'border-amber-600/50 border-l-amber-500' : 'border-slate-300/25 border-l-[#e0413a]',
            ].join(' ')}
          >
            {/* Axis label */}
            <span className="flex-1 min-w-0 flex flex-col">
              <span className="font-mono text-[9px] tracking-[0.2em] text-text-muted uppercase">
                Route {String(i + 1).padStart(2, '0')}
              </span>
              <span className="text-sm intel-mono text-text">
                {label(hotspots, axis.fromHotspotId)}
                <span className="mx-1.5" style={{ color: '#e0413a' }}>➔</span>
                {label(hotspots, axis.toHotspotId)}
              </span>
            </span>

            {/* Main effort toggle */}
            <button
              type="button"
              data-testid={`main-toggle-${axis.id}`}
              onClick={() => onToggleMain(axis.id)}
              title={isMain ? 'This is your main attack. Click to unmark it.' : 'Mark this as the main attack'}
              className={[
                'text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded-full border',
                'transition-colors duration-150',
                isMain
                  ? 'bg-amber-600/20 border-amber-600/60 text-amber-600'
                  : 'border-slate-400/40 text-slate-500 hover:border-amber-600/40 hover:text-amber-600',
              ].join(' ')}
            >
              {isMain ? '★ MAIN ATTACK' : '☆ MAIN ATTACK'}
            </button>

            {/* Delete */}
            <button
              type="button"
              data-testid={`delete-axis-${axis.id}`}
              onClick={() => onDelete(axis.id)}
              title="Remove this route"
              className="text-slate-500 hover:text-red-400 transition-colors duration-150 text-base leading-none px-1"
            >
              ×
            </button>
          </motion.li>
        )
      })}
      {empties.map((slot) => {
        // The next slot to fill says what to do; the rest just wait.
        const isNext = slot === axes.length
        return (
          <motion.li
            key={`empty-${slot}`}
            layout
            data-testid={`route-slot-empty-${slot}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2 }}
            className={[
              SLOT_CLASS,
              'flex items-center gap-3 pl-3 pr-2 border border-dashed transition-colors duration-200',
              isNext && selecting ? 'border-brand-600/70 bg-brand-100/20' : 'border-slate-500/40',
            ].join(' ')}
          >
            <span className="font-mono text-[9px] tracking-[0.2em] text-text-muted uppercase shrink-0">
              Route {String(slot + 1).padStart(2, '0')}
            </span>
            <span className={['text-xs intel-mono truncate', isNext ? (selecting ? 'text-brand-600 animate-pulse' : 'text-text-muted') : 'text-slate-500/70'].join(' ')}>
              {isNext
                ? (selecting ? 'Now click where the attack would go' : 'Empty. Click a start point on the map')
                : 'Empty'}
            </span>
          </motion.li>
        )
      })}
      </AnimatePresence>
    </ul>
  )
}

// ── MapPredictiveStage ────────────────────────────────────────────────────────

export default function MapPredictiveStage({ stage, sessionContext: _ctx, onSubmit }) {
  const { mapBounds, hotspots = [], tokenCount = 3, prompt = 'Where do you think they will attack?' } =
    stage?.payload ?? {}

  const [axes,          setAxes]          = useState([])
  const [selectedHsId,  setSelectedHsId]  = useState(null)   // first hotspot clicked
  const [mainAxisId,    setMainAxisId]    = useState(null)   // axis marked main effort
  const [pending,       setPending]       = useState(false)
  const axisCounter                       = React.useRef(0)

  const tokensUsed      = axes.length
  const tokensRemaining = tokenCount - tokensUsed
  const canDraw         = tokensRemaining > 0

  // ── Hotspot click ─────────────────────────────────────────────────────────

  const handleHotspotClick = useCallback(
    (id) => {
      if (!selectedHsId) {
        // First selection
        setSelectedHsId(id)
        return
      }

      if (id === selectedHsId) {
        // Clicked same hotspot — deselect
        setSelectedHsId(null)
        return
      }

      // Attempt to commit an axis
      if (!canDraw) {
        setSelectedHsId(null)
        return
      }

      if (isDuplicateAxis(axes, selectedHsId, id)) {
        setSelectedHsId(null)
        return
      }

      axisCounter.current += 1
      const newAxis = {
        id:           `axis-${axisCounter.current}`,
        fromHotspotId: selectedHsId,
        toHotspotId:   id,
        markedAsMain:  false,
      }

      setAxes(prev => [...prev, newAxis])
      setSelectedHsId(null)
    },
    [selectedHsId, axes, canDraw]
  )

  // ── Delete axis ───────────────────────────────────────────────────────────

  const handleDelete = useCallback(
    (axisId) => {
      setAxes(prev => prev.filter(a => a.id !== axisId))
      if (mainAxisId === axisId) setMainAxisId(null)
    },
    [mainAxisId]
  )

  // ── Toggle main effort ────────────────────────────────────────────────────

  const handleToggleMain = useCallback(
    (axisId) => {
      setMainAxisId(prev => (prev === axisId ? null : axisId))
    },
    []
  )

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (pending) return
    setPending(true)
    try {
      await onSubmit({
        axes: axes.map(a => ({
          fromHotspotId: a.fromHotspotId,
          toHotspotId:   a.toHotspotId,
          markedAsMain:  a.id === mainAxisId,
        })),
      })
    } finally {
      setPending(false)
    }
  }

  // ── Build axes prop for MapCanvas ─────────────────────────────────────────

  // `animated` makes each committed route flow from its start point towards its
  // target. A drawn line says "these two places are related"; a flowing one says
  // which way the player thinks the attack goes, which is the whole prediction.
  const mapAxes = axes.map(a => ({
    id:            a.id,
    fromHotspotId: a.fromHotspotId,
    toHotspotId:   a.toHotspotId,
    color:         a.id === mainAxisId ? '#e74c3c' : '#c0392b',
    dashed:        false,
    animated:      true,
  }))

  // In-progress axis (first hotspot selected, awaiting second)
  // We render a hint in the UI but don't add a phantom polyline to avoid
  // cursor-tracking complexity without a mousemove handler.

  return (
    <div className="flex flex-col h-full min-h-0 w-full" data-testid="map-predictive-stage">
      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto cf-stage-scroll px-4 py-4 flex flex-col gap-4">
        {/* Header */}
        <StageHeader
          eyebrow="Threat assessment"
          title={prompt}
          aside={
            <div
              className="text-sm intel-mono text-slate-500 shrink-0"
              data-testid="token-counter"
            >
              <span className="text-text font-bold">{tokensUsed}</span>
              <span className="mx-1">/</span>
              <span>{tokenCount}</span>
              <span className="ml-1 text-slate-500">routes drawn</span>
            </div>
          }
        >
          {/* Always occupies its line. Mounting this only once a hotspot was
              picked shoved the map down by its height mid-interaction, so the
              second click landed on empty sea instead of the hotspot the
              player was aiming at. */}
          <p
            aria-hidden={!selectedHsId && canDraw}
            className={[
              'text-xs intel-mono flex items-center gap-1.5 transition-colors',
              selectedHsId ? 'text-brand-600' : !canDraw ? 'text-amber-600' : 'invisible',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className={['w-1.5 h-1.5 rounded-full animate-pulse', !selectedHsId && !canDraw ? 'bg-amber-600' : 'bg-brand-600'].join(' ')}
            />
            {!selectedHsId && !canDraw
              ? `All ${tokenCount} routes used. Remove one to draw another`
              : 'Start point set. Now click where the attack would go'}
          </p>
        </StageHeader>

        {/* Token pips */}
        <div className="flex gap-1.5" aria-label="Tokens">
          {Array.from({ length: tokenCount }).map((_, i) => (
            <div
              key={i}
              className={[
                'h-2 flex-1 rounded-sm transition-all duration-300',
                i < tokensUsed
                  ? 'bg-[#e0413a] shadow-[0_0_8px_rgba(224,65,58,0.55)]'
                  : 'bg-slate-500/15 border border-slate-500/50',
              ].join(' ')}
            />
          ))}
        </div>

        {/* Map: fills the height the header and route list leave, rather than
            a fixed 45vh that made the stage scroll on a tall screen. */}
        <div className="relative flex-1 min-h-[240px]">
        <MapCanvas
          bounds={mapBounds}
          hotspots={hotspots}
          axes={mapAxes}
          focusedHotspotId={selectedHsId}
          onHotspotClick={handleHotspotClick}
          height="100%"
        />
        {/* Once a main attack is picked, say so on the map itself. */}
        <AnimatePresence>
          {mainAxisId && (
            <motion.div
              key="main-stamp"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              // Clipped to the map: mid-slam the stamp is 2.6x its size, and
              // poking past the stage it summoned a scrollbar that narrowed
              // the map and made it flash as if reloading.
              className="absolute inset-0 z-[500] pointer-events-none overflow-hidden rounded-md"
            >
              <div className="absolute top-3 right-3">
                <Stamp tone="amber" size="xs" rotate={-6}>Main attack marked</Stamp>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>


        {/* Committed axes list */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">
            Routes you have drawn
          </h4>
          <AxisList
            axes={axes}
            hotspots={hotspots}
            mainAxisId={mainAxisId}
            onDelete={handleDelete}
            onToggleMain={handleToggleMain}
            tokenCount={tokenCount}
            selecting={!!selectedHsId}
          />
        </div>
      </div>

      {/* Sticky footer: Submit */}
      <StageFooter>
        <ActionButton
          testId="submit-analysis"
          busy={pending}
          busyLabel="Saving…"
          onClick={handleSubmit}
        >
          Save Routes and Continue
        </ActionButton>
      </StageFooter>
    </div>
  )
}
