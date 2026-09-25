/**
 * CaseFilePlay — chapter-play page.
 * Route: /case-files/:caseSlug/:chapterSlug
 *
 * Orchestrates the 8-stage chapter-play flow via useCaseFileSession.
 * When the chapter is completed, navigates to the debrief route.
 */

import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import useCaseFileSession from '../hooks/useCaseFileSession'
import Overlay from '../components/ui/Overlay'
import { useGameChrome } from '../context/GameChromeContext'
import StageRouter from '../components/caseFiles/StageRouter'
import CaseFilesGate from '../components/caseFiles/CaseFilesGate'
import TutorialModal from '../components/tutorial/TutorialModal'
import SEO from '../components/SEO'
import { stageTypeLabel } from '../utils/caseFiles/scoringDisplay'

// ── Tiny spinner ──────────────────────────────────────────────────────────────
function Spinner({ label = 'Loading case file…' }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <div className="w-8 h-8 border-2 border-slate-300/30 border-t-brand-600 rounded-full animate-spin" />
      <p className="text-sm text-slate-500 tracking-wide">{label}</p>
    </div>
  )
}

// ── Header (Abort · Title · Stage X/N) + case progress tracker ─────────────────
// The bare "Stage 3 / 8" pill said how far along you were but not what was
// left. The tracker underneath names each stage, so a player can see the
// interviews are still to come before they rush the map.
function PlayHeader({ chapter, currentStageIndex, totalStages, onAbort }) {
  const stages = chapter.stages ?? []
  return (
    <div className="shrink-0 border-b border-slate-200/10 bg-surface/95 backdrop-blur-sm">
      <div className="flex items-center gap-2 px-3 py-2">
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

      {stages.length > 1 && (
        <ol
          data-testid="case-progress"
          aria-label="Case progress"
          className="flex gap-1 px-3 pb-2"
        >
          {stages.map((s, i) => {
            const done    = i < currentStageIndex
            const current = i === currentStageIndex
            return (
              <li
                key={s.id ?? i}
                aria-current={current ? 'step' : undefined}
                className="flex-1 min-w-0 flex flex-col gap-1"
              >
                <span
                  className={[
                    'relative h-1 rounded-full overflow-hidden transition-colors duration-500',
                    done ? 'bg-brand-600' : current ? 'bg-brand-600/25' : 'bg-slate-500/25',
                  ].join(' ')}
                >
                  {current && (
                    <motion.span
                      key={`fill-${i}`}
                      className="absolute inset-y-0 left-0 bg-brand-600 rounded-full"
                      initial={{ width: '0%' }}
                      animate={{ width: '55%' }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                    />
                  )}
                </span>
                <span
                  className={[
                    'hidden sm:block truncate font-mono text-[9px] uppercase tracking-wider transition-colors',
                    current ? 'text-brand-600 font-bold' : done ? 'text-text-muted' : 'text-slate-500/70',
                  ].join(' ')}
                >
                  {done ? '✓ ' : ''}{stageTypeLabel(s.type)}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

// ── Stage title card ──────────────────────────────────────────────────────────
// A beat of ceremony between stages: "STAGE 04 · INTERROGATIONS" stamps across
// the screen and clears itself. It never takes a click (pointer-events-none),
// so a player who already knows the drill is not held up by it.
function StageTitleCard({ index, total, type }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 1150)
    return () => clearTimeout(t)
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="stage-title-card"
          data-testid="stage-title-card"
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-[#06101e]/55"
        >
          <motion.div
            initial={{ scale: 1.6, opacity: 0, rotate: -6 }}
            animate={{ scale: 1, opacity: 1, rotate: -3 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 480, damping: 22 }}
            className="flex flex-col items-center gap-1 px-6 py-3 border-[3px] border-brand-600/80 rounded-sm bg-surface/80 cf-stamp-ink"
            style={{ outline: '1px solid rgba(91,170,255,0.5)', outlineOffset: '3px', boxShadow: '0 0 40px rgba(91,170,255,0.25)' }}
          >
            <span className="font-mono text-[10px] tracking-[0.35em] text-brand-600/80 font-bold">
              STAGE {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
            </span>
            <span className="font-mono text-xl sm:text-2xl font-black tracking-[0.2em] uppercase text-brand-600">
              {stageTypeLabel(type)}
            </span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── Resume notice ─────────────────────────────────────────────────────────────
// Shown once when the server handed back an unfinished run instead of starting
// a new one, so the player understands why they are not on stage 1.
function ResumeNotice({ stageNumber, totalStages, onDismiss }) {
  return (
    <div
      data-testid="resume-notice"
      className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-brand-100/40 border-b border-brand-600/20"
    >
      <p className="flex-1 text-[11px] text-brand-600 intel-mono">
        Picked your case back up at stage {stageNumber} of {totalStages}.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-brand-600/70 hover:text-brand-600 text-xs px-1"
      >
        ✕
      </button>
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
    // z-100 left the backdrop under the app TopBar (z-[1001]), so the header
    // stayed lit and clickable behind a supposedly modal dialog.
    <Overlay zIndex={1100} backdrop="rgba(0,0,0,0.70)" onDismiss={onCancel} className="flex items-center justify-center px-4" data-testid="abort-confirm-modal">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="abort-title"
        className="w-full max-w-sm rounded-2xl border border-slate-300/20 bg-surface p-5 flex flex-col gap-3"
      >
        <h2 id="abort-title" className="text-base font-bold text-text">
          Leave this case?
        </h2>
        <p className="text-sm text-text-muted leading-relaxed">
          Save and exit and you will pick this run back up at the stage you
          reached. Start over and this run is thrown away and the case begins
          again from stage one, which uses another of today&#39;s attempts.
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
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
            onClick={() => onConfirm({ abandon: false })}
            data-testid="abort-save-btn"
            className="px-4 py-2 rounded-btn text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-colors"
          >
            Save and Exit
          </button>
          {/* "Give Up" tested badly: it abandoned the run correctly but then
              dropped you on the catalogue with no confirmation, so it read as
              having done nothing. What people mean by giving up on a case is
              starting it again, so that is what this does, in place. */}
          <button
            type="button"
            onClick={() => onConfirm({ restart: true })}
            data-testid="abort-confirm-btn"
            className="px-4 py-2 rounded-btn text-sm font-semibold text-white bg-danger hover:opacity-90 transition-opacity"
          >
            Start Over
          </button>
        </div>
      </div>
    </Overlay>
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
    resumed,
    submitStage,
    sendQuestion,
    restartSession,
  } = useCaseFileSession({ caseSlug, chapterSlug })

  const [abortOpen,     setAbortOpen]     = useState(false)
  const [noticeHidden,  setNoticeHidden]  = useState(false)

  // Stage the run was picked back up at. Frozen on first sight, and the notice
  // retires as soon as the player finishes a stage — otherwise it followed them
  // through the whole chapter, re-reading "picked your case back up at stage 6"
  // when they had actually resumed at stage 4.
  const resumedAtRef = useRef(null)
  if (resumed && resumedAtRef.current === null) resumedAtRef.current = currentStageIndex
  const showResumeNotice =
    resumed &&
    !noticeHidden &&
    resumedAtRef.current !== null &&
    resumedAtRef.current > 0 &&
    currentStageIndex === resumedAtRef.current

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

  // The final `debrief` stage used to render in-flow, where `scoring` is still
  // null (the server only scores on /complete) — so players met a DEBRIEF
  // screen stuck on "Computing your score…", pressed Close Case, and were then
  // shown a second, identical-looking debrief that finally had the number on
  // it. Submit that stage for them instead and go straight to the scored one.
  const debriefSubmittedRef = useRef(false)
  const activeStage = chapter?.stages?.[currentStageIndex]
  const isAutoDebrief = activeStage?.type === 'debrief'
  useEffect(() => {
    if (loading || error || gate || sessionId === null || isCompleted) return
    if (!isAutoDebrief || debriefSubmittedRef.current) return
    debriefSubmittedRef.current = true
    submitStage({ viewed: true }).catch(() => { debriefSubmittedRef.current = false })
  }, [loading, error, gate, sessionId, isCompleted, isAutoDebrief, submitStage])

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
        minTier={gate.minTier}
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
        <SEO title="Loading…" />
        <Spinner />
      </>
    )
  }

  const stage = chapter.stages?.[currentStageIndex]

  // id → headline for every evidence card in the chapter. Stages that refer
  // back to an earlier card (phase_reveal's assessments) can then name it
  // instead of printing its database id.
  const itemTitles = {}
  for (const s of chapter.stages ?? []) {
    for (const item of [...(s.payload?.items ?? []), ...(s.payload?.newItems ?? []), ...(s.payload?.startingItems ?? [])]) {
      if (item?.id && item.title) itemTitles[item.id] = item.title
    }
  }

  const sessionContext = {
    caseSlug,
    chapterSlug,
    chapterTitle: chapter.title,
    sessionId,
    priorResults,
    itemTitles,
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

  async function handleAbortConfirm({ restart } = {}) {
    setAbortOpen(false)
    if (restart) {
      // Stay on the page: the run resets to stage one in front of the player,
      // which is the confirmation that anything happened.
      debriefSubmittedRef.current = false
      resumedAtRef.current = null
      await restartSession()
      return
    }
    navigate('/case-files')
  }

  return (
    <>
      <TutorialModal />
      <SEO title={chapter.title} />

      {/*
        Layout strategy:
          • Mobile (≤600px): fixed-position full-viewport flex column. AppShell's
            chrome is hidden by enterImmersive(); this overlay covers the page so
            the stage UI always fits 100dvh without page-level scrolling.
          • Desktop (>600px): pinned to exactly the height AppShell leaves, so
            only a stage's own content area ever scrolls, never the page. On a
            non-/cbat route AppShell takes 11.5rem: 3.5 topbar + 1.5 top and
            1.5 bottom content padding + 5 on .app-shell-main, whose unlayered
            rule beats md:pb-6 even on desktop. This used to deduct 6.5rem,
            which left an 80px page scroll under every stage. The edge is 601px
            (not sm:) so it meets the phone layout with no gap between.
      */}
      <div
        className={[
          'flex flex-col w-full',
          'max-[600px]:fixed max-[600px]:inset-0 max-[600px]:z-40 max-[600px]:bg-[#06101e] max-[600px]:h-[100dvh]',
          'min-[601px]:relative min-[601px]:h-[calc(100dvh-11.5rem-env(safe-area-inset-bottom))] min-[601px]:min-h-[26rem]',
        ].join(' ')}
        data-testid="case-file-play"
      >
        <PlayHeader
          chapter={chapter}
          currentStageIndex={currentStageIndex}
          totalStages={totalStages}
          onAbort={() => setAbortOpen(true)}
        />

        {/* Only worth saying once there is actually progress to have kept —
            "picked you back up at stage 1 of 8" is just noise. */}
        {showResumeNotice && (
          <ResumeNotice
            stageNumber={resumedAtRef.current + 1}
            totalStages={totalStages}
            onDismiss={() => setNoticeHidden(true)}
          />
        )}

        {/* Stage area — flexes to fill remaining height, stage handles internal scroll */}
        <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
          {stage && !isAutoDebrief && (
            <StageTitleCard
              key={`title-${currentStageIndex}`}
              index={currentStageIndex}
              total={totalStages}
              type={stage.type}
            />
          )}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`stage-${currentStageIndex}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              // Kept short on purpose: mode="wait" runs exit then enter back to
              // back, so anything longer leaves the stage area visibly empty
              // between stages and reads as a broken page.
              transition={{ duration: 0.12, ease: 'easeInOut' }}
              className="flex-1 min-h-0 flex flex-col"
            >
              {isAutoDebrief ? (
                <Spinner label="Scoring your analysis…" />
              ) : stage ? (
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
