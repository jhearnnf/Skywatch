import QuizGameModal from './QuizGameModal'

export default function ReadyForBriefing({ briefId, hasQuestions, hasCompleted, quizOpen, onQuizOpen, onQuizClose, onQuizComplete }) {
  return (
    <>
      <div className="ready-for-briefing">
        <div className="rfb__inner">

          {hasCompleted ? (
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
              <button className="rfb__cta rfb__cta--retake" onClick={onQuizOpen}>
                Retake Quiz
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
                disabled={!hasQuestions}
                title={!hasQuestions ? 'Quiz not ready for this brief.' : undefined}
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
