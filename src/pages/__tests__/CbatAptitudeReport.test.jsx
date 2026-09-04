import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatAptitudeReport from '../CbatAptitudeReport'

// ── Mocks ─────────────────────────────────────────────────────────────────

let searchParams = new URLSearchParams()
const setSearchParams = vi.fn((updater) => {
  searchParams = typeof updater === 'function' ? updater(searchParams) : new URLSearchParams(updater)
})

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useSearchParams: () => [searchParams, setSearchParams],
}))

vi.mock('../../components/SEO', () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...rest }) => <div {...rest}>{children}</div> }),
}))

const setUser = vi.fn()
let currentUser = { _id: 'u1', cbatTargetBattery: null }

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, setUser, API: '', apiFetch: (...args) => fetch(...args) }),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const summary = {
  targetBattery: null,
  batteries: [
    { key: 'pilot', label: 'Pilot', group: 'Officer aircrew', cutoff: 112, score: 100, margin: -12, status: 'fail', coverage: 81 },
    { key: 'nco-control-atc', label: 'Non-Commissioned Control (ATC)', group: 'Non-commissioned', cutoff: 80, score: 100, margin: 20, status: 'pass', coverage: 89 },
  ],
}

const report = {
  key: 'pilot',
  label: 'Pilot',
  group: 'Officer aircrew',
  note: null,
  cutoff: 112,
  maxScore: 180,
  score: 100,
  margin: -12,
  status: 'fail',
  coverage: 81,
  domains: [
    {
      key: 'StrgcTM', label: 'Strategic Task Management', blurb: 'Holding a plan together.',
      weight: 17, stanine: 5, coverage: 100,
      tests: [
        { code: 'CUT', label: 'Cognitive Updating Test', match: 'direct', games: ['cut'], mult: 3, state: 'scored', stanine: 5,
          played: [{ gameKey: 'cut', label: 'Cognitive Updating Test', form: 380, runs: 5, stanine: 5 }],
          needsRuns: [], nextTarget: { gameKey: 'cut', stanine: 6, score: 409 } },
        { code: 'SAT', label: 'Situational Awareness Test', match: 'direct', games: ['sat'], mult: 1, state: 'needs-runs',
          stanine: null, needsRuns: [{ gameKey: 'sat', label: 'Situational Awareness Test', runs: 1, runsNeeded: 2 }] },
      ],
    },
    {
      key: 'Percpt', label: 'Perceptual', blurb: 'Reading detail off a display.',
      weight: 14, stanine: null, coverage: 0,
      tests: [
        { code: 'MATF', label: 'Table Reading Test', match: 'none', games: [], mult: 1, state: 'no-game' },
      ],
    },
  ],
  gaps: [{ code: 'MATF', label: 'Table Reading Test', domains: ['Perceptual'] }],
  focus: [
    { kind: 'improve', code: 'CUT', label: 'Cognitive Updating Test', match: 'direct', domainKey: 'StrgcTM',
      domainLabel: 'Strategic Task Management', domainWeight: 17, stanine: 5,
      nextTarget: { gameKey: 'cut', stanine: 6, score: 409 }, gain: 4.9 },
    { kind: 'unlock', code: 'SAT', label: 'Situational Awareness Test', match: 'direct', domainKey: 'StrgcTM',
      domainLabel: 'Strategic Task Management', domainWeight: 17, stanine: null,
      needsRuns: [{ gameKey: 'sat', label: 'Situational Awareness Test', runs: 1, runsNeeded: 2 }],
      easierOnly: false, opensDomain: false, gain: 1.2, coverageGain: 4.3 },
  ],
}

const reportUsers = [
  { _id: 'busy1', agentNumber: '2000001', email: 'busy@example.com', displayName: null, isAdmin: false, plays: 42, rolesPassed: 6, totalRoles: 13, targetBattery: 'nco-control-atc' },
  { _id: 'quiet1', agentNumber: '2000002', email: 'quiet@example.com', displayName: 'Maverick', isAdmin: false, plays: 3, rolesPassed: 0, totalRoles: 13, targetBattery: null },
]

