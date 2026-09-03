import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Survey from '../Survey'

// `/survey` with no token: the page has to find the invite itself.
//
// Separate file from Survey.test.jsx because this is the one path that reads the
// session out of context, so the auth mock has to be steerable rather than the
// fixed public stub the emailed flow uses.
let auth

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => auth,
}))

vi.mock('../../components/SEO', () => ({ default: () => null }))

const captureLoginReturn = vi.fn()
vi.mock('../../utils/loginRedirect', () => ({
  captureLoginReturn: (...a) => captureLoginReturn(...a),
}))

const TOKEN = 'b'.repeat(64)

const meta = (over = {}) => ({
  name: 'Falcon',
  closed: false,
  optedOut: false,
  completed: false,
  roleGroups: [{ service: 'Royal Air Force', roles: [{ key: 'pilot', label: 'Pilot' }] }],
  response: null,
  ...over,
})

let calls

// POST /api/survey/self issues the token; the GET after it is the ordinary load.
function mockApi({ selfOk = true, selfStatus = 200, selfMessage = '', metaOver = {} } = {}) {
  calls = []
  global.fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ url, method: opts.method ?? 'GET' })
    if (String(url).endsWith('/api/survey/self')) {
      return selfOk
        ? { ok: true, json: async () => ({ data: { token: TOKEN } }) }
        : { ok: false, status: selfStatus, json: async () => ({ message: selfMessage }) }
    }
    return { ok: true, json: async () => ({ data: meta(metaOver) }) }
  })
}

const renderBare = () =>
  render(
    <MemoryRouter initialEntries={['/survey']}>
      <Routes>
        <Route path="/survey" element={<Survey />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  auth = { API: '', user: { _id: 'u1' }, loading: false }
  captureLoginReturn.mockClear()
  mockApi()
})
afterEach(() => { vi.restoreAllMocks() })

describe('Survey — the signed-in shortcut', () => {
  it('opens the questionnaire with no token in the URL', async () => {
    renderBare()
    expect(await screen.findByTestId('survey-intro')).toBeInTheDocument()
    expect(screen.getByText(/Hello Falcon/)).toBeInTheDocument()
  })

  it('asks the server for this account own invite, then loads it', async () => {
    renderBare()
    await screen.findByTestId('survey-intro')
    expect(calls[0]).toEqual({ url: '/api/survey/self', method: 'POST' })
    expect(calls[1].url).toBe(`/api/survey/${TOKEN}`)
  })

  it('resumes a run already in progress', async () => {
    mockApi({ metaOver: { response: { role: 'pilot', satTest: true } } })
    renderBare()
    await screen.findByTestId('survey-intro')
    // The answers came back on the load, so the run is not starting from blank.
    expect(calls.some(c => c.url === `/api/survey/${TOKEN}`)).toBe(true)
  })

  it('goes straight to the closing screen when it has already been answered', async () => {
    mockApi({ metaOver: { completed: true } })
    renderBare()
    expect(await screen.findByTestId('survey-done')).toBeInTheDocument()
  })

  it('waits for the auth check before deciding nobody is signed in', async () => {
    auth = { API: '', user: null, loading: true }
    renderBare()
    expect(await screen.findByTestId('survey-loading')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.queryByTestId('survey-needs-login')).not.toBeInTheDocument()
  })

  it('offers a sign-in rather than a broken link when nobody is signed in', async () => {
    auth = { API: '', user: null, loading: false }
    renderBare()
    expect(await screen.findByTestId('survey-needs-login')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    // Nothing is looked up: there is no token and no session to look one up for.
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('remembers where to come back to after signing in', async () => {
    auth = { API: '', user: null, loading: false }
    renderBare()
    await screen.findByTestId('survey-needs-login')
    expect(captureLoginReturn).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/survey' }),
    )
  })

  it('reports a closed questionnaire instead of hanging on the loader', async () => {
    mockApi({ selfOk: false, selfStatus: 410, selfMessage: 'This questionnaire has closed.' })
    renderBare()
    expect(await screen.findByTestId('survey-error')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('This questionnaire has closed.')).toBeInTheDocument()
    })
  })
})
