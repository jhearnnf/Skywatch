import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActiveMock, MOCK_CONFIG } from '../../lib/cbatMockSession'

const mockUseAuth = vi.hoisted(() => vi.fn())
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../lib/posthog', () => ({ captureEvent: () => {} }))

import CbatMock from '../CbatMock'

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

function renderPage(routes, start = '/cbat/mock') {
  const apiFetch = vi.fn(async (url, opts) => {
    for (const [match, body, ok = true] of routes) {
      if (url.includes(match)) {
        return { ok, status: ok ? 200 : 400, json: async () => (typeof body === 'function' ? body(url, opts) : body) }
      }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  mockUseAuth.mockReturnValue({ user: { _id: 'u1', agentNumber: '1234567' }, apiFetch, API: '' })
  render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/cbat/mock" element={<CbatMock />} />
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
