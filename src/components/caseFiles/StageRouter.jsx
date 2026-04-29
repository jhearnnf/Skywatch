/**
 * StageRouter — pure dispatcher that picks the right stage component
 * by stage.type and forwards the appropriate props subset.
 *
 * Props:
 *   stage          { id, type, payload }
 *   sessionContext { caseSlug, chapterSlug, sessionId, priorResults }
 *   onSubmit       (resultPayload) => Promise<void>
 *   sendQuestion   (actorId, question) => Promise<{ answer, questionsRemaining }>
 *                  — only forwarded to actor_interrogations
 *   scoring        { totalScore, breakdown } | null
 *                  — only forwarded to debrief (Case Files don't award airstars/XP)
 */

import StageTutorialTrigger    from './StageTutorialTrigger'
import ObjectiveBanner         from './ObjectiveBanner'
import ColdOpenStage           from './stages/ColdOpenStage'
import EvidenceWallStage       from './stages/EvidenceWallStage'
import MapPredictiveStage      from './stages/MapPredictiveStage'
import ActorInterrogationsStage from './stages/ActorInterrogationsStage'
import DecisionPointStage      from './stages/DecisionPointStage'
import PhaseRevealStage        from './stages/PhaseRevealStage'
import MapLiveStage            from './stages/MapLiveStage'
import DebriefStage            from './stages/DebriefStage'

const STAGE_COMPONENTS = {
  cold_open:            ColdOpenStage,
  evidence_wall:        EvidenceWallStage,
  map_predictive:       MapPredictiveStage,
  actor_interrogations: ActorInterrogationsStage,
  decision_point:       DecisionPointStage,
  phase_reveal:         PhaseRevealStage,
  map_live:             MapLiveStage,
  debrief:              DebriefStage,
}

export default function StageRouter({ stage, sessionContext, onSubmit, sendQuestion, scoring }) {
  const Cmp = STAGE_COMPONENTS[stage?.type]

  if (!Cmp) {
    return (
      <div className="p-8 text-slate-500">
        Unknown stage type: {stage?.type}
      </div>
    )
  }

  const props = { stage, sessionContext, onSubmit }
  if (stage.type === 'actor_interrogations') props.sendQuestion = sendQuestion
  if (stage.type === 'debrief')              props.scoring      = scoring

  return (
    <>
      <StageTutorialTrigger stageType={stage.type} />
      <ObjectiveBanner stageType={stage.type} />
      {/*
        Stage area — fills remaining viewport height inside CaseFilePlay's flex
        column. Each stage component is responsible for internal scrolling and
        keeping its primary action button visible at the bottom of the stage.
      */}
      <div className="flex-1 min-h-0 flex flex-col w-full">
        <Cmp {...props} />
      </div>
    </>
  )
}
