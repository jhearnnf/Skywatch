/**
 * DebriefStage — end-of-chapter score breakdown, annotated replay, and
 * teaser for the next chapter.
 *
 * Props:
 *   stage          = { id, type: 'debrief', payload }
 *   sessionContext = { caseSlug, chapterSlug, sessionId, priorResults }
 *   onSubmit(resultPayload) → Promise<void>  — called with { viewed: true }
 *   scoring        = {
 *     totalScore,
 *     breakdown: [{ stageIndex, stageType, score, maxScore, notes }],
 *   } | null   — null while parent is computing; show skeleton.
 *   Case Files do NOT award airstars or level XP — those fields are absent.
 *   interest?        { interested, pending?, error? } — the player's
 *                    "register your interest" state for the next chapter
 *   onToggleInterest? (nextValue: boolean) => void — makes the teaser tappable
 *
 * Payload:
 *   {
 *     annotatedReplayBeats: [{ refStageIndex, headline, body, takeaway }],
 *     teaserNextChapter: { title, blurb } | null
 *   }
 *
 * Presentation-only — no fetch.
 */

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatScore, formatPct, stageTypeLabel, gradeForPct } from '../../../utils/caseFiles/scoringDisplay'
import { Stamp, StickyNote, StageFooter, ActionButton } from '../CaseFileKit'

// ── Grade colour map ──────────────────────────────────────────────────────────

const GRADE_COLOR = {
  S:  'text-amber-600',
  A:  'text-emerald-600',
  B:  'text-brand-600',
  C:  'text-slate-600',
  D:  'text-danger',
  '-': 'text-text-faint',
}

function gradeColor(grade) {
  return GRADE_COLOR[grade] ?? 'text-text-muted'
}

// Stamp ink per grade, and the bar colour under each breakdown row.
const GRADE_TONE = { S: 'amber', A: 'green', B: 'blue', C: 'blue', D: 'red' }
const GRADE_BAR  = { S: '#f59e0b', A: '#22c55e', B: '#5baaff', C: '#8aa3c2', D: '#e0413a' }

// Lands just after the score has finished counting up.
const COUNT_UP_MS = 1800

// ── Count-up animation for the total score ────────────────────────────────────

function CountUpScore({ target, duration = 1800 }) {
  const [displayed, setDisplayed] = useState(0)
  const rafRef    = useRef(null)
  const startRef  = useRef(null)

  useEffect(() => {
    if (typeof target !== 'number') return
    startRef.current = null

    function tick(timestamp) {
      if (!startRef.current) startRef.current = timestamp
      const elapsed  = timestamp - startRef.current
      const progress = Math.min(elapsed / duration, 1)
      // Ease-out cubic
      const eased    = 1 - Math.pow(1 - progress, 3)
      setDisplayed(Math.round(target * eased))
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    rafRef.current = requestAnimationFrame(tick)

    // Browsers stop servicing requestAnimationFrame in a hidden tab, so a
    // debrief that mounts while the player is looking elsewhere freezes on a
    // partial number — "10" under a breakdown that adds up to 192. Timers are
    // throttled but still fire, so use one to settle on the real total.
    const settle = setTimeout(() => setDisplayed(target), duration + 400)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      clearTimeout(settle)
    }
  }, [target, duration])

  return (
    <span data-testid="total-score-display">
      {displayed.toLocaleString('en')}
    </span>
  )
}

// ── Skeleton placeholder while scoring is loading ─────────────────────────────

function ScoringSkeletonBlock() {
  return (
    <div
      data-testid="scoring-skeleton"
      className="flex flex-col items-center gap-4 py-8"
    >
      <div className="h-16 w-48 rounded-xl bg-surface-raised animate-pulse" />
      <div className="h-4 w-32 rounded bg-surface-raised animate-pulse" />
      <div className="h-4 w-24 rounded bg-surface-raised animate-pulse" />
      <p className="text-sm text-text-muted mt-2 font-mono">
        Computing your score…
      </p>
    </div>
  )
}

// ── Score banner ─────────────────────────────────────────────────────────────

