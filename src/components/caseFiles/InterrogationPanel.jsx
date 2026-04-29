/**
 * InterrogationPanel
 * Side panel (desktop) / full-screen modal (mobile ≤600px) for interrogating
 * a single actor in the Case Files game.
 *
 * Props
 *   actor              { id, name, role, faction, portraitUrl? }
 *   transcript         [{ q, a, askedAt }]
 *   questionsRemaining number
 *   onSendQuestion     (question: string) => Promise<void>  — parent handles state
 *   onClose            () => void
 *   isPending          boolean — true while a question is in flight
 *   contextDateLabel?  string  — shown in header (optional)
 *
 * Character limit of 280 is enforced via:
 *   1. <textarea maxLength={MAX_CHARS} /> — browser-level hard cap
 *   2. Submit button disabled when input.trim().length === 0 or > MAX_CHARS
 *      (belt-and-suspenders; maxLength makes (2) effectively unreachable but
 *       guards against programmatic injection or future refactors)
 */

import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'

const MAX_CHARS = 280

// CONTRACT-AMBIGUITY: "side panel (desktop) / full-screen modal (mobile)" —
// treating ≤600px as mobile per project breakpoint. Panel slides in from the
// right on desktop (fixed right-0, partial width) and covers full screen on
// mobile. Parent is responsible for rendering only one panel at a time.

const PANEL_VARIANTS = {
  hidden: { x: '100%', opacity: 0 },
  visible: {
    x: 0,
    opacity: 1,
    transition: { type: 'spring', damping: 26, stiffness: 260 },
  },
  exit: {
    x: '100%',
    opacity: 0,
    transition: { duration: 0.18, ease: 'easeIn' },
  },
}

// Typing indicator dots
function TypingIndicator() {
  return (
    <div
      data-testid="typing-indicator"
      className="flex items-center gap-1 px-3 py-2 rounded-xl bg-surface-raised border border-slate-300/30 w-fit"
      aria-label="Actor is typing"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  )
}

