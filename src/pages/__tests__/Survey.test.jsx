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
  resultImages: [],
  ...over,
})

let patches

// Sheets the fake server is holding for this run. Module level so a test can
// assert what the upload and delete calls actually did to it.
let sheets

function mockApi(over = {}) {
  patches = []
  sheets  = []
  global.fetch = vi.fn(async (url, opts = {}) => {
    if (String(url).includes('/cbat-result')) {
      if (opts.method === 'DELETE') {
        const id = String(url).split('/').pop()
        sheets = sheets.filter(x => x._id !== id)
      } else {
        sheets = [...sheets, { _id: `s${sheets.length + 1}`, url: 'https://cdn/sheet.jpg' }]
      }
      return { ok: true, json: async () => ({ data: { images: sheets } }) }
    }
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

// Step over the score sheet ask, which sits between the last question and the
// thank-you for anyone who has a result. It has its own describe block below;
// every other walk in this file is about what happens on either side of it, so
// they pass through rather than exercise it. A no-op when the step was skipped
// for this run (a "waiting" answer), which is what keeps one helper usable in
// walks that take different branches.
// Waits rather than looks. AnimatePresence runs in "wait" mode, so the outgoing
// card has to finish exiting before this one mounts, which lands past the 320ms
// `advance` allows. A bare query would find nothing, skip nothing, and strand
// the walk on this screen.
const skipSheet = async () => {
  let skip
  try {
    skip = await screen.findByTestId('survey-upload-skip', {}, { timeout: 1500 })
  } catch {
    return // this branch was never offered the ask
  }
  fireEvent.click(skip)
  await advance()
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
    await skipSheet()

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
    await skipSheet()

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
    await skipSheet()

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
    await skipSheet()
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
    await skipSheet()

    fireEvent.click(await screen.findByText('Not this time'))
    expect(await screen.findByTestId('survey-declined')).toBeInTheDocument()
  })
})