function ScoreBanner({ scoring, personalBest }) {
  const { totalScore } = scoring

  // "192" on its own tells a first-timer nothing. The chapter's ceiling is the
  // sum of what each stage was worth, so show what they were playing for.
  const maxTotal = (scoring.breakdown ?? []).reduce((sum, r) => sum + (r.maxScore ?? 0), 0)

  // `/best` is read after the run is scored, so bestScore already includes this
  // attempt: matching it means this run is the best one.
  const attempts   = personalBest?.completedCount ?? 0
  const best       = personalBest?.bestScore
  const isFirstRun = attempts <= 1
  const isNewBest  = !isFirstRun && typeof best === 'number' && totalScore >= best

  const overallPct   = maxTotal > 0 ? Math.round((totalScore / maxTotal) * 100) : null
  const overallGrade = overallPct === null ? null : gradeForPct(overallPct)

  return (
    <div className="relative flex flex-col items-center gap-3 py-6 border-b border-slate-300/20">
      {/* Overall grade, stamped on once the count-up lands */}
      {overallGrade && overallGrade !== '-' && (
        <div className="absolute top-2 right-0 sm:right-4 pointer-events-none" aria-hidden="true">
          <Stamp
            testId="overall-grade-stamp"
            tone={GRADE_TONE[overallGrade] ?? 'blue'}
            size="lg"
            rotate={-10}
            delay={COUNT_UP_MS / 1000}
            className="!text-5xl !tracking-normal !px-4 !py-1"
          >
            {overallGrade}
          </Stamp>
        </div>
      )}

      {/* Count-up number */}
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
        className="text-6xl sm:text-7xl font-black text-brand-600 tabular-nums"
      >
        <CountUpScore target={totalScore} duration={COUNT_UP_MS} />
        {maxTotal > 0 && (
          <span className="text-2xl sm:text-3xl font-bold text-text-faint align-middle ml-1">
            {' / '}{maxTotal.toLocaleString('en')}
          </span>
        )}
      </motion.div>

      <p className="text-xs font-bold tracking-widest uppercase text-text-muted font-mono">
        Total Score
      </p>

      {/* Personal-best line — Case Files award no airstars, so this and the
          grades are the whole reward for coming back to a case. */}
      {personalBest && (
        <p
          data-testid="personal-best-line"
          className={[
            'text-xs font-mono',
            isNewBest ? 'text-amber-600 font-bold' : 'text-text-muted',
          ].join(' ')}
        >
          {isFirstRun
            ? 'First run on this case'
            : isNewBest
              ? `New personal best, beating your previous ${attempts - 1} run${attempts - 1 === 1 ? '' : 's'}`
              : `Personal best ${best.toLocaleString('en')} · run ${attempts}`}
        </p>
      )}
      {isNewBest && (
        <Stamp tone="amber" size="sm" rotate={-4} delay={COUNT_UP_MS / 1000 + 0.35}>
          ★ New record
        </Stamp>
      )}
    </div>
  )
}

// ── Breakdown table ───────────────────────────────────────────────────────────

