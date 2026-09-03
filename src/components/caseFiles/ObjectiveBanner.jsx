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
    text:  'Read the briefing. The thumbnails below are your starting clues. Tap one for a quick hint.',
  },
  evidence_wall: {
    label: 'Your job',
    text:  'Link cards that share a theme: same place, same plan, same group. Click one card, then another to link them, or click a red string to undo. Aim for 4 to 6. Wrong links cost very little, so try your ideas.',
  },
  map_predictive: {
    // Deliberately mechanical: the stage below asks the case-specific question
    // in its own headline, and having the banner ask it again in near-identical
    // words made the top of the screen read as a duplicated paragraph.
    label: 'How this works',
    text:  'Click one place, then another, to draw a route between them. Star the route you think is their main attack.',
  },
  actor_interrogations: {
    label: 'Your job',
    text:  'Different people know different things. Pick who you think would actually know, and ask short, specific questions. Up to 3 each. You score for how many different people you ask, so spread them around.',
  },
  decision_point: {
    label: 'Your call',
    text:  'Pick what you think will actually happen. Each option shows a hint, so read them before you lock in.',
  },
  phase_reveal: {
    // The stage is read-only — there is nothing to add here. It used to say
    // "add any extra links you spot", which sent players hunting for a control
    // that does not exist.
    label: 'What happened',
    text:  'Here is which of your links held up, and the new evidence that came in. Read it, then carry on.',
  },
  map_live: {
    label: 'Your job',
    text:  'This is what really happened, step by step. Press Next Step to move the clock on, and answer each question as it appears.',
  },
  debrief: {
    label: 'Mission review',
    text:  'See what you got right, what you missed, and why each call mattered. Case Files do not affect your airstars or your level.',
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
