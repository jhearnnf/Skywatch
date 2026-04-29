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
  const totalQuestionsMax = actors.length * maxQuestionsPerActor

  // ── handlers ───────────────────────────────────────────────────────────────
  function handlePortraitClick(actor) {
    setSelectedActorId((prev) => (prev === actor.id ? null : actor.id))
  }

  async function handleSendQuestion(actorId, question) {
    setPending(true)
    try {
      const result = await sendQuestion(actorId, question)
      const { answer, questionsRemaining: qr } = result ?? {}

      setTranscripts((prev) => ({
        ...prev,
        [actorId]: [
          ...(prev[actorId] ?? []),
          { q: question, a: answer ?? '', askedAt: new Date().toISOString() },
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

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 w-full" data-testid="actor-interrogations-stage">
      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 intel-mono mb-0.5">
            Actor Interrogations
          </p>
          <h2 className="text-base font-extrabold text-text leading-snug">
            Interrogate the participants
            {contextDateLabel ? (
              <span className="font-normal text-text-muted"> — {contextDateLabel}</span>
            ) : null}
          </h2>
        </div>
        <div className="text-xs text-text-muted intel-mono shrink-0">
          <span data-testid="actors-interrogated-count">
            {interrogatedActors.length} actor{interrogatedActors.length !== 1 ? 's' : ''} interrogated
          </span>
          {' · '}
          <span data-testid="questions-used-count">
            {totalQuestionsUsed} / {totalQuestionsMax} questions used
          </span>
        </div>
      </div>

      {/* Pinboard */}
      <div
        ref={boardRef}
        data-testid="pinboard"
        className="relative rounded-2xl border border-slate-300/20 bg-surface p-4"
      >
        {/* Relationship lines layer */}
        {relationships.map((rel, idx) => {
          const from = linePositions[rel.fromActorId]
          const to   = linePositions[rel.toActorId]
          if (!from || !to) return null
          return (
            <RelationshipLine
              key={idx}
              from={from}
              to={to}
              label={rel.label}
              width={boardSize.w}
              height={boardSize.h}
            />
          )
        })}

        {/* Actor card grid */}
        <div className="relative z-10 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
          {actors.map((actor) => (
            <div
              key={actor.id}
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
              />
            </div>
          ))}
        </div>
      </div>

      {/* Hint text */}
      <p className="text-xs text-text-muted text-center">
        Click an actor to open the interrogation panel. You may ask up to {maxQuestionsPerActor} question{maxQuestionsPerActor !== 1 ? 's' : ''} per actor.
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
          {isSubmitting ? 'Submitting…' : 'Done — Continue'}
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
          />
        )}
      </AnimatePresence>
    </div>
  )
}
