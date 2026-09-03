import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import CbatPassersSection from '../CbatPassersSection'

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ apiFetch: (...a) => fetch(...a) }),
}))

const DAY = 24 * 60 * 60 * 1000
const iso = (ms) => new Date(ms).toISOString()

const person = (over = {}) => ({
  _id: over._id ?? 'u1',
  agentNumber: '1234567',
  displayName: null,
  email: 'a@example.com',
  isTester: false,
  cbatPassed: false,
  completions: 14,
  lastPlayedAt: iso(Date.now() - 30 * DAY),
  lastActivityAt: iso(Date.now() - 30 * DAY),
  daysDormant: 30,
  band: 'ready',
  invite: null,
  mailable: true,
  ...over,
})

const cohort = (over = {}) => ({
  thresholds: { minCompletions: 10, dormantDays: 21, warmBandDays: 14 },
  batchSize: 50,
  groups: over.groups ?? [
    { day: '2026-08-04', users: [person()] },
  ],
  totals: {
    candidates: 1, ready: 1, warm: 0, emailed: 0, responded: 0, deferred: 0, remaining: 1,
    ...(over.totals ?? {}),
  },
  nextBatchIds: over.nextBatchIds ?? ['u1'],
})

let sendBody

function mockApi(data = cohort()) {
  sendBody = null
  global.fetch = vi.fn(async (url, opts = {}) => {
    if (String(url).includes('/send')) {
      sendBody = JSON.parse(opts.body)
      return { ok: true, json: async () => ({ data: { sentCount: 1, failedCount: 0, sent: ['a@example.com'], failed: [] } }) }
    }
    if (String(url).includes('/preview')) {
      return { ok: true, json: async () => ({ data: { subject: 'How did your CBAT go?', html: '<p>hi</p>', recipient: { _id: 'u1', email: 'a@example.com', name: 'Agent 1234567' }, isPlaceholder: false, link: 'https://skywatch.academy/survey/tok' } }) }
    }
    return { ok: true, json: async () => ({ data }) }
  })
}

// The section links out to the results page, so it needs a router around it.
// The stand-in route lets a test assert the navigation actually happened.
const open = async () => {
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<CbatPassersSection API="" />} />
        <Route path="/admin/cbat-questionnaire" element={<div data-testid="results-page" />} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByText('Potential CBAT Passers'))
  await screen.findByText('Agent 1234567')
}

beforeEach(() => { mockApi() })
afterEach(() => { vi.restoreAllMocks() })

describe('CbatPassersSection — the list', () => {
  it('groups candidates under the day of their last finished run', async () => {
    await open()
    expect(screen.getByText(/Tue, 4 Aug 2026/)).toBeInTheDocument()
    expect(screen.getByText('Agent 1234567')).toBeInTheDocument()
    expect(screen.getByText('14 games')).toBeInTheDocument()
    expect(screen.getByText('30d quiet')).toBeInTheDocument()
  })

  it('marks an already-emailed account and refuses to select it again', async () => {
    mockApi(cohort({
      groups: [{ day: '2026-08-04', users: [person({
        invite: { sentAt: iso(Date.now() - 3 * DAY), openedAt: null, completedAt: null, optedOutAt: null, sendError: null, deferredUntil: null, sendCount: 1 },
        mailable: false,
      })] }],
      nextBatchIds: [],
      totals: { emailed: 1, remaining: 0 },
    }))
    await open()

    expect(screen.getByRole('checkbox', { name: /Select Agent/ })).toBeDisabled()
    expect(screen.getByText(/^✓/)).toBeInTheDocument()
    // Nothing left to send, so the button cannot fire.
    expect(screen.getByRole('button', { name: /Send bulk email/ })).toBeDisabled()
  })

  it('shows a failed send as retryable rather than done', async () => {
    mockApi(cohort({
      groups: [{ day: '2026-08-04', users: [person({
        invite: { sentAt: null, openedAt: null, completedAt: null, optedOutAt: null, sendError: 'no id returned', deferredUntil: null, sendCount: 0 },
        mailable: true,
      })] }],
    }))
    await open()

    expect(screen.getByText(/⚠ Failed/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Select Agent/ })).not.toBeDisabled()
  })

  it('shows when a deferred candidate sits their test, and holds them back', async () => {
    const sitting = Date.now() + 40 * DAY
    mockApi(cohort({
      groups: [{ day: '2026-08-04', users: [person({
        invite: { sentAt: iso(Date.now() - 5 * DAY), openedAt: iso(Date.now() - 5 * DAY), completedAt: null, optedOutAt: null, sendError: null, deferredUntil: iso(sitting), sendCount: 1 },
        mailable: false,
      })] }],
      nextBatchIds: [],
      totals: { deferred: 1, remaining: 0 },
    }))
    await open()

    expect(screen.getByText(/^Sits /)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Select Agent/ })).toBeDisabled()
  })

  it('flags a deferral that has run out as due a follow-up', async () => {
    mockApi(cohort({
      groups: [{ day: '2026-08-04', users: [person({
        invite: { sentAt: iso(Date.now() - 90 * DAY), openedAt: null, completedAt: null, optedOutAt: null, sendError: null, deferredUntil: iso(Date.now() - DAY), sendCount: 1 },
        mailable: true,
      })] }],
    }))
    await open()

    expect(screen.getByText('Due a follow-up')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Select Agent/ })).not.toBeDisabled()
  })

  it('marks a warm-band candidate as too soon', async () => {
    mockApi(cohort({
      groups: [{ day: '2026-08-04', users: [person({ band: 'warm', daysDormant: 16 })] }],
      nextBatchIds: [],
    }))
    await open()
    expect(screen.getByText('Too soon')).toBeInTheDocument()
  })
})

describe('CbatPassersSection — sending', () => {
  it('preselects the batch the server chose', async () => {
    await open()
    expect(screen.getByRole('checkbox', { name: /Select Agent/ })).toBeChecked()
    expect(screen.getByRole('button', { name: /Send bulk email \(1\)/ })).toBeInTheDocument()
  })

  it('names every recipient before anything is sent', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: /Send bulk email/ }))

    const dialog = await screen.findByText(/Send to 1 person\?/)
    expect(dialog).toBeInTheDocument()
    // Still nothing sent — the confirmation is the gate.
    expect(sendBody).toBeNull()
  })

  it('sends only after the confirmation is accepted', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: /Send bulk email/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send now' }))

    await waitFor(() => expect(sendBody).toEqual(expect.objectContaining({ userIds: ['u1'] })))
    expect(await screen.findByText(/Sent 1 email\./)).toBeInTheDocument()
  })

  it('cancelling the confirmation sends nothing', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: /Send bulk email/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByText(/Send to 1 person\?/)).not.toBeInTheDocument())
    expect(sendBody).toBeNull()
  })

  it('a deselected person is left out of the send', async () => {
    await open()
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Agent/ })) // deselect
    expect(screen.getByRole('button', { name: /Send bulk email \(0\)/ })).toBeDisabled()
  })

  it('previews the real email before sending', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Preview email' }))

    const heading = await screen.findByText('Email preview')
    const modal = heading.closest('div').parentElement
    expect(within(modal).getByText(/How did your CBAT go\?/)).toBeInTheDocument()
    expect(sendBody).toBeNull() // previewing is not sending
  })
})

describe('CbatPassersSection — finding the results', () => {
  it('links to the results page from beside the send button', async () => {
    await open()
    fireEvent.click(screen.getByTestId('cbat-passers-results-link'))
    expect(await screen.findByTestId('results-page')).toBeInTheDocument()
  })
})