beforeEach(() => {
  searchParams = new URLSearchParams()
  currentUser = { _id: 'u1', cbatTargetBattery: null }
  global.fetch = vi.fn((url) => {
    let body = summary
    if (url.includes('/report-users')) body = { users: reportUsers }
    else if (url.includes('/report/')) body = report
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'success', data: body }) })
  })
})
afterEach(() => vi.clearAllMocks())

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CbatAptitudeReport', () => {
  it('leads with the score against the cutoff and the pass/fail verdict', async () => {
    render(<CbatAptitudeReport />)

    expect(await screen.findByText('100')).toBeInTheDocument()
    expect(screen.getByText('112')).toBeInTheDocument()
    // The ribbon down the left edge, mirroring the real sheet.
    expect(screen.getByText('fail')).toBeInTheDocument()
    expect(screen.getByText('Nearly there')).toBeInTheDocument()
  })

  it('withholds the verdict when coverage is too thin to judge', async () => {
    // The dangerous state: renormalising 49% of a battery still yields 100 against a pass mark of
    // 90. The number is real, so it is still shown, but nothing may call it a pass.
    global.fetch = vi.fn((url) => {
      const thin = { ...report, coverage: 49, status: 'provisional' }
      let body = { ...summary, batteries: [{ ...summary.batteries[0], coverage: 49, status: 'provisional' }] }
      if (url.includes('/report-users')) body = { users: reportUsers }
      else if (url.includes('/report/')) body = thin
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'success', data: body }) })
    })

    render(<CbatAptitudeReport />)
    await screen.findByText('100')

    expect(screen.getByText('Not enough to judge yet')).toBeInTheDocument()
    expect(screen.getByText(/only measured 49% of this role/)).toBeInTheDocument()
    // The ribbon must not say pass or fail.
    expect(screen.getByText('partial')).toBeInTheDocument()
    expect(screen.queryByText('Passing')).not.toBeInTheDocument()
    // The score is relabelled so it doesn't read as a final number.
    expect(screen.getByText('Estimated so far')).toBeInTheDocument()
  })

  it('states the coverage the estimate rests on', async () => {
    render(<CbatAptitudeReport />)
    await screen.findByText('100')
    expect(screen.getByText('81%')).toBeInTheDocument()
  })

  it('never presents itself as a real CBAT result', async () => {
    // The single most important thing on the page: SkyWatch does not have the RAF's tests, and a
    // page that looks this much like the real sheet has to say so.
    render(<CbatAptitudeReport />)
    await screen.findByText('100')
    expect(screen.getByText(/practice estimate, not a real result/i)).toBeInTheDocument()
    expect(screen.getByText(/our own versions of the CBAT tests, not the RAF/i)).toBeInTheDocument()
  })

  it('ranks the focus list and links each item to its game', async () => {
    render(<CbatAptitudeReport />)
    await screen.findByText('100')

    // Two currencies, one per kind. A scored test is worth points; a test we cannot measure yet is
    // worth the share of the role it would open up, because its points would rest on a stanine
    // nobody has seen. Showing the guess is what put a worth-more grind above the one game
    // standing between a user and a verdict.
    expect(screen.getByText('+4.9')).toBeInTheDocument()
    expect(screen.getByText('+4.3%')).toBeInTheDocument()
    expect(screen.queryByText('+1.2')).not.toBeInTheDocument()
    // Both instructions name the difficulty: CUT and SAT are split games and only their Hard runs
    // feed this score, so "average 409+" on its own would be advice a user could follow on Easier
    // and get nothing for.
    expect(screen.getByText(/Average 409\+ across 3 goes on Hard to go from level 5 to 6/)).toBeInTheDocument()
    expect(screen.getByText(/Play it on Hard 2 more times and it starts counting/)).toBeInTheDocument()
    expect(screen.getAllByText('Play')[0]).toHaveAttribute('href', '/cbat/cut?difficulty=hard')
  })

  it('sends every play link to Hard, the only difficulty it scores', async () => {
    // The report counts Hard runs and nothing else, and a game card opens on whatever difficulty
    // that user last chose — Easier until they change it. Without the parameter the page would tell
    // someone to play Hard and then hand them an Easier card.
    render(<CbatAptitudeReport />)
    await screen.findByText('100')

    const play = screen.getAllByText('Play')[0]
    expect(play).toHaveAttribute('href', '/cbat/cut?difficulty=hard')
    expect(play.getAttribute('title')).toMatch(/Hard already selected/)
    expect(screen.getByTitle(/^CUT · Cognitive Updating Test/)).toHaveAttribute('href', '/cbat/cut?difficulty=hard')
  })

  it('tells a player on a scored game to play more Hard runs to level up', async () => {
    // The chip is the thing tapped to raise a score, so its tooltip is where "more of this, on
    // Hard" has to be said. "You are on level 5" alone reads as a status, not an instruction.
    render(<CbatAptitudeReport />)
    await screen.findByText('100')

    const cut = screen.getByTitle(/^CUT · Cognitive Updating Test/)
    expect(cut.getAttribute('title')).toMatch(/You are on level 5\./)
    expect(cut.getAttribute('title')).toMatch(/Play more Hard runs to level up/)
    expect(cut.getAttribute('title')).toMatch(/Easier runs do not count/)
  })

  it('says nothing about Hard on a game that has only one difficulty', async () => {
    // Target ships one difficulty. Telling a player to go and find its Hard button would send them
    // looking for something that is not on the card.
    global.fetch = vi.fn((url) => {
      const target = {
        ...report,
        domains: [{
          ...report.domains[0],
          tests: [{ ...report.domains[0].tests[0], code: 'TRT', label: 'Target Recognition Test', games: ['target'],
            played: [{ gameKey: 'target', label: 'Target Recognition Test', form: 80, runs: 5, stanine: 5 }] }],
        }],
        focus: [],
      }
      let body = summary
      if (url.includes('/report-users')) body = { users: reportUsers }
      else if (url.includes('/report/')) body = target
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'success', data: body }) })
    })

    render(<CbatAptitudeReport />)
    await screen.findByText('100')

    const chip = screen.getByTitle(/^TRT · Target Recognition Test/)
    expect(chip).toHaveAttribute('href', '/cbat/target')
    expect(chip.getAttribute('title')).toMatch(/Play more runs to level up/)
    expect(chip.getAttribute('title')).not.toMatch(/Hard/)
  })

  it('opens a domain to reveal the tests behind it', async () => {
    render(<CbatAptitudeReport />)
    await screen.findByText('100')

    expect(screen.queryByText('Holding a plan together.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Strategic Task Management'))
    expect(screen.getByText('Holding a plan together.')).toBeInTheDocument()
    // CUT is sat three times inside this skill area. The multiplier shows on the always-visible
    // chip and again on the expanded row, so both places tell you where practice pays off most.
    expect(screen.getAllByText(/×3/)).toHaveLength(2)
  })

  it('lists tests SkyWatch has no game for as gaps', async () => {
    render(<CbatAptitudeReport />)
    await screen.findByText('100')
    expect(screen.getByText("Tests we don't have a game for")).toBeInTheDocument()
  })

  it('shows which games feed each skill area, without needing a tap', async () => {
    // The bar says where you are weak; these say what to go and play about it. Both have to be
    // visible at once or the row only does half the job.
    render(<CbatAptitudeReport />)
    await screen.findByText('100')

    const cut = screen.getByTitle(/^CUT · Cognitive Updating Test/)
    expect(cut).toHaveAttribute('href', '/cbat/cut?difficulty=hard')
    // Labelled by the game the user recognises, with the real sheet code in the tooltip.
    expect(cut.textContent).toMatch(/Cognitive Updating Test/)

    const sat = screen.getByTitle(/^SAT · Situational Awareness Test/)
    expect(sat).toHaveAttribute('href', '/cbat/sat?difficulty=hard')
    expect(sat.getAttribute('title')).toMatch(/Play it on Hard 2 more time/)
  })

  it('makes a game with no chip link inert when there is no game', async () => {
    render(<CbatAptitudeReport />)
    await screen.findByText('100')

    const chip = screen.getByTitle(/^MATF · Table Reading Test. No SkyWatch game/)
    expect(chip.tagName).toBe('SPAN')          // not a link
    expect(chip.className).toMatch(/line-through/)
  })

  it('greys out a skill area we cannot measure, and the test inside it', async () => {
    // Perceptual has one test, Table Reading, which has no SkyWatch game. Both the row and the
    // test inside it must read as unavailable rather than as a score of zero.
    render(<CbatAptitudeReport />)
    await screen.findByText('100')

    const domainRow = screen.getByText('Perceptual').closest('div.border-b')
    expect(domainRow.className).toMatch(/opacity-50/)
    expect(screen.getByText('No game yet')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Perceptual'))
    // MATF appears twice: the test row inside the skill area, and the chip in the gaps card. The
    // struck-through one is the test row.
    const codeCell = screen.getAllByText('MATF').find(el => el.className.includes('line-through'))
    expect(codeCell).toBeDefined()
    const testRow = codeCell.closest('div')
    expect(testRow.className).toMatch(/opacity-45/)
    // No link to play something that doesn't exist.
    expect(testRow.querySelector('a')).toBeNull()
  })

  it('does not grey out a skill area it can measure', async () => {
    render(<CbatAptitudeReport />)
    await screen.findByText('100')
    const scored = screen.getByText('Strategic Task Management').closest('div.border-b')
    expect(scored.className).not.toMatch(/opacity-50/)
  })

  it('shows every role scored when the picker is opened, and saves a target', async () => {
    render(<CbatAptitudeReport />)
    await screen.findByText('100')

    fireEvent.click(screen.getByText('Change role'))
    expect(await screen.findByText("How you'd do in every role")).toBeInTheDocument()
    expect(screen.getByText('Non-Commissioned Control (ATC)')).toBeInTheDocument()
    // Same play, opposite verdicts — the reason the picker exists.
    expect(screen.getByText('pass')).toBeInTheDocument()

    fireEvent.click(screen.getByText(/I'm aiming for Pilot/))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/users/me/target-battery',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ batteryKey: 'pilot' }) }),
      )
    })
  })

  it('shows no admin controls to an ordinary player', async () => {
    render(<CbatAptitudeReport />)
    await screen.findByText('100')
    expect(screen.queryByText('View as…')).not.toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/report-users'), expect.anything())
  })

  describe('as an admin', () => {
    beforeEach(() => { currentUser = { _id: 'a1', isAdmin: true, cbatTargetBattery: null } })

    it('says plainly whose report is on screen', async () => {
      render(<CbatAptitudeReport />)
      await screen.findByText('100')
      expect(screen.getByText('Viewing your own report.')).toBeInTheDocument()
      expect(screen.getByText('View as…')).toBeInTheDocument()
    })

    it('lists players busiest-first and switches to the one picked', async () => {
      render(<CbatAptitudeReport />)
      await screen.findByText('100')

      fireEvent.click(screen.getByText('View as…'))
      expect(await screen.findByText('Agent 2000001')).toBeInTheDocument()
      expect(screen.getByText('42')).toBeInTheDocument()
      expect(screen.getByText('Maverick')).toBeInTheDocument()

      fireEvent.click(screen.getByText('Agent 2000001'))
      // Subject goes in the URL so a refresh, or a link pasted into a support thread, lands back
      // on the same player.
      expect(searchParams.get('as')).toBe('busy1')
      // ...and the previous player's role choice is dropped rather than carried over.
      expect(searchParams.get('role')).toBeNull()
    })

    it('shows roles passed per player, green when any and red when none', async () => {
      render(<CbatAptitudeReport />)
      await screen.findByText('100')
      fireEvent.click(screen.getByText('View as…'))
      await screen.findByText('Agent 2000001')

      const passing = screen.getByText('6 roles')
      const none    = screen.getByText('0 roles')
      expect(passing.className).toMatch(/emerald/)
      expect(none.className).not.toMatch(/emerald/)
      expect(passing).toHaveAttribute('title', 'Clears the cutoff on 6 of 13 roles')
    })

    it('says "1 role", not "1 roles"', async () => {
      global.fetch = vi.fn((url) => {
        let body = summary
        if (url.includes('/report-users')) body = { users: [{ ...reportUsers[0], rolesPassed: 1 }] }
        else if (url.includes('/report/')) body = report
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'success', data: body }) })
      })
      render(<CbatAptitudeReport />)
      await screen.findByText('100')
      fireEvent.click(screen.getByText('View as…'))
      expect(await screen.findByText('1 role')).toBeInTheDocument()
    })

    it('searches the server rather than filtering the loaded page', async () => {
      render(<CbatAptitudeReport />)
      await screen.findByText('100')
      fireEvent.click(screen.getByText('View as…'))
      await screen.findByText('Agent 2000001')

      fireEvent.change(screen.getByPlaceholderText(/Search agent number/), { target: { value: 'mav' } })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/report-users?q=mav'))
      })
    })

    it('requests the viewed player\'s report, not its own', async () => {
      searchParams = new URLSearchParams({ as: 'busy1' })
      render(<CbatAptitudeReport />)
      await screen.findByText('100')

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('userId=busy1'))
    })

    it('will not let an admin set a target role while reading someone else\'s report', async () => {
      // The button would set the ADMIN's own target — not what it appears to do on this page.
      searchParams = new URLSearchParams({ as: 'busy1' })
      global.fetch = vi.fn((url) => {
        let body = { ...summary, viewingAs: { _id: 'busy1', agentNumber: '2000001', displayName: null } }
        if (url.includes('/report-users')) body = { users: reportUsers }
        else if (url.includes('/report/')) body = { ...report, viewingAs: { _id: 'busy1', agentNumber: '2000001', displayName: null } }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'success', data: body }) })
      })

      render(<CbatAptitudeReport />)
      await screen.findByText('100')
      expect(screen.getByText(/Viewing/)).toBeInTheDocument()

      fireEvent.click(screen.getByText('Change role'))
      await screen.findByText("How you'd do in every role")
      expect(screen.queryByText(/I'm aiming for/)).not.toBeInTheDocument()
      expect(screen.getByText('This player has not chosen a role yet.')).toBeInTheDocument()
    })

    it('says in the list whether each player has chosen a role', async () => {
      // The thing being scanned for before opening anyone: a report read against a role its owner
      // never picked is read against our default, and the two look identical once open.
      render(<CbatAptitudeReport />)
      await screen.findByText('100')
      fireEvent.click(screen.getByText('View as…'))
      await screen.findByText('Agent 2000001')

      const aiming = screen.getByText('Aiming for Non-Commissioned Control (ATC)')
      const none   = screen.getByText('No role chosen')
      expect(aiming.className).toMatch(/brand-700/)
      expect(none.className).not.toMatch(/brand-700/)
    })

    it('opens a picked player on their own chosen role', async () => {
      // Their target only arrives with their summary, so the report must wait for it rather than
      // fetch the sheet's first role and swap it out a moment later.
      searchParams = new URLSearchParams({ as: 'busy1' })
      global.fetch = vi.fn((url) => {
        const viewingAs = { _id: 'busy1', agentNumber: '2000001', displayName: null }
        let body = { ...summary, targetBattery: 'nco-control-atc', viewingAs }
        if (url.includes('/report-users')) body = { users: reportUsers }
        else if (url.includes('/report/')) body = { ...report, viewingAs }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'success', data: body }) })
      })

      render(<CbatAptitudeReport />)
      await screen.findByText('100')

      // Not a call count — every role fetch must have been for THEIR role, with the sheet's first
      // role never requested on the way there.
      const roleCalls = global.fetch.mock.calls
        .map(c => c[0]).filter(u => u.includes('/report/'))
      expect(roleCalls.length).toBeGreaterThan(0)
      expect(roleCalls.every(u => u.includes('/report/nco-control-atc'))).toBe(true)
    })

    it('says so when the player being viewed has never chosen a role', async () => {
      searchParams = new URLSearchParams({ as: 'quiet1' })
      global.fetch = vi.fn((url) => {
        const viewingAs = { _id: 'quiet1', agentNumber: '2000002', displayName: 'Maverick' }
        let body = { ...summary, targetBattery: null, viewingAs }
        if (url.includes('/report-users')) body = { users: reportUsers }
        else if (url.includes('/report/')) body = { ...report, viewingAs }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'success', data: body }) })
      })

      render(<CbatAptitudeReport />)
      await screen.findByText('100')

      expect(screen.getByText(/This player is aiming for/)).toBeInTheDocument()
      expect(screen.getByText(/not chosen yet, so this is the first role on the sheet/)).toBeInTheDocument()
    })
  })

  it('prompts a signed-out visitor to sign in rather than showing an empty sheet', () => {
    currentUser = null
    render(<CbatAptitudeReport />)
    expect(screen.getByText('Sign in to see your Aptitude Report')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

// The explainer is five long bullets written for someone who has never sat the CBAT, and dead
// weight for someone who has read them once. It decides for itself which reader it has.
describe('CbatAptitudeReport — the explainer', () => {
  const HOW_IT_WORKS = /You sit the tests once and get one score out of 180/
  const DISCLAIMER   = /practice estimate, not a real result/i

  const unscored = () => {
    global.fetch = vi.fn((url) => {
      let body = { ...summary, batteries: summary.batteries.map(b => ({ ...b, score: null, status: 'unscored', coverage: 0 })) }
      if (url.includes('/report-users')) body = { users: reportUsers }
      else if (url.includes('/report/')) body = { ...report, score: null, margin: null, status: 'unscored', coverage: 0 }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'success', data: body }) })
    })
  }

  it('stays shut for a player who already has a score', async () => {
    render(<CbatAptitudeReport />)
    await screen.findByText('100')
    expect(screen.queryByText(HOW_IT_WORKS)).not.toBeInTheDocument()
    expect(screen.getByText('Show')).toBeInTheDocument()
  })

  it('opens itself for a player who has no score to read yet', async () => {
    unscored()
    render(<CbatAptitudeReport />)
    await screen.findByText('Pass mark')
    expect(screen.getByText(HOW_IT_WORKS)).toBeInTheDocument()
  })

  // The awaits below are the test harness, not the page: a parent state change re-renders it, and
  // this file's useAuth mock hands back a fresh apiFetch each time, so both fetch effects re-run
  // and the report block drops out for a tick. The real context memoises apiFetch and never does
  // this.
  it('opens on a tap', async () => {
    render(<CbatAptitudeReport />)
    await screen.findByText('100')
    fireEvent.click(screen.getByText('Show'))
    expect(await screen.findByText(HOW_IT_WORKS)).toBeInTheDocument()
  })

  // The page is worthless, and actively misleading, if it is mistaken for a real result. The one
  // paragraph that says so is not something a reader can collapse away.
  it('never hides the disclaimer, open or shut', async () => {
    render(<CbatAptitudeReport />)
    await screen.findByText('100')
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Show'))
    expect(await screen.findByText(DISCLAIMER)).toBeInTheDocument()
  })
})

