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

// ── Small typewriter chip for the context date ────────────────────────────
function DateChip({ label }) {
  return (
    <motion.span
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4 }}
      className="inline-block text-[11px] font-bold tracking-widest uppercase px-3 py-1 rounded-full border border-brand-400/40 bg-brand-100/60 text-brand-600 font-mono mb-3"
    >
      {label}
    </motion.span>
  )
}

// ── Stamp overlay that plays on commit ────────────────────────────────────
function StampOverlay({ show }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="stamp"
          initial={{ scale: 2, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.8, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
        >
          <span className="text-[10px] font-black tracking-[0.3em] uppercase px-4 py-2 rounded border-4 border-brand-600/80 text-brand-600/90 rotate-[-12deg] select-none"
            style={{ fontFamily: 'var(--font-family-mono)' }}
          >
            Decision Locked
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── Individual option card ────────────────────────────────────────────────
function OptionCard({ option, selected, committed, dimmed, onSelect }) {
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
        'relative flex flex-col gap-2 rounded-2xl border p-5 cursor-pointer select-none',
        'transition-colors duration-200',
        committed
          ? 'cursor-default'
          : 'hover:border-brand-400 hover:bg-brand-100/30',
        selected
          ? 'border-brand-500 bg-brand-100/50 shadow-[0_0_0_2px_rgba(91,170,255,0.25)]'
          : 'border-slate-200 bg-surface-raised',
      ].filter(Boolean).join(' ')}
    >
      {/* Stamp overlay for committed card */}
      {selected && <StampOverlay show={committed} />}

      {/* Selected indicator */}
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={[
            'mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors',
            selected
              ? 'border-brand-500 bg-brand-500'
              : 'border-slate-400',
          ].join(' ')}
        >
          {selected && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="w-2 h-2 rounded-full bg-white block"
            />
          )}
        </span>

        <p className="text-sm font-bold text-text leading-snug flex-1">{option.text}</p>
      </div>

      {/* Hint toggle */}
      {option.hint && (
        <div className="pl-8">
          <button
            type="button"
            data-testid={`hint-toggle-${option.id}`}
            onClick={toggleHint}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleHint(e) } }}
            className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 transition-colors flex items-center gap-1"
          >
            <span aria-hidden="true">{hintOpen ? '▲' : '▼'}</span>
            {hintOpen ? 'Hide hint' : 'Hint'}
          </button>

          <AnimatePresence>
            {hintOpen && (
              <motion.p
                key="hint"
                data-testid={`hint-text-${option.id}`}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="mt-1.5 text-xs text-text-muted leading-relaxed overflow-hidden"
              >
                {option.hint}
              </motion.p>
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
      className="rounded-xl border border-brand-600/20 bg-brand-100/20 px-4 py-3"
    >
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

  async function handleLockIn() {
    if (!selectedOptionId || committed || submitting) return
    setCommitted(true)
    setSubmitting(true)
    // Stamp animation runs via framer-motion; we submit immediately so the
    // parent can advance the stage. The animation continues in parallel via
    // the exit transition on StampOverlay.
    await onSubmit({ selectedOptionId })
  }

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="flex flex-col gap-6 w-full max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <header className="flex flex-col items-start gap-1">
        {contextDateLabel && <DateChip label={contextDateLabel} />}
        <motion.h2
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="text-xl sm:text-2xl font-black text-text leading-snug"
        >
          {prompt}
        </motion.h2>
      </header>

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
        {options.map(option => {
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
      <div className="shrink-0 border-t border-slate-300/10 bg-surface px-4 py-3 flex justify-end">
        <button
          type="button"
          data-testid="lock-in-btn"
          disabled={!selectedOptionId || committed || submitting}
          onClick={handleLockIn}
          className={[
            'px-6 py-3 rounded-2xl font-bold text-sm tracking-wide transition-all duration-200',
            selectedOptionId && !committed
              ? 'bg-brand-600 text-white hover:bg-brand-700 shadow-[0_0_18px_rgba(91,170,255,0.35)]'
              : 'bg-surface-raised text-text-faint border border-slate-200 cursor-not-allowed',
          ].join(' ')}
        >
          {submitting ? 'Locking In…' : 'Lock In Decision'}
        </button>
      </div>
    </div>
  )
}
