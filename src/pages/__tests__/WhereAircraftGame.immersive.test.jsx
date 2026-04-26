import { render } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import WhereAircraftGame from '../WhereAircraftGame'

const enterImmersive = vi.hoisted(() => vi.fn())
const exitImmersive  = vi.hoisted(() => vi.fn())

vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ immersive: false, enterImmersive, exitImmersive }),
}))

vi.mock('../../utils/sound', () => ({ playSound: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ aircraftBriefId: 'brief123' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/wheres-that-aircraft/brief123', search: '', hash: '' }),
}))

vi.mock('../../components/SEO', () => ({ default: () => null }))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'u1' },
    API: '', apiFetch: (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    refreshUser:   vi.fn(),
  }),
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../components/RafBasesMap',            () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, ...rest }) => <div {...rest}>{children}</div>,
    button: ({ children, ...rest }) => <button {...rest}>{children}</button>,
    p:      ({ children, ...rest }) => <p {...rest}>{children}</p>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// Stub crypto.randomUUID so the test doesn't depend on platform support
if (!globalThis.crypto) globalThis.crypto = {}
if (!globalThis.crypto.randomUUID) globalThis.crypto.randomUUID = () => 'test-uuid'

beforeEach(() => {
  enterImmersive.mockClear()
  exitImmersive.mockClear()
  global.fetch = vi.fn(() => new Promise(() => {})) // never resolves — stays on PHASE_LOADING
})

afterEach(() => { vi.restoreAllMocks() })

describe('WhereAircraftGame — immersive chrome', () => {
  it('does not enter immersive on the loading phase', () => {
    render(<WhereAircraftGame />)
    expect(enterImmersive).not.toHaveBeenCalled()
    expect(exitImmersive).toHaveBeenCalled()
  })
})
