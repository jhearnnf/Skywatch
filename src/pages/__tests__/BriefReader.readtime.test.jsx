import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

// ── Hoisted mock fns ───────────────────────────────────────────────────────

const mockUseAuth = vi.hoisted(() => vi.fn())

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../utils/sound', () => ({ playSound: vi.fn(), stopAllSounds: vi.fn(), playGridRevealTone: vi.fn(), preloadSound: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => vi.fn(), useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link:        ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppTutorialContext', () => ({ useAppTutorial: () => ({ start: vi.fn() }) }))
vi.mock('../../context/AppSettingsContext', () => ({ useAppSettings: () => ({ settings: { airstarsPerBriefRead: 5 } }) }))
vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../components/UpgradePrompt',          () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style, onClick, onDragEnd, drag }) => {
      if (drag === 'x' && onDragEnd) {
        return (
          <div className={className} style={style} onClick={onClick}>
            {children}
            <button data-testid="swipe-left"  onClick={() => onDragEnd(null, { offset: { x: -150, y: 0 }, velocity: { x: 0, y: 0 } })} />
            <button data-testid="swipe-right" onClick={() => onDragEnd(null, { offset: { x:  150, y: 0 }, velocity: { x: 0, y: 0 } })} />
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

// ── Fixtures ───────────────────────────────────────────────────────────────

const BRIEF = {
  _id:                 'brief123',
  title:               'RAF Typhoon',
  category:            'Aircrafts',
  descriptionSections: ['Section one.'],
  keywords:            [],
  sources:             [],
  media:               [],
}

function makeGetResponse(brief = BRIEF) {
  return { ok: true, json: async () => ({ data: { brief, readRecord: null, ammoMax: 3 } }) }
}

function makeCompleteResponse() {
  return { ok: true, json: async () => ({ status: 'success', data: { airstarsEarned: 0, dailyCoinsEarned: 0, loginStreak: 0 } }) }
}

function setupLoggedIn() {
  mockUseAuth.mockReturnValue({
    user:          { _id: 'user1' },
    API: '', apiFetch: (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    setUser:       vi.fn(),
  })
}

function setupGuest() {
  mockUseAuth.mockReturnValue({
    user:          null,
    API: '', apiFetch: (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    setUser:       vi.fn(),
  })
}

/** Flush pending microtasks / React state updates without advancing fake timers */
const flush = () => act(async () => {})

/** Returns all PATCH /time calls made so far */
function timeCalls(fetchMock) {
  return fetchMock.mock.calls.filter(([url, opts]) =>
    url.includes('/time') && opts?.method === 'PATCH'
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('BriefReader — read time tracking', () => {
  beforeEach(() => {
    // Fake timers BEFORE render so setInterval is intercepted
    vi.useFakeTimers()
    setupLoggedIn()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does NOT call PATCH /time immediately on mount', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse())
    render(<BriefReader />)
    await flush() // let fetch resolve + state update
    expect(screen.getByText('RAF Typhoon')).toBeDefined()
    expect(timeCalls(global.fetch)).toHaveLength(0)
  })

  it('calls PATCH /time after 10 seconds with accumulated seconds', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse())
    render(<BriefReader />)
    await flush()

    await act(async () => { vi.advanceTimersByTime(10_000) })
    await flush()

    const calls = timeCalls(global.fetch)
    expect(calls.length).toBeGreaterThanOrEqual(1)
    const body = JSON.parse(calls[0][1].body)
    expect(body.seconds).toBeGreaterThan(0)
    expect(body.seconds).toBeLessThanOrEqual(10)
  })

  it('flushes accumulated time on unmount', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse())
    const { unmount } = render(<BriefReader />)
    await flush()

    // Advance 5 seconds (less than 1 interval — no periodic flush yet)
    await act(async () => { vi.advanceTimersByTime(5_000) })
    expect(timeCalls(global.fetch)).toHaveLength(0)

    // Unmount should flush the 5 accumulated seconds
    await act(async () => { unmount() })
    await flush()

    const calls = timeCalls(global.fetch)
    expect(calls.length).toBeGreaterThanOrEqual(1)
    const body = JSON.parse(calls[0][1].body)
    expect(body.seconds).toBeGreaterThan(0)
  })

  it('sends PATCH /time with credentials: include', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse())
    render(<BriefReader />)
    await flush()

    await act(async () => { vi.advanceTimersByTime(10_000) })
    await flush()

    const call = timeCalls(global.fetch)[0]
    expect(call[1].credentials).toBe('include')
  })

  it('does NOT call PATCH /time when user is not logged in', async () => {
    setupGuest()
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse())
    const { unmount } = render(<BriefReader />)
    await flush()

    await act(async () => { vi.advanceTimersByTime(30_000) })
    await act(async () => { unmount() })
    await flush()

    expect(timeCalls(global.fetch)).toHaveLength(0)
  })

  it('stops accumulating time after the brief is completed (done state)', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeGetResponse())
      .mockResolvedValue(makeCompleteResponse())

    render(<BriefReader />)
    await flush()
    // Brief loaded — swipe-left trigger is rendered inside SwipeCard
    expect(screen.getByTestId('swipe-left')).toBeDefined()

    // Advance 5s to accumulate some time
    await act(async () => { vi.advanceTimersByTime(5_000) })

    // Complete the brief via swipe — cleanup flushes remaining time, timer stops
    await act(async () => {
      fireEvent.click(screen.getByTestId('swipe-left'))
    })
    await flush()

    const callsAfterComplete = timeCalls(global.fetch).length

    // Advance another 30s — timer should not fire any more PATCH /time calls
    await act(async () => { vi.advanceTimersByTime(30_000) })
    await flush()

    expect(timeCalls(global.fetch).length).toBe(callsAfterComplete)
  })

  it('does not flush if no time has accumulated (avoids zero-second noise)', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeGetResponse())
    const { unmount } = render(<BriefReader />)
    // Unmount immediately — Date.now() delta will be ~0ms → 0 seconds
    await act(async () => { unmount() })
    await flush()

    // PATCH should not be sent for 0 seconds
    expect(timeCalls(global.fetch)).toHaveLength(0)
  })
})
