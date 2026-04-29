// PhaseRevealStage — reveals what happened: prior connections get confirmed
// or refuted, and new evidence items drop in.
//
// CONTRACT-AMBIGUITY: updatedConnections payload —
//   We forward any prior evidence_wall connections found in priorResults.
//   Specifically: scan priorResults for a stage result that has a
//   `connections` array (the evidence_wall stage shape). If found, pass it
//   through unchanged. If not found, pass an empty array.
//   Rationale: the player cannot edit connections inside PhaseReveal (V1),
//   so forwarding the last known state is the least-surprising contract.
//   The parent can diff against the pre-reveal state to detect changes.
//
// Props:
//   stage          = { id, type: 'phase_reveal', payload }
//   sessionContext = { caseSlug, chapterSlug, sessionId, priorResults }
//   onSubmit(resultPayload) → Promise<void>

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import EvidenceCard from '../EvidenceCard'

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Extract prior evidence_wall connections from priorResults.
 * Looks for the first result that carries a `connections` array.
 */
function extractPriorConnections(priorResults) {
  if (!Array.isArray(priorResults)) return []
  for (const result of priorResults) {
    if (Array.isArray(result?.connections)) return result.connections
  }
  return []
}

// ── Phase label header ────────────────────────────────────────────────────
function PhaseLabel({ label }) {
  return (
    <motion.div
      data-testid="phase-label"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="flex flex-col items-start gap-1"
    >
      <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-text-muted font-mono">
        — Phase Update —
      </span>
      <h2 className="text-2xl sm:text-3xl font-black text-brand-600 leading-tight">
        {label}
      </h2>
    </motion.div>
  )
}

// ── Verdict badge ─────────────────────────────────────────────────────────
function VerdictBadge({ verdict }) {
  const isConfirmed = verdict === 'confirmed'
  return (
    <span
      data-testid={`verdict-badge-${verdict}`}
      className={[
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border',
        isConfirmed
          ? 'bg-emerald-100/20 border-emerald-300/50 text-emerald-600'
          : 'bg-red-100/20 border-red-400/40 text-danger',
      ].join(' ')}
    >
      <span aria-hidden="true">{isConfirmed ? '✓' : '✗'}</span>
      {isConfirmed ? 'Confirmed' : 'Refuted'}
    </span>
  )
}

// ── Single connection resolution row ─────────────────────────────────────
function ResolutionRow({ resolution }) {
  const { pairItemIds = [], verdict, explanation } = resolution
  const [idA, idB] = pairItemIds

  return (
    <div
      data-testid={`resolution-row-${verdict}`}
      className="flex flex-col gap-2 p-4 rounded-2xl border border-slate-200/30 bg-surface-raised"
    >
      {/* Connection pair labels */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-text-muted bg-surface px-2 py-0.5 rounded font-mono">
          {idA ?? '?'}
        </span>
        <span className="text-slate-500 text-xs" aria-hidden="true">—</span>
        <span className="text-xs font-bold text-text-muted bg-surface px-2 py-0.5 rounded font-mono">
          {idB ?? '?'}
        </span>
        <VerdictBadge verdict={verdict} />
      </div>

      {/* Explanation */}
      {explanation && (
        <p className="text-xs text-text-muted leading-relaxed">{explanation}</p>
      )}
    </div>
  )
}

// ── Stagger container variants ────────────────────────────────────────────
const listVariants = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.12 } },
}
const itemVariants = {
  hidden:  { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
}

// ── Main component ────────────────────────────────────────────────────────
export default function PhaseRevealStage({ stage, sessionContext, onSubmit }) {
  const {
    newPhaseLabel        = '',
    newItems             = [],
    connectionResolutions = [],
  } = stage?.payload ?? {}

  const priorConnections = extractPriorConnections(sessionContext?.priorResults)

  const [submitting, setSubmitting] = useState(false)

  async function handleContinue() {
    if (submitting) return
    setSubmitting(true)
    // CONTRACT-AMBIGUITY: forward prior connections unchanged (see file header)
    await onSubmit({ updatedConnections: priorConnections })
  }

  const hasResolutions = connectionResolutions.length > 0
  const hasNewItems    = newItems.length > 0

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="flex flex-col gap-8 w-full max-w-3xl mx-auto px-4 py-6">
      {/* Phase label header */}
      <PhaseLabel label={newPhaseLabel} />

      {/* ── Section 1: Connection Resolutions ─────────────────────────── */}
      {hasResolutions && (
        <section className="flex flex-col gap-3">
          <h3 className="text-[11px] font-bold tracking-widest uppercase text-text-muted">
            Intelligence Assessments
          </h3>
          <motion.div
            className="flex flex-col gap-3"
            variants={listVariants}
            initial="hidden"
            animate="visible"
          >
            {connectionResolutions.map((res, i) => (
              <motion.div key={`${res.pairItemIds?.[0]}-${res.pairItemIds?.[1]}-${i}`} variants={itemVariants}>
                <ResolutionRow resolution={res} />
              </motion.div>
            ))}
          </motion.div>
        </section>
      )}

      {/* ── Section 2: New Evidence ────────────────────────────────────── */}
      {hasNewItems && (
        <section className="flex flex-col gap-3">
          <h3 className="text-[11px] font-bold tracking-widest uppercase text-text-muted">
            New Evidence
          </h3>
          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            variants={listVariants}
            initial="hidden"
            animate="visible"
          >
            {newItems.map(item => (
              <motion.div key={item.id} variants={itemVariants} className="relative">
                {/* NEW sticker */}
                <span
                  data-testid={`new-sticker-${item.id}`}
                  className="absolute top-2 right-2 z-10 text-[9px] font-black tracking-widest uppercase px-2 py-0.5 rounded-full bg-brand-600 text-white shadow-sm"
                >
                  NEW
                </span>
                <EvidenceCard item={item} />
              </motion.div>
            ))}
          </motion.div>
        </section>
      )}

      {/* ── Empty state ────────────────────────────────────────────────── */}
      {!hasResolutions && !hasNewItems && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-sm text-text-muted text-center py-8"
        >
          No new intelligence at this time.
        </motion.p>
      )}

      </div>
      </div>

      {/* Sticky footer — Continue button */}
      <div className="shrink-0 border-t border-slate-300/10 bg-surface px-4 py-3 flex justify-end">
        <button
          type="button"
          data-testid="continue-btn"
          disabled={submitting}
          onClick={handleContinue}
          className={[
            'px-6 py-3 rounded-2xl font-bold text-sm tracking-wide transition-all duration-200',
            !submitting
              ? 'bg-brand-600 text-white hover:bg-brand-700 shadow-[0_0_18px_rgba(91,170,255,0.35)]'
              : 'bg-surface-raised text-text-faint border border-slate-200 cursor-not-allowed',
          ].join(' ')}
        >
          {submitting ? 'Loading…' : 'Continue'}
        </button>
      </div>
    </div>
  )
}
