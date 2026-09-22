import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import CbatGameGuard from '../CbatGameGuard'

let mockUser     = null
let mockSettings = null

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: mockSettings }),
}))

vi.mock('../SEO', () => ({ default: () => null }))

let mockInProgress = false
vi.mock('../../hooks/useCbatGameInProgress', () => ({
  useCbatGameInProgress: () => mockInProgress,
}))

function renderGuard(props) {
  return render(
    <MemoryRouter>
      <CbatGameGuard {...props}>
        <div data-testid="game-content">GAME</div>
      </CbatGameGuard>
    </MemoryRouter>
  )
}

describe('CbatGameGuard', () => {
  beforeEach(() => {
    mockUser     = { _id: 'u1', isAdmin: false }
    mockSettings = { cbatGameEnabled: { target: true, symbols: false } }
    mockInProgress = false
  })

  it('renders children when the game is enabled', () => {
    renderGuard({ gameKey: 'target', gameTitle: 'Target' })
    expect(screen.getByTestId('game-content')).toBeTruthy()
  })

  it('renders the disabled page when the game is disabled and user is not admin', () => {
    renderGuard({ gameKey: 'symbols', gameTitle: 'Symbols' })
    expect(screen.queryByTestId('game-content')).toBeNull()
    expect(screen.getByText(/SYMBOLS OFFLINE/)).toBeTruthy()
  })

  it('renders children when the game is disabled but the user is admin', () => {
    mockUser = { _id: 'admin', isAdmin: true }
    renderGuard({ gameKey: 'symbols', gameTitle: 'Symbols' })
    expect(screen.getByTestId('game-content')).toBeTruthy()
  })

  it('treats a missing key as enabled (default)', () => {
    mockSettings = { cbatGameEnabled: {} }
    renderGuard({ gameKey: 'target', gameTitle: 'Target' })
    expect(screen.getByTestId('game-content')).toBeTruthy()
  })

  it('renders nothing while settings are still loading', () => {
    mockSettings = null
    const { container } = renderGuard({ gameKey: 'target', gameTitle: 'Target' })
    expect(container.firstChild).toBeNull()
  })

  // plane-turn is the hub-level alias for the three modes hosted on /cbat/trace:
  // 'plane-turn-2d', 'plane-turn-3d' and 'trace-1'. The guard treats the alias
  // as enabled if ANY of them is on, so disabling all three is the only way to
  // hide the TRACE 1/2 page.
  it('plane-turn alias is enabled when only 2D mode is on', () => {
    mockSettings = { cbatGameEnabled: { 'plane-turn-2d': true, 'plane-turn-3d': false, 'trace-1': false } }
    renderGuard({ gameKey: 'plane-turn', gameTitle: 'TRACE 1/2' })
    expect(screen.getByTestId('game-content')).toBeTruthy()
  })

  it('plane-turn alias is enabled when only 3D mode is on', () => {
    mockSettings = { cbatGameEnabled: { 'plane-turn-2d': false, 'plane-turn-3d': true, 'trace-1': false } }
    renderGuard({ gameKey: 'plane-turn', gameTitle: 'TRACE 1/2' })
    expect(screen.getByTestId('game-content')).toBeTruthy()
  })

  it('plane-turn alias is enabled when only Trace 1 is on', () => {
    mockSettings = { cbatGameEnabled: { 'plane-turn-2d': false, 'plane-turn-3d': false, 'trace-1': true } }
    renderGuard({ gameKey: 'plane-turn', gameTitle: 'TRACE 1/2' })
    expect(screen.getByTestId('game-content')).toBeTruthy()
  })

  it('plane-turn alias is disabled only when ALL three modes are off', () => {
    mockSettings = { cbatGameEnabled: { 'plane-turn-2d': false, 'plane-turn-3d': false, 'trace-1': false } }
    renderGuard({ gameKey: 'plane-turn', gameTitle: 'TRACE 1/2' })
    expect(screen.queryByTestId('game-content')).toBeNull()
    expect(screen.getByText(/TRACE 1\/2 OFFLINE/)).toBeTruthy()
  })
})

// The link rides along with the game so a bug can be reported from where it
// was seen; it steps out of the way while a test is actually running.
describe('CbatGameGuard — report link', () => {
  beforeEach(() => {
    mockUser     = { _id: 'u1', isAdmin: false }
    mockSettings = { cbatGameEnabled: { target: true, symbols: false } }
    mockInProgress = false
  })

  it('links to the report form alongside an enabled game', () => {
    renderGuard({ gameKey: 'target', gameTitle: 'Target' })
    expect(screen.getByTestId('cbat-game-report').getAttribute('href')).toBe('/report')
  })

  it('links to the report form for an admin viewing a disabled game', () => {
    mockUser = { _id: 'admin', isAdmin: true }
    renderGuard({ gameKey: 'symbols', gameTitle: 'Symbols' })
    expect(screen.getByTestId('cbat-game-report')).toBeTruthy()
  })

  it('does not show the link on the disabled page', () => {
    renderGuard({ gameKey: 'symbols', gameTitle: 'Symbols' })
    expect(screen.queryByTestId('cbat-game-report')).toBeNull()
  })

  it('hides the link while a test is in progress', () => {
    mockInProgress = true
    renderGuard({ gameKey: 'target', gameTitle: 'Target' })
    expect(screen.getByTestId('game-content')).toBeTruthy()
    expect(screen.queryByTestId('cbat-game-report')).toBeNull()
  })

  it('is desktop-only, so a phone layout tuned to one screen gains no line', () => {
    renderGuard({ gameKey: 'target', gameTitle: 'Target' })
    const cls = screen.getByTestId('cbat-game-report').className.split(/\s+/)
    expect(cls).toContain('hidden')
    expect(cls).toContain('lg:inline-flex')
    expect(cls).toContain('fixed')
  })
})
