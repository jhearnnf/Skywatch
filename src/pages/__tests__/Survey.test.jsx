import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Survey from '../Survey'

// The questionnaire is public and identifies the respondent by the token in the
// URL, so the only things it needs from context are the API base and a fetch.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ API: '', apiFetch: (...a) => fetch(...a) }),
}))

vi.mock('../../components/SEO', () => ({ default: () => null }))

const TOKEN = 'a'.repeat(64)

// Minimal shape of GET /api/survey/:token.
const meta = (over = {}) => ({
  name: 'Falcon',
  closed: false,
  optedOut: false,
  completed: false,
  roleGroups: [
    { service: 'Royal Air Force', roles: [{ key: 'pilot', label: 'Pilot' }, { key: 'wso', label: 'Weapon Systems Officer (WSO)' }] },
    { service: 'Royal Canadian Air Force', roles: [{ key: 'rcaf-pilot', label: 'Pilot' }] },
    { service: 'Something else', roles: [{ key: 'other', label: "My role isn't listed" }] },
  ],
  response: null,
  ...over,
})

let patches

function mockApi(over = {}) {
  patches = []
  global.fetch = vi.fn(async (url, opts = {}) => {
    if (opts.method === 'PATCH') {
      const body = JSON.parse(opts.body)
      patches.push(body)
      return {
        ok: true,
        json: async () => ({
          data: { badgeAwarded: body.passedForRole === 'yes' || body.passedAnyRole === 'yes' },
        }),
      }
    }
    return { ok: true, json: async () => ({ data: meta(over) }) }
  })
}

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/survey/:token" element={<Survey />} />
      </Routes>
    </MemoryRouter>,
  )

const renderSurvey = () => renderAt(`/survey/${TOKEN}`)
const renderPreview = () => renderAt('/survey/preview')

// Answers auto-advance behind a short timeout so the tap registers visibly.
// Real timers rather than fake ones: the cards animate in and out through
// framer-motion, whose own scheduling does not survive a mocked clock, and the
// delay being waited on here is a fifth of a second.
const advance = async () => {
  await act(async () => { await new Promise(r => setTimeout(r, 320)) })
}

beforeEach(() => { mockApi() })
afterEach(() => { vi.restoreAllMocks() })

describe('Survey — loading and gating', () => {
  it('greets the recipient by name', async () => {
    renderSurvey()
    expect(await screen.findByTestId('survey-intro')).toBeInTheDocument()
    expect(screen.getByText(/Hello Falcon/)).toBeInTheDocument()
  })

  it('shows a closed notice when the questionnaire has been turned off', async () => {
    mockApi({ closed: true })
    renderSurvey()
    expect(await screen.findByTestId('survey-closed')).toBeInTheDocument()
  })

  it('shows the unsubscribed notice when already opted out', async () => {
    mockApi({ optedOut: true })
    renderSurvey()
    expect(await screen.findByText(/unsubscribed/i)).toBeInTheDocument()
  })

  it('reports an invalid link rather than an empty form', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ message: 'This questionnaire link is not valid.' }) }))
    renderSurvey()
    expect(await screen.findByTestId('survey-error')).toBeInTheDocument()
  })
})

