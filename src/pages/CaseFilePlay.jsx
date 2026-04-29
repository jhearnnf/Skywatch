/**
 * CaseFilePlay — chapter-play page.
 * Route: /case-files/:caseSlug/:chapterSlug
 *
 * Orchestrates the 8-stage chapter-play flow via useCaseFileSession.
 * When the chapter is completed, navigates to the debrief route.
 */

import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import useCaseFileSession from '../hooks/useCaseFileSession'
import { useGameChrome } from '../context/GameChromeContext'
import StageRouter from '../components/caseFiles/StageRouter'
import CaseFilesGate from '../components/caseFiles/CaseFilesGate'
import TutorialModal from '../components/tutorial/TutorialModal'
import SEO from '../components/SEO'

// ── Tiny spinner ──────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <div className="w-8 h-8 border-2 border-slate-300/30 border-t-brand-600 rounded-full animate-spin" />
      <p className="text-sm text-slate-500 tracking-wide">Loading case file…</p>
    </div>
  )
}

// ── Header (Abort · Title · Stage X/N) ────────────────────────────────────────
function PlayHeader({ chapter, currentStageIndex, totalStages, onAbort }) {
  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-200/10 bg-surface/95 backdrop-blur-sm">
      <button
        type="button"
        onClick={onAbort}
        data-testid="abort-case-btn"
        className="shrink-0 text-xs font-semibold text-slate-500 hover:text-danger transition-colors px-2 py-1 rounded"
        aria-label="Abort case"
      >
        ✕ Abort
      </button>
      <div className="flex-1 min-w-0 text-center">
        <p className="text-xs font-semibold text-slate-600 truncate">{chapter.title}</p>
        {chapter.dateRangeLabel && (
          <p className="text-[10px] text-slate-500 truncate">{chapter.dateRangeLabel}</p>
        )}
      </div>
      <span className="shrink-0 text-[11px] font-mono text-brand-600 bg-brand-600/10 px-2 py-0.5 rounded-full">
        Stage {currentStageIndex + 1} / {totalStages}
      </span>
    </div>
  )
}

// ── Abort confirmation modal ──────────────────────────────────────────────────
function AbortConfirmModal({ open, onCancel, onConfirm }) {
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4"
      onClick={onCancel}
      data-testid="abort-confirm-modal"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="abort-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-slate-300/20 bg-surface p-5 flex flex-col gap-3"
      >
        <h2 id="abort-title" className="text-base font-bold text-text">
          Abort this case?
        </h2>
        <p className="text-sm text-text-muted leading-relaxed">
          You&#39;ve already used today&#39;s attempt — aborting won&#39;t refund it.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            data-testid="abort-cancel-btn"
            className="px-4 py-2 rounded-btn text-sm font-semibold text-brand-600 border border-brand-600/40 hover:bg-brand-600/10 transition-colors"
          >
            Keep Playing
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="abort-confirm-btn"
            className="px-4 py-2 rounded-btn text-sm font-semibold text-white bg-danger hover:opacity-90 transition-opacity"
          >
            Abort Case
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CaseFilePlay() {
  const { caseSlug, chapterSlug } = useParams()
  const navigate = useNavigate()

  const {
    loading,
    error,
    gate,
    chapter,
    sessionId,
    currentStageIndex,
    totalStages,
    priorResults,
    scoring,
    isCompleted,
    submitStage,
    sendQuestion,
  } = useCaseFileSession({ caseSlug, chapterSlug })

  const [abortOpen, setAbortOpen] = useState(false)

  // Hide TopBar / BottomNav on mobile for the duration of an active session.
  // Mirrors QuizFlow / BattleOfOrderFlow.
  const { enterImmersive, exitImmersive } = useGameChrome()
  useEffect(() => {
    if (!loading && !error && !gate && chapter && sessionId !== null && !isCompleted) {
      enterImmersive()
    } else {
      exitImmersive()
    }
    return exitImmersive
  }, [loading, error, gate, chapter, sessionId, isCompleted, enterImmersive, exitImmersive])

  // Navigate to debrief once the chapter is completed
  useEffect(() => {
    if (!isCompleted) return
    navigate(
      `/case-files/${caseSlug}/${chapterSlug}/debrief`,
      {
        replace: false,
        state:   { scoring, chapter },
      },
    )
  }, [isCompleted, caseSlug, chapterSlug, navigate, scoring, chapter])

  // ── Gated state (disabled / tier / daily limit) ──────────────────────────
  if (gate) {
    return (
      <CaseFilesGate
        reason={gate.reason}
        usedToday={gate.usedToday}
        limitToday={gate.limitToday}
      />
    )
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
        <p className="text-sm text-danger text-center">{error}</p>
        <Link
          to="/case-files"
          className="text-xs text-brand-600 hover:underline"
        >
          ← Back to Case Files
        </Link>
      </div>
    )
  }

  // ── Loading state ────────────────────────────────────────────────────────
  if (loading || !chapter || sessionId === null) {
    return (
      <>
        <SEO title="Loading… — Skywatch" />
        <Spinner />
      </>
    )
  }

  const stage = chapter.stages?.[currentStageIndex]

  const sessionContext = {
    caseSlug,
    chapterSlug,
    sessionId,
    priorResults,
  }

  // ── Wrap submitStage to surface errors without crashing ──────────────────
  async function handleSubmit(payload) {
    try {
      await submitStage(payload)
    } catch (err) {
      // Stage components surface their own error UI when onSubmit rejects;
      // re-throw so the component's catch handler fires.
      throw err
    }
  }

  function handleAbortConfirm() {
    setAbortOpen(false)
    navigate('/case-files')
  }

  return (
    <>
      <TutorialModal />
      <SEO title={`${chapter.title} — Skywatch`} />

      {/*
        Layout strategy:
          • Mobile (≤600px): fixed-position full-viewport flex column. AppShell's
            chrome is hidden by enterImmersive(); this overlay covers the page so
            the stage UI always fits 100dvh without page-level scrolling.
          • Desktop (>600px): natural relative flow inside AppShell. We still
            use a flex column with a min-height so each stage's internal scroll
            kicks in if its content is taller than the viewport.
      */}
      <div
        className={[
          'flex flex-col w-full',
          'max-[600px]:fixed max-[600px]:inset-0 max-[600px]:z-40 max-[600px]:bg-[#06101e] max-[600px]:h-[100dvh]',
          'sm:relative sm:h-[calc(100dvh-3.5rem-3rem)] sm:min-h-[60vh]',
        ].join(' ')}
        data-testid="case-file-play"
      >
        <PlayHeader
          chapter={chapter}
          currentStageIndex={currentStageIndex}
          totalStages={totalStages}
          onAbort={() => setAbortOpen(true)}
        />

        {/* Stage area — flexes to fill remaining height, stage handles internal scroll */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`stage-${currentStageIndex}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="flex-1 min-h-0 flex flex-col"
            >
              {stage ? (
                <StageRouter
                  stage={stage}
                  sessionContext={sessionContext}
                  onSubmit={handleSubmit}
                  sendQuestion={sendQuestion}
                  scoring={scoring}
                />
              ) : (
                <Spinner />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <AbortConfirmModal
        open={abortOpen}
        onCancel={() => setAbortOpen(false)}
        onConfirm={handleAbortConfirm}
      />
    </>
  )
}