export default function InterrogationPanel({
  actor,
  transcript,
  questionsRemaining,
  onSendQuestion,
  onClose,
  isPending,
  contextDateLabel,
}) {
  const [input, setInput] = useState('')
  const [sendError, setSendError] = useState(null)
  const transcriptEndRef = useRef(null)

  const charCount = input.length
  const exhausted = questionsRemaining === 0
  const canSend = !isPending && !exhausted && input.trim().length > 0 && charCount <= MAX_CHARS

  // Scroll transcript to bottom when it grows or while pending
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript, isPending])

  async function handleSend() {
    if (!canSend) return
    const q = input.trim()
    setInput('')
    setSendError(null)
    try {
      await onSendQuestion(q)
    } catch (err) {
      setSendError(err?.message ?? 'Failed to send question. Try again.')
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  const { name = 'Unknown', role = '', suggestedQuestions = [] } = actor ?? {}
  const showSuggestions =
    Array.isArray(suggestedQuestions) &&
    suggestedQuestions.length > 0 &&
    transcript.length === 0 &&
    !exhausted

  return (
    <motion.div
      key="interrogation-panel"
      data-testid="interrogation-panel"
      variants={PANEL_VARIANTS}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={[
        'fixed right-0 top-0 bottom-0 z-50',
        'flex flex-col bg-surface border-l border-slate-300/30 shadow-2xl',
        // Desktop: partial width; Mobile: full screen
        'w-full sm:w-[420px]',
      ].join(' ')}
      style={{ maxWidth: '100vw' }}
      role="dialog"
      aria-modal="true"
      aria-label={`Interrogate ${name}`}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 p-4 border-b border-slate-300/20 shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-0.5 intel-mono">
            Interrogation
          </p>
          <h2 className="text-base font-extrabold text-text leading-tight">{name}</h2>
          {role ? (
            <p className="text-xs text-text-muted mt-0.5 leading-tight">{role}</p>
          ) : null}
          {contextDateLabel ? (
            <p className="text-[10px] text-slate-500 mt-1 intel-mono uppercase tracking-wider">
              {contextDateLabel}
            </p>
          ) : null}
        </div>
        <button
          onClick={onClose}
          aria-label="Close panel"
          data-testid="panel-close-btn"
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-slate-300/40 text-slate-500 hover:text-text hover:border-slate-400 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* ── Transcript ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 min-h-0">
        {transcript.length === 0 && !isPending && (
          <p className="text-sm text-text-muted text-center mt-8 italic">
            Ask your first question below.
          </p>
        )}

        {/* Suggested-question chips — shown only before the first question, to
            help knowledge-light players know what's worth asking. Tapping a
            chip drops the text into the input so the player can edit or send
            it as-is. */}
        {showSuggestions && (
          <div data-testid="suggested-questions" className="flex flex-col gap-1.5 mt-3">
            <p className="text-[10px] uppercase tracking-widest text-brand-600 intel-mono text-center">
              Try asking
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {suggestedQuestions.slice(0, 4).map((q, i) => (
                <button
                  key={i}
                  type="button"
                  data-testid={`suggested-question-${i}`}
                  onClick={() => setInput(q)}
                  className="text-[11px] leading-snug px-2 py-1 rounded border border-brand-600/30 bg-brand-100/20 text-brand-600 hover:border-brand-600/60 hover:bg-brand-100/40 transition-colors text-left max-w-full"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {transcript.map(({ q, a, askedAt }, idx) => (
          <div key={idx} className="flex flex-col gap-2">
            {/* Player question — right aligned */}
            <div className="flex justify-end">
              <div
                className="max-w-[75%] px-3 py-2 rounded-xl rounded-tr-sm bg-brand-200 border border-brand-400/30 text-sm text-text leading-relaxed"
                data-testid={`transcript-q-${idx}`}
              >
                {q}
              </div>
            </div>

            {/* Actor answer — left aligned */}
            {a != null && (
              <div className="flex justify-start">
                <div
                  className="max-w-[75%] px-3 py-2 rounded-xl rounded-tl-sm bg-surface-raised border border-slate-300/20 text-sm text-text leading-relaxed"
                  data-testid={`transcript-a-${idx}`}
                >
                  {a}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator while pending */}
        {isPending && (
          <div className="flex justify-start">
            <TypingIndicator />
          </div>
        )}

        <div ref={transcriptEndRef} />
      </div>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-slate-300/20 p-4 flex flex-col gap-2">
        {/* Questions remaining */}
        <div className="flex items-center justify-between text-xs text-text-muted intel-mono">
          <span data-testid="questions-remaining">
            {exhausted
              ? 'No more questions'
              : `${questionsRemaining} / ${questionsRemaining + transcript.length} questions remaining`}
          </span>
          <span
            data-testid="char-counter"
            className={charCount > MAX_CHARS ? 'text-danger' : ''}
          >
            {charCount} / {MAX_CHARS}
          </span>
        </div>

        {/* Inline error */}
        {sendError && (
          <p className="text-xs text-danger" role="alert" data-testid="send-error">
            {sendError}
          </p>
        )}

        {/* Input row */}
        <div className="flex gap-2 items-end">
          <textarea
            data-testid="question-input"
            value={input}
            onChange={(e) => {
              setSendError(null)
              setInput(e.target.value)
            }}
            onKeyDown={handleKeyDown}
            maxLength={MAX_CHARS}
            disabled={isPending || exhausted}
            placeholder={exhausted ? 'No more questions for this actor.' : 'Ask a question… (Ctrl+Enter to send)'}
            rows={2}
            className={[
              'flex-1 resize-none rounded-xl border bg-surface px-3 py-2 text-sm text-text',
              'placeholder:text-slate-500 leading-relaxed outline-none',
              'transition-colors focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30',
              isPending || exhausted
                ? 'border-slate-300/20 opacity-50 cursor-not-allowed'
                : 'border-slate-300/40',
            ].join(' ')}
            aria-label="Your question"
          />

          <button
            data-testid="send-button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send question"
            className={[
              'shrink-0 h-10 px-4 rounded-xl text-sm font-bold transition-all duration-150',
              canSend
                ? 'bg-brand-600 text-white hover:bg-brand-700 active:scale-95'
                : 'bg-slate-300/20 text-slate-500 cursor-not-allowed',
            ].join(' ')}
          >
            Send
          </button>
        </div>
      </div>
    </motion.div>
  )
}
