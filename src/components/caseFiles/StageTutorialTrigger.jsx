import { useEffect } from 'react'
import { useAppTutorial } from '../../context/AppTutorialContext'

const STAGE_TUTORIAL_MAP = {
  cold_open:            'caseFile_coldOpen',
  evidence_wall:        'caseFile_evidenceWall',
  actor_interrogations: 'caseFile_actorInterrogations',
  decision_point:       'caseFile_decisionPoint',
  map_predictive:       'caseFile_mapPredictive',
  phase_reveal:         'caseFile_phaseReveal',
  map_live:             'caseFile_mapLive',
  debrief:              'caseFile_debrief',
}

export default function StageTutorialTrigger({ stageType }) {
  const { start, replay } = useAppTutorial()
  const tutorialName = STAGE_TUTORIAL_MAP[stageType]

  useEffect(() => {
    if (tutorialName) start(tutorialName)
  }, [tutorialName]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!tutorialName) return null

  return (
    <button
      type="button"
      onClick={() => replay(tutorialName)}
      title="Replay tutorial"
      aria-label="Replay stage tutorial"
      className="fixed top-16 right-3 z-40 w-7 h-7 flex items-center justify-center rounded-full bg-surface-raised border border-slate-300/30 text-slate-400 hover:text-brand-600 text-sm font-bold leading-none"
    >
      ?
    </button>
  )
}
