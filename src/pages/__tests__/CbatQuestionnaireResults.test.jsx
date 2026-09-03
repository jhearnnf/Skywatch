import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

const mount = (data) => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data }) }))
  return render(<MemoryRouter><CbatQuestionnaireResults /></MemoryRouter>)
}

beforeEach(() => { global.fetch = vi.fn() })
afterEach(() => { vi.restoreAllMocks() })

describe('CbatQuestionnaireResults — the funnel', () => {
  it('shows the send-to-finish funnel with rates', async () => {
    mount(payload())
    expect(await screen.findByText('Emailed')).toBeInTheDocument()
    expect(screen.getByText('70%')).toBeInTheDocument()  // opened
    expect(screen.getByText('30%')).toBeInTheDocument()  // finished
  })

  it('surfaces the free text above the tables', async () => {
    mount(payload({ summary: { gaps: [{ gaps: 'The SLT was a new format.', role: 'pilot', agentNumber: '999' }] } }))
    expect(await screen.findByText('The SLT was a new format.')).toBeInTheDocument()
    expect(screen.getByText(/Royal Air Force/)).toBeInTheDocument()
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
    expect(table.getByText('Passed')).toBeInTheDocument()
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

  it('reports a load failure instead of an empty page', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ message: 'nope' }) }))
    render(<MemoryRouter><CbatQuestionnaireResults /></MemoryRouter>)
    expect(await screen.findByText('nope')).toBeInTheDocument()
  })
})

describe('CbatQuestionnaireResults — comments', () => {
  it('shows what people said, apart from the gaps answers', async () => {
    mount(payload({ summary: {
      gaps:     [{ gaps: 'A test we had not seen.', role: 'pilot', agentNumber: '1' }],
      comments: [{ comment: 'Genuinely helped, thank you.', role: 'pilot', passedForRole: 'yes', agentNumber: '2' }],
    } }))

    expect(await screen.findByText('What we did not prepare them for')).toBeInTheDocument()
    expect(screen.getByText('What they said')).toBeInTheDocument()
    expect(screen.getByText('Genuinely helped, thank you.')).toBeInTheDocument()
  })

  it('hides the block when nobody wrote anything', async () => {
    mount(payload())
    await screen.findByText('Emailed')
    expect(screen.queryByText('What they said')).not.toBeInTheDocument()
  })

  it('shows a comment on the answer row it belongs to', async () => {
    mount(payload({ responses: [{
      _id: 'r9', userId: { agentNumber: '777' },
      satTest: true, passedForRole: 'yes', comment: 'One more thing.',
    }] }))
    const table = within(await screen.findByTestId('results-answers'))
    expect(table.getByText('One more thing.')).toBeInTheDocument()
  })
})
