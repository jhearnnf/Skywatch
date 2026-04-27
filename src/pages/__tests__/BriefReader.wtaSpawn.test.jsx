import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BriefReader from '../BriefReader'

// ── Hoisted mock fns ──────────────────────────────────────────────────────────

const mockUseAuth = vi.hoisted(() => vi.fn())

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../utils/sound', () => ({ playSound: vi.fn(), stopAllSounds: vi.fn(), playGridRevealTone: vi.fn(), preloadSound: vi.fn() }))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => vi.fn(),
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
vi.mock('../../components/UpgradePrompt',          () => ({ default: () => null }))
vi.mock('../../components/FlashcardDeckNotification', () => ({
  default: ({ onDone }) => (
    <div data-testid="flashcard-deck-notif">
      <button onClick={onDone}>dismiss</button>
    </div>
  ),
}))
vi.mock('../../components/MissionDetectedModal', () => ({
  default: ({ aircraftBriefId, aircraftTitle }) => (
    <div data-testid="mission-modal">{aircraftTitle}::{String(aircraftBriefId)}</div>
  ),
}))

// SwipeCard uses useMotionValue/useTransform/useAnimationControls. The drag motion.div
// gets test buttons so we can call handleContinue without real pointer events.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style, onClick, onDragEnd, drag }) => {
      if (drag === 'x' && onDragEnd) {
        return (
          <div className={className} style={style} onClick={onClick}>
            {children}
            <button
              data-testid="swipe-left"
              onClick={() => onDragEnd(null, { offset: { x: -150, y: 0 }, velocity: { x: 0, y: 0 } })}
            />
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SINGLE_SECTION_AIRCRAFT_BRIEF = {
  _id:                 'brief123',
  title:               'RAF Typhoon',
  subtitle:            'Air superiority fighter',
  category:            'Aircrafts',
  descriptionSections: ['The Typhoon is a swing-role combat aircraft.'],
  keywords:            [],
  sources:             [],
  media:               [],
}

const SINGLE_SECTION_TRAINING_BRIEF = {
  ...SINGLE_SECTION_AIRCRAFT_BRIEF,
  category: 'Training',
}

function makeGetResponse(brief, readRecord = null) {
  return { ok: true, json: async () => ({ data: { brief, readRecord, ammoMax: 3 } }) }
}
function makeWtaSpawnResponse(prereqsMet, remaining) {
  return { ok: true, json: async () => ({ data: { prereqsMet, remaining, threshold: 3, readsSince: remaining > 0 ? 3 - remaining : 2 } }) }
}
function makeSpawnDecisionResponse(decision) {
  return { ok: true, json: async () => ({ status: 'success', data: decision }) }
}
function makeSpawnCheckResponse(decision) {
  return { ok: true, json: async () => ({ status: 'success', data: decision }) }
}
function makeCompleteResponse() {
  return {
    ok: true,
    json: async () => ({
      status: 'success',
      data: { airstarsEarned: 0, dailyCoinsEarned: 0, loginStreak: 0, newTotalAirstars: 0, newCycleAirstars: 0, rankPromotion: null },
    }),
  }
}
const SAFE_EMPTY = { ok: true, json: async () => ({ data: {} }) }

function setupLoggedIn() {
  mockUseAuth.mockReturnValue({
    user:          { _id: 'user1' },
    API: '',
    apiFetch:      (...args) => fetch(...args),
    awardAirstars: vi.fn(),
    setUser:       vi.fn(),
  })
}

// Routes fetch calls by URL/method so test sequencing isn't fragile.
function makeFetchRouter(handlers) {
  return vi.fn((url, opts) => {
    const u = typeof url === 'string' ? url : url.toString()
    for (const [matcher, response] of handlers) {
      if (matcher(u, opts)) {
        return Promise.resolve(typeof response === 'function' ? response(u, opts) : response)
      }
    }
    return Promise.resolve(SAFE_EMPTY)
  })
}
const isGetBrief        = (u, opts) => u.match(/\/api\/briefs\/brief123(\?|$)/) && (!opts || !opts.method || opts.method === 'GET')
const isWtaSpawn        = (u) => u.includes('/api/users/me/wta-spawn')
const isSpawnDecision   = (u, opts) => u.includes('/wheres-aircraft/spawn-decision') && opts?.method === 'POST'
const isSpawnCheck      = (u, opts) => u.includes('/wheres-aircraft/spawn-check')    && opts?.method === 'POST'
const isComplete        = (u, opts) => u.includes('/api/briefs/brief123/complete')   && opts?.method === 'POST'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BriefReader — WTA spawn-decision lazy prefetch', () => {
  beforeEach(() => {
    setupLoggedIn()
    sessionStorage.clear()
    localStorage.clear()
    localStorage.setItem('skywatch_first_brief', '1')
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('POSTs /spawn-decision when the user lands on the flashcard with prereqsMet && remaining===1', async () => {
    global.fetch = makeFetchRouter([
      [isGetBrief,      makeGetResponse(SINGLE_SECTION_AIRCRAFT_BRIEF)],
      [isWtaSpawn,      makeWtaSpawnResponse(true, 1)],
      [isSpawnDecision, makeSpawnDecisionResponse({ spawn: false })],
    ])

    render(<BriefReader />)

    await waitFor(() => {
      const calls = global.fetch.mock.calls.map(c => [c[0], c[1]])
      expect(calls.some(([u, o]) => isSpawnDecision(typeof u === 'string' ? u : u.toString(), o))).toBe(true)
    })
  })

  it('does NOT POST /spawn-decision when prereqs are not met', async () => {
    global.fetch = makeFetchRouter([
      [isGetBrief,      makeGetResponse(SINGLE_SECTION_AIRCRAFT_BRIEF)],
      [isWtaSpawn,      makeWtaSpawnResponse(false, 1)],
    ])

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    // Wait long enough for the wta-spawn fetch to settle without firing /spawn-decision
    await new Promise(r => setTimeout(r, 30))

    const calls = global.fetch.mock.calls.map(c => [c[0], c[1]])
    expect(calls.some(([u, o]) => isSpawnDecision(typeof u === 'string' ? u : u.toString(), o))).toBe(false)
  })

  it('does NOT POST /spawn-decision for non-Aircrafts briefs', async () => {
    global.fetch = makeFetchRouter([
      [isGetBrief, makeGetResponse(SINGLE_SECTION_TRAINING_BRIEF)],
    ])

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    await new Promise(r => setTimeout(r, 30))

    const calls = global.fetch.mock.calls.map(c => [c[0], c[1]])
    expect(calls.some(([u, o]) => isSpawnDecision(typeof u === 'string' ? u : u.toString(), o))).toBe(false)
  })

  it('does NOT POST /spawn-decision when remaining > 1', async () => {
    global.fetch = makeFetchRouter([
      [isGetBrief, makeGetResponse(SINGLE_SECTION_AIRCRAFT_BRIEF)],
      [isWtaSpawn, makeWtaSpawnResponse(true, 2)],
    ])

    render(<BriefReader />)
    await waitFor(() => screen.getByText('RAF Typhoon'))

    await new Promise(r => setTimeout(r, 30))

    const calls = global.fetch.mock.calls.map(c => [c[0], c[1]])
    expect(calls.some(([u, o]) => isSpawnDecision(typeof u === 'string' ? u : u.toString(), o))).toBe(false)
  })

  it('opens MissionDetectedModal immediately on completion when /spawn-decision prefetched spawn:true', async () => {
    const decision = {
      spawn:           true,
      aircraftBriefId: 'aircraft-XYZ',
      aircraftTitle:   'Eurofighter Typhoon',
      mediaUrl:        null,
      baseBriefCount:  1,
    }

    global.fetch = makeFetchRouter([
      [isGetBrief,      makeGetResponse(SINGLE_SECTION_AIRCRAFT_BRIEF)],
      [isWtaSpawn,      makeWtaSpawnResponse(true, 1)],
      [isSpawnDecision, makeSpawnDecisionResponse(decision)],
      [isComplete,      makeCompleteResponse()],
      [isSpawnCheck,    makeSpawnCheckResponse(decision)],
    ])

    render(<BriefReader />)

    // Wait for the prefetch to have landed
    await waitFor(() => {
      const calls = global.fetch.mock.calls.map(c => [c[0], c[1]])
      expect(calls.some(([u, o]) => isSpawnDecision(typeof u === 'string' ? u : u.toString(), o))).toBe(true)
    })

    fireEvent.click(await screen.findByTestId('swipe-left'))

    // Modal opens from the cached decision — no spinner overlay
    await waitFor(() => {
      expect(screen.getByTestId('mission-modal').textContent).toBe('Eurofighter Typhoon::aircraft-XYZ')
    })
    expect(screen.queryByText('Incoming message')).toBeNull()

    // Commit POST /spawn-check fires in the background
    await waitFor(() => {
      const calls = global.fetch.mock.calls.map(c => [c[0], c[1]])
      expect(calls.some(([u, o]) => isSpawnCheck(typeof u === 'string' ? u : u.toString(), o))).toBe(true)
    })
  })

  it('falls back to /spawn-check on completion when prefetch never resolved', async () => {
    let resolveDecision
    const pendingDecisionPromise = new Promise(resolve => { resolveDecision = resolve })

    global.fetch = makeFetchRouter([
      [isGetBrief,      makeGetResponse(SINGLE_SECTION_AIRCRAFT_BRIEF)],
      [isWtaSpawn,      makeWtaSpawnResponse(true, 1)],
      // Never resolve the prefetch — simulates a slow / failed network
      [isSpawnDecision, () => pendingDecisionPromise],
      [isComplete,      makeCompleteResponse()],
      [isSpawnCheck,    makeSpawnCheckResponse({
        spawn:           true,
        aircraftBriefId: 'fallback-id',
        aircraftTitle:   'Fallback Jet',
        mediaUrl:        null,
        baseBriefCount:  1,
      })],
    ])

    render(<BriefReader />)
    fireEvent.click(await screen.findByTestId('swipe-left'))

    // Fallback path fires /spawn-check and opens the modal from its response
    await waitFor(() => {
      expect(screen.getByTestId('mission-modal').textContent).toBe('Fallback Jet::fallback-id')
    })

    // Cleanup so the dangling promise doesn't leak between tests
    resolveDecision({ ok: true, json: async () => ({ status: 'success', data: { spawn: false } }) })
  })
})