function BreakdownTable({ breakdown }) {
  // The briefing and the debrief itself carry no marks. Listing them as
  // "0 / 0 - 0%" read like two stages the player had failed.
  const rows = (breakdown ?? []).filter(r => (r.maxScore ?? 0) > 0)
  if (!rows.length) return null

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[11px] font-bold tracking-widest uppercase text-text-muted">
        Stage Breakdown
      </h3>
      <div
        className="rounded-xl border border-slate-300/20 overflow-hidden"
        data-testid="breakdown-table"
      >
        {/* Header row */}
        <div className="grid grid-cols-4 gap-0 bg-surface-raised px-4 py-2 text-[10px] font-bold tracking-widest uppercase text-text-muted border-b border-slate-300/20">
          <span>Stage</span>
          <span className="text-right">Score</span>
          <span className="text-right">%</span>
          <span className="text-right">Grade</span>
        </div>

        {/* Data rows */}
        {rows.map((row, i) => {
          const pct   = row.maxScore ? Math.round((row.score / row.maxScore) * 100) : 0
          const grade = gradeForPct(pct)
          return (
            <motion.div
              key={`${row.stageIndex}-${i}`}
              data-testid={`breakdown-row-${i}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.3 }}
              className={[
                'grid grid-cols-4 gap-0 px-4 py-3 text-sm border-b border-slate-300/10 last:border-b-0',
                'hover:bg-surface-raised/60 transition-colors duration-100',
              ].join(' ')}
            >
              <span className="text-text font-medium pr-2 flex flex-col gap-0.5 min-w-0">
                <span className="truncate">{stageTypeLabel(row.stageType)}</span>
                <span aria-hidden="true" className="block h-1 w-full max-w-[160px] rounded-full bg-slate-300/15 overflow-hidden mt-0.5">
                  <motion.span
                    className="block h-full rounded-full"
                    style={{ background: GRADE_BAR[grade] ?? '#8aa3c2' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                    transition={{ delay: 0.4 + 0.12 * i, duration: 0.7, ease: 'easeOut' }}
                  />
                </span>
                {/* The scorer already works out WHY each stage scored what it
                    did. The table used to throw it away, leaving a player with
                    a number and no idea what to do differently. */}
                {row.notes && (
                  <span
                    data-testid={`breakdown-note-${i}`}
                    className="text-[11px] font-normal text-text-muted leading-snug"
                  >
                    {row.notes}
                  </span>
                )}
              </span>
              <span className="text-right text-text-muted font-mono text-xs self-center">
                {formatScore(row.score, row.maxScore)}
              </span>
              <span className="text-right text-text-muted font-mono text-xs self-center">
                {formatPct(row.score, row.maxScore)}
              </span>
              <span className={['text-right font-black text-base self-center', gradeColor(grade)].join(' ')}>
                {grade}
              </span>
            </motion.div>
          )
        })}
      </div>

      {/* Grade key. A lone "C" is meaningless the first time you see one. */}
      <p className="text-[10px] text-text-faint font-mono leading-relaxed">
        Grades: S is 95% and up, A is 80%, B is 60%, C is 40%, D is under 40%.
        A dash means no marks scored on that stage.
      </p>
    </section>
  )
}

// ── Annotated replay ──────────────────────────────────────────────────────────

function AnnotatedReplay({ beats }) {
  if (!beats?.length) return null

  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-[11px] font-bold tracking-widest uppercase text-text-muted">
        Mission Review
      </h3>
      <div className="flex flex-col gap-5">
        {beats.map((beat, i) => (
          <motion.div
            key={`beat-${i}`}
            data-testid={`replay-beat-${i}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * i, duration: 0.35, ease: 'easeOut' }}
            className="relative flex flex-col gap-2 p-4 pt-5 rounded-sm rounded-tl-none border border-slate-300/25 bg-surface-raised card-shadow mt-3"
          >
            {/* Stage reference, as the file's tab */}
            <span className="absolute -top-3.5 left-[-1px] h-3.5 px-2.5 flex items-center rounded-t-md border border-b-0 border-slate-300/25 bg-surface-raised text-[9px] font-black tracking-[0.2em] uppercase text-text-muted font-mono">
              STAGE {(beat.refStageIndex ?? i) + 1}
            </span>

            {/* Headline */}
            <p className="text-sm font-bold text-text leading-snug">
              {beat.headline}
            </p>

            {/* Body prose */}
            {beat.body && (
              <p className="text-xs text-text-muted leading-relaxed">
                {beat.body}
              </p>
            )}

            {/* Takeaway quote-box */}
            {beat.takeaway && (
              <StickyNote
                testId={`beat-takeaway-${i}`}
                tilt={i % 2 ? 0.8 : -0.8}
                className="mt-2 mx-1 self-start max-w-md"
              >
                {beat.takeaway}
              </StickyNote>
            )}
          </motion.div>
        ))}
      </div>
    </section>
  )
}

// ── Next chapter teaser ───────────────────────────────────────────────────────
// Doubles as the "register your interest" control: the next chapter usually
// does not exist yet, and whether players want it is the signal that decides
// what gets written. Tap to register, tap again to take it back.
//
// The prompt is always shown, not revealed on hover: a touch screen has no
// hover, and interest is only counted on a deliberate tap, never a pass of
// the mouse, or the numbers would mean nothing.

