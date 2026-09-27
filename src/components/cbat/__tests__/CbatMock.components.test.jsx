import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActiveMock, grantGamePath, clearGrantedGamePath } from '../../../lib/cbatMockSession'

const mockUseAuth = vi.hoisted(() => vi.fn())
vi.mock('../../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterGameOver: () => {}, exitGameOver: () => {} }),
}))
vi.mock('../../../lib/posthog', () => ({ captureEvent: () => {} }))

import CbatMockLock from '../CbatMockLock'
import CbatMockGameOver from '../CbatMockGameOver'
import CbatMockScoreSheet from '../CbatMockScoreSheet'
import { CbatModeRow } from '../../CbatModeSelector'

const ACTIVE = {
  id: 'm1',
  userId: 'u1',
  status: 'active',
  scope: 'role',
  batteryKey: 'pilot',
  currentStep: 0,
  breakAfter: [],
  breakStartedAt: null,
  testsDone: 0,
  testsTotal: 2,
  steps: [
    { codes: ['FLAG'], gameKeys: ['flag'], minutes: 2, played: [], done: false },
    { codes: ['CUT'], gameKeys: ['cut'], minutes: 4, played: [], done: false },
  ],
}

let apiFetch
beforeEach(() => {
  apiFetch = vi.fn(async (url) => ({
    ok: true,
    json: async () => (url.endsWith('/current') ? { data: { mock: ACTIVE } } : { data: {} }),
  }))
  mockUseAuth.mockReturnValue({ user: { _id: 'u1' }, apiFetch, API: '' })
})
afterEach(() => { setActiveMock(null); clearGrantedGamePath(); localStorage.clear() })

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname}</p>
}

function renderLocked(start = '/cbat/mock') {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <CbatMockLock />
      <Link to="/profile">Profile</Link>
      <Link to="/cbat/flag">Play FLAG</Link>
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  )
}

describe('the site lock', () => {
  it('asks before a link leaves the assessment, and stays put if the player stays', async () => {
    renderLocked()
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    await waitFor(() => expect(document.documentElement.hasAttribute('data-cbat-mock')).toBe(true))

    fireEvent.click(screen.getByText('Profile'))
    expect(screen.getByTestId('cbat-mock-leave')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/cbat/mock')

    fireEvent.click(screen.getByTestId('cbat-mock-stay'))
    expect(screen.queryByTestId('cbat-mock-leave')).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('/cbat/mock')
  })

  it('lets the tab sent from the assessment screen through to the test it is waiting on', async () => {
    grantGamePath('/cbat/flag')
    renderLocked()
    await waitFor(() => expect(document.documentElement.hasAttribute('data-cbat-mock')).toBe(true))
    fireEvent.click(screen.getByText('Play FLAG'))
    expect(screen.queryByTestId('cbat-mock-leave')).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('/cbat/flag')
  })

  // A duplicated tab, a middle-click or a restored session can land straight on the test's page.
  // That tab never passed through the assessment screen, so it is sent there.
  it('sends any other tab that lands on the test’s page to the assessment screen', async () => {
    renderLocked('/cbat/flag')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/cbat/mock'))
    expect(screen.queryByTestId('cbat-mock-leave')).toBeNull()
  })

  // Arriving is not choosing to leave. Asking "Leave the assessment?" on a freshly opened tab read
  // as a question about the tab, and answering it ended a real mock by accident.
  it('bounces an arrival somewhere closed back to the assessment without asking', async () => {
    renderLocked('/community')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/cbat/mock'))
    expect(screen.queryByTestId('cbat-mock-leave')).toBeNull()
  })

  it('locks a new tab from the remembered mock before the server answers', async () => {
    localStorage.setItem('sw_cbat_mock_active', JSON.stringify({ userId: 'u1', mock: ACTIVE }))
    apiFetch = vi.fn(() => new Promise(() => {}))   // the server never answers
    mockUseAuth.mockReturnValue({ user: { _id: 'u1' }, apiFetch, API: '' })
    renderLocked('/cbat')
    expect(screen.getByTestId('where')).toHaveTextContent('/cbat/mock')
  })

  // The bug a duplicated tab showed: the mock was never written down, so the new tab waited on the
  // server, let the player back to the menu and showed their own theme in the meantime.
  it('writes the mock down for other tabs as soon as the server confirms it', async () => {
    renderLocked('/cbat/mock')
    await waitFor(() => expect(localStorage.getItem('sw_cbat_mock_active')).not.toBeNull())
    expect(JSON.parse(localStorage.getItem('sw_cbat_mock_active'))).toMatchObject({ userId: 'u1', mock: { id: 'm1' } })
  })

  it("never locks one account with another account's remembered mock", async () => {
    localStorage.setItem('sw_cbat_mock_active', JSON.stringify({ userId: 'someone-else', mock: ACTIVE }))
    apiFetch = vi.fn(() => new Promise(() => {}))
    mockUseAuth.mockReturnValue({ user: { _id: 'u1' }, apiFetch, API: '' })
    renderLocked('/cbat')
    expect(screen.getByTestId('where')).toHaveTextContent('/cbat')
    expect(document.documentElement.hasAttribute('data-cbat-mock')).toBe(false)
  })

  it('unlocks when another tab leaves the mock', async () => {
    renderLocked('/cbat/mock')
    await waitFor(() => expect(document.documentElement.hasAttribute('data-cbat-mock')).toBe(true))
    localStorage.removeItem('sw_cbat_mock_active')
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'sw_cbat_mock_active' })) })
    expect(document.documentElement.hasAttribute('data-cbat-mock')).toBe(false)
  })

  it('ends the mock and goes where the player was heading when they choose to leave', async () => {
    renderLocked()
    await waitFor(() => expect(document.documentElement.hasAttribute('data-cbat-mock')).toBe(true))
    fireEvent.click(screen.getByText('Profile'))
    await act(async () => { fireEvent.click(screen.getByTestId('cbat-mock-confirm-leave')) })
    const call = apiFetch.mock.calls.find(([u]) => u === '/api/cbat-mock/m1/abandon')
    expect(call[1].method).toBe('POST')
    // Recorded on the mock, so an unexpected leave can be traced.
    expect(JSON.parse(call[1].body)).toEqual({ source: 'link', from: '/cbat/mock', to: '/profile' })
    expect(screen.getByTestId('where')).toHaveTextContent('/profile')
    expect(document.documentElement.hasAttribute('data-cbat-mock')).toBe(false)
  })
})

