import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatQuestionnaireResults from '../CbatQuestionnaireResults'

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ API: '', apiFetch: (...a) => fetch(...a) }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))

const payload = (over = {}) => ({
  responses: over.responses ?? [],
  optedOut:  over.optedOut  ?? [],
  deferred:  over.deferred  ?? [],
  summary: {
    invitesSent: 10, opened: 7, started: 5, completed: 3, optOuts: 1,
    satTest: 4, notYet: 1, passed: 2, failed: 1, waiting: 1,
    avgRealism: 3.5, avgHelped: 4.2, donationClicks: 1,
    roleCounts: {}, gaps: [],
    ...(over.summary ?? {}),
  },
})

// Answer cards start closed; this opens every one of them.
const expandAll = async () => fireEvent.click(await screen.findByTestId('results-toggle-all'))

const mount = (data) => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data }) }))
  return render(<MemoryRouter><CbatQuestionnaireResults /></MemoryRouter>)
}

beforeEach(() => {
  global.fetch = vi.fn()
  // jsdom stubs scrollIntoView on HTMLElement.prototype, shadowing Element.prototype.
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { vi.restoreAllMocks() })

describe('CbatQuestionnaireResults — the funnel', () => {
  it('shows the send-to-finish funnel with rates', async () => {
    mount(payload())
    expect(await screen.findByText('Emailed')).toBeInTheDocument()
    expect(screen.getByText('70%')).toBeInTheDocument()  // opened
    expect(screen.getByText('30%')).toBeInTheDocument()  // finished
  })

})

describe('CbatQuestionnaireResults — unsubscribes', () => {
  const optedOut = [{
    agentNumber: '1234567', displayName: null, email: 'a@example.com',
    optedOutAt: '2026-09-01T00:00:00.000Z', sentAt: '2026-08-20T00:00:00.000Z',
    reason: 'too_many_emails', passedForRole: 'yes', satTest: true,
  }]

  it('names them, with the reason they gave', async () => {
    mount(payload({ optedOut }))
    fireEvent.click(await screen.findByTestId('results-tab-optouts'))

    const table = within(screen.getByTestId('results-optouts'))
    expect(table.getByText('Agent 1234567')).toBeInTheDocument()
    expect(table.getByText('Too many emails')).toBeInTheDocument()
    // The answer they gave on the way out is still worth having.
    expect(table.getByText(/Passed/)).toBeInTheDocument()
  })

  it('says plainly when no reason was given', async () => {
    mount(payload({ optedOut: [{ ...optedOut[0], reason: null, passedForRole: null }] }))
    fireEvent.click(await screen.findByTestId('results-tab-optouts'))
    expect(screen.getByText('No reason given')).toBeInTheDocument()
  })

  it('says so when nobody has left', async () => {
    mount(payload())
    fireEvent.click(await screen.findByTestId('results-tab-optouts'))
    expect(screen.getByText('Nobody has unsubscribed.')).toBeInTheDocument()
  })
})

describe('CbatQuestionnaireResults — still waiting', () => {
  it('shows when they come back, and their booked date', async () => {
    mount(payload({ deferred: [{
      agentNumber: '222', displayName: 'Falcon', email: 'f@example.com',
      sentAt: '2026-08-01T00:00:00.000Z', deferredUntil: '2026-12-19T00:00:00.000Z',
      due: false, testBookedFor: '2026-12-12T00:00:00.000Z', testBookedUnknown: false,
    }] }))
    fireEvent.click(await screen.findByTestId('results-tab-deferred'))

    expect(screen.getByText('Falcon')).toBeInTheDocument()
    expect(screen.getByText(/Back on 19 Dec 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Test booked 12 Dec 2026/)).toBeInTheDocument()
  })

  it('flags an expired deferral as due', async () => {
    mount(payload({ deferred: [{
      agentNumber: '222', displayName: null, email: 'f@example.com',
      deferredUntil: '2026-01-01T00:00:00.000Z', due: true,
      testBookedFor: null, testBookedUnknown: true,
    }] }))
    fireEvent.click(await screen.findByTestId('results-tab-deferred'))

    expect(screen.getByText('Due a follow-up')).toBeInTheDocument()
    expect(screen.getByText('Not booked yet')).toBeInTheDocument()
  })
})

describe('CbatQuestionnaireResults — answers', () => {
  it('shows one row per respondent with their answers', async () => {
    mount(payload({ responses: [{
      _id: 'r1', userId: { agentNumber: '333', displayName: 'Kestrel', email: 'k@example.com' },
      satTest: true, role: 'pilot', passedForRole: 'yes',
      realismRating: 4, helpedRating: 5, gaps: 'Timing was tighter.',
      donationClicked: true, completedAt: '2026-09-01T00:00:00.000Z',
    }] }))

    expect(await screen.findByText('Kestrel')).toBeInTheDocument()
    const table = within(screen.getByTestId('results-answers'))
    // Closed: who, pass, and that there is something written inside.
    expect(table.getByText('Passed')).toBeInTheDocument()
    expect(table.getByText(/Wrote about the gaps/)).toBeInTheDocument()
    expect(table.queryByText('Realism 4/5')).toBeNull()
    expect(table.queryByText('Timing was tighter.')).toBeNull()

    await expandAll()
    expect(table.getByText('Realism 4/5')).toBeInTheDocument()
    expect(table.getByText('Helped 5/5')).toBeInTheDocument()
    expect(table.getByText('Clicked donate')).toBeInTheDocument()
    expect(table.getByText('Timing was tighter.')).toBeInTheDocument()
  })

  it('marks a run that stopped partway rather than hiding it', async () => {
    mount(payload({ responses: [{
      _id: 'r2', userId: { agentNumber: '444' },
      satTest: true, passedForRole: 'no', completedAt: null,
    }] }))

    expect(await screen.findByText('Stopped partway')).toBeInTheDocument()
    expect(screen.getByText('Did not pass')).toBeInTheDocument()
  })

  // What they did here before they sat it, beside what they told us about it.
  it('shows how much of the roster they played and the estimate for their role', async () => {
    mount(payload({ responses: [{
      _id: 'r3', userId: { agentNumber: '555' },
      satTest: true, role: 'pilot', passedForRole: 'yes',
      cbat: {
        runs: 47, gamesPlayed: 12, gamesTotal: 23,
        aptitude: { battery: 'pilot', label: 'Pilot', cutoff: 112, maxScore: 180, score: 128, status: 'pass', coverage: 91 },
      },
    }] }))

    await expandAll()
    const row = within(await screen.findByTestId('results-cbat-summary'))
    expect(row.getByText('12 / 23')).toBeInTheDocument()
    expect(row.getByText('128 / 180')).toBeInTheDocument()
    expect(row.getByText(/for Pilot/)).toBeInTheDocument()
    expect(row.getByText('Pass')).toBeInTheDocument()
  })

  it('leaves the estimate off when no role could be scored, and never invents one', async () => {
    mount(payload({ responses: [{
      _id: 'r4', userId: { agentNumber: '556' },
      satTest: true, role: 'rn-pilot', passedForRole: 'no',
      cbat: { runs: 3, gamesPlayed: 1, gamesTotal: 23, aptitude: null },
    }] }))

    await expandAll()
    const row = within(await screen.findByTestId('results-cbat-summary'))
    expect(row.getByText('1 / 23')).toBeInTheDocument()
    expect(row.queryByText(/Est\. score/)).toBeNull()
  })

  it('shows a dash rather than a number when the role has no Hard runs behind it', async () => {
    mount(payload({ responses: [{
      _id: 'r5', userId: { agentNumber: '557' },
      satTest: true, role: 'wso', passedForRole: 'waiting',
      cbat: {
        runs: 6, gamesPlayed: 2, gamesTotal: 23,
        aptitude: { battery: 'wso', label: 'WSO', cutoff: 100, maxScore: 180, score: null, status: 'unscored', coverage: 0 },
      },
    }] }))

    await expandAll()
    const row = within(await screen.findByTestId('results-cbat-summary'))
    expect(row.getByText('— / 180')).toBeInTheDocument()
    expect(row.queryByText('No score')).toBeNull()
  })

  it('reports a load failure instead of an empty page', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ message: 'nope' }) }))
    render(<MemoryRouter><CbatQuestionnaireResults /></MemoryRouter>)
    expect(await screen.findByText('nope')).toBeInTheDocument()
  })

  it('badges a respondent who sent in a score sheet', async () => {
    mount(payload({ responses: [{
      _id: 'r3', userId: { _id: 'u3', agentNumber: '555' },
      satTest: true, passedForRole: 'yes', resultImagesUploaded: 2,
    }] }))

    const table = within(await screen.findByTestId('results-answers'))
    expect(table.getByTestId('results-sheet-badge')).toHaveTextContent('Sheet ×2')
  })

  it('does not badge a respondent who sent nothing in', async () => {
    mount(payload({ responses: [{
      _id: 'r4', userId: { agentNumber: '666' }, satTest: true, passedForRole: 'yes',
    }] }))

    const table = within(await screen.findByTestId('results-answers'))
    expect(table.queryByTestId('results-sheet-badge')).toBeNull()
  })

  // Orphaned rows (the account behind them is gone) have no id to fetch images
  // by, so there is nothing for the badge to open.
  it('does not badge an uploaded sheet whose account is gone', async () => {
    mount(payload({ responses: [{
      _id: 'r4b', userId: null, satTest: true, passedForRole: 'yes', resultImagesUploaded: 1,
    }] }))

    const table = within(await screen.findByTestId('results-answers'))
    expect(table.queryByTestId('results-sheet-badge')).toBeNull()
  })
})

