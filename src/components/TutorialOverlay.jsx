import { useTutorial } from '../context/TutorialContext'

export default function TutorialOverlay() {
  const { showOverlay, stepData, activeStep, totalSteps, next, skip } = useTutorial()
  if (!showOverlay || !stepData) return null

  const isLast = activeStep === totalSteps - 1

  return (
    <div className="tut-overlay" role="dialog" aria-modal="true" aria-label={stepData.title}>
      <div className="tut-card">

        <div className="tut-card__eyebrow">
          <span className="tut-card__badge">▸ MISSION BRIEFING</span>
          <span className="tut-card__step">{activeStep + 1} / {totalSteps}</span>
        </div>

        <h2 className="tut-card__title">{stepData.title}</h2>
        <p className="tut-card__body">{stepData.body}</p>

        <div className="tut-card__actions">
          <button className="tut-card__next" onClick={next}>
            {isLast ? 'Got it' : 'Next →'}
          </button>
          {!isLast && (
            <button className="tut-card__skip" onClick={skip}>Skip tutorial</button>
          )}
        </div>

      </div>
    </div>
  )
}
