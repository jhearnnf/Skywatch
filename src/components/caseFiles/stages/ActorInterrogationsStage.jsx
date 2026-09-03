/**
 * ActorInterrogationsStage
 * Orchestrates the actor-interrogations stage of the Case Files game.
 *
 * Props (component contract)
 *   stage          { id, type: 'actor_interrogations', payload }
 *   sessionContext { caseSlug, chapterSlug, sessionId, priorResults }
 *   onSubmit       (resultPayload) => Promise<void>
 *   sendQuestion   (actorId, question) => Promise<{ answer, questionsRemaining }>
 *
 * stage.payload shape
 *   {
 *     actors:              [{ id, name, role, faction, portraitUrl?, systemPromptKey }],
 *     relationships:       [{ fromActorId, toActorId, label }],
 *     maxQuestionsPerActor: number (default 3),
 *     contextDateLabel:    string,
 *   }
 *
 * CONTRACT-AMBIGUITY: The spec says "Done button (always enabled)". The Done
 * button here is always enabled regardless of interrogation count, per spec.
 *
 * CONTRACT-AMBIGUITY: questionsRemaining from server response takes precedence
 * over locally tracked value; if the server response is absent we fall back to
 * decrementing the local counter. We initialise per-actor questionsRemaining to
 * maxQuestionsPerActor and update it from server responses.
 *
 * CONTRACT-AMBIGUITY: Relationship line coordinates are computed from DOM
 * layout via useRef + ResizeObserver on the pinboard container. Lines recompute
 * on each resize. If a card ref is missing (actor not yet mounted), that
 * relationship line is skipped rather than throwing.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { AnimatePresence } from 'framer-motion'
import ActorPortrait from '../ActorPortrait'
import RelationshipLine from '../RelationshipLine'
import InterrogationPanel from '../InterrogationPanel'

// ── helpers ──────────────────────────────────────────────────────────────────

// Vertical offset applied per card, cycling across the grid. Cards used to sit
// on one baseline per row, so any line between two actors in the same row was
// perfectly horizontal: several of them ran along the same strip, and each one
// passed straight through whatever cards sat in between. Pinning alternate
// columns higher and lower gives every line its own slope, which is what makes
// one traceable by eye. It also reads more like a real pinboard.
const CARD_STAGGER_PX = [0, 30, 14]
// Enough room under the grid for the lowest-pinned column, on top of the
// board's own padding.
const CARD_STAGGER_MAX = Math.max(...CARD_STAGGER_PX)

function buildInitialTranscripts(actors) {
  return Object.fromEntries(actors.map((a) => [a.id, []]))
}

function buildInitialQuestionsRemaining(actors, maxQuestionsPerActor) {
  return Object.fromEntries(actors.map((a) => [a.id, maxQuestionsPerActor]))
}

// Returns the centre {x, y} of a DOM element relative to a container element.
function getCentre(el, containerEl) {
  const elRect        = el.getBoundingClientRect()
  const containerRect = containerEl.getBoundingClientRect()
  return {
    x: elRect.left - containerRect.left + elRect.width  / 2,
    y: elRect.top  - containerRect.top  + elRect.height / 2,
  }
}

// ── component ─────────────────────────────────────────────────────────────────

export default function ActorInterrogationsStage({
  stage,
  sessionContext,   // eslint-disable-line no-unused-vars — available for future use
  onSubmit,
  sendQuestion,
}) {
  const payload  = stage?.payload ?? {}
  const {
    actors               = [],
    relationships        = [],
    maxQuestionsPerActor = 3,
    contextDateLabel     = '',
  } = payload

  // ── state ──────────────────────────────────────────────────────────────────
  const [selectedActorId, setSelectedActorId] = useState(null)
  const [hoveredActorId,  setHoveredActorId]  = useState(null)
  const [transcripts, setTranscripts]         = useState(() => buildInitialTranscripts(actors))
  const [questionsRemaining, setQuestionsRemaining] = useState(() =>
    buildInitialQuestionsRemaining(actors, maxQuestionsPerActor)
  )
  const [pending, setPending]     = useState(false)
  const [linePositions, setLinePositions] = useState({}) // actorId → {x, y}
  const [boardSize, setBoardSize]         = useState({ w: 0, h: 0 })
  const [isSubmitting, setIsSubmitting]   = useState(false)

  // ── refs ───────────────────────────────────────────────────────────────────
  const boardRef    = useRef(null)          // pinboard container
  const cardRefs    = useRef({})            // actorId → DOM element

  // ── line position computation ──────────────────────────────────────────────
  const recomputeLines = useCallback(() => {
    const board = boardRef.current
    if (!board) return
    const { width, height } = board.getBoundingClientRect()
    setBoardSize({ w: width, h: height })

    const positions = {}
    for (const actor of actors) {
      const el = cardRefs.current[actor.id]
      if (!el) continue
      positions[actor.id] = getCentre(el, board)
    }
    setLinePositions(positions)
  }, [actors])

  useEffect(() => {
    recomputeLines()
    window.addEventListener('resize', recomputeLines)
    return () => window.removeEventListener('resize', recomputeLines)
  }, [recomputeLines])

  // ResizeObserver on the board itself (handles sidebar open/close etc.)
  useEffect(() => {
    const board = boardRef.current
    if (!board || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(recomputeLines)
    ro.observe(board)
    return () => ro.disconnect()
  }, [recomputeLines])

  // ── derived stats ──────────────────────────────────────────────────────────
  const interrogatedActors = actors.filter(
    (a) => (transcripts[a.id] ?? []).length > 0
  )
  const totalQuestionsUsed = actors.reduce(
    (sum, a) => sum + (transcripts[a.id] ?? []).length,
    0
  )

  // ── handlers ───────────────────────────────────────────────────────────────
  function handlePortraitClick(actor) {
    setSelectedActorId((prev) => (prev === actor.id ? null : actor.id))
  }

  async function handleSendQuestion(actorId, question) {
    setPending(true)
    try {
      const result = await sendQuestion(actorId, question)
      const { answer, questionsRemaining: qr, mood } = result ?? {}

      setTranscripts((prev) => ({
        ...prev,
        [actorId]: [
          ...(prev[actorId] ?? []),
          // `mood` drives the portrait's reaction in InterrogationPanel. It is
          // optional: the panel falls back to reading the answer itself.
          { q: question, a: answer ?? '', mood, askedAt: new Date().toISOString() },
        ],
      }))

      setQuestionsRemaining((prev) => ({
        ...prev,
        [actorId]: typeof qr === 'number' ? qr : Math.max(0, (prev[actorId] ?? 0) - 1),
      }))
    } finally {
      setPending(false)
    }
  }

  async function handleDone() {
    if (isSubmitting) return
    setIsSubmitting(true)
    const interrogations = interrogatedActors.map((a) => ({
      actorId:       a.id,
      questionCount: (transcripts[a.id] ?? []).length,
    }))
    try {
      await onSubmit({ interrogations })
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── selected actor ─────────────────────────────────────────────────────────
  const selectedActor = actors.find((a) => a.id === selectedActorId) ?? null

  // Hover wins over selection: while the panel is open the player is often
  // scanning the board for who to ask next.
  const activeRelationshipActorId = hoveredActorId ?? selectedActorId

  function isActiveRelationship(rel) {
    return (
      activeRelationshipActorId != null &&
      (rel.fromActorId === activeRelationshipActorId || rel.toActorId === activeRelationshipActorId)
    )
  }

  const nameById = Object.fromEntries(actors.map((a) => [a.id, a.name]))

  // Everyone the given actor is tied to, as readable text. This is what the
  // line labels used to try to say on the board itself.
  function connectionsFor(actorId) {
    if (!actorId) return []
    return relationships
      .filter((rel) => rel.fromActorId === actorId || rel.toActorId === actorId)
      .map((rel) => {
        const otherId = rel.fromActorId === actorId ? rel.toActorId : rel.fromActorId
        return { id: otherId, name: nameById[otherId] ?? otherId, label: rel.label }
      })
      .filter((c) => c.name)
  }

  const activeActor       = actors.find((a) => a.id === activeRelationshipActorId) ?? null
  const activeConnections = connectionsFor(activeRelationshipActorId)

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 w-full" data-testid="actor-interrogations-stage">
      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 intel-mono mb-0.5">
            Who to ask
          </p>
          <h2 className="text-base font-extrabold text-text leading-snug">
            Ask the people involved
            {contextDateLabel ? (
              <span className="font-normal text-text-muted">, {contextDateLabel}</span>
            ) : null}
          </h2>
        </div>
        <div className="text-xs text-text-muted intel-mono shrink-0">
          <span data-testid="actors-interrogated-count">
            {interrogatedActors.length} of {actors.length} people asked
          </span>
          {' · '}
          <span data-testid="questions-used-count">
            {totalQuestionsUsed} question{totalQuestionsUsed !== 1 ? 's' : ''} used, up to {maxQuestionsPerActor} each
          </span>
        </div>
      </div>

      {/* Pinboard */}
      <div
        ref={boardRef}
        data-testid="pinboard"
        className="relative rounded-2xl border border-slate-300/20 bg-surface p-4"
        style={{ paddingBottom: 16 + CARD_STAGGER_MAX }}
      >
        {/* Actor card grid */}
        {/* Wider gutters as well as the stagger: a longer run between two cards
            is easier to follow than a short one crammed between neighbours. */}
        <div className="relative z-10 grid gap-x-5 gap-y-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
          {actors.map((actor, i) => (
            <div
              key={actor.id}
              data-testid={`actor-slot-${actor.id}`}
              style={{ transform: `translateY(${CARD_STAGGER_PX[i % CARD_STAGGER_PX.length]}px)` }}
              ref={(el) => {
                if (el) {
                  cardRefs.current[actor.id] = el
                } else {
                  delete cardRefs.current[actor.id]
                }
              }}
            >
              <ActorPortrait
                actor={actor}
                isSelected={selectedActorId === actor.id}
                onClick={handlePortraitClick}
                onHoverChange={(hovering) => setHoveredActorId(hovering ? actor.id : null)}
              />
            </div>
          ))}
        </div>

        {/* Relationship lines layer — drawn AFTER the grid so a line reads as
            one continuous run instead of being sliced up by the cards it
            passes. The line touching the actor under the cursor (or the one
            being interrogated) is brightened; the label for it is in the strip
            below the board. */}
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
          {relationships.map((rel, idx) => {
            const from = linePositions[rel.fromActorId]
            const to   = linePositions[rel.toActorId]
            if (!from || !to) return null
            return (
              <RelationshipLine
                key={idx}
                from={from}
                to={to}
                highlighted={isActiveRelationship(rel)}
                width={boardSize.w}
                height={boardSize.h}
              />
            )
          })}
        </div>
      </div>

      {/* Connections strip. Fixed height so revealing it never shifts the board
          under the cursor, and it reads the same on a phone, where there is no
          hover at all and the board labels were simply never visible. */}
      {relationships.length > 0 && (
        <div
          data-testid="connections-strip"
          className="min-h-[2.5rem] rounded-xl border border-slate-300/15 bg-surface-raised px-3 py-2 flex flex-wrap items-center justify-center gap-1.5"
        >
          {activeActor && activeConnections.length > 0 ? (
            <>
              <span className="intel-mono text-[10px] uppercase tracking-widest text-brand-600 mr-1">
                {activeActor.name} is tied to
              </span>
              {activeConnections.map((c) => (
                <span
                  key={c.id}
                  className="text-[11px] leading-tight px-2 py-0.5 rounded-full border border-brand-600/30 bg-brand-100/25 text-text"
                >
                  {c.name}
                  {c.label && <span className="text-text-muted"> · {c.label}</span>}
                </span>
              ))}
            </>
          ) : (
            <span className="text-xs text-text-muted text-center">
              Hover or open a person to see who they are tied to.
            </span>
          )}
        </div>
      )}

      {/* Hint text */}
      <p className="text-xs text-text-muted text-center">
        Click a person to open their interview panel. You get up to {maxQuestionsPerActor} question{maxQuestionsPerActor !== 1 ? 's' : ''} each.
      </p>
      </div>

      {/* Sticky footer: Done button */}
      <div className="shrink-0 border-t border-slate-300/10 bg-surface px-4 py-3 flex justify-end">
        <button
          data-testid="done-button"
          onClick={handleDone}
          disabled={isSubmitting}
          className={[
            'px-6 py-2.5 rounded-xl font-bold text-sm transition-all duration-150',
            isSubmitting
              ? 'bg-slate-300/20 text-slate-500 cursor-not-allowed'
              : 'bg-brand-600 text-white hover:bg-brand-700 active:scale-95',
          ].join(' ')}
        >
          {isSubmitting ? 'Submitting…' : 'Done, Continue'}
        </button>
      </div>

      {/* Interrogation panel overlay */}
      <AnimatePresence>
        {selectedActor && (
          <InterrogationPanel
            key={selectedActor.id}
            actor={selectedActor}
            transcript={transcripts[selectedActor.id] ?? []}
            questionsRemaining={questionsRemaining[selectedActor.id] ?? 0}
            onSendQuestion={(q) => handleSendQuestion(selectedActor.id, q)}
            onClose={() => setSelectedActorId(null)}
            isPending={pending}
            contextDateLabel={contextDateLabel}
            connections={connectionsFor(selectedActor.id)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