describe('CbatQuestionnaireResults — viewing a score sheet', () => {
  it('opens a modal with the images and steps between them', async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes('/cbat-results')) {
        return {
          ok: true,
          json: async () => ({ data: { images: [
            { _id: 'i1', url: 'https://example.com/1.png', caption: 'sheet1', uploadedAt: '2026-09-01T00:00:00.000Z' },
            { _id: 'i2', url: 'https://example.com/2.png', caption: 'sheet2', uploadedAt: '2026-09-02T00:00:00.000Z' },
          ] } }),
        }
      }
      return {
        ok: true,
        json: async () => ({ data: payload({ responses: [{
          _id: 'r10', userId: { _id: 'u10', agentNumber: '555' },
          satTest: true, passedForRole: 'yes', resultImagesUploaded: 2,
        }] }) }),
      }
    })

    render(<MemoryRouter><CbatQuestionnaireResults /></MemoryRouter>)

    fireEvent.click(await screen.findByTestId('results-sheet-badge'))

    const modal = within(await screen.findByTestId('sheets-modal'))
    expect(await modal.findByText('1 / 2')).toBeInTheDocument()
    expect(modal.getByAltText('sheet1')).toHaveAttribute('src', 'https://example.com/1.png')

    fireEvent.click(modal.getByLabelText('Next image'))
    expect(await modal.findByText('2 / 2')).toBeInTheDocument()
    expect(modal.getByAltText('sheet2')).toHaveAttribute('src', 'https://example.com/2.png')

    // Wraps back round rather than stopping at the last image.
    fireEvent.click(modal.getByLabelText('Next image'))
    expect(await modal.findByText('1 / 2')).toBeInTheDocument()

    fireEvent.click(modal.getByText('Close'))
    expect(screen.queryByTestId('sheets-modal')).toBeNull()
  })

  it('reports a load failure inside the modal instead of a blank one', async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes('/cbat-results')) {
        return { ok: false, json: async () => ({ message: 'Could not load the score sheet' }) }
      }
      return {
        ok: true,
        json: async () => ({ data: payload({ responses: [{
          _id: 'r11', userId: { _id: 'u11', agentNumber: '556' },
          satTest: true, passedForRole: 'yes', resultImagesUploaded: 1,
        }] }) }),
      }
    })

    render(<MemoryRouter><CbatQuestionnaireResults /></MemoryRouter>)
    fireEvent.click(await screen.findByTestId('results-sheet-badge'))

    const modal = within(await screen.findByTestId('sheets-modal'))
    expect(await modal.findByText('Could not load the score sheet')).toBeInTheDocument()
  })
})

