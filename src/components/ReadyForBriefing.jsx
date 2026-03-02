import QuizGameModal from './QuizGameModal'

export default function ReadyForBriefing({ briefId, quizOpen, onQuizOpen, onQuizClose }) {
  return (
    <>
      <div className="ready-for-briefing">
        <div className="rfb__inner">
          <p className="rfb__eyebrow">Operator</p>
          <h2 className="rfb__title">Ready for Briefing?</h2>
          <p className="rfb__subtitle">
            Test your recall of this intel. Earn Aircoins if you win.
          </p>
          <button className="rfb__cta" onClick={onQuizOpen}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Start Knowledge Check
          </button>
        </div>
      </div>

      {quizOpen && (
        <QuizGameModal briefId={briefId} onClose={onQuizClose} />
      )}
    </>
  )
}
