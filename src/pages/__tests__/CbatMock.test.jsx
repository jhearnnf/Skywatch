import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActiveMock, MOCK_CONFIG } from '../../lib/cbatMockSession'

const mockUseAuth = vi.hoisted(() => vi.fn())
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../lib/posthog', () => ({ captureEvent: () => {} }))
vi.mock('../../components/cbat/CbatMockScoreSheet', () => ({
  default: ({ mock, agentNumber }) => <p data-testid="sheet-stub">{`${mock.id} ${agentNumber}`}</p>,
}))

import CbatMock, { CbatMockSheetPage } from '../CbatMock'

const MIN = 60 * 1000

const active = (over = {}) => ({
  id: 'm1',
  status: 'active',
  scope: 'role',
  batteryKey: 'pilot',
  batteryLabel: 'Pilot',
  region: 'GB',
  currentStep: 1,
  breakAfter: [0],
  breakStartedAt: null,
  testsDone: 1,
  testsTotal: 2,
  lastActivityAt: new Date().toISOString(),
  deadline: new Date(Date.now() + 120 * MIN).toISOString(),
  steps: [
    { codes: ['FLAG'], labels: ['FLAG'], gameKeys: ['flag'], minutes: 2, played: ['flag'], done: true },
    { codes: ['CUT'], labels: ['Cognitive Updating Test'], gameKeys: ['cut'], minutes: 4, played: [], done: false },
  ],
  ...over,
})

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{`${loc.pathname}${loc.search}`}</p>
}

