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
})
