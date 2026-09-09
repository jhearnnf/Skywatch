import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import AptitudeReportCard from '../AptitudeReportCard'

// The card on somebody else's profile.
//
// Same figures, same shape, two things that have to change. It must ask the server for THAT
// player rather than the admin reading it — a card that quietly reported the admin's own numbers
// under an agent's name is worse than no card at all — and it must stop addressing the reader as
// the player. Every line on the player's own card names a game to go and play tonight, and an
// admin cannot play it for them: "2 / 3 runs to settle your first game" on an agent's profile
// belongs to nobody on that page.

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, className, style }) => <div className={className} style={style}>{children}</div> },
}))

const battery = (over) => ({ key: 'pilot', label: 'Pilot', cutoff: 112, ...over })

const RUNS = {
  targetBattery: 'pilot',
  batteries: [battery({ score: null, margin: null, status: 'unscored', coverage: 0 })],
  targetFocus: { kind: 'unlock', code: 'CUT', gameKey: 'cut', gain: null, coverageGain: 12.3, needsRuns: [] },
  nearestUnlock: { gameKey: 'cut', label: 'Cognitive Updating Test', runs: 2, runsNeeded: 1 },
  runsToCount: 3,
}

const SCORED = {
  targetBattery: 'pilot',
  batteries: [battery({ score: 128, margin: 16, status: 'pass', coverage: 74 })],
  targetFocus: null,
  nearestUnlock: null,
  runsToCount: 3,
}

const NO_ROLE = {
  targetBattery: null,
  batteries: [battery({ score: 128, margin: 16, status: 'pass', coverage: 74 })],
  targetFocus: null,
  nearestUnlock: null,
  runsToCount: 3,
}

function renderWith(data, props = {}) {
  const apiFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) })
  mockUseAuth.mockReturnValue({ user: { _id: 'admin1' }, API: '', apiFetch })
  const view = render(<AptitudeReportCard {...props} />)
  return { ...view, apiFetch }
}

const settled = () => waitFor(() => expect(screen.queryByTestId('aptitude-report-skeleton')).toBeNull())

beforeEach(() => mockUseAuth.mockReset())

describe('AptitudeReportCard — read on another agent', () => {
  it('asks for that agent’s report, not the admin’s own', async () => {
    const { apiFetch } = renderWith(RUNS, { userId: 'u9' })
    await settled()
    expect(apiFetch).toHaveBeenCalledWith('/api/games/cbat/report?userId=u9')
  })

  it('opens the report page as that agent', async () => {
    renderWith(SCORED, { userId: 'u9' })
    await settled()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/cbat/report?as=u9')
  })

  it('says nothing to the reader that only the player could act on', async () => {
    const { container } = renderWith(RUNS, { userId: 'u9' })
    await settled()
    expect(screen.getByTestId('aptitude-card-score')).toHaveTextContent('2 / 3 runs to settle their first game')
    expect(screen.getByTestId('aptitude-card-action'))
      .toHaveTextContent('Needs Cognitive Updating Test on Hard 1 more time to settle it.')
    expect(container.textContent).not.toMatch(/\byour\b|\byou\b/i)
  })

  it('reports a role nobody has chosen as a fact about them', async () => {
    const { container } = renderWith(NO_ROLE, { userId: 'u9' })
    await settled()
    expect(screen.getByTestId('aptitude-card-action')).toHaveTextContent('They have not picked a role they are aiming for')
    expect(container.textContent).not.toMatch(/\byour\b|\byou\b/i)
  })

  it('is the same figure either way — only the person changes', async () => {
    renderWith(SCORED, { userId: 'u9' })
    await settled()
    expect(screen.getByTestId('aptitude-card-score')).toHaveTextContent('128 / pass mark 112')
  })
})

describe('AptitudeReportCard — read on yourself', () => {
  it('is untouched: own report, own page, own voice', async () => {
    const { apiFetch } = renderWith(RUNS)
    await settled()
    expect(apiFetch).toHaveBeenCalledWith('/api/games/cbat/report')
    expect(screen.getByRole('link')).toHaveAttribute('href', '/cbat/report')
    expect(screen.getByTestId('aptitude-card-score')).toHaveTextContent('2 / 3 runs to settle your first game')
    expect(screen.getByTestId('aptitude-card-action'))
      .toHaveTextContent('Play Cognitive Updating Test on Hard 1 more time to settle it.')
  })
})
