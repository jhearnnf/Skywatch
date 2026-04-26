import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import QuizFlow from '../QuizFlow'

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
  Link:        ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { _id: 'u1', difficultySetting: 'easy' },
    API: '', apiFetch: (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    refreshUser:   vi.fn(),
  }),
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { aiQuestionsPerDifficulty: 7 }, levelThresholds: [] }),
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../components/LockedCategoryModal',     () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, ...rest }) => <div {...rest}>{children}</div>,
    button: ({ children, ...rest }) => <button {...rest}>{children}</button>,
    p:      ({ children, ...rest }) => <p {...rest}>{children}</p>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

beforeEach(() => {
  enterImmersive.mockClear()
  exitImmersive.mockClear()
})

afterEach(() => { vi.restoreAllMocks() })

describe('QuizFlow — immersive chrome', () => {
  it('does not enter immersive while loading', () => {
    global.fetch = vi.fn(() => new Promise(() => {}))
    render(<QuizFlow />)
    expect(enterImmersive).not.toHaveBeenCalled()
    expect(exitImmersive).toHaveBeenCalled()
  })

  it('does not enter immersive on an error', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    render(<QuizFlow />)
    await waitFor(() => expect(exitImmersive).toHaveBeenCalled())
    expect(enterImmersive).not.toHaveBeenCalled()
  })
})
