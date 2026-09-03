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
import { motion } from 'framer-motion'
import { formatScore, formatPct, stageTypeLabel, gradeForPct } from '../../../utils/caseFiles/scoringDisplay'

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

  return (
    <div className="flex flex-col items-center gap-3 py-6 border-b border-slate-300/20">
      {/* Count-up number */}
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
        className="text-6xl sm:text-7xl font-black text-brand-600 tabular-nums"
      >
        <CountUpScore target={totalScore} />
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
            className="flex flex-col gap-2 p-4 rounded-2xl border border-slate-300/20 bg-surface-raised"
          >
            {/* Stage reference label */}
            <span className="text-[10px] font-black tracking-[0.2em] uppercase text-text-faint font-mono">
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
              <blockquote
                data-testid={`beat-takeaway-${i}`}
                className="mt-1 border-l-2 border-brand-400/50 pl-3 text-xs italic text-brand-600/80"
              >
                {beat.takeaway}
              </blockquote>
            )}
          </motion.div>
        ))}
      </div>
    </section>
  )
}

// ── Next chapter teaser ───────────────────────────────────────────────────────

function TeaserCard({ teaser }) {
  if (!teaser) return null

  return (
    <motion.div
      data-testid="teaser-next-chapter"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.4, ease: 'easeOut' }}
      className="rounded-2xl border border-brand-400/30 bg-brand-100/20 p-5 flex flex-col gap-2"
    >
      <span className="text-[10px] font-black tracking-[0.25em] uppercase text-brand-600/70 font-mono">
        Coming Up
      </span>
      <p className="text-sm font-bold text-text">
        Next: {teaser.title}
      </p>
      {teaser.blurb && (
        <p className="text-xs text-text-muted leading-relaxed">
          {teaser.blurb}
        </p>
      )}
    </motion.div>
  )
}

// ── DebriefStage (public) ─────────────────────────────────────────────────────

export default function DebriefStage({ stage, sessionContext, onSubmit, scoring, personalBest, onReplay }) {
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
      <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="flex flex-col gap-8 w-full max-w-3xl mx-auto px-4 py-6">
      {/* ── Top heading ──────────────────────────────────────────────── */}
      <header className="flex flex-col items-start gap-1">
        <motion.span
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35 }}
          className="text-[10px] font-black tracking-[0.3em] uppercase text-text-faint font-mono"
        >
          {chapterTitle}
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
        <TeaserCard teaser={teaserNextChapter} />
      )}

      </div>
      </div>

      {/* ── Sticky footer: Close Case button ──────────────────────────── */}
      <div className="shrink-0 border-t border-slate-300/10 bg-surface px-4 py-3 flex flex-wrap justify-center gap-3">
        {onReplay && (
          <button
            type="button"
            data-testid="replay-case-btn"
            onClick={onReplay}
            className="px-6 py-3 rounded-2xl font-bold text-sm tracking-widest uppercase border border-brand-600/50 text-brand-600 hover:bg-brand-600/10 transition-colors"
          >
            Run It Again
          </button>
        )}
        <button
          type="button"
          data-testid="close-case-btn"
          disabled={submitting}
          onClick={handleClose}
          className={[
            'px-8 py-3 rounded-2xl font-bold text-sm tracking-widest uppercase transition-all duration-200',
            !submitting
              ? 'bg-brand-600 text-white hover:opacity-90 shadow-[0_0_20px_rgba(91,170,255,0.3)]'
              : 'bg-surface-raised text-text-faint border border-slate-300/30 cursor-not-allowed',
          ].join(' ')}
        >
          {submitting ? 'Closing…' : 'Close Case'}
        </button>
      </div>
    </div>
  )
}
