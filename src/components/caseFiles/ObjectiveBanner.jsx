/**
 * ObjectiveBanner
 * Plain-English "what to do" strip rendered above each Case File stage.
 * Helps players who don't know the topic understand the task in front of them.
 *
 * Hard-coded per stage type — no schema dependency.
 */

const STAGE_OBJECTIVES = {
  cold_open: {
    label: 'Starting position',
    text:  'Read the briefing. The thumbnails below are your starting clues — hover for a quick hint.',
  },
  evidence_wall: {
    label: 'Your job',
    text:  'Link cards that share a theme — same place, same plan, same group. Aim for 4–6 strong links. Wrong links cost a little, so try ideas without worrying.',
  },
  map_predictive: {
    label: 'Your job',
    text:  'If they attack, where would they strike first? Click two places to draw a route. You have 3 routes total — star the one that goes for the capital.',
  },
  actor_interrogations: {
    label: 'Your job',
    text:  'Different people know different things. Pick who you think would actually know, and ask short, specific questions. Up to 3 per person.',
  },
  decision_point: {
    label: 'Your call',
    text:  'Pick what you think will actually happen. Each option shows a hint — read them before you lock in.',
  },
  phase_reveal: {
    label: 'What happened',
    text:  'New evidence has come in. Add any extra links you spot now that the picture is clearer.',
  },
  map_live: {
    label: 'Your job',
    text:  'Events are unfolding live. Answer each question as it appears on the map.',
  },
  debrief: {
    label: 'Mission review',
    text:  'See what you got right, what you missed, and why each call mattered.',
  },
}

export default function ObjectiveBanner({ stageType }) {
  const objective = STAGE_OBJECTIVES[stageType]
  if (!objective) return null

  return (
    <div
      data-testid="objective-banner"
      className="px-4 py-2.5 border-b border-brand-600/20 bg-brand-100/30 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3"
    >
      <span className="intel-mono text-[10px] tracking-widest text-brand-600 uppercase shrink-0">
        {objective.label}
      </span>
      <p className="text-[12px] sm:text-[13px] text-text leading-snug">
        {objective.text}
      </p>
    </div>
  )
}
