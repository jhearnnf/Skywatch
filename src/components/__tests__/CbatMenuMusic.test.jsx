import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const updateCbatMusic = vi.fn()
vi.mock('../../utils/cbat/menuMusic', () => ({ updateCbatMusic: (...a) => updateCbatMusic(...a) }))

let mockPath = '/cbat'
let mockImmersive = false
let mockGameOver = false
let mockSlim = false
vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: mockPath }) }))
vi.mock('../../context/GameChromeContext', () => ({ useGameChrome: () => ({ immersive: mockImmersive, gameOver: mockGameOver }) }))
vi.mock('../../hooks/useSlimMode', () => ({ useSlimMode: () => mockSlim }))

import CbatMenuMusic from '../CbatMenuMusic'

function lastZone() {
  return updateCbatMusic.mock.calls.at(-1)?.[0]
}

beforeEach(() => {
  updateCbatMusic.mockClear()
  mockPath = '/cbat'
  mockImmersive = false
  mockGameOver = false
  mockSlim = false
})
afterEach(cleanup)

describe('<CbatMenuMusic> zone mapping', () => {
  it('menu zone on the CBAT selection page', () => {
    mockPath = '/cbat'
    render(<CbatMenuMusic />)
    expect(lastZone()).toBe('menu')
  })

  it('instructions zone on a game route while not immersive', () => {
    mockPath = '/cbat/dad'
    mockImmersive = false
    render(<CbatMenuMusic />)
    expect(lastZone()).toBe('instructions')
  })

  it('silent (null) on a game route while immersive (in game)', () => {
    mockPath = '/cbat/dad'
    mockImmersive = true
    render(<CbatMenuMusic />)
    expect(lastZone()).toBe(null)
  })

  it('menu zone on a game route at game over (results screen)', () => {
    mockPath = '/cbat/dad'
    mockImmersive = false
    mockGameOver = true
    render(<CbatMenuMusic />)
    expect(lastZone()).toBe('menu')
  })

  it('menu zone on a game leaderboard route', () => {
    mockPath = '/cbat/dad/leaderboard'
    mockImmersive = false
    render(<CbatMenuMusic />)
    expect(lastZone()).toBe('menu')
  })

  it('menu zone on the profile page', () => {
    mockPath = '/profile'
    render(<CbatMenuMusic />)
    expect(lastZone()).toBe('menu')
  })

  it('menu zone on a profile sub-route', () => {
    mockPath = '/profile/badge'
    render(<CbatMenuMusic />)
    expect(lastZone()).toBe('menu')
  })

  it('silent (null) off the CBAT area', () => {
    mockPath = '/home'
    render(<CbatMenuMusic />)
    expect(lastZone()).toBe(null)
  })

  it('menu zone on the slim landing (/) when slim mode is on', () => {
    mockPath = '/'
    mockSlim = true
    render(<CbatMenuMusic />)
    expect(lastZone()).toBe('menu')
  })

  it('silent (null) on the landing (/) when slim mode is off', () => {
    mockPath = '/'
    mockSlim = false
    render(<CbatMenuMusic />)
    expect(lastZone()).toBe(null)
  })

  it('stops the music on unmount', () => {
    mockPath = '/cbat'
    const { unmount } = render(<CbatMenuMusic />)
    updateCbatMusic.mockClear()
    unmount()
    expect(updateCbatMusic).toHaveBeenCalledWith(null)
  })
})
