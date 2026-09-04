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
let searchHits
let searchUrls
let settingsPatch
let savedSettings

function mockApi(data = cohort()) {
  sendBody = null
  searchHits = []
  searchUrls = []
  settingsPatch = null
  savedSettings = { cbatSurveyEmailSubject: 'Saved subject', cbatSurveyEnabled: true }
  global.fetch = vi.fn(async (url, opts = {}) => {
    if (String(url).includes('/search')) {
      searchUrls.push(String(url))
      return { ok: true, json: async () => ({ data: { users: searchHits, query: 'q' } }) }
    }
    if (String(url).includes('/send')) {
      sendBody = JSON.parse(opts.body)
      return { ok: true, json: async () => ({ data: { sentCount: 1, failedCount: 0, sent: ['a@example.com'], failed: [] } }) }
    }
    if (String(url).includes('/api/admin/settings')) {
      if ((opts.method ?? 'GET') === 'PATCH') {
        settingsPatch = JSON.parse(opts.body)
        return { ok: true, json: async () => ({ data: { settings: savedSettings } }) }
      }
      return { ok: true, json: async () => ({ data: { settings: savedSettings } }) }
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
  fireEvent.click(screen.getByText('Potential CBAT Passers Survey'))
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

  it('unticks everything without dropping the list', async () => {
    await open()
    // The load pre-ticks the server's batch, so there is something to clear.
    expect(screen.getByRole('checkbox', { name: /Select Agent/ })).toBeChecked()

    fireEvent.click(screen.getByTestId('cbat-passers-untick-all'))

    expect(screen.getByRole('checkbox', { name: /Select Agent/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: /Send bulk email \(0\)/ })).toBeDisabled()
    expect(screen.getByTestId('cbat-passers-untick-all')).toBeDisabled()
    // The row itself is untouched — this clears ticks, it does not reload.
    expect(screen.getByText('Agent 1234567')).toBeInTheDocument()
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

// The list is a bulk worklist built from thresholds. The search box is how an
// admin reaches one specific person the thresholds got wrong about, including
// the people who are deliberately kept out of every bulk send.
describe('CbatPassersSection — searching for someone specific', () => {
  const type = (text) =>
    fireEvent.change(screen.getByTestId('cbat-passers-search'), { target: { value: text } })

  it('does not search until there is something to search for', async () => {
    await open()
    type('a')
    await new Promise(r => setTimeout(r, 400))
    expect(searchUrls).toHaveLength(0)
  })

  it('searches once the typing settles, and shows the hit', async () => {
    searchHits = [person({ _id: 'u9', email: 'andreaspaschalis@gmail.com', excludedReason: 'named' })]
    await open()
    type('andreas')

    expect(await screen.findByText('andreaspaschalis@gmail.com')).toBeInTheDocument()
    expect(searchUrls).toHaveLength(1)
    expect(searchUrls[0]).toContain('q=andreas')
  })

  it('says why a hit is missing from the list above', async () => {
    searchHits = [person({ _id: 'u9', email: 'x@test.com', excludedReason: 'named' })]
    await open()
    type('x@test')

    expect(await screen.findByText(/do-not-contact list/)).toBeInTheDocument()
  })

  it('lets an excluded person be ticked and sent to', async () => {
    searchHits = [person({ _id: 'u9', email: 'x@test.com', excludedReason: 'named', mailable: true })]
    await open()
    type('x@test')
    await screen.findByText('x@test.com')

    const hits = screen.getByTestId('cbat-passers-search-results')
    fireEvent.click(within(hits).getByRole('checkbox'))

    fireEvent.click(screen.getByRole('button', { name: /Send bulk email \(2\)/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send now' }))

    await waitFor(() => expect(sendBody).not.toBeNull())
    expect(sendBody.userIds).toEqual(expect.arrayContaining(['u1', 'u9']))
  })

  it('keeps a ticked hit in the send after the search box is cleared', async () => {
    searchHits = [person({ _id: 'u9', email: 'x@test.com', excludedReason: 'named' })]
    await open()
    type('x@test')
    await screen.findByText('x@test.com')

    const hits = screen.getByTestId('cbat-passers-search-results')
    fireEvent.click(within(hits).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() =>
      expect(screen.queryByTestId('cbat-passers-search-results')).not.toBeInTheDocument())

    // Still going out, and still named on the confirmation.
    fireEvent.click(screen.getByRole('button', { name: /Send bulk email \(2\)/ }))
    expect(await screen.findByText(/Send to 2 people\?/)).toBeInTheDocument()
    expect(screen.getByText('x@test.com')).toBeInTheDocument()
  })

  it('marks an off-list recipient on the confirmation', async () => {
    searchHits = [person({ _id: 'u9', email: 'x@test.com', excludedReason: 'named' })]
    await open()
    type('x@test')
    await screen.findByText('x@test.com')
    fireEvent.click(within(screen.getByTestId('cbat-passers-search-results')).getByRole('checkbox'))

    fireEvent.click(screen.getByRole('button', { name: /Send bulk email/ }))
    await screen.findByText(/Send to 2 people\?/)
    expect(screen.getByText('Off list')).toBeInTheDocument()
  })

  it('will not let a blocked account be ticked', async () => {
    searchHits = [person({ _id: 'u9', email: 'gone@test.com', excludedReason: 'opted-out', mailable: false })]
    await open()
    type('gone@')
    await screen.findByText('gone@test.com')

    const hits = screen.getByTestId('cbat-passers-search-results')
    expect(within(hits).getByRole('checkbox')).toBeDisabled()
    expect(within(hits).getByText(/Unsubscribed/)).toBeInTheDocument()
  })

  it('says so when nobody matches', async () => {
    searchHits = []
    await open()
    type('nobody')
    expect(await screen.findByText(/Nobody matches/)).toBeInTheDocument()
  })
})

// ── The 2026-09-03 regression, from the admin's side ───────────────────────
//
// Fifty-one people were sent a link to http://localhost:5173. The panel gave no
// hint before the send that the links would be dead, and no hint afterwards
// that anyone was owed a working one. Both are now on screen.
describe('CbatPassersSection — a base URL that would be dead in the inbox', () => {
  it('says so and refuses to let the send be started', async () => {
    mockApi(cohort({ }))
    // The server reports the problem; the panel does not work it out itself.
    const withProblem = cohort()
    withProblem.linkProblem = 'CLIENT_URL points at this machine ("http://localhost:5173")'
    mockApi(withProblem)

    await open()

    expect(screen.getByTestId('cbat-passers-link-problem')).toHaveTextContent(/points at this machine/i)
    expect(screen.getByText(/Send bulk email/)).toBeDisabled()
    expect(screen.getByTestId('cbat-passers-test-send')).toBeDisabled()
  })

  it('leaves the send alone when the base URL is fine', async () => {
    const fine = cohort()
    fine.linkProblem = null
    mockApi(fine)

    await open()

    expect(screen.queryByTestId('cbat-passers-link-problem')).not.toBeInTheDocument()
    expect(screen.getByText(/Send bulk email/)).not.toBeDisabled()
  })
})

describe('CbatPassersSection — people owed a working link', () => {
  const owed = () => {
    const data = cohort({
      groups: [{
        day: '2026-08-04',
        users: [person({
          needsResend: true,
          mailable: true,
          invite: { sentAt: iso(Date.now() - DAY), brokenLinkAt: iso(Date.now() - DAY), sendCount: 1 },
        })],
      }],
      totals: { needsResend: 1, emailed: 1 },
    })
    return data
  }

  it('marks them in the list and counts them at the top', async () => {
    mockApi(owed())
    await open()

    expect(screen.getByTestId('cbat-passers-broken-badge')).toBeInTheDocument()
    expect(screen.getByTestId('cbat-passers-needs-resend'))
      .toHaveTextContent(/emailed a link that did not work/i)
  })

  // It used to preselect the apology whenever anyone was owed one. That made
  // the exceptional email the default and left the decision one un-read radio
  // button away from reaching the wrong half of the list.
  it('still starts on the normal invitation, even with people owed a resend', async () => {
    mockApi(owed())
    await open()

    expect(screen.getByTestId('cbat-passers-variant-standard')).toBeChecked()
    expect(screen.getByTestId('cbat-passers-variant-apology')).not.toBeChecked()
  })

  it('starts on the normal invitation when nobody is owed anything', async () => {
    await open()
    expect(screen.getByTestId('cbat-passers-variant-standard')).toBeChecked()
  })
})

describe('CbatPassersSection — choosing which email goes out', () => {
  it('sends the variant that is selected', async () => {
    await open()

    fireEvent.click(screen.getByTestId('cbat-passers-variant-apology'))
    fireEvent.click(screen.getByText(/Send bulk email/))
    fireEvent.click(await screen.findByText('Send now'))

    await waitFor(() => expect(sendBody).toBeTruthy())
    expect(sendBody.variant).toBe('apology')
  })

  it('names the chosen email on the confirmation, not just the recipients', async () => {
    await open()

    fireEvent.click(screen.getByTestId('cbat-passers-variant-apology'))
    fireEvent.click(screen.getByText(/Send bulk email/))

    expect(await screen.findByTestId('cbat-passers-confirm-variant'))
      .toHaveTextContent(/Apology and working link/i)
  })

  it('previews the variant that is selected', async () => {
    await open()

    fireEvent.click(screen.getByTestId('cbat-passers-variant-apology'))
    fireEvent.click(screen.getByText('Preview email'))

    await waitFor(() => {
      const previewCall = global.fetch.mock.calls
        .map(c => String(c[0])).find(u => u.includes('/preview'))
      expect(previewCall).toMatch(/variant=apology/)
    })
  })
})

// ── The settings this panel took over from Content ─────────────────────────
//
// The copy, the thresholds and the open/closed switch used to be a section of
// their own further up the page, a long way from the list of people they get
// sent to. Two variants made that worse: twelve near-identical boxes under one
// heading with nothing saying which half went to whom.
describe('CbatPassersSection — editing the wording in place', () => {
  it('opens the chosen template behind its pencil, without selecting it', async () => {
    await open()

    fireEvent.click(screen.getByTestId('cbat-passers-edit-apology'))

    const editor = await screen.findByTestId('cbat-passers-template-editor')
    expect(within(editor).getByText('Apology and working link')).toBeInTheDocument()
    // Reading the apology copy must not arm the apology send.
    expect(screen.getByTestId('cbat-passers-variant-standard')).toBeChecked()
  })

  it('loads what is currently saved rather than the built-in default', async () => {
    await open()

    fireEvent.click(screen.getByTestId('cbat-passers-edit-standard'))
    await screen.findByTestId('cbat-passers-template-editor')

    expect(await screen.findByDisplayValue('Saved subject')).toBeInTheDocument()
  })

  it('saves the six fields under the right keys, with a reason', async () => {
    await open()

    fireEvent.click(screen.getByTestId('cbat-passers-edit-apology'))
    await screen.findByTestId('cbat-passers-template-editor')
    fireEvent.click(await screen.findByTestId('cbat-passers-template-save'))

    await waitFor(() => expect(settingsPatch).toBeTruthy())
    expect(Object.keys(settingsPatch)).toEqual(expect.arrayContaining([
      'cbatSurveyApologyEmailSubject', 'cbatSurveyApologyEmailHeading',
      'cbatSurveyApologyEmailSubtitle', 'cbatSurveyApologyEmailBody',
      'cbatSurveyApologyEmailCta', 'cbatSurveyApologyEmailFooter',
    ]))
    expect(settingsPatch.reason).toBeTruthy()
  })

  it('saves the thresholds and the open switch together', async () => {
    await open()

    fireEvent.click(screen.getByTestId('cbat-passers-survey-enabled'))
    fireEvent.click(screen.getByTestId('cbat-passers-save-defaults'))

    await waitFor(() => expect(settingsPatch).toBeTruthy())
    expect(settingsPatch).toEqual(expect.objectContaining({
      cbatSurveyMinCompletions: 10,
      cbatSurveyDormantDays: 21,
      cbatSurveyEnabled: false,
    }))
  })

  it('reflects the saved open/closed switch on load', async () => {
    const closed = cohort()
    closed.surveyEnabled = false
    mockApi(closed)

    await open()
    expect(screen.getByTestId('cbat-passers-survey-enabled')).not.toBeChecked()
  })
})