function TeaserCard({ teaser, interest, onToggleInterest }) {
  if (!teaser) return null
  const canRegister = typeof onToggleInterest === 'function'
  const registered  = !!interest?.interested
  const pending     = !!interest?.pending

  function toggle() {
    if (!canRegister || pending) return
    onToggleInterest(!registered)
  }

  return (
    <motion.div
      data-testid="teaser-next-chapter"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.4, ease: 'easeOut' }}
      role={canRegister ? 'button' : undefined}
      tabIndex={canRegister ? 0 : undefined}
      aria-pressed={canRegister ? registered : undefined}
      aria-busy={pending || undefined}
      onClick={canRegister ? toggle : undefined}
      onKeyDown={canRegister ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } } : undefined}
      className={[
        'group relative rounded-sm border border-dashed p-5 flex flex-col gap-2 overflow-hidden transition-all duration-200',
        registered
          ? 'border-emerald-500/60 bg-emerald-500/10 shadow-[0_0_24px_rgba(34,197,94,0.15)]'
          : 'border-brand-400/40 bg-brand-100/15',
        canRegister && !registered ? 'cursor-pointer hover:border-brand-600 hover:bg-brand-100/25 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:border-brand-600' : '',
        canRegister && registered ? 'cursor-pointer focus-visible:outline-none' : '',
      ].join(' ')}
    >
      <div className="absolute top-3 right-3 pointer-events-none" aria-hidden="true">
        {registered ? (
          <Stamp key="registered" tone="green" size="xs" rotate={-6}>Interest registered</Stamp>
        ) : (
          <Stamp key="sealed" tone="blue" size="xs" rotate={8} slam={false}>Sealed</Stamp>
        )}
      </div>
      <span className="text-[10px] font-black tracking-[0.25em] uppercase text-brand-600/70 font-mono">
        Coming Up
      </span>
      <p className="text-sm font-bold text-text pr-28">
        Next: {teaser.title}
      </p>
      {teaser.blurb && (
        <p className="text-xs text-text-muted leading-relaxed">
          {teaser.blurb}
        </p>
      )}

      {canRegister && (
        <div className="mt-2 pt-2.5 border-t border-dashed border-slate-500/30 min-h-[2.75rem] flex items-center">
          <AnimatePresence mode="wait" initial={false}>
            {interest?.error ? (
              <motion.p key="error" role="alert" data-testid="interest-error"
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                className="text-xs text-danger">
                Could not save that. Tap to try again.
              </motion.p>
            ) : registered ? (
              <motion.div key="on" data-testid="interest-registered"
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-emerald-600">
                  ✓ You have registered your interest in the next file.
                </span>
                <span className="text-[11px] text-text-muted">
                  Tap again if you are not interested.
                </span>
              </motion.div>
            ) : (
              <motion.span key="off" data-testid="interest-prompt"
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest text-brand-600 transition-colors group-hover:text-brand-700">
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-brand-600 animate-pulse" />
                Want this next? Tap to register your interest
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  )
}

// ── DebriefStage (public) ─────────────────────────────────────────────────────

export default function DebriefStage({ stage, sessionContext, onSubmit, scoring, personalBest, onReplay, interest, onToggleInterest }) {
  const {
    annotatedReplayBeats = [],
    teaserNextChapter    = null,
  } = stage?.payload ?? {}

  // Falls back to the slug only when the caller has no title to hand; showing
  // "road-to-invasion" above DEBRIEF looked like leaked plumbing.
  const chapterTitle = sessionContext?.chapterTitle || sessionContext?.chapterSlug || ''
  const [submitting, setSubmitting] = useState(false)

  async function handleClose() {
    if (submitting) return
    setSubmitting(true)
    try {
      await onSubmit({ viewed: true })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="flex flex-col h-full min-h-0 w-full"
      data-testid="debrief-stage"
    >
      <div className="flex-1 min-h-0 overflow-y-auto cf-stage-scroll">
      <div className="flex flex-col gap-8 w-full max-w-3xl mx-auto px-4 py-6">
      {/* ── Top heading ──────────────────────────────────────────────── */}
      <header className="flex flex-col items-start gap-1">
        <motion.span
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35 }}
          className="inline-flex items-center gap-2 text-[10px] font-black tracking-[0.3em] uppercase text-text-faint font-mono"
        >
          <span aria-hidden="true" className="w-1.5 h-1.5 bg-[#e0413a] rounded-[1px]" />
          <span>{chapterTitle}</span>
        </motion.span>
        <motion.h2
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="text-4xl sm:text-5xl font-black text-text tracking-tight"
        >
          DEBRIEF
        </motion.h2>
      </header>

      {/* ── Score banner or skeleton ──────────────────────────────────── */}
      {scoring === null ? (
        <ScoringSkeletonBlock />
      ) : (
        <>
          <ScoreBanner scoring={scoring} personalBest={personalBest} />
          <BreakdownTable breakdown={scoring.breakdown} />
        </>
      )}

      {/* ── Annotated replay ──────────────────────────────────────────── */}
      {annotatedReplayBeats.length > 0 && (
        <AnnotatedReplay beats={annotatedReplayBeats} />
      )}

      {/* ── Teaser for next chapter ───────────────────────────────────── */}
      {teaserNextChapter && (
        <TeaserCard teaser={teaserNextChapter} interest={interest} onToggleInterest={onToggleInterest} />
      )}

      </div>
      </div>

      {/* ── Sticky footer: Close Case button ──────────────────────────── */}
      <StageFooter className="!justify-center flex-wrap">
        {onReplay && (
          <ActionButton variant="secondary" testId="replay-case-btn" onClick={onReplay}>
            Run It Again
          </ActionButton>
        )}
        <ActionButton
          testId="close-case-btn"
          busy={submitting}
          busyLabel="Closing…"
          onClick={handleClose}
          className="px-8"
        >
          Close Case
        </ActionButton>
      </StageFooter>
    </div>
  )
}
