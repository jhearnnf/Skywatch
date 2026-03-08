import QuizGameModal from './QuizGameModal'

export default function ReadyForBriefing({ briefId, hasQuestions, hasCompleted, quizOpen, targetingActive, onQuizOpen, onQuizClose, onQuizComplete, loggedIn, onLoginClick }) {
  // No questions and not yet completed — entire card is in a pending/suspended state
  const assessmentPending = loggedIn && !hasCompleted && !hasQuestions

  return (
    <>
      <div className={[
        'ready-for-briefing',
        targetingActive    ? 'ready-for-briefing--locked'  : '',
        assessmentPending  ? 'ready-for-briefing--pending' : '',
      ].filter(Boolean).join(' ')}>
        <div className="rfb__inner">

          {!loggedIn ? (
            <>
              <p className="rfb__eyebrow">Operator</p>
              <h2 className="rfb__title">Ready for Briefing?</h2>
              <p className="rfb__subtitle">
                Sign in to test your recall of this intel and earn Aircoins.
              </p>
              <button className="rfb__cta" onClick={onLoginClick}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Sign In to Play
              </button>
            </>
          ) : hasCompleted ? (
            <>
              <p className="rfb__eyebrow">Knowledge Check</p>
              <h2 className="rfb__title rfb__title--done">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: '0.4rem' }}>
                  <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M6 10l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Quiz Completed
              </h2>
              <p className="rfb__subtitle">
                Aircoins already earned for this brief. Retake anytime — no extra coins awarded.
              </p>
              <button className="rfb__cta rfb__cta--retake" onClick={onQuizOpen} disabled={targetingActive} title={targetingActive ? 'Finish reading the brief first.' : undefined}>
                Retake Quiz
              </button>
            </>
          ) : assessmentPending ? (
            <>
              <p className="rfb__eyebrow rfb__eyebrow--suspended">Assessment Suspended</p>
              <h2 className="rfb__title rfb__title--pending">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: '0.45rem' }}>
                  <circle cx="9" cy="9" r="8" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M9 5v4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <circle cx="9" cy="13" r="1" fill="currentColor"/>
                </svg>
                Intel Compilation Incomplete
              </h2>
              <p className="rfb__subtitle rfb__subtitle--pending">
                Insufficient intelligence data has been compiled for this brief.
                Assessment protocols cannot be initiated until additional intel has been processed and cleared for evaluation.
              </p>
              <button className="rfb__cta rfb__cta--suspended" disabled>
                Assessment Locked
              </button>
            </>
          ) : (
            <>
              <p className="rfb__eyebrow">Operator</p>
              <h2 className="rfb__title">Ready for Briefing?</h2>
              <p className="rfb__subtitle">
                Test your recall of this intel. Earn Aircoins if you win.
              </p>
              <button
                className="rfb__cta"
                onClick={onQuizOpen}
                disabled={targetingActive}
                title={targetingActive ? 'Finish reading the brief first.' : undefined}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Start Knowledge Check
              </button>
            </>
          )}

        </div>
      </div>

      {quizOpen && (
        <QuizGameModal briefId={briefId} onClose={onQuizClose} onComplete={onQuizComplete} />
      )}
    </>
  )
}
