import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

const mockUseAuth  = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())
const enterImmersive = vi.hoisted(() => vi.fn())
const exitImmersive  = vi.hoisted(() => vi.fn())

vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ immersive: false, enterImmersive, exitImmersive }),
}))

vi.mock('../../utils/sound', () => ({
  playSound: vi.fn(), stopAllSounds: vi.fn(), playGridRevealTone: vi.fn(), preloadSound: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link:        ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { airstarsPerBriefRead: 5 } }),
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn() }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style, onClick, onDragEnd, drag }) => {
      if (drag === 'x' && onDragEnd) {
        return (
          <div className={className} style={style} onClick={onClick}>
            {children}
            <button data-testid="swipe-left" onClick={() => onDragEnd(null, { offset: { x: -150, y: 0 }, velocity: { x: 0, y: 0 } })} />
          </div>
        )
      }
      return <div className={className} style={style} onClick={onClick}>{children}</div>
    },
    button: ({ children, className, onClick }) => <button className={className} onClick={onClick}>{children}</button>,
    p:      ({ children, className })          => <p className={className}>{children}</p>,
  },
  AnimatePresence:      ({ children }) => <>{children}</>,
  LayoutGroup:          ({ children }) => <>{children}</>,
  useMotionValue:       () => ({ set: vi.fn(), get: () => 0 }),
  useTransform:         () => 0,
  useAnimationControls: () => ({ start: vi.fn() }),
}))

const TRAINING_BRIEF = {
  _id: 'brief123', title: 'RAF Typhoon', subtitle: 'Air superiority fighter',
  category: 'Training', descriptionSections: ['Section content.'],
  keywords: [], sources: [], media: [],
}

const FRESH_READ_RECORD = { _id: 'rr1', coinsAwarded: false, completed: false }

beforeEach(() => {
  enterImmersive.mockClear()
  exitImmersive.mockClear()
  mockUseAuth.mockReturnValue({
    user: { _id: 'user1', loginStreak: 0 },
    API: '', apiFetch: (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    setUser: vi.fn(),
  })
  sessionStorage.clear()
})

afterEach(() => { vi.restoreAllMocks() })

describe('BriefReader — immersive chrome', () => {
  it('does not enter immersive while loading', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) // never resolves
    render(<BriefReader />)
    expect(enterImmersive).not.toHaveBeenCalled()
    expect(exitImmersive).toHaveBeenCalled()
  })

  it('enters immersive once a fresh brief with sections is loaded', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { brief: TRAINING_BRIEF, readRecord: FRESH_READ_RECORD, ammoMax: 3 } }),
    })
    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))
    expect(enterImmersive).toHaveBeenCalled()
  })
})
