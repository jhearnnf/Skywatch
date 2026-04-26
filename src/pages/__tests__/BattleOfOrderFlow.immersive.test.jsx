import { render } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BattleOfOrderFlow from '../BattleOfOrderFlow'

const enterImmersive = vi.hoisted(() => vi.fn())
const exitImmersive  = vi.hoisted(() => vi.fn())

vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ immersive: false, enterImmersive, exitImmersive }),
}))

vi.mock('../../utils/sound', () => ({ playSound: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'u1' },
    API: '', apiFetch: (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    refreshUser:   vi.fn(),
  }),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, ...rest }) => <div {...rest}>{children}</div>,
    button: ({ children, ...rest }) => <button {...rest}>{children}</button>,
    circle: ({ children, ...rest }) => <circle {...rest}>{children}</circle>,
    p:      ({ children, ...rest }) => <p {...rest}>{children}</p>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

beforeEach(() => {
  enterImmersive.mockClear()
  exitImmersive.mockClear()
  global.fetch = vi.fn(() => new Promise(() => {})) // never resolves — stays on 'loading'
})

afterEach(() => { vi.restoreAllMocks() })

describe('BattleOfOrderFlow — immersive chrome', () => {
  it('does not enter immersive on the loading screen', () => {
    render(<BattleOfOrderFlow />)
    expect(enterImmersive).not.toHaveBeenCalled()
    expect(exitImmersive).toHaveBeenCalled()
  })
})