describe('Survey — the Google Play ask', () => {
  // Walk to the closing screen, with the answers that matter to this ask left
  // open: it must not depend on either of them.
  const finish = async ({ passed = 'yes', helped = 5 } = {}) => {
    fireEvent.click(await screen.findByTestId('survey-start'))
    fireEvent.click(await screen.findByTestId('survey-sat-yes'));           await advance()
    fireEvent.click(await screen.findByTestId('survey-role-pilot'));        await advance()
    fireEvent.click(await screen.findByTestId(`survey-passed-${passed}`));   await advance()
    if (passed === 'no') {
      fireEvent.click(await screen.findByTestId('survey-any-no'));          await advance()
    }
    fireEvent.click(await screen.findByTestId('survey-realism-4'));         await advance()
    fireEvent.click(await screen.findByTestId(`survey-helped-${helped}`));   await advance()
    fireEvent.click(await screen.findByTestId('survey-gaps-submit'));       await advance()
    await skipSheet()
    return screen.findByTestId('survey-done')
  }

  it('never sits next to the donation', async () => {
    mockApi({ usedAndroid: true })
    renderSurvey()
    await finish()
    expect(screen.getByTestId('survey-donate')).toBeInTheDocument()
    expect(screen.queryByTestId('survey-play-review')).not.toBeInTheDocument()
  })

  it('takes the place of the donation once that is turned down', async () => {
    mockApi({ usedAndroid: true })
    renderSurvey()
    await finish()
    fireEvent.click(await screen.findByText('Not this time'))

    const card = await screen.findByTestId('survey-play-review')
    expect(card).toBeInTheDocument()
    expect(screen.getByTestId('survey-play-review-link')).toHaveAttribute(
      'href', 'https://play.google.com/store/apps/details?id=academy.skywatch.app',
    )
  })

  it('stays away from someone who has only ever used the website', async () => {
    mockApi({ usedAndroid: false })
    renderSurvey()
    await finish()
    fireEvent.click(await screen.findByText('Not this time'))

    expect(await screen.findByTestId('survey-declined')).toBeInTheDocument()
    expect(screen.queryByTestId('survey-play-review')).not.toBeInTheDocument()
  })

  // The one that keeps the listing safe. Showing the store link only to happy
  // respondents is review gating, which Play prohibits.
  it('asks the same of someone who failed and rated us 1', async () => {
    mockApi({ usedAndroid: true })
    renderSurvey()
    await finish({ passed: 'no', helped: 1 })
    fireEvent.click(await screen.findByText('Not this time'))

    expect(await screen.findByTestId('survey-play-review')).toBeInTheDocument()
  })

  it('records the click through to the store', async () => {
    mockApi({ usedAndroid: true })
    renderSurvey()
    await finish()
    fireEvent.click(await screen.findByText('Not this time'))
    fireEvent.click(await screen.findByTestId('survey-play-review-link'))

    await waitFor(() => expect(patches).toContainEqual(
      expect.objectContaining({ playReviewClicked: true }),
    ))
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
    await skipSheet()

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
    await skipSheet()

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
    await skipSheet()

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
    await skipSheet()
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

describe('Survey — the closing comment box', () => {
  const reachDone = async () => {
    renderSurvey()
    fireEvent.click(await screen.findByTestId('survey-start'))
    fireEvent.click(await screen.findByTestId('survey-sat-yes'));      await advance()
    fireEvent.click(await screen.findByTestId('survey-role-pilot'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-passed-yes'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-realism-4'));    await advance()
    fireEvent.click(await screen.findByTestId('survey-helped-5'));     await advance()
    fireEvent.click(await screen.findByTestId('survey-gaps-submit'));  await advance()
    await skipSheet()
    return screen.findByTestId('survey-done')
  }

  it('starts closed so it does not compete with the donation ask', async () => {
    await reachDone()
    expect(screen.getByTestId('survey-comment-open')).toBeInTheDocument()
    expect(screen.queryByTestId('survey-comment-input')).not.toBeInTheDocument()
  })

  it('sits below the donation, not in front of it', async () => {
    await reachDone()
    const donate = screen.getByTestId('survey-donate')
    const comment = screen.getByTestId('survey-comment-open')
    expect(donate.compareDocumentPosition(comment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('saves what they wrote', async () => {
    await reachDone()
    fireEvent.click(screen.getByTestId('survey-comment-open'))
    fireEvent.change(await screen.findByTestId('survey-comment-input'), {
      target: { value: 'The DPT drills carried me.' },
    })
    fireEvent.click(screen.getByTestId('survey-comment-submit'))

    await waitFor(() => expect(patches).toContainEqual(
      expect.objectContaining({ comment: 'The DPT drills carried me.' }),
    ))
    expect(await screen.findByTestId('survey-comment-thanks')).toBeInTheDocument()
  })

  it('cannot send an empty comment', async () => {
    await reachDone()
    fireEvent.click(screen.getByTestId('survey-comment-open'))
    expect(await screen.findByTestId('survey-comment-submit')).toBeDisabled()
  })

  it('is offered even to someone who declined the donation', async () => {
    await reachDone()
    fireEvent.click(screen.getByText('Not this time'))
    expect(await screen.findByTestId('survey-declined')).toBeInTheDocument()
    expect(screen.getByTestId('survey-comment-open')).toBeInTheDocument()
  })
})

describe('Survey — the score sheet ask', () => {
  // Walk to the last question and answer it, which is where the ask appears.
  const reachAsk = async ({ passed = 'yes' } = {}) => {
    renderSurvey()
    fireEvent.click(await screen.findByTestId('survey-start'))
    fireEvent.click(await screen.findByTestId('survey-sat-yes'));            await advance()
    fireEvent.click(await screen.findByTestId('survey-role-pilot'));         await advance()
    fireEvent.click(await screen.findByTestId(`survey-passed-${passed}`));   await advance()
    if (passed === 'no') {
      fireEvent.click(await screen.findByTestId('survey-any-no'));           await advance()
    }
    fireEvent.click(await screen.findByTestId('survey-realism-4'));          await advance()
    fireEvent.click(await screen.findByTestId('survey-helped-5'));           await advance()
    fireEvent.click(await screen.findByTestId('survey-gaps-submit'));        await advance()
  }

  // jsdom never loads an <img> and never fails one either, so the component's
  // decode step would wait on a promise that can never settle. This stands in a
  // decoder that succeeds, which puts the test on the same path a real browser
  // takes; the canvas jsdom does not implement then returns the original bytes,
  // which is the documented fallback and what actually gets sent here.
  class FakeImage {
    width = 2000
    height = 1000
    set src(_value) { setTimeout(() => this.onload?.(), 0) }
  }

  // A real File, so the component's own FileReader does the work rather than a
  // stub standing in for the only interesting part of the flow.
  const choose = async () => {
    vi.stubGlobal('Image', FakeImage)
    const file = new File(['sheet-bytes'], 'sheet.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('survey-upload-file'), { target: { files: [file] } })
    await advance()
  }

  it('comes after the last question, not before it', async () => {
    await reachAsk()
    expect(await screen.findByTestId('survey-upload')).toBeInTheDocument()
    // The donation lives on the next screen; the two asks must never share one.
    expect(screen.queryByTestId('survey-donate')).not.toBeInTheDocument()
  })

  // The run is data as soon as the sixth question is answered. Making the sheet
  // step decide whether the response counts would turn every polite decline
  // into an abandoned run.
  it('marks the run complete before the ask, not after it', async () => {
    await reachAsk()
    await waitFor(() => expect(patches).toContainEqual(expect.objectContaining({ complete: true })))
  })

  it('is offered to someone who did not pass, whose sheet is just as useful', async () => {
    await reachAsk({ passed: 'no' })
    expect(await screen.findByTestId('survey-upload')).toBeInTheDocument()
  })

  // Nothing to photograph yet, so the screen would be a dead end.
  it('is skipped for someone still waiting on their result', async () => {
    await reachAsk({ passed: 'waiting' })
    expect(await screen.findByTestId('survey-done')).toBeInTheDocument()
    expect(screen.queryByTestId('survey-upload')).not.toBeInTheDocument()
    // They are the likeliest future sender, so the offer is made here instead.
    expect(screen.getByTestId('survey-sheet-later')).toBeInTheDocument()
  })

  it('states the terms before the button, where the decision is made', async () => {
    await reachAsk()
    await screen.findByTestId('survey-upload')
    expect(screen.getByText(/never published/i)).toBeInTheDocument()
    expect(screen.getByText(/Cover your name and candidate number/i)).toBeInTheDocument()
    expect(screen.getByText(/remove it again on this screen/i)).toBeInTheDocument()
  })

  it('skipping costs nothing and goes straight to the thank-you', async () => {
    await reachAsk()
    fireEvent.click(await screen.findByTestId('survey-upload-skip'))
    await advance()
    expect(await screen.findByTestId('survey-done')).toBeInTheDocument()
  })

  it('uploads a chosen photo and shows it back', async () => {
    await reachAsk()
    await screen.findByTestId('survey-upload')
    await choose()

    await waitFor(() => expect(screen.getByTestId('survey-upload-list')).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/cbat-result'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('lets them take it back again', async () => {
    await reachAsk()
    await screen.findByTestId('survey-upload')
    await choose()
    await waitFor(() => expect(screen.getByTestId('survey-upload-list')).toBeInTheDocument())

    await act(async () => { fireEvent.click(screen.getByTestId('survey-upload-remove-s1')) })
    await waitFor(() => expect(screen.queryByTestId('survey-upload-list')).not.toBeInTheDocument())
    expect(sheets).toHaveLength(0)
  })

  // A real score sheet usually runs to more than one page, so sending several
  // at once is the normal case rather than an edge one.
  it('takes several pages in one go', async () => {
    await reachAsk()
    await screen.findByTestId('survey-upload')

    vi.stubGlobal('Image', FakeImage)
    const pages = [
      new File(['page-one'], 'page1.jpg', { type: 'image/jpeg' }),
      new File(['page-two'], 'page2.jpg', { type: 'image/jpeg' }),
    ]
    fireEvent.change(screen.getByTestId('survey-upload-file'), { target: { files: pages } })
    await advance()

    await waitFor(() => expect(sheets).toHaveLength(2))
    expect(screen.getByTestId('survey-upload-list').children).toHaveLength(2)
    expect(screen.getByText(/Add another page/)).toBeInTheDocument()
  })

  // Losing the pages that worked because a later one did not is the one failure
  // that would actually cost us a sheet.
  it('keeps the pages that worked when one of them fails', async () => {
    await reachAsk()
    await screen.findByTestId('survey-upload')

    vi.stubGlobal('Image', FakeImage)
    let seen = 0
    const passthrough = global.fetch
    global.fetch = vi.fn(async (url, opts) => {
      if (String(url).includes('/cbat-result') && opts?.method === 'POST' && ++seen === 2) {
        return { ok: false, json: async () => ({ message: 'page2.jpg was too large.' }) }
      }
      return passthrough(url, opts)
    })

    fireEvent.change(screen.getByTestId('survey-upload-file'), {
      target: { files: [
        new File(['ok'],  'page1.jpg', { type: 'image/jpeg' }),
        new File(['bad'], 'page2.jpg', { type: 'image/jpeg' }),
      ] },
    })
    await advance()

    expect(await screen.findByTestId('survey-upload-error')).toHaveTextContent('page2.jpg')
    expect(screen.getByTestId('survey-upload-list').children).toHaveLength(1)
  })

  it('surfaces a refusal rather than pretending it worked', async () => {
    await reachAsk()
    await screen.findByTestId('survey-upload')
    const passthrough = global.fetch
    global.fetch = vi.fn(async (url, opts) => {
      if (String(url).includes('/cbat-result')) {
        return { ok: false, json: async () => ({ message: 'That image is too large.' }) }
      }
      return passthrough(url, opts)
    })
    await choose()
    expect(await screen.findByTestId('survey-upload-error')).toHaveTextContent('too large')
  })

  it('shows sheets already sent, so a reopened link does not ask twice', async () => {
    mockApi({ resultImages: [{ _id: 'old1', url: 'https://cdn/old.jpg' }] })
    await reachAsk()
    expect(await screen.findByTestId('survey-upload-list')).toBeInTheDocument()
    expect(screen.getByText(/Add another page/)).toBeInTheDocument()
  })

  it('keeps the demo entirely in the browser', async () => {
    renderPreview()
    fireEvent.click(await screen.findByTestId('survey-start'))
    fireEvent.click(await screen.findByTestId('survey-sat-yes'));      await advance()
    fireEvent.click(await screen.findByTestId('survey-role-pilot'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-passed-yes'));   await advance()
    fireEvent.click(await screen.findByTestId('survey-realism-4'));    await advance()
    fireEvent.click(await screen.findByTestId('survey-helped-5'));     await advance()
    fireEvent.click(await screen.findByTestId('survey-gaps-submit'));  await advance()

    await screen.findByTestId('survey-upload')
    await choose()

    // The thumbnail, the count and the remove button all behave, and it says so.
    await waitFor(() => expect(screen.getByTestId('survey-upload-list')).toBeInTheDocument())
    expect(screen.getByTestId('survey-upload-preview-note')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
