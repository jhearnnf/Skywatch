import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import AptitudeReportCard from '../AptitudeReportCard'
import { MIN_COVERAGE_FOR_VERDICT } from '../../data/cbatBatteries'

// Everything the card says short of a verdict.
//
// The rule these tests exist to hold is that a progress figure is never a score. An estimate
// renormalised over 8% of a role is real arithmetic and completely unsafe to read as a result:
// "96 / pass mark 112" on the games hub gets read as "am I passing" whatever the caption says, and
// the figure moves thirty points, usually downwards, the moment another game starts counting. So
// below the threshold the card counts runs, coverage or roles instead, and never shows a score or
// a pass mark next to any of them.
//
// The second rule is that the card is never empty. A user two games in is exactly who it is for.

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
// Keeps `animate` — the rail's fill width is the assertion, and the real component only ever
// expresses it as an animation target.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style, animate }) => (
      <div
        className={className}
        style={{ ...style, ...(typeof animate?.width === 'string' ? { width: animate.width } : {}) }}
      >{children}</div>
    ),
  },
}))

const USER = { _id: '1' }

function renderWith(data) {
  mockUseAuth.mockReturnValue({
    user: USER,
    API: '',
    apiFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) }),
  })
  return render(<AptitudeReportCard />)
}

const settled = () => waitFor(() => expect(screen.queryByTestId('aptitude-report-skeleton')).toBeNull())

const battery = (over) => ({ key: 'pilot', label: 'Pilot', cutoff: 112, ...over })
const unscored = () => battery({ score: null, margin: null, status: 'unscored', coverage: 0 })

const headline = () => screen.getByTestId('aptitude-card-score')
const action = () => screen.getByTestId('aptitude-card-action')

// Two runs in, nothing counting yet: score null, coverage 0, one game nearly banked.
const RUNS = {
  targetBattery: 'pilot',
  batteries: [unscored()],
  targetFocus: { kind: 'unlock', code: 'CUT', gameKey: 'cut', gain: null, coverageGain: 12.3, needsRuns: [] },
  nearestUnlock: { gameKey: 'cut', label: 'Cognitive Updating Test', runs: 2, runsNeeded: 1 },
  runsToCount: 3,
}

// Enough for arithmetic, nowhere near enough for a verdict.
const PROVISIONAL = {
  targetBattery: 'pilot',
  batteries: [battery({ score: 96, margin: -16, status: 'provisional', coverage: 12 })],
  targetFocus: {
    kind: 'unlock', code: 'CUT', gameKey: 'cut', gain: 9.4, coverageGain: 12.3,
    needsRuns: [{ gameKey: 'cut', runs: 1, runsNeeded: 2 }],
  },
  nearestUnlock: null,
  runsToCount: 3,
}

describe('AptitudeReportCard — below the verdict threshold', () => {
  beforeEach(() => mockUseAuth.mockReset())

  it('counts runs toward a first score when nothing is measured yet', async () => {
    renderWith(RUNS)
    await settled()
    expect(headline()).toHaveTextContent('2 / 3 runs to your first score')
  })

  it('names the game the user is closest to finishing', async () => {
    renderWith(RUNS)
    await settled()
    expect(action()).toHaveTextContent('Play Cognitive Updating Test on Hard 1 more time to start your score.')
  })

  // The whole point of the state. A number against a pass mark is a verdict, and there isn't one.
  it('shows no score and no pass mark in either state', async () => {
    const runs = renderWith(RUNS)
    await settled()
    expect(runs.container.textContent).not.toMatch(/pass mark|112/)
    runs.unmount()

    const provisional = renderWith(PROVISIONAL)
    await settled()
    expect(provisional.container.textContent).not.toMatch(/pass mark|112|96/)
  })

  it('reports coverage once something is measured', async () => {
    renderWith(PROVISIONAL)
    await settled()
    expect(headline()).toHaveTextContent('12% of this role measured')
    expect(action()).toHaveTextContent('Play Cognitive Updating Test on Hard 2 more times to measure more of it.')
  })

  // Coverage fills the full track with the threshold ticked on it; runs fill a track that IS the
  // unlock, so a tick would sit on its own end.
  it('fills the coverage rail to the coverage, and ticks where a verdict starts', async () => {
    const { container } = renderWith(PROVISIONAL)
    await settled()
    expect(container.querySelector('.aptitude-rail-fill')).toHaveStyle({ width: '12%' })
    expect(screen.getByTestId('aptitude-card-tick'))
      .toHaveStyle({ left: `calc(${MIN_COVERAGE_FOR_VERDICT}% - 1px)` })
  })

  it('fills the runs rail to the runs banked, with no tick', async () => {
    const { container } = renderWith(RUNS)
    await settled()
    expect(container.querySelector('.aptitude-rail-fill')).toHaveStyle({ width: '66.66666666666666%' })
    expect(screen.queryByTestId('aptitude-card-tick')).toBeNull()
  })

  // Neither state may be coloured. A green stripe on a card that cannot call a pass is the exact
  // misreading the provisional status exists to prevent.
  it('keeps the neutral stripe', async () => {
    renderWith(PROVISIONAL)
    await settled()
    expect(screen.getByTestId('aptitude-card-stripe').className).toContain('bg-[#1a3a5c]')
  })

  it('counts runs the report itself set, not a number of its own', async () => {
    renderWith({ ...RUNS, nearestUnlock: { gameKey: 'cut', runs: 1, runsNeeded: 3 }, runsToCount: 4 })
    await settled()
    expect(headline()).toHaveTextContent('1 / 4 runs to your first score')
  })
})