function renderPage(routes, start = '/cbat/mock', user = { _id: 'u1', agentNumber: '1234567' }) {
  const apiFetch = vi.fn(async (url, opts) => {
    for (const [match, body, ok = true] of routes) {
      if (url.includes(match)) {
        return { ok, status: ok ? 200 : 400, json: async () => (typeof body === 'function' ? body(url, opts) : body) }
      }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  mockUseAuth.mockReturnValue({ user, apiFetch, API: '' })
  render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/cbat/mock" element={<CbatMock />} />
        <Route path="/cbat/mock/:id" element={<CbatMockSheetPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
  return apiFetch
}

afterEach(() => setActiveMock(null))

describe('the break', () => {
  it('counts down with a small Continue, the finish estimate and the deadline', async () => {
    const mock = active({ breakStartedAt: new Date().toISOString() })
    renderPage([['/current', { data: { mock } }]])
    await waitFor(() => expect(screen.getByTestId('mock-break')).toBeInTheDocument())
    expect(screen.getByTestId('mock-break-countdown').textContent).toMatch(/^(10:00|09:5\d)$/)
    // Small while the timer runs: a text link, not the full-width button.
    expect(screen.getByTestId('mock-continue')).toHaveTextContent('Continue assessment now')
    expect(screen.getByTestId('mock-continue').className).toContain('underline')
    expect(screen.getByTestId('mock-finish').textContent).not.toBe('')
    expect(screen.getByTestId('mock-deadline')).toHaveTextContent('or this assessment will close')
  })

  it('drops the timer once it has run out and makes Continue the main button', async () => {
    const mock = active({ breakStartedAt: new Date(Date.now() - (MOCK_CONFIG.breakMinutes + 1) * MIN).toISOString() })
    renderPage([['/current', { data: { mock } }]])
    await waitFor(() => expect(screen.getByTestId('mock-break')).toBeInTheDocument())
    expect(screen.queryByTestId('mock-break-countdown')).toBeNull()
    expect(screen.getByTestId('mock-continue')).toHaveTextContent(/^Continue assessment$/)
  })

  it('restarts the clock on the server and opens the next test on Hard', async () => {
    const mock = active({ breakStartedAt: new Date().toISOString() })
    const apiFetch = renderPage([
      ['/current', { data: { mock } }],
      ['/begin', { data: { mock: { ...mock, breakStartedAt: null } } }],
    ])
    await waitFor(() => expect(screen.getByTestId('mock-continue')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('mock-continue'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/cbat/cut?difficulty=hard'))
    expect(apiFetch).toHaveBeenCalledWith('/api/cbat-mock/m1/begin', { method: 'POST' })
  })
})

describe('between tests', () => {
  it('names the next test and offers its tutorial first', async () => {
    renderPage([['/current', { data: { mock: active() } }], ['/begin', { data: { mock: active() } }]])
    await waitFor(() => expect(screen.getByTestId('mock-next')).toBeInTheDocument())
    expect(screen.getByTestId('mock-next')).toHaveTextContent('Test 2 of 2')
    expect(screen.getByTestId('mock-next')).toHaveTextContent('Cognitive Updating Test')
    fireEvent.click(screen.getByTestId('mock-tutorial-first'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/cbat/cut?difficulty=hard&tutorial=1'))
  })

  it('explains the refresh when a new version sent the player back here', async () => {
    renderPage([['/current', { data: { mock: active() } }]], '/cbat/mock?updated=1')
    await waitFor(() => expect(screen.getByTestId('mock-updated')).toBeInTheDocument())
    expect(screen.getByTestId('mock-updated')).toHaveTextContent('SkyWatch was updated')
    expect(screen.getByTestId('mock-updated')).toHaveTextContent('Press Continue to carry on')
    expect(screen.getByTestId('mock-continue')).toBeInTheDocument()
  })

  it('shows no update notice on an ordinary visit', async () => {
    renderPage([['/current', { data: { mock: active() } }]])
    await waitFor(() => expect(screen.getByTestId('mock-next')).toBeInTheDocument())
    expect(screen.queryByTestId('mock-updated')).toBeNull()
  })
})

describe('the start page', () => {
  const PREVIEW = {
    data: {
      scope: 'role', batteryKey: 'pilot', region: 'GB', batteries: [{ key: 'pilot', label: 'Pilot' }],
      steps: [
        { codes: ['FLAG'], gameKeys: ['flag'], minutes: 1.5, played: true },
        { codes: ['CUT'], gameKeys: ['cut'], minutes: 4, played: false },
      ],
      breaks: 1, totalMinutes: 65, unsat: [], breakMinutes: 10, idleLimitMinutes: 120,
    },
  }

  it('opens on the player\'s own role, flags tests not tried, and will not start until the rules are agreed', async () => {
    const apiFetch = renderPage([
      ['/current', { data: { mock: null, closed: null, targetBattery: 'pilot', detectedRegion: 'GB' } }],
      ['/preview', PREVIEW],
      ['/history', { data: { mocks: [] } }],
      ['/start', { data: { mock: active({ currentStep: 0, testsDone: 0 }) } }],
    ])
    await waitFor(() => expect(screen.getByTestId('mock-start')).toBeInTheDocument())
    expect(screen.getByTestId('mock-role-pilot')).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(screen.getByTestId('mock-preview')).toHaveTextContent('2 tests, about 1 hr 5 min including 1 break'))
    expect(screen.getByTestId('mock-readiness')).toHaveTextContent('You have not tried 1 of these')
    expect(screen.getByTestId('mock-rules')).toHaveTextContent('Keep going within 2 hours')

    const start = screen.getByTestId('mock-start-button')
    expect(start).toBeDisabled()
    fireEvent.click(screen.getByTestId('mock-agree'))
    fireEvent.click(start)
    await waitFor(() => expect(screen.getByTestId('mock-runner')).toBeInTheDocument())
    const call = apiFetch.mock.calls.find(([u]) => u.endsWith('/start'))
    expect(JSON.parse(call[1].body)).toEqual({ battery: 'pilot' })
  })

  const STATS = {
    data: {
      generatedAt: new Date().toISOString(),
      started: { people: 2, last7d: 2, mocks: 3 },
      completed: { people: 1, mocks: 2 },
      byStatus: { active: 1, completed: 2, abandoned: 0, expired: 0 },
      verdicts: { pass: 1, fail: 1, none: 0, passRate: 0.5 },
      roles: [{ key: 'pilot', label: 'Pilot', region: 'GB', sat: 2, pass: 1, fail: 1 }],
      people: [
        { userId: 'p1', displayName: 'Maverick', agentNumber: '111', started: 2, completed: 2, pass: 1, fail: 1, none: 0, passRate: 0.5,
          lastStartedAt: new Date().toISOString(), last: { label: 'Pilot', status: 'completed', verdict: 'fail', score: 95, cutoff: 90,
            underMinimum: [{ label: 'Symbolic Reasoning', stanine: 1, minStanine: 2 }] } },
        { userId: 'p2', displayName: null, agentNumber: '222', started: 1, completed: 0, pass: 0, fail: 0, none: 0, passRate: null,
          lastStartedAt: new Date().toISOString(), last: { label: 'Pilot', status: 'active', verdict: null, score: null, cutoff: null } },
      ],
    },
  }
  const startRoutes = [
    ['/current', { data: { mock: null, closed: null, targetBattery: 'pilot', detectedRegion: 'GB' } }],
    ['/preview', PREVIEW],
    ['/history', { data: { mocks: [] } }],
    ['/admin/stats', STATS],
  ]

  it('shows the admin tools only to an admin', async () => {
    const apiFetch = renderPage(startRoutes)
    await waitFor(() => expect(screen.getByTestId('mock-start')).toBeInTheDocument())
    expect(screen.queryByTestId('mock-admin-stats')).toBeNull()
    expect(apiFetch.mock.calls.some(([u]) => u.includes('/admin/stats'))).toBe(false)
  })

  it('gives an admin the started / completed counts and the pass rate, each opening its players', async () => {
    renderPage(startRoutes, '/cbat/mock', { _id: 'a1', agentNumber: '1', isAdmin: true })
    await waitFor(() => expect(screen.getByTestId('mock-stat-started')).toHaveTextContent('2'))
    expect(screen.getByTestId('mock-stat-completed')).toHaveTextContent('1')
    expect(screen.getByTestId('mock-stat-passrate')).toHaveTextContent('50%')
    expect(screen.getByTestId('mock-stat-passrate')).toHaveTextContent('1 passed · 1 failed')

    fireEvent.click(screen.getByTestId('mock-stat-started'))
    expect(screen.getByTestId('mock-people-count')).toHaveTextContent('2 agents')
    const rows = screen.getAllByTestId('mock-people-row')
    expect(rows[0]).toHaveTextContent('Maverick')
    expect(rows[0]).toHaveTextContent('50% pass')
    expect(rows[0]).toHaveTextContent('Latest: Pilot, fail (95, cutoff 90)')
    expect(rows[0]).toHaveTextContent('Under the minimum: Symbolic Reasoning 1 (needs 2)')
    expect(rows[1]).toHaveTextContent('Agent #222')
    expect(rows[1]).toHaveTextContent('Latest: Pilot, in progress')
    fireEvent.click(screen.getByText('Close'))
    expect(screen.queryByTestId('mock-people-dialog')).toBeNull()

    fireEvent.click(screen.getByTestId('mock-stat-completed'))
    expect(screen.getAllByTestId('mock-people-row')).toHaveLength(1)
  })

  it('opens a player straight onto their full results, switches between their mocks, and goes back', async () => {
    const sheet = { batteries: [{ key: 'pilot', label: 'Pilot', score: 95, cutoff: 90, status: 'fail', domains: [
      { key: 'SymR', label: 'Symbolic Reasoning', stanine: 1, minStanine: 2, belowMinimum: true, tests: [{ code: 'NOP' }] },
    ] }] }
    const apiFetch = renderPage([
      ...startRoutes,
      ['/admin/users/p1', { data: {
        user: { userId: 'p1', displayName: 'Maverick', agentNumber: '111' },
        mocks: [
          { id: 'mB', scope: 'role', batteryLabel: 'Pilot', region: 'GB', status: 'active', startedAt: new Date().toISOString(), testsDone: 1, testsTotal: 9 },
          { id: 'mA', scope: 'role', batteryLabel: 'Pilot', region: 'GB', status: 'completed', startedAt: new Date().toISOString(), testsDone: 9, testsTotal: 9, sheet },
        ],
      } }],
    ], '/cbat/mock', { _id: 'a1', agentNumber: '1', isAdmin: true })
    await waitFor(() => expect(screen.getByTestId('mock-stat-started')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('mock-stat-started'))
    fireEvent.click(screen.getAllByTestId('mock-people-row')[0])

    // Opens on the latest mock that has a sheet, with the practise card under it.
    await waitFor(() => expect(screen.getByTestId('sheet-stub')).toHaveTextContent('mA 111'))
    expect(apiFetch).toHaveBeenCalledWith('/api/cbat-mock/admin/users/p1')
    expect(screen.getByTestId('mock-practise-next')).toHaveTextContent('Symbolic Reasoning is under the minimum of 2')
    const [open, done] = screen.getAllByTestId('mock-player-mock')
    expect(done).toHaveTextContent('Pilot, Fail')
    expect(done).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(open)
    expect(screen.queryByTestId('sheet-stub')).toBeNull()
    expect(screen.getByTestId('mock-player-no-sheet')).toHaveTextContent('1 of 9 tests sat')

    fireEvent.click(screen.getByTestId('mock-people-back'))
    expect(screen.getAllByTestId('mock-people-row')).toHaveLength(2)
  })

  it('tells the player when their last assessment closed itself', async () => {
    renderPage([
      ['/current', { data: { mock: null, closed: { id: 'old', status: 'expired', endedAt: new Date().toISOString(), testsDone: 3 }, targetBattery: null, detectedRegion: 'GB' } }],
      ['/preview', PREVIEW],
      ['/history', { data: { mocks: [] } }],
      ['/notice-seen', { status: 'success' }],
    ])
    await waitFor(() => expect(screen.getByTestId('mock-closed-notice')).toBeInTheDocument())
    expect(screen.getByTestId('mock-closed-notice')).toHaveTextContent('The scores from the 3 tests you finished are saved')
  })
})

describe('simulated pass / fail pages', () => {
  const simulated = (status) => ({ data: { mock: {
    id: 'simulated', status: 'completed', scope: 'role', batteryKey: 'rcaf-pilot', batteryLabel: 'Pilot', region: 'CA',
    startedAt: new Date().toISOString(), testsDone: 9, testsTotal: 9,
    sheet: { batteries: [{ key: 'rcaf-pilot', label: 'Pilot', score: 70, cutoff: 90, status, domains: [] }] },
  } } })
  const ADMIN = { _id: 'a1', agentNumber: '1', isAdmin: true }

  it('opens from the admin tools on the real score sheet page', async () => {
    const STATS = { data: {
      generatedAt: new Date().toISOString(), started: { people: 0, last7d: 0, mocks: 0 }, completed: { people: 0, mocks: 0 },
      byStatus: { active: 0, completed: 0, abandoned: 0, expired: 0 }, verdicts: { pass: 0, fail: 0, none: 0, passRate: null },
      roles: [], people: [],
    } }
    const apiFetch = renderPage([
      ['/current', { data: { mock: null, closed: null, targetBattery: 'pilot', detectedRegion: 'GB' } }],
      ['/preview', { data: { scope: 'role', batteryKey: 'pilot', region: 'GB', batteries: [], steps: [], breaks: 0, totalMinutes: 0, unsat: [], breakMinutes: 10, idleLimitMinutes: 120 } }],
      ['/history', { data: { mocks: [] } }],
      ['/admin/stats', STATS],
      ['/admin/simulate', simulated('fail')],
    ], '/cbat/mock', ADMIN)
    await waitFor(() => expect(screen.getByTestId('mock-simulate-fail')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('mock-simulate-fail'))
    await waitFor(() => expect(screen.getByTestId('sheet-stub')).toHaveTextContent('simulated 1'))
    expect(apiFetch).toHaveBeenCalledWith('/api/cbat-mock/admin/simulate?result=fail')
    expect(screen.getByTestId('mock-simulated-note')).toHaveTextContent('Simulated fail: Pilot, Canada')
  })

  it('draws a fresh one when pressed again on the simulated page', async () => {
    const apiFetch = renderPage([['/admin/simulate', simulated('pass')]], '/cbat/mock/simulated?result=pass&draw=1', ADMIN)
    await waitFor(() => expect(screen.getByTestId('sheet-stub')).toBeInTheDocument())
    expect(apiFetch).toHaveBeenCalledWith('/api/cbat-mock/admin/simulate?result=pass')
    fireEvent.click(screen.getByTestId('mock-simulate-pass'))
    await waitFor(() => expect(apiFetch.mock.calls.filter(([u]) => u.includes('/admin/simulate'))).toHaveLength(2))
  })
})
