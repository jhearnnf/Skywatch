export const PATHWAY_COLORS = {
  News:        '#a16207', Bases:       '#2563eb', Aircrafts:   '#64748b',
  Ranks:       '#d97706', Squadrons:   '#7c3aed', Training:    '#059669',
  Roles:       '#ea580c', Threats:     '#dc2626', Missions:    '#0891b2',
  Terminology: '#4f46e5', Heritage:    '#b45309', Allies:      '#16a34a',
  AOR:         '#0d9488', Tech:        '#0284c7', Treaties:    '#db2777',
  Actors:      '#9333ea',
}

export const DEFAULT_PATHWAY_UNLOCKS = [
  { category: 'Bases',     levelRequired: 1, rankRequired: 1, tierRequired: 'free'   },
  { category: 'Aircrafts', levelRequired: 2, rankRequired: 1, tierRequired: 'free'   },
  { category: 'Ranks',     levelRequired: 2, rankRequired: 1, tierRequired: 'silver' },
  { category: 'Squadrons', levelRequired: 3, rankRequired: 2, tierRequired: 'silver' },
  { category: 'Training',  levelRequired: 4, rankRequired: 2, tierRequired: 'silver' },
  { category: 'Roles',     levelRequired: 5, rankRequired: 3, tierRequired: 'silver' },
  { category: 'Actors',    levelRequired: 5, rankRequired: 3, tierRequired: 'silver' },
  { category: 'Threats',   levelRequired: 6, rankRequired: 3, tierRequired: 'gold'   },
  { category: 'Missions',  levelRequired: 7, rankRequired: 4, tierRequired: 'gold'   },
]

export function tierRankNum(tier) {
  return { free: 0, trial: 1, silver: 1, gold: 2 }[tier] ?? 0
}