// A user who has never opened the report has no target role, and used to get a pitch card with no
// figure on it at all — both a wasted slot and a different height from the skeleton above it, so
// the card visibly shrank on arrival. They get the same progress as everyone else.
describe('AptitudeReportCard — no role chosen', () => {
  beforeEach(() => mockUseAuth.mockReset())

  it('counts a first-timer’s runs toward their first score', async () => {
    renderWith({
      targetBattery: null,
      batteries: [unscored()],
      nearestUnlock: { gameKey: 'cut', runs: 1, runsNeeded: 2 },
      runsToCount: 3,
    })
    await settled()
    expect(headline()).toHaveTextContent('1 / 3 runs to your first score')
    expect(action()).toHaveTextContent('Play Cognitive Updating Test on Hard 2 more times to start your score.')
    // No role to name, so the eyebrow does not pretend there is one.
    expect(screen.getByTestId('aptitude-card-eyebrow')).toHaveTextContent(/^Aptitude Report$/)
  })

  it('names the price of entry to someone who has played nothing', async () => {
    renderWith({ targetBattery: null, batteries: [unscored()], nearestUnlock: null, runsToCount: 3 })
    await settled()
    expect(headline()).toHaveTextContent('3 runs to your first score')
    expect(action()).toHaveTextContent('Play any CBAT game 3 times and your score starts here.')
  })

  // The most persuasive true thing we can say to someone who has scores but has never looked.
  it('counts the roles a scored player would already pass', async () => {
    renderWith({
      targetBattery: null,
      batteries: [
        battery({ key: 'pilot', score: 120, status: 'pass' }),
        battery({ key: 'wso', score: 118, status: 'pass' }),
        battery({ key: 'intelligence', score: 80, status: 'fail' }),
      ],
      nearestUnlock: null,
      runsToCount: 3,
    })
    await settled()
    expect(headline()).toHaveTextContent('2 / 3 roles you’d pass')
    expect(action()).toHaveTextContent('Pick the role you’re aiming for')
  })

  // "0 / 13 roles you'd pass" is a true sentence and a miserable one. The count of roles measured
  // is just as true and is the one that reads as progress.
  it('leads with roles scored when none of them would pass yet', async () => {
    renderWith({
      targetBattery: null,
      batteries: [
        battery({ key: 'pilot', score: 70, status: 'fail' }),
        battery({ key: 'wso', score: 66, status: 'fail' }),
      ],
      nearestUnlock: null,
      runsToCount: 3,
    })
    await settled()
    expect(headline()).toHaveTextContent('2 roles scored')
  })
})

// An older client cache, or a summary served before these fields existed.
describe('AptitudeReportCard — an incomplete payload', () => {
  beforeEach(() => mockUseAuth.mockReset())

  it('falls back to coverage when the summary carries no next play', async () => {
    renderWith({
      targetBattery: 'pilot',
      batteries: [battery({ score: 96, margin: -16, status: 'provisional', coverage: 12 })],
    })
    await settled()
    expect(headline()).toHaveTextContent('12% of this role measured')
    expect(action()).toHaveTextContent('Play more of this role’s games to measure more of it.')
  })

  it('still counts to three when the summary does not say how many runs count', async () => {
    renderWith({ targetBattery: null, batteries: [unscored()] })
    await settled()
    expect(headline()).toHaveTextContent('3 runs to your first score')
  })
})
