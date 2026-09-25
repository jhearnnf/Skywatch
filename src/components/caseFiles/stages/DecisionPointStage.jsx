// DecisionPointStage — player faces a key historical decision and picks the
// option they believe the actor took.
//
// Hints render inline by default so knowledge-light players see the relevant
// context without an extra click. A toggle still lets players collapse them.
//
// Props:
//   stage          = { id, type: 'decision_point', payload }
//   sessionContext = { caseSlug, chapterSlug, sessionId, priorResults }
//   onSubmit(resultPayload) → Promise<void>

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Stamp, StickyNote, StageHeader, StageFooter, ActionButton } from '../CaseFileKit'

// ── Stamp that slams onto the chosen card on commit ───────────────────────
function StampOverlay({ show }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="stamp"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
        >
          <Stamp tone="blue" size="md" rotate={-12}>Decision Locked</Stamp>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const OPTION_LETTERS = 'ABCDEFGH'

// ── Individual option card ────────────────────────────────────────────────
function OptionCard({ option, index, selected, committed, dimmed, onSelect }) {
  // Hints default to OPEN so knowledge-light players see the context up front.
  const [hintOpen, setHintOpen] = useState(true)

  function handleClick() {
    if (committed) return
    onSelect(option.id)
  }

  function handleKeyDown(e) {
    if (committed) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(option.id)
    }
  }

  function toggleHint(e) {
    e.stopPropagation()
    setHintOpen(h => !h)
  }

  return (
    <motion.div
      role="button"
      tabIndex={committed ? -1 : 0}
      aria-pressed={selected}
      data-testid={`option-card-${option.id}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      layout
      animate={
        dimmed
          ? { opacity: 0.3, scale: 0.97 }
          : selected
            ? { opacity: 1, scale: 1 }
            : { opacity: 1, scale: 1 }
      }
      transition={{ duration: 0.25 }}
      className={[
        'relative flex flex-col gap-3 rounded-sm border border-l-4 p-4 pt-3 cursor-pointer select-none card-shadow',
        'transition-all duration-200',
        committed
          ? 'cursor-default'
          : 'hover:-translate-y-0.5 hover:border-brand-400',
        selected
          ? 'border-brand-500 border-l-brand-600 bg-brand-100/40 shadow-[0_0_0_2px_rgba(91,170,255,0.25)]'
          : 'border-slate-300/30 border-l-slate-400/50 bg-surface-raised',
      ].filter(Boolean).join(' ')}
    >
      {/* Stamp overlay for committed card */}
      {selected && <StampOverlay show={committed} />}

      {/* File label: "Course of action A" */}
      <div className="flex items-center justify-between gap-2 border-b border-dashed border-slate-300/25 pb-1.5">
        <span className="font-mono text-[9px] font-bold tracking-[0.2em] uppercase text-text-muted">
          Course of action
        </span>
        <span
          aria-hidden="true"
          className={[
            'w-6 h-6 rounded-sm flex items-center justify-center font-mono text-xs font-black border-2 transition-colors',
            selected
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-slate-400/60 text-slate-500',
          ].join(' ')}
        >
          {OPTION_LETTERS[index] ?? index + 1}
        </span>
      </div>

      <p className="text-sm sm:text-[15px] font-bold text-text leading-snug">{option.text}</p>

      {/* Hint toggle */}
      {option.hint && (
        <div>
          <button
            type="button"
            data-testid={`hint-toggle-${option.id}`}
            onClick={toggleHint}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleHint(e) } }}
            className="text-[11px] font-semibold text-amber-600 hover:text-amber-700 transition-colors flex items-center gap-1 font-mono uppercase tracking-wider"
          >
            <span aria-hidden="true">{hintOpen ? '▲' : '▼'}</span>
            {hintOpen ? 'Hide analyst note' : 'Analyst note'}
          </button>

          <AnimatePresence>
            {hintOpen && (
              <motion.div
                key="hint"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden px-1 pt-3 pb-1"
              >
                <StickyNote testId={`hint-text-${option.id}`} tilt={index % 2 ? 1 : -1}>
                  {option.hint}
                </StickyNote>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  )
}

// ── Signals recap panel (pinned context summary) ──────────────────────────
function SignalsRecap({ signals }) {
  if (!Array.isArray(signals) || signals.length === 0) return null
  return (
    <motion.aside
      data-testid="signals-recap"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.35 }}
      className="relative rounded-sm border border-slate-300/25 border-l-2 border-l-[#e0413a]/60 bg-surface-raised px-4 py-3 card-shadow"
    >
      <span
        aria-hidden="true"
        className="absolute top-2 right-2 w-3 h-3 rounded-full"
        style={{ background: 'radial-gradient(circle at 35% 30%, #ffb3b3 0%, #e0413a 45%, #7a1512 100%)', boxShadow: '1px 2px 3px rgba(0,0,0,0.6)' }}
      />
      <p className="intel-mono text-[10px] tracking-widest uppercase text-brand-600 mb-1.5">
        What you've seen so far
      </p>
      <ul className="flex flex-col gap-1.5">
        {signals.map((s, i) => (
          <li key={i} className="text-[12px] leading-snug text-text flex gap-2">
            <span aria-hidden="true" className="text-brand-600 mt-[2px]">•</span>
            <span>
              {s.stageRef && (
                <span className="font-semibold text-brand-600 mr-1">
                  {s.stageRef}:
                </span>
              )}
              {s.takeaway}
            </span>
          </li>
        ))}
      </ul>
    </motion.aside>
  )
}

// ── Main component ────────────────────────────────────────────────────────
export default function DecisionPointStage({ stage, sessionContext: _sessionContext, onSubmit }) {
  const { prompt, contextDateLabel, options = [], signalsRecap = [] } = stage?.payload ?? {}

  const [selectedOptionId, setSelectedOptionId] = useState(null)
  const [committed, setCommitted]               = useState(false)
  const [submitting, setSubmitting]             = useState(false)
  const [error, setError]                       = useState(null)

  async function handleLockIn() {
    if (!selectedOptionId || committed || submitting) return
    setCommitted(true)
    setSubmitting(true)
    setError(null)
    // Stamp animation runs via framer-motion; we submit immediately so the
    // parent can advance the stage. The animation continues in parallel via
    // the exit transition on StampOverlay.
    try {
      await onSubmit({ selectedOptionId })
    } catch (err) {
      // A rejected submit used to leave the card stamped, the button dead and
      // the failure invisible. Hand the decision back so it can be retried.
      console.error('[DecisionPointStage] onSubmit rejected:', err)
      setCommitted(false)
      setSubmitting(false)
      setError('Could not lock that in. Please try again.')
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      <div className="flex-1 min-h-0 overflow-y-auto cf-stage-scroll">
      <div className="flex flex-col gap-6 w-full max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <StageHeader eyebrow="Your call" date={contextDateLabel || null} title={prompt} />

      {/* Pinned recap of key signals from earlier stages — optional. */}
      <SignalsRecap signals={signalsRecap} />

      {/* Options grid — 1 col mobile, 2 col ≥640px */}
      <motion.div
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.08 } },
        }}
      >
        {options.map((option, index) => {
          const isSelected = selectedOptionId === option.id
          const isDimmed   = committed && !isSelected
          return (
            <motion.div
              key={option.id}
              variants={{
                hidden:  { opacity: 0, y: 12 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
              }}
            >
              <OptionCard
                option={option}
                index={index}
                selected={isSelected}
                committed={committed}
                dimmed={isDimmed}
                onSelect={setSelectedOptionId}
              />
            </motion.div>
          )
        })}
      </motion.div>

      </div>
      </div>

      {/* Sticky footer — Lock In button */}
      <StageFooter
        left={error ? (
          <p role="alert" data-testid="lock-in-error" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      >
        <ActionButton
          testId="lock-in-btn"
          disabled={!selectedOptionId || committed}
          busy={submitting}
          busyLabel="Locking In…"
          onClick={handleLockIn}
        >
          Lock In Decision
        </ActionButton>
      </StageFooter>
    </div>
  )
}
