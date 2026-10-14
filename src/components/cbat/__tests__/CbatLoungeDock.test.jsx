import { describe, it, expect } from 'vitest'
import { cbatRouteKind, dockMode } from '../../../utils/cbat/loungeDock'

// The desktop CBAT chat is one panel that stays put across CBAT pages. These
// are the rules for where it sits; the layout itself needs a real browser.

describe('cbatRouteKind', () => {
  it('knows the hub, a game and a leaderboard', () => {
    expect(cbatRouteKind('/cbat')).toBe('hub')
    expect(cbatRouteKind('/cbat/act')).toBe('game')
    expect(cbatRouteKind('/cbat/flag-easier/leaderboard')).toBe('board')
  })

  it('serves nothing outside CBAT, nor the report or the mock', () => {
    expect(cbatRouteKind('/profile')).toBeNull()
    expect(cbatRouteKind('/cbat/report')).toBeNull()
    expect(cbatRouteKind('/cbat/mock')).toBeNull()
    expect(cbatRouteKind('/cbat/mock/abc')).toBeNull()
  })
})

const base = { kind: 'game', hubSlot: null, immersive: false, gameOver: false, stick: false, wide: true, wider: true }

describe('dockMode', () => {
  it('fills the right-hand column on an instructions page', () => {
    expect(dockMode(base)).toBe('full')
  })

  // The slide down when a game starts, and back up after.
  it('slides away while a game is being played, and on the results screen', () => {
    expect(dockMode({ ...base, immersive: true })).toBe('hidden')
    expect(dockMode({ ...base, gameOver: true })).toBe('hidden')
  })

  it('fills the column on a leaderboard', () => {
    expect(dockMode({ ...base, kind: 'board' })).toBe('full')
  })

  it('sits under Recent Scores whenever the hub column is there', () => {
    expect(dockMode({ ...base, kind: 'hub', hubSlot: {} })).toBe('hub')
    // Still the hub's while the hub fades out on the way to a game.
    expect(dockMode({ ...base, kind: 'game', hubSlot: {} })).toBe('hub')
  })

  it('holds still on arrival at the hub until its column has mounted', () => {
    expect(dockMode({ ...base, kind: 'hub' })).toBe('hold')
  })

  it('hides on a window too narrow to give it a column', () => {
    expect(dockMode({ ...base, wide: false, wider: false })).toBe('hidden')
  })

  // The joystick games need more room before the panel fits beside them.
  it('asks more width of the joystick games', () => {
    expect(dockMode({ ...base, stick: true, wide: true, wider: false })).toBe('hidden')
    expect(dockMode({ ...base, stick: true, wide: true, wider: true })).toBe('full')
  })
})