// A bar and a bare number say where you are without saying what it means. The words for it used to
// live in a column that only appeared from `lg`, so on the device most people read this on, no row
// said anything at all.
describe('CbatAptitudeReport — what a level means', () => {
  it('names the band on the row itself, at every width', async () => {
    render(<CbatAptitudeReport />)
    await screen.findByText('100')
    expect(screen.getByText('Average').className).not.toMatch(/hidden/)
  })

  it('says so on a skill area it cannot measure at all', async () => {
    render(<CbatAptitudeReport />)
    await screen.findByText('100')
    expect(screen.getByText('No game yet').className).not.toMatch(/hidden/)
  })

  // The weighting is detail rather than meaning, so it is the half that gives way when the row
  // runs out of room.
  it('keeps the weighting in a column of its own', async () => {
    render(<CbatAptitudeReport />)
    await screen.findByText('100')
    expect(screen.getByText('counts 17%').closest('.hidden')).toBeInTheDocument()
  })
})

// Opening a skill area is how you find out what you actually scored on each game. On a phone that
// column had nowhere to go and was simply dropped, which left the tap showing a code, a bar and a
// level: everything except the reason for tapping.
describe('CbatAptitudeReport — your scores on a phone', () => {
  it('gives the last-3 scores their own line below the sm breakpoint', async () => {
    const { container } = render(<CbatAptitudeReport />)
    await screen.findByText('100')
    fireEvent.click(screen.getByText('Strategic Task Management'))

    const phone = [...container.querySelectorAll('.sm\\:hidden')]
      .find(el => el.textContent.includes('Last 3:'))
    expect(phone).toBeDefined()
    expect(phone.textContent).toContain('Cognitive Updating Test 380')
  })

  it('keeps the desktop column in the row itself', async () => {
    const { container } = render(<CbatAptitudeReport />)
    await screen.findByText('100')
    fireEvent.click(screen.getByText('Strategic Task Management'))

    const desktop = [...container.querySelectorAll('.hidden.sm\\:block')]
      .find(el => el.textContent.includes('Last 3:'))
    expect(desktop).toBeDefined()
  })
})