describe('Survey — the "not yet" branch', () => {
  const sayNotYet = async () => {
    fireEvent.click(await screen.findByTestId('survey-start'))
    fireEvent.click(await screen.findByTestId('survey-sat-no'))
    await advance()
    return screen.findByTestId('survey-booked')
  }

  it('asks when the test is booked rather than ending there', async () => {
    renderSurvey()
    await sayNotYet()

    // Not the questionnaire proper: no role question and no donation ask.
    expect(screen.queryByTestId('survey-role-picker')).not.toBeInTheDocument()
    expect(screen.queryByTestId('survey-donate')).not.toBeInTheDocument()
  })

  it('records a date they give and promises not to ask before it', async () => {
    mockApi()
    global.fetch = vi.fn(async (url, opts = {}) => {
      if (opts.method === 'PATCH') {
        patches.push(JSON.parse(opts.body))
        return { ok: true, json: async () => ({ data: { deferredUntil: '2026-12-19T00:00:00.000Z' } }) }
      }
      return { ok: true, json: async () => ({ data: meta() }) }
    })

    renderSurvey()
    await sayNotYet()

    fireEvent.change(screen.getByTestId('survey-booked-date'), { target: { value: '2026-12-12' } })
    fireEvent.click(screen.getByTestId('survey-booked-submit'))
    await advance()

    await waitFor(() => expect(patches).toContainEqual(
      expect.objectContaining({ testBookedFor: '2026-12-12' }),
    ))
    expect(await screen.findByTestId('survey-notyet')).toBeInTheDocument()
    // The promise on screen names the date the server actually enforces.
    expect(screen.getByText(/19 December 2026/)).toBeInTheDocument()
  })

  it('accepts "not booked yet" as a real answer', async () => {
    renderSurvey()
    await sayNotYet()

    fireEvent.click(screen.getByTestId('survey-booked-unknown'))
    await advance()

    await waitFor(() => expect(patches).toContainEqual(
      expect.objectContaining({ testBookedUnknown: true }),
    ))
    expect(await screen.findByTestId('survey-notyet')).toBeInTheDocument()
  })

  it('lets them decline to say, and still ends warmly', async () => {
    renderSurvey()
    await sayNotYet()

    fireEvent.click(screen.getByTestId('survey-booked-skip'))
    await advance()
    expect(await screen.findByTestId('survey-notyet')).toBeInTheDocument()
    expect(screen.queryByTestId('survey-donate')).not.toBeInTheDocument()
  })

  it('cannot save a date until one is chosen', async () => {
    renderSurvey()
    await sayNotYet()
    expect(screen.getByTestId('survey-booked-submit')).toBeDisabled()
  })
})

