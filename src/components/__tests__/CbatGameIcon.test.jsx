import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const mockUseSettings = vi.fn()
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: () => mockUseSettings() }))

import CbatGameIcon from '../cbat/CbatGameIcon'
import { CBAT_GAME_ICONS, cbatIconKey } from '../../data/cbatGameIcons'
import { CBAT_GAMES, CBAT_LEADERBOARD_CONFIG } from '../../data/cbatGames'

describe('CBAT game icons', () => {
  beforeEach(() => {
    mockUseSettings.mockReturnValue({ settings: { cbatDrawnIconsEnabled: true } })
  })

  it('has a drawn icon for every hub game', () => {
    const missing = CBAT_GAMES.map(g => g.key).filter(k => !CBAT_GAME_ICONS[k])
    expect(missing).toEqual([])
  })

  it('resolves every leaderboard key to an icon', () => {
    const missing = Object.keys(CBAT_LEADERBOARD_CONFIG).filter(k => !cbatIconKey(k))
    expect(missing).toEqual([])
  })

  it('borrows the parent game icon for a leaderboard key with none of its own', () => {
    expect(cbatIconKey('flag-easier')).toBe('flag')
    expect(cbatIconKey('trace-2')).toBe('plane-turn')
    expect(cbatIconKey('visualisation-3d')).toBe('visualisation')
    expect(cbatIconKey('clan-easier')).toBe('clan')
  })

  it('never draws text, so no icon depends on a font', () => {
    for (const markup of Object.values(CBAT_GAME_ICONS)) expect(markup).not.toMatch(/<text/)
  })

  it('renders an svg for a known key', () => {
    const { container } = render(<CbatGameIcon gameKey="sma" className="w-4 h-4" weight="sm" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg.getAttribute('class')).toContain('cbat-gi--sm')
    expect(svg.dataset.gameIcon).toBe('sma')
  })

  it('falls back to what it is given for an unknown key', () => {
    const { container } = render(<CbatGameIcon gameKey="nope" fallback={<span>🎯</span>} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).toBe('🎯')
  })

  it('shows the emoji while the admin setting is off, which is the default', () => {
    mockUseSettings.mockReturnValue({ settings: {} })
    const { container } = render(<CbatGameIcon gameKey="sma" fallback={<span>🕹️</span>} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).toBe('🕹️')
  })

  it('shows the emoji before settings have loaded', () => {
    mockUseSettings.mockReturnValue(null)
    const { container } = render(<CbatGameIcon gameKey="sma" fallback={<span>🕹️</span>} />)
    expect(container.querySelector('svg')).toBeNull()
  })
})
