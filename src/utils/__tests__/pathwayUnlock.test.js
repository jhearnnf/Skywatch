import { describe, it, expect } from 'vitest'
import { pathwayTierRequired } from '../subscription'

// ── Inline the pure unlock logic so tests don't depend on the React component ─

function tierRank(tier) {
  return { free: 0, trial: 1, silver: 1, gold: 2 }[tier] ?? 0
}

function isPathwayUnlocked(unlock, userLevel, userRankNumber, userTier) {
  return (
    userLevel      >= (unlock.levelRequired ?? 1) &&
    userRankNumber >= (unlock.rankRequired  ?? 1) &&
    tierRank(userTier) >= tierRank(unlock.tierRequired ?? 'free')
  )
}

// ── Settings fixture ──────────────────────────────────────────────────────────

const SETTINGS = {
  freeCategories:   ['News', 'Bases', 'Terminology'],
  silverCategories: ['News', 'Bases', 'Terminology', 'Aircrafts', 'Ranks', 'Squadrons', 'Allies', 'Training', 'AOR', 'Roles', 'Tech'],
}

// Build pathway objects the same way LearnPriority does
function makePathway(category, levelRequired, rankRequired) {
  const tierRequired = pathwayTierRequired(category, SETTINGS)
  return { category, levelRequired, rankRequired, tierRequired }
}

// ── pathwayTierRequired derives correctly from settings ───────────────────────

describe('pathwayTierRequired derives tier from settings', () => {
  it('News is free', () => expect(pathwayTierRequired('News', SETTINGS)).toBe('free'))
  it('Aircrafts is silver (in silver list, not free list)', () => expect(pathwayTierRequired('Aircrafts', SETTINGS)).toBe('silver'))
  it('Threats is gold (in neither list)', () => expect(pathwayTierRequired('Threats', SETTINGS)).toBe('gold'))
  it('Treaties is gold (in neither list)', () => expect(pathwayTierRequired('Treaties', SETTINGS)).toBe('gold'))
})

// ── Level gate ────────────────────────────────────────────────────────────────

describe('pathway level gate', () => {
  const pathway = makePathway('News', 3, 1)  // news is free, level 3 required

  it('unlocks when user meets level requirement', () => {
    expect(isPathwayUnlocked(pathway, 3, 1, 'free')).toBe(true)
    expect(isPathwayUnlocked(pathway, 5, 1, 'free')).toBe(true)
  })

  it('stays locked when user is below level requirement', () => {
    expect(isPathwayUnlocked(pathway, 1, 1, 'free')).toBe(false)
    expect(isPathwayUnlocked(pathway, 2, 1, 'free')).toBe(false)
  })
})

// ── Rank gate ─────────────────────────────────────────────────────────────────

describe('pathway rank gate', () => {
  const pathway = makePathway('News', 1, 4)  // news is free, rank 4 required

  it('unlocks when user meets rank requirement', () => {
    expect(isPathwayUnlocked(pathway, 1, 4, 'free')).toBe(true)
    expect(isPathwayUnlocked(pathway, 1, 10, 'free')).toBe(true)
  })

  it('stays locked when user is below rank requirement', () => {
    expect(isPathwayUnlocked(pathway, 1, 1, 'free')).toBe(false)
    expect(isPathwayUnlocked(pathway, 1, 3, 'free')).toBe(false)
  })
})

// ── Tier gate (derived from settings) ────────────────────────────────────────

describe('pathway tier gate (derived from category settings)', () => {
  const silverPathway = makePathway('Aircrafts', 1, 1)  // silver tier, level 1, rank 1
  const goldPathway   = makePathway('Threats',   1, 1)  // gold tier, level 1, rank 1
  const freePathway   = makePathway('News',      1, 1)  // free tier, level 1, rank 1

  it('free pathway unlocks for free user', () => {
    expect(isPathwayUnlocked(freePathway, 1, 1, 'free')).toBe(true)
  })

  it('silver pathway locks for free user', () => {
    expect(isPathwayUnlocked(silverPathway, 1, 1, 'free')).toBe(false)
  })

  it('silver pathway unlocks for silver user', () => {
    expect(isPathwayUnlocked(silverPathway, 1, 1, 'silver')).toBe(true)
  })

  it('silver pathway unlocks for gold user', () => {
    expect(isPathwayUnlocked(silverPathway, 1, 1, 'gold')).toBe(true)
  })

  it('gold pathway locks for silver user', () => {
    expect(isPathwayUnlocked(goldPathway, 1, 1, 'silver')).toBe(false)
  })

  it('gold pathway unlocks for gold user', () => {
    expect(isPathwayUnlocked(goldPathway, 1, 1, 'gold')).toBe(true)
  })

  it('silver pathway unlocks for active trial user (silver perks)', () => {
    expect(isPathwayUnlocked(silverPathway, 1, 1, 'trial')).toBe(true)
  })
})

// ── All three gates must pass simultaneously ──────────────────────────────────

describe('all three gates combined', () => {
  // Threats: gold tier, level 6, rank 3 required
  const threats = makePathway('Threats', 6, 3)

  it('unlocks only when level, rank, AND tier are all met', () => {
    expect(isPathwayUnlocked(threats, 6, 3, 'gold')).toBe(true)
  })

  it('stays locked if level not met even with correct tier and rank', () => {
    expect(isPathwayUnlocked(threats, 5, 3, 'gold')).toBe(false)
  })

  it('stays locked if rank not met even with correct tier and level', () => {
    expect(isPathwayUnlocked(threats, 6, 2, 'gold')).toBe(false)
  })

  it('stays locked if tier not met even with correct level and rank', () => {
    expect(isPathwayUnlocked(threats, 6, 3, 'silver')).toBe(false)
    expect(isPathwayUnlocked(threats, 6, 3, 'free')).toBe(false)
  })
})

// ── Admin change propagation: tier follows category settings ──────────────────

describe('tier derives dynamically from settings', () => {
  it('category treated as free when added to freeCategories', () => {
    const settings = { freeCategories: ['Threats'], silverCategories: [] }
    expect(pathwayTierRequired('Threats', settings)).toBe('free')
  })

  it('category treated as gold when removed from all tier lists', () => {
    const settings = { freeCategories: [], silverCategories: [] }
    expect(pathwayTierRequired('Aircrafts', settings)).toBe('gold')
  })

  it('category treated as silver when moved from free to silver only', () => {
    const settings = { freeCategories: [], silverCategories: ['News'] }
    expect(pathwayTierRequired('News', settings)).toBe('silver')
  })
})
