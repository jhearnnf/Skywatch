import { describe, it, expect } from 'vitest'
import { displayTier, getAccessibleCategories, isCategoryLocked } from '../subscription'

// ── displayTier ───────────────────────────────────────────────────────────────

describe('displayTier', () => {
  it('returns "Guest" for null user', () => {
    expect(displayTier(null)).toBe('Guest')
  })

  it('returns "Free" for free-tier user', () => {
    expect(displayTier({ subscriptionTier: 'free' })).toBe('Free')
  })

  it('returns "Silver" for silver-tier user', () => {
    expect(displayTier({ subscriptionTier: 'silver' })).toBe('Silver')
  })

  it('returns "Gold" for gold-tier user', () => {
    expect(displayTier({ subscriptionTier: 'gold' })).toBe('Gold')
  })

  it('returns "Trial (Silver)" for active trial user', () => {
    expect(displayTier({ subscriptionTier: 'trial', isTrialActive: true })).toBe('Trial (Silver)')
  })

  it('returns "Trial (expired)" for expired trial user', () => {
    expect(displayTier({ subscriptionTier: 'trial', isTrialActive: false })).toBe('Trial (expired)')
  })

  it('defaults to "Free" when subscriptionTier is missing', () => {
    expect(displayTier({})).toBe('Free')
  })
})

// ── getAccessibleCategories ───────────────────────────────────────────────────

const SETTINGS = {
  guestCategories:  ['News'],
  freeCategories:   ['News'],
  silverCategories: ['News', 'Aircrafts', 'Bases'],
}

describe('getAccessibleCategories', () => {
  it('returns [] when settings is null/undefined', () => {
    expect(getAccessibleCategories(null, null)).toEqual([])
  })

  it('returns guestCategories for null user', () => {
    expect(getAccessibleCategories(null, SETTINGS)).toEqual(['News'])
  })

  it('returns freeCategories for free user', () => {
    expect(getAccessibleCategories({ subscriptionTier: 'free' }, SETTINGS)).toEqual(['News'])
  })

  it('returns silverCategories for silver user', () => {
    expect(getAccessibleCategories({ subscriptionTier: 'silver' }, SETTINGS))
      .toEqual(['News', 'Aircrafts', 'Bases'])
  })

  it('returns null for gold user (all categories unlocked)', () => {
    expect(getAccessibleCategories({ subscriptionTier: 'gold' }, SETTINGS)).toBeNull()
  })

  it('returns silverCategories for active trial user', () => {
    expect(getAccessibleCategories(
      { subscriptionTier: 'trial', isTrialActive: true }, SETTINGS
    )).toEqual(['News', 'Aircrafts', 'Bases'])
  })

  it('returns freeCategories for expired trial user', () => {
    expect(getAccessibleCategories(
      { subscriptionTier: 'trial', isTrialActive: false }, SETTINGS
    )).toEqual(['News'])
  })
})

// ── isCategoryLocked ──────────────────────────────────────────────────────────

describe('isCategoryLocked', () => {
  it('News is not locked for guest', () => {
    expect(isCategoryLocked('News', null, SETTINGS)).toBe(false)
  })

  it('Aircrafts is locked for guest', () => {
    expect(isCategoryLocked('Aircrafts', null, SETTINGS)).toBe(true)
  })

  it('Aircrafts is not locked for silver user', () => {
    expect(isCategoryLocked('Aircrafts', { subscriptionTier: 'silver' }, SETTINGS)).toBe(false)
  })

  it('Treaties is locked for silver user', () => {
    expect(isCategoryLocked('Treaties', { subscriptionTier: 'silver' }, SETTINGS)).toBe(true)
  })

  it('nothing is locked for gold user', () => {
    expect(isCategoryLocked('Treaties', { subscriptionTier: 'gold' }, SETTINGS)).toBe(false)
    expect(isCategoryLocked('Aircrafts', { subscriptionTier: 'gold' }, SETTINGS)).toBe(false)
  })

  it('Aircrafts is not locked for active trial user (silver perks)', () => {
    expect(isCategoryLocked('Aircrafts', { subscriptionTier: 'trial', isTrialActive: true }, SETTINGS)).toBe(false)
  })

  it('Aircrafts is locked for expired trial user (free perks)', () => {
    expect(isCategoryLocked('Aircrafts', { subscriptionTier: 'trial', isTrialActive: false }, SETTINGS)).toBe(true)
  })

  it('returns false (fail open) when settings is null', () => {
    expect(isCategoryLocked('Aircrafts', null, null)).toBe(false)
  })
})
