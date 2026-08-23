import { render } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import CbatDpt from '../CbatDpt'
import { DPT_TUNING } from '../../utils/cbat/dptDifficulty'

// DPT's aircraft-select screen doubles as its instructions card, so this is
// where the Easier/Hard pair lives. What's pinned here is where it SITS.
//
// The shared CbatDifficultySelect module used to export a `DifficultyTitleRow`
// that flanked the title with one button either side. No page ever used it, and
// it caught two separate attempts at adding a split game — it reads as the
// obvious helper and is wrong on screen. It has been deleted; this test and the
// matching one in CbatRosterCompletion.test.jsx are what keep it deleted.

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../components/CbatQuitButton', () => ({ default: () => null }))
vi.mock('../../components/CbatGameOver', () => ({
  default: ({ children, gameKey }) => <div data-game-key={gameKey}>{children}</div>,
}))
vi.mock('../../components/SkywatchLogoIntro', () => ({
  default: () => null,
  SKYWATCH_LOGO_INTRO_MS: 0,
}))
vi.mock('../../components/DptAircraftLayer', () => ({ default: () => null }))
vi.mock('@react-three/drei', () => ({ useGLTF: { preload: vi.fn() } }))
vi.mock('../../lib/cbatOutbox', () => ({
  submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })),
}))
vi.mock('../../lib/offlineRoster', () => ({
  getAircraftRoster: vi.fn(() => Promise.resolve({ data: [] })),
}))
vi.mock('../../utils/cbat/useCbatTracking', () => ({
  useCbatTracking: () => ({ start: vi.fn(), setRound: vi.fn(), markCompleted: vi.fn() }),
}))
vi.mock('../../utils/cbat/useAdminRoundParam', () => ({ useAdminRoundParam: vi.fn() }))
vi.mock('../../hooks/useGameBodyClass', () => ({ useGameBodyClass: vi.fn() }))
vi.mock('../../data/aircraftModels', () => ({
  has3DModel: () => true,
  getModelUrl: () => '/models/x.glb',
}))
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }) => <div className={className}>{children}</div>,
    button: ({ children, className, onClick }) => (
      <button className={className} onClick={onClick}>{children}</button>
    ),
    g: ({ children }) => <g>{children}</g>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

function renderPage() {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1' },
    API: '',
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  })
  return render(<CbatDpt />)
}

const difficultyButton = (container, key) => container.querySelector(`[data-difficulty="${key}"]`)

describe('CbatDpt difficulty selector placement', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('renders both halves of the pair', () => {
    const { container } = renderPage()
    expect(difficultyButton(container, 'easier')).toBeTruthy()
    expect(difficultyButton(container, 'hard')).toBeTruthy()
  })

  it('puts the pair BELOW the title, where every other split game has it', () => {
    const { container } = renderPage()
    const title = [...container.querySelectorAll('h2')]
      .find(h => h.textContent === 'Dynamic Projection Test')
    expect(title).toBeTruthy()

    for (const key of ['easier', 'hard']) {
      const button = difficultyButton(container, key)
      expect(title.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('keeps the pair on its own row rather than flanking the title', () => {
    const { container } = renderPage()
    const easier = difficultyButton(container, 'easier')
    const hard   = difficultyButton(container, 'hard')
    // Same parent as each other, and that parent is not the title's.
    expect(easier.parentElement).toBe(hard.parentElement)
    const title = [...container.querySelectorAll('h2')]
      .find(h => h.textContent === 'Dynamic Projection Test')
    expect(easier.parentElement.contains(title)).toBe(false)
  })

  it('shows the selected difficulty blurb under the pair', () => {
    const { container } = renderPage()
    // Easier is the default, so its blurb is the one on screen.
    const blurb = [...container.querySelectorAll('p')]
      .find(el => el.textContent === DPT_TUNING.easier.blurb)
    expect(blurb).toBeTruthy()
    const easier = difficultyButton(container, 'easier')
    expect(easier.compareDocumentPosition(blurb) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('orders the pair easier-then-hard on screen', () => {
    const { container } = renderPage()
    const easier = difficultyButton(container, 'easier')
    const hard   = difficultyButton(container, 'hard')
    expect(easier.compareDocumentPosition(hard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