describe('CbatQuestionnaireResults — expandable answer cards', () => {
  const two = () => payload({ responses: [
    { _id: 'a1', userId: { _id: 'u1', agentNumber: '111' }, satTest: true, passedForRole: 'yes',
      gaps: 'First gap.', comment: 'First comment.' },
    { _id: 'a2', userId: { _id: 'u2', agentNumber: '222' }, satTest: true, passedForRole: 'no',
      gaps: 'Second gap.' },
  ] })
  const headerOf = async (name) =>
    within((await screen.findByText(name)).closest('[data-testid="results-answer-card"]'))
      .getByRole('button', { expanded: false })

  it('starts every card closed', async () => {
    mount(two())
    await screen.findByText('Agent 111')
    expect(screen.queryByTestId('results-answer-body')).toBeNull()
    expect(screen.queryByText('First gap.')).toBeNull()
  })

  it('opens and closes one card on click, leaving the others shut', async () => {
    mount(two())
    const header = await headerOf('Agent 111')

    fireEvent.click(header)
    expect(screen.getByText('First gap.')).toBeInTheDocument()
    expect(screen.getByText('First comment.')).toBeInTheDocument()
    expect(screen.queryByText('Second gap.')).toBeNull()
    expect(header).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(header)
    expect(screen.queryByText('First gap.')).toBeNull()
  })

  it('opens from the keyboard', async () => {
    mount(two())
    fireEvent.keyDown(await headerOf('Agent 222'), { key: 'Enter' })
    expect(screen.getByText('Second gap.')).toBeInTheDocument()
  })

  it('expands and collapses them all at once', async () => {
    mount(two())
    await expandAll()
    expect(screen.getAllByTestId('results-answer-body')).toHaveLength(2)
    expect(screen.getByTestId('results-toggle-all')).toHaveTextContent('Collapse all')

    fireEvent.click(screen.getByTestId('results-toggle-all'))
    expect(screen.queryByTestId('results-answer-body')).toBeNull()
  })

  it('opens the score sheet from a closed card without opening the card', async () => {
    global.fetch = vi.fn(async (url) => url.includes('/cbat-results')
      ? { ok: true, json: async () => ({ data: { images: [] } }) }
      : { ok: true, json: async () => ({ data: payload({ responses: [{
          _id: 'r12', userId: { _id: 'u12', agentNumber: '557' },
          satTest: true, passedForRole: 'yes', resultImagesUploaded: 1,
        }] }) }) })
    render(<MemoryRouter><CbatQuestionnaireResults /></MemoryRouter>)

    fireEvent.click(await screen.findByTestId('results-sheet-badge'))
    expect(await screen.findByTestId('sheets-modal')).toBeInTheDocument()
    expect(screen.queryByTestId('results-answer-body')).toBeNull()
  })
})

