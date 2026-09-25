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
import { Stamp, StageFooter, ActionButton } from '../CaseFileKit'

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Extract prior evidence_wall connections from priorResults.
 *
 * useCaseFileSession accumulates results as { stageIndex, stageType, payload },
 * so the links live at `payload.connections`. This used to look only at
 * `result.connections`, which never matched — so every run forwarded an empty
 * list and phase_reveal could never score above its floor. The flat shape is
 * still accepted in case a caller hands results in already-unwrapped.
 */
function extractPriorConnections(priorResults) {
  if (!Array.isArray(priorResults)) return []
  for (const result of priorResults) {
    if (Array.isArray(result?.payload?.connections)) return result.payload.connections
    if (Array.isArray(result?.connections))          return result.connections
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
      className="flex flex-col items-start gap-1.5"
    >
      <span className="inline-flex items-center gap-2 text-[10px] font-bold tracking-[0.25em] uppercase text-[#ff6b63] font-mono">
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[#e0413a] cf-flash-blink" />
        Incoming intelligence
      </span>
      <h2 className="text-2xl sm:text-3xl font-black text-brand-600 leading-tight">
        {label}
      </h2>
    </motion.div>
  )
}

// ── Verdict stamp ─────────────────────────────────────────────────────────
// Each verdict lands as a rubber stamp, one after another down the list, so
// the page plays out as a run of results rather than arriving as a table.
function VerdictBadge({ verdict, index = 0 }) {
  const isConfirmed = verdict === 'confirmed'
  return (
    <Stamp
      testId={`verdict-badge-${verdict}`}
      tone={isConfirmed ? 'green' : 'red'}
      size="sm"
      rotate={isConfirmed ? -6 : 5}
      delay={0.45 + index * 0.35}
    >
      {isConfirmed ? '✓ Confirmed' : '✗ Refuted'}
    </Stamp>
  )
}

// ── Single connection resolution row ─────────────────────────────────────
function ResolutionRow({ resolution, itemTitles, index, playerLinked }) {
  const { pairItemIds = [], verdict, explanation } = resolution
  const [idA, idB] = pairItemIds
  const isConfirmed = verdict === 'confirmed'

  // These rows used to print the raw database ids — "ev_yelnya_armor —
  // ev_field_hospitals" — which meant nothing to anyone who had not read the
  // seed file. Show the card headline the player actually saw, and keep the id
  // as a fallback for content that has not been given one.
  const labelFor = (id) => (id && itemTitles?.[id]) || id || '?'

  return (
    <div
      data-testid={`resolution-row-${verdict}`}
      className={[
        'relative flex flex-col gap-3 p-4 rounded-sm border border-l-4 bg-surface-raised card-shadow',
        isConfirmed ? 'border-slate-300/25 border-l-emerald-500/70' : 'border-slate-300/25 border-l-[#e0413a]/70',
      ].join(' ')}
    >
      {/* The two cards, tied by string. A refuted pair shows the string cut. */}
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
        <span className="text-xs font-semibold text-text bg-surface px-2 py-1 rounded-sm border border-slate-300/25 min-w-0">
          {labelFor(idA)}
        </span>
        <span
          aria-hidden="true"
          className={[
            'hidden sm:block flex-1 min-w-6 h-0 border-t-2',
            isConfirmed ? 'border-[#e0413a]' : 'border-dashed border-slate-500/60',
          ].join(' ')}
        />
        <span className="sm:hidden text-slate-500 text-xs" aria-hidden="true">+</span>
        <span className="text-xs font-semibold text-text bg-surface px-2 py-1 rounded-sm border border-slate-300/25 min-w-0">
          {labelFor(idB)}
        </span>
        <span className="sm:ml-2 shrink-0">
          <VerdictBadge verdict={verdict} index={index} />
        </span>
      </div>

      {/* Did the player pin this pair themselves? That is the whole payoff
          of the evidence wall, so say it in plain words. */}
      {playerLinked && (
        <span
          data-testid={`resolution-yours-${index}`}
          className={[
            'self-start font-mono text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm',
            isConfirmed ? 'bg-emerald-500/15 text-emerald-600' : 'bg-[#e0413a]/15 text-[#ff6b63]',
          ].join(' ')}
        >
          {isConfirmed ? '★ You linked these. Good call' : 'You linked these'}
        </span>
      )}

      {/* Explanation */}
      {explanation && (
        <p className="text-xs text-text-muted leading-relaxed">{explanation}</p>
      )}
    </div>
  )
}

function pairLinked(connections, [a, b] = []) {
  return connections.some(c =>
    (c.fromItemId === a && c.toItemId === b) || (c.fromItemId === b && c.toItemId === a)
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
  const itemTitles       = sessionContext?.itemTitles

  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState(null)

  async function handleContinue() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    // CONTRACT-AMBIGUITY: forward prior connections unchanged (see file header)
    try {
      await onSubmit({ updatedConnections: priorConnections })
    } catch (err) {
      console.error('[PhaseRevealStage] onSubmit rejected:', err)
      setSubmitting(false)
      setError('Could not continue. Please try again.')
    }
  }

  const hasResolutions = connectionResolutions.length > 0
  const confirmedCount = connectionResolutions.filter(r => r.verdict === 'confirmed').length
  const calledCount    = connectionResolutions.filter(r => r.verdict === 'confirmed' && pairLinked(priorConnections, r.pairItemIds)).length
  const hasNewItems    = newItems.length > 0

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      <div className="flex-1 min-h-0 overflow-y-auto cf-stage-scroll">
      <div className="relative flex flex-col gap-8 w-full max-w-3xl mx-auto px-4 py-6">
      {/* One scan line sweeps down the page as the update arrives */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="cf-scan-sweep absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-transparent via-brand-600/10 to-transparent" />
      </div>
      {/* Phase label header */}
      <PhaseLabel label={newPhaseLabel} />

      {/* ── Section 1: Connection Resolutions ─────────────────────────── */}
      {hasResolutions && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h3 className="text-[11px] font-bold tracking-widest uppercase text-text-muted">
              Intelligence Assessments
            </h3>
            {confirmedCount > 0 && (
              <span data-testid="resolution-summary" className="intel-mono text-[10px] text-text-muted">
                You linked <span className="text-emerald-600 font-bold">{calledCount}</span> of the {confirmedCount} confirmed pair{confirmedCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <motion.div
            className="flex flex-col gap-3"
            variants={listVariants}
            initial="hidden"
            animate="visible"
          >
            {connectionResolutions.map((res, i) => (
              <motion.div key={`${res.pairItemIds?.[0]}-${res.pairItemIds?.[1]}-${i}`} variants={itemVariants}>
                <ResolutionRow
                  resolution={res}
                  itemTitles={itemTitles}
                  index={i}
                  playerLinked={pairLinked(priorConnections, res.pairItemIds)}
                />
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
                {/* NEW stamp, clear of the card's own pushpin */}
                <div className="absolute -top-2 right-6 z-20 pointer-events-none">
                  <Stamp testId={`new-sticker-${item.id}`} tone="amber" size="xs" rotate={6}>
                    New intel
                  </Stamp>
                </div>
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
      <StageFooter
        left={error ? (
          <p role="alert" data-testid="continue-error" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      >
        <ActionButton
          testId="continue-btn"
          busy={submitting}
          busyLabel="Loading…"
          onClick={handleContinue}
        >
          Continue
        </ActionButton>
      </StageFooter>
    </div>
  )
}