describe('inside a test', () => {
  it('hides the mode row so the board cannot be switched', () => {
    const modes = [
      { key: 'easier', label: 'Easier', gameKey: 'flag-easier', bars: 1, blurb: '' },
      { key: 'hard', label: 'Hard', gameKey: 'flag', bars: 3, blurb: '' },
    ]
    const { container, rerender } = render(<CbatModeRow modes={modes} value="hard" onSelect={() => {}} />)
    expect(container.textContent).toContain('Easier')
    act(() => setActiveMock(ACTIVE))
    rerender(<CbatModeRow modes={modes} value="hard" onSelect={() => {}} />)
    expect(container.textContent).toBe('')
  })

  it('ends a test with Continue, not a score, once the run is saved', () => {
    setActiveMock(ACTIVE)
    render(<MemoryRouter><CbatMockGameOver scoreSaved queued={false} /></MemoryRouter>)
    expect(screen.getByTestId('cbat-mock-continue')).toHaveTextContent('Continue assessment')
  })

  it('says plainly when the run could only be queued', () => {
    setActiveMock(ACTIVE)
    render(<MemoryRouter><CbatMockGameOver scoreSaved={false} queued /></MemoryRouter>)
    expect(screen.getByTestId('cbat-mock-queued')).toBeInTheDocument()
    expect(screen.queryByTestId('cbat-mock-continue')).toBeNull()
  })
})

describe('the score sheet', () => {
  const domain = (over) => ({ key: 'CIP', label: 'CIP', weight: 16, minStanine: 5, stanine: 7, belowMinimum: false, tests: [{ code: 'FLAG', mult: 1 }], ...over })
  const sheetMock = {
    id: 'm1', status: 'completed', scope: 'all', region: 'GB', batteryKey: null, batteryLabel: null,
    startedAt: '2026-09-27T09:00:00Z', testsDone: 20, testsTotal: 20,
    sheet: {
      maxScore: 180,
      batteries: [
        { key: 'pilot', label: 'Pilot', cutoff: 112, score: 138, status: 'fail', failedMinimums: ['CIP'],
          domains: [domain({ key: 'StrgcTM', minStanine: 4, tests: [{ code: 'CUT', mult: 3 }, { code: 'SAT', mult: 1 }] }), domain({ stanine: 3, belowMinimum: true })] },
        { key: 'intelligence', label: 'Intelligence', cutoff: 95, score: 120, status: 'pass', failedMinimums: [],
          domains: [domain({ key: 'SpaR', minStanine: 5 }), domain()] },
      ],
    },
  }

  it('prints PASS or FAIL beside each role and the red bar on a domain under its minimum', () => {
    const { container } = render(<CbatMockScoreSheet mock={sheetMock} agentNumber="1234567" />)
    expect(screen.getByTestId('mock-sheet-battery-pilot')).toHaveAttribute('data-status', 'fail')
    expect(screen.getByTestId('mock-sheet-battery-intelligence')).toHaveAttribute('data-status', 'pass')
    expect(container.querySelectorAll('.mock-sheet-min-fail')).toHaveLength(1)
    // The multiplier leads a test exactly as the real sheet writes it.
    expect(container.textContent).toContain('3(CUT), SAT')
    expect(container.textContent).toContain('1234567')
  })

  it('is titled as a SkyWatch estimate, never as an official result', () => {
    const { container } = render(<CbatMockScoreSheet mock={sheetMock} />)
    expect(container.textContent).toContain('SkyWatch Mock Assessment')
    expect(container.textContent).toContain('Not an official result')
    expect(container.textContent).not.toMatch(/OFFICIAL - SENSITIVE|OFFICIAL – SENSITIVE/)
  })
})

describe('a tab that was already open', () => {
  it('picks up a mock started in another tab when it comes back into view', async () => {
    let served = null
    apiFetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: { mock: served } }) }))
    mockUseAuth.mockReturnValue({ user: { _id: 'u1' }, apiFetch, API: '' })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderLocked('/cbat')
      await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
      expect(screen.getByTestId('where')).toHaveTextContent('/cbat')

      // Another tab starts a mock; this one is looked at again a little later.
      served = ACTIVE
      vi.advanceTimersByTime(5000)
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/cbat/mock'))
    } finally {
      vi.useRealTimers()
    }
  })
})