describe('CbatQuestionnaireResults — what they wrote', () => {
  it('keeps the gaps and the comment apart inside the card', async () => {
    mount(payload({ responses: [{
      _id: 'r9', userId: { agentNumber: '777' }, satTest: true, passedForRole: 'yes',
      gaps: 'A test we had not seen.', comment: 'Genuinely helped, thank you.',
    }] }))

    await expandAll()
    const body = within(screen.getByTestId('results-answer-body'))
    expect(body.getByText('What we did not prepare them for')).toBeInTheDocument()
    expect(body.getByText('A test we had not seen.')).toBeInTheDocument()
    expect(body.getByText('What they said')).toBeInTheDocument()
    expect(body.getByText('Genuinely helped, thank you.')).toBeInTheDocument()
  })

  // The page used to print each paragraph twice, once in a block above the
  // tabs and again on the person's row.
  it('prints each answer once, even when the summary carries it too', async () => {
    mount(payload({
      responses: [{
        _id: 'r9', userId: { agentNumber: '777' },
        satTest: true, passedForRole: 'yes', comment: 'One more thing.',
      }],
      summary: { comments: [{ comment: 'One more thing.', role: 'pilot', passedForRole: 'yes', agentNumber: '777' }] },
    }))

    await expandAll()
    expect(screen.getAllByText('One more thing.')).toHaveLength(1)
  })

  it('leaves the headings out when nobody wrote anything', async () => {
    mount(payload({ responses: [{ _id: 'r8', userId: { agentNumber: '1' }, satTest: true, passedForRole: 'yes' }] }))
    await expandAll()
    expect(screen.queryByText('What they said')).toBeNull()
    expect(screen.queryByText('What we did not prepare them for')).toBeNull()
  })
})

