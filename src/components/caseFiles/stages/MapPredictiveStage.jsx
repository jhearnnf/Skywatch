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
import MapCanvas from '../MapCanvas'

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

// ── AxisList — sidebar list of committed axes ─────────────────────────────────

function AxisList({ axes, hotspots, mainAxisId, onDelete, onToggleMain }) {
  function label(hs, id) {
    const h = hs.find(h => h.id === id)
    return h?.label ?? id
  }

  if (axes.length === 0) {
    return (
      <p className="text-sm text-slate-500 italic py-2">
        No axes drawn yet. Click two hotspots on the map.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {axes.map(axis => {
        const isMain = axis.id === mainAxisId
        return (
          <li
            key={axis.id}
            className="flex items-center gap-2 rounded-lg px-3 py-2 bg-surface border border-slate-300/30"
          >
            {/* Axis label */}
            <span className="flex-1 text-sm intel-mono text-text">
              <span style={{ color: '#c0392b' }}>→</span>{' '}
              {label(hotspots, axis.fromHotspotId)}
              <span className="text-slate-500 mx-1">›</span>
              {label(hotspots, axis.toHotspotId)}
            </span>

            {/* Main effort toggle */}
            <button
              type="button"
              data-testid={`main-toggle-${axis.id}`}
              onClick={() => onToggleMain(axis.id)}
              title={isMain ? 'Main effort (click to unmark)' : 'Mark as main effort'}
              className={[
                'text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded-full border',
                'transition-colors duration-150',
                isMain
                  ? 'bg-amber-600/20 border-amber-600/60 text-amber-600'
                  : 'border-slate-400/40 text-slate-500 hover:border-amber-600/40 hover:text-amber-600',
              ].join(' ')}
            >
              {isMain ? '★ MAIN' : '☆ MAIN'}
            </button>

            {/* Delete */}
            <button
              type="button"
              data-testid={`delete-axis-${axis.id}`}
              onClick={() => onDelete(axis.id)}
              title="Remove axis"
              className="text-slate-500 hover:text-red-400 transition-colors duration-150 text-base leading-none px-1"
            >
              ×
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ── MapPredictiveStage ────────────────────────────────────────────────────────

export default function MapPredictiveStage({ stage, sessionContext: _ctx, onSubmit }) {
  const { mapBounds, hotspots = [], tokenCount = 3, prompt = 'Draw expected thrust axes' } =
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

  const mapAxes = axes.map(a => ({
    id:            a.id,
    fromHotspotId: a.fromHotspotId,
    toHotspotId:   a.toHotspotId,
    color:         a.id === mainAxisId ? '#e74c3c' : '#c0392b',
    dashed:        false,
  }))

  // In-progress axis (first hotspot selected, awaiting second)
  // We render a hint in the UI but don't add a phantom polyline to avoid
  // cursor-tracking complexity without a mousemove handler.

  return (
    <div className="flex flex-col h-full min-h-0 w-full" data-testid="map-predictive-stage">
      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-base font-bold text-text">{prompt}</h3>
            {selectedHsId && (
              <p className="text-xs text-brand-600 mt-0.5 intel-mono">
                Origin selected — click destination hotspot
              </p>
            )}
          </div>
          <div
            className="text-sm intel-mono text-slate-500 shrink-0"
            data-testid="token-counter"
          >
            <span className="text-text font-bold">{tokensUsed}</span>
            <span className="mx-1">/</span>
            <span>{tokenCount}</span>
            <span className="ml-1 text-slate-500">tokens used</span>
          </div>
        </div>

        {/* Token pips */}
        <div className="flex gap-1.5" aria-label="Tokens">
          {Array.from({ length: tokenCount }).map((_, i) => (
            <div
              key={i}
              className={[
                'h-1.5 flex-1 rounded-full transition-colors duration-200',
                i < tokensUsed ? 'bg-red-400' : 'bg-slate-300/30',
              ].join(' ')}
            />
          ))}
        </div>

        {/* Map — capped at 45vh so the axes list + footer remain reachable on short viewports */}
        <MapCanvas
          bounds={mapBounds}
          hotspots={hotspots}
          axes={mapAxes}
          focusedHotspotId={selectedHsId}
          onHotspotClick={handleHotspotClick}
          height="45vh"
        />

        {/* No-tokens warning */}
        {!canDraw && tokensUsed > 0 && (
          <p className="text-xs text-amber-600 intel-mono">
            All tokens used. Remove an axis to draw another.
          </p>
        )}

        {/* Committed axes list */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">
            Committed Axes
          </h4>
          <AxisList
            axes={axes}
            hotspots={hotspots}
            mainAxisId={mainAxisId}
            onDelete={handleDelete}
            onToggleMain={handleToggleMain}
          />
        </div>
      </div>

      {/* Sticky footer: Submit */}
      <div className="shrink-0 border-t border-slate-300/10 bg-surface px-4 py-3 flex justify-end">
        <button
          type="button"
          data-testid="submit-analysis"
          disabled={pending}
          onClick={handleSubmit}
          className={[
            'px-6 py-2.5 rounded-xl text-sm font-bold tracking-wide transition-opacity duration-150',
            'bg-brand-600 text-white',
            pending ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90',
          ].join(' ')}
        >
          {pending ? 'Committing…' : 'Commit Analysis'}
        </button>
      </div>
    </div>
  )
}