describe('Survey — the main path', () => {
  const startAndSit = async () => {
    fireEvent.click(await screen.findByTestId('survey-start'))
    fireEvent.click(await screen.findByTestId('survey-sat-yes'))
    await advance()
  }

  it('saves every answer as it is given, not only at the end', async () => {
    renderSurvey()
    await startAndSit()
    await waitFor(() => expect(patches).toContainEqual(expect.objectContaining({ satTest: true })))

    fireEvent.click(await screen.findByTestId('survey-role-pilot'))
    await advance()
    await waitFor(() => expect(patches).toContainEqual(expect.objectContaining({ role: 'pilot' })))

    fireEvent.click(await screen.findByTestId('survey-passed-yes'))
    await advance()
    // Someone who quits here has still told us the thing that matters most.
    await waitFor(() => expect(patches).toContainEqual(expect.objectContaining({ passedForRole: 'yes' })))
  })

  it('asks about other roles only after a "no"', async () => {
    renderSurvey()
    await startAndSit()
    fireEvent.click(await screen.findByTestId('survey-role-pilot'))
    await advance()

    fireEvent.click(await screen.findByTestId('survey-passed-no'))
    await advance()
    expect(await screen.findByTestId('survey-any-yes')).toBeInTheDocument()
  })

  it('skips the other-roles question after a "yes"', async () => {
    renderSurvey()
    await startAndSit()
    fireEvent.click(await screen.findByTestId('survey-role-pilot'))
    await advance()

    fireEvent.click(await screen.findByTestId('survey-passed-yes'))
    await advance()
    expect(screen.queryByTestId('survey-any-yes')).not.toBeInTheDocument()
    expect(await screen.findByTestId('survey-realism-5')).toBeInTheDocument()
  })

  it('reaches the thank-you and marks the run complete', async () => {
    renderSurvey()
    await startAndSit()
    fireEvent.click(await screen.findByTestId('survey-role-pilot'));     await advance()
    fireEvent.click(await screen.findByTestId('survey-passed-yes'));     await advance()
    fireEvent.click(await screen.findByTestId('survey-realism-4'));      await advance()
    fireEvent.click(await screen.findByTestId('survey-helped-5'));       await advance()
    fireEvent.click(await screen.findByTestId('survey-gaps-submit'));    await advance()

    expect(await screen.findByTestId('survey-done')).toBeInTheDocument()
    await waitFor(() => expect(patches.at(-1)).toEqual(expect.objectContaining({ complete: true })))
  })

  it('celebrates the pass before it asks for anything', async () => {
    renderSurvey()
    await startAndSit()
    fireEvent.click(await screen.findByTestId('survey-role-pilot'));  await advance()
    fireEvent.click(await screen.findByTestId('survey-passed-yes'));  await advance()
    fireEvent.click(await screen.findByTestId('survey-realism-4'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-helped-5'));    await advance()
    fireEvent.click(await screen.findByTestId('survey-gaps-submit')); await advance()

    const badge = await screen.findByTestId('survey-badge')
    const donate = screen.getByTestId('survey-donate')
    // The reward has to precede the ask in the document, not merely exist.
    expect(badge.compareDocumentPosition(donate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows no badge when they did not pass', async () => {
    renderSurvey()
    await startAndSit()
    fireEvent.click(await screen.findByTestId('survey-role-pilot'));  await advance()
    fireEvent.click(await screen.findByTestId('survey-passed-no'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-any-no'));      await advance()
    fireEvent.click(await screen.findByTestId('survey-realism-2'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-helped-3'));    await advance()
    fireEvent.click(await screen.findByTestId('survey-gaps-submit')); await advance()

    expect(await screen.findByTestId('survey-done')).toBeInTheDocument()
    expect(screen.queryByTestId('survey-badge')).not.toBeInTheDocument()
  })

  it('lets the free-text question be skipped', async () => {
    renderSurvey()
    await startAndSit()
    fireEvent.click(await screen.findByTestId('survey-role-pilot'));  await advance()
    fireEvent.click(await screen.findByTestId('survey-passed-yes'));  await advance()
    fireEvent.click(await screen.findByTestId('survey-realism-4'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-helped-5'));    await advance()

    fireEvent.click(await screen.findByText('Skip this'))
    await advance()
    expect(await screen.findByTestId('survey-done')).toBeInTheDocument()
  })

  it('declining the donation is not a dead end', async () => {
    renderSurvey()
    await startAndSit()
    fireEvent.click(await screen.findByTestId('survey-role-pilot'));  await advance()
    fireEvent.click(await screen.findByTestId('survey-passed-yes'));  await advance()
    fireEvent.click(await screen.findByTestId('survey-realism-4'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-helped-5'));    await advance()
    fireEvent.click(await screen.findByTestId('survey-gaps-submit')); await advance()

    fireEvent.click(await screen.findByText('Not this time'))
    expect(await screen.findByTestId('survey-declined')).toBeInTheDocument()
  })
})

describe('Survey — the role picker', () => {
  const toRole = async () => {
    fireEvent.click(await screen.findByTestId('survey-start'))
    fireEvent.click(await screen.findByTestId('survey-sat-yes'))
    await advance()
    return screen.findByTestId('survey-role-picker')
  }

  it('filters by role name across every service', async () => {
    renderSurvey()
    await toRole()
    fireEvent.change(screen.getByTestId('survey-role-search'), { target: { value: 'pilot' } })

    expect(screen.getByTestId('survey-role-pilot')).toBeInTheDocument()
    expect(screen.getByTestId('survey-role-rcaf-pilot')).toBeInTheDocument()
    expect(screen.queryByTestId('survey-role-wso')).not.toBeInTheDocument()
  })

  it('filters by service, so "canadian" finds the RCAF roles', async () => {
    renderSurvey()
    await toRole()
    fireEvent.change(screen.getByTestId('survey-role-search'), { target: { value: 'canadian' } })

    expect(screen.getByTestId('survey-role-rcaf-pilot')).toBeInTheDocument()
    expect(screen.queryByTestId('survey-role-wso')).not.toBeInTheDocument()
  })

  it('asks for the role in words when "other" is chosen, and does not advance early', async () => {
    renderSurvey()
    await toRole()
    fireEvent.click(screen.getByTestId('survey-role-other'))
    await advance()

    // Still on the role question — the typed answer is the answer.
    const input = await screen.findByTestId('survey-role-other-input')
    expect(screen.queryByTestId('survey-passed-yes')).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'Air Load Master, RAAF' } })
    fireEvent.click(screen.getByTestId('survey-role-other-submit'))
    await advance()

    await waitFor(() => expect(patches).toContainEqual(
      expect.objectContaining({ role: 'other', roleOther: 'Air Load Master, RAAF' }),
    ))
    expect(await screen.findByTestId('survey-passed-yes')).toBeInTheDocument()
  })
})

describe('Survey — progress and going back', () => {
  it('states the length from the first question', async () => {
    renderSurvey()
    fireEvent.click(await screen.findByTestId('survey-start'))
    expect(await screen.findByText('1 of 6')).toBeInTheDocument()
  })

  it('lets a wrong answer be corrected', async () => {
    renderSurvey()
    fireEvent.click(await screen.findByTestId('survey-start'))
    fireEvent.click(await screen.findByTestId('survey-sat-yes'))
    await advance()
    await screen.findByTestId('survey-role-picker')

    fireEvent.click(screen.getByText('← Back'))
    await waitFor(() => expect(screen.getByTestId('survey-sat-yes')).toBeInTheDocument())
  })
})

describe('Survey — the /survey/preview demo', () => {
  it('renders without asking the server for anything', async () => {
    renderPreview()
    expect(await screen.findByTestId('survey-intro')).toBeInTheDocument()
    expect(screen.getByTestId('survey-preview-banner')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('walks the whole questionnaire without saving a single answer', async () => {
    renderPreview()
    fireEvent.click(await screen.findByTestId('survey-start'))
    fireEvent.click(await screen.findByTestId('survey-sat-yes'));      await advance()
    fireEvent.click(await screen.findByTestId('survey-role-pilot'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-passed-yes'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-realism-4'));    await advance()
    fireEvent.click(await screen.findByTestId('survey-helped-5'));     await advance()
    fireEvent.click(await screen.findByTestId('survey-gaps-submit'));  await advance()

    expect(await screen.findByTestId('survey-done')).toBeInTheDocument()
    expect(patches).toHaveLength(0)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('still shows the earned badge, worked out locally', async () => {
    renderPreview()
    fireEvent.click(await screen.findByTestId('survey-start'))
    fireEvent.click(await screen.findByTestId('survey-sat-yes'));      await advance()
    fireEvent.click(await screen.findByTestId('survey-role-pilot'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-passed-yes'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-realism-4'));    await advance()
    fireEvent.click(await screen.findByTestId('survey-helped-5'));     await advance()
    fireEvent.click(await screen.findByTestId('survey-gaps-submit'));  await advance()

    expect(await screen.findByTestId('survey-badge')).toBeInTheDocument()
  })

  it('shows a deferral date on the "not yet" branch', async () => {
    renderPreview()
    fireEvent.click(await screen.findByTestId('survey-start'))
    fireEvent.click(await screen.findByTestId('survey-sat-no'))
    await advance()
    fireEvent.click(await screen.findByTestId('survey-booked-unknown'))
    await advance()

    expect(await screen.findByTestId('survey-notyet')).toBeInTheDocument()
    expect(screen.getByText(/We will not ask about this again before/)).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('never opens a Stripe session from the donation button', async () => {
    renderPreview()
    fireEvent.click(await screen.findByTestId('survey-start'))
    fireEvent.click(await screen.findByTestId('survey-sat-yes'));      await advance()
    fireEvent.click(await screen.findByTestId('survey-role-pilot'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-passed-yes'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-realism-4'));    await advance()
    fireEvent.click(await screen.findByTestId('survey-helped-5'));     await advance()
    fireEvent.click(await screen.findByTestId('survey-gaps-submit'));  await advance()

    fireEvent.click(await screen.findByTestId('survey-donate-submit'))

    expect(await screen.findByTestId('survey-donate-note')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('Survey — the last question follows from the realism rating', () => {
  // Walk to the free-text question having given `rating` on question 4.
  const reachGaps = async (rating) => {
    renderSurvey()
    fireEvent.click(await screen.findByTestId('survey-start'))
    fireEvent.click(await screen.findByTestId('survey-sat-yes'));            await advance()
    fireEvent.click(await screen.findByTestId('survey-role-pilot'));         await advance()
    fireEvent.click(await screen.findByTestId('survey-passed-yes'));         await advance()
    fireEvent.click(await screen.findByTestId(`survey-realism-${rating}`));  await advance()
    fireEvent.click(await screen.findByTestId('survey-helped-4'));           await advance()
    return screen.findByTestId('survey-gaps')
  }

  it('asks what was DIFFERENT after "nothing like it"', async () => {
    const card = await reachGaps(1)
    expect(card).toHaveAttribute('data-variant', 'low')
    expect(screen.getByText('What was different?')).toBeInTheDocument()
    // Never the generic prompt: they have already told us it did not match.
    expect(screen.queryByText(/anything we did not prepare you for/i)).not.toBeInTheDocument()
  })

  it('asks what was different after "a little similar" too', async () => {
    const card = await reachGaps(2)
    expect(card).toHaveAttribute('data-variant', 'low')
  })

  it('asks what did not match after "fairly close"', async () => {
    const card = await reachGaps(3)
    expect(card).toHaveAttribute('data-variant', 'mid')
    expect(screen.getByText('What did not match?')).toBeInTheDocument()
  })

  it('asks what was MISSING after "very close"', async () => {
    const card = await reachGaps(4)
    expect(card).toHaveAttribute('data-variant', 'high')
    expect(screen.getByText(/anything we did not prepare you for/i)).toBeInTheDocument()
  })

  it('asks what was missing after "almost identical"', async () => {
    const card = await reachGaps(5)
    expect(card).toHaveAttribute('data-variant', 'high')
  })

  it('saves to the same field whichever wording was shown', async () => {
    await reachGaps(1)
    fireEvent.change(screen.getByTestId('survey-gaps-input'), {
      target: { value: 'The SLT was a completely different format.' },
    })
    fireEvent.click(screen.getByTestId('survey-gaps-submit'))
    await advance()

    await waitFor(() => expect(patches).toContainEqual(
      expect.objectContaining({ gaps: 'The SLT was a completely different format.' }),
    ))
  })
})

describe('Survey — the donation ladder', () => {
  const reachDone = async () => {
    renderSurvey()
    fireEvent.click(await screen.findByTestId('survey-start'))
    fireEvent.click(await screen.findByTestId('survey-sat-yes'));      await advance()
    fireEvent.click(await screen.findByTestId('survey-role-pilot'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-passed-yes'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-realism-4'));    await advance()
    fireEvent.click(await screen.findByTestId('survey-helped-5'));     await advance()
    fireEvent.click(await screen.findByTestId('survey-gaps-submit'));  await advance()
    return screen.findByTestId('survey-done')
  }

  it('offers three amounts, stopping at the figure the copy names', async () => {
    await reachDone()
    expect(screen.getByTestId('survey-donate-3')).toBeInTheDocument()
    expect(screen.getByTestId('survey-donate-5')).toBeInTheDocument()
    expect(screen.getByTestId('survey-donate-10')).toBeInTheDocument()
    // £20 would sit beside a sentence that says "a one-off £3".
    expect(screen.queryByTestId('survey-donate-20')).not.toBeInTheDocument()
  })

  it('preselects the amount the copy promises', async () => {
    await reachDone()
    expect(screen.getByTestId('survey-donate-3')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Give £3' })).toBeInTheDocument()
  })

  it('sends a bigger giver to the full donate page rather than capping them', async () => {
    await reachDone()
    const other = screen.getByTestId('survey-donate-other')
    expect(other).toHaveAttribute('href', '/donate')
  })
})