// A name on this page is somebody an admin has just read an opinion from, and
// the next question is always "who is this". It has a page already, so every
// name and every address opens it.
describe('CbatQuestionnaireResults — opening a profile', () => {
  const ProfileProbe = () => {
    const { pathname, state } = useLocation()
    return <div data-testid="profile-probe">{pathname} · {state?.backLabel}</div>
  }

  const mountRouted = (data) => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data }) }))
    return render(
      <MemoryRouter initialEntries={['/admin/cbat-questionnaire']}>
        <Routes>
          <Route path="/admin/cbat-questionnaire" element={<CbatQuestionnaireResults />} />
          <Route path="/agent/:id" element={<ProfileProbe />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('opens the profile from an answer row, and comes back here', async () => {
    mountRouted(payload({ responses: [{
      _id: 'r1', userId: { _id: 'u1', agentNumber: '777', email: 'a@example.com' },
      satTest: true, passedForRole: 'yes',
    }] }))

    fireEvent.click(await screen.findByText('Agent 777'))
    expect((await screen.findByTestId('profile-probe')).textContent)
      .toBe('/agent/u1 · Back to results')
  })

  it('opens it from the email too, because that is the half an admin may recognise', async () => {
    mountRouted(payload({ responses: [{
      _id: 'r1', userId: { _id: 'u1', agentNumber: '777', email: 'a@example.com' },
      satTest: true, passedForRole: 'yes',
    }] }))

    fireEvent.click(await screen.findByText('a@example.com'))
    expect((await screen.findByTestId('profile-probe')).textContent)
      .toBe('/agent/u1 · Back to results')
  })

  it('opens the profile from a closed card without opening it first', async () => {
    mountRouted(payload({ responses: [{
      _id: 'r1', userId: { _id: 'u7', agentNumber: '777' }, satTest: true, passedForRole: 'yes',
    }] }))

    fireEvent.click(await screen.findByText('Agent 777'))
    expect((await screen.findByTestId('profile-probe')).textContent)
      .toBe('/agent/u7 · Back to results')
  })

  it('leaves the name as plain text when the account behind it is gone', async () => {
    mountRouted(payload({ optedOut: [{
      userId: null, agentNumber: '1234567', email: 'gone@example.com',
      optedOutAt: '2026-09-01T00:00:00.000Z', reason: 'too_many_emails',
    }] }))

    fireEvent.click(await screen.findByTestId('results-tab-optouts'))
    const name = screen.getByText('Agent 1234567')
    expect(name.tagName).toBe('SPAN')
    expect(screen.queryByTestId('profile-probe')).toBeNull()
  })
})

// Where "← Admin" goes back to. The results page is only ever reached from the
// Potential CBAT Passers panel, or from the Questionnaires stat card that is a
// headline of this page — either way, the panel is the place to return to.
describe('CbatQuestionnaireResults — going back', () => {
  it('returns to Admin with the passers panel flagged to open', async () => {
    const AdminProbe = () => {
      const { state } = useLocation()
      return <div data-testid="admin-probe">{state?.openPassers ? 'passers-open' : 'plain'}</div>
    }
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: payload() }) }))
    render(
      <MemoryRouter initialEntries={['/admin/cbat-questionnaire']}>
        <Routes>
          <Route path="/admin/cbat-questionnaire" element={<CbatQuestionnaireResults />} />
          <Route path="/admin" element={<AdminProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByText('← Admin'))
    expect((await screen.findByTestId('admin-probe')).textContent).toBe('passers-open')
  })
})
