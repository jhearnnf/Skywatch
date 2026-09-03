import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import SurveyOptOut from '../SurveyOptOut'

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ API: '' }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))

const TOKEN = 'b'.repeat(64)

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/survey/:token/opt-out" element={<SurveyOptOut />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: { name: 'Falcon' } }) }))
})
afterEach(() => { vi.restoreAllMocks() })

describe('SurveyOptOut — the real page', () => {
  it('unsubscribes on arrival, before asking anything', async () => {
    renderAt(`/survey/${TOKEN}/opt-out`)

    expect(await screen.findByTestId('optout-page')).toBeInTheDocument()
    // The opt-out fired by itself; the questions are underneath and optional.
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain(`/api/survey/${TOKEN}/opt-out`)
    expect(opts.method).toBe('POST')
    expect(screen.getByTestId('optout-extras')).toBeInTheDocument()
  })

  it('cannot send the optional answers until one is chosen', async () => {
    renderAt(`/survey/${TOKEN}/opt-out`)
    await screen.findByTestId('optout-extras')
    expect(screen.getByTestId('optout-submit')).toBeDisabled()

    fireEvent.click(screen.getByTestId('optout-reason-not_relevant'))
    expect(screen.getByTestId('optout-submit')).not.toBeDisabled()
  })

  it('sends the reason and the pass answer together', async () => {
    renderAt(`/survey/${TOKEN}/opt-out`)
    await screen.findByTestId('optout-extras')

    fireEvent.click(screen.getByTestId('optout-reason-too_many_emails'))
    fireEvent.click(screen.getByTestId('optout-passed-yes'))
    fireEvent.click(screen.getByTestId('optout-submit'))

    expect(await screen.findByTestId('optout-thanks')).toBeInTheDocument()
    await waitFor(() => {
      const patch = global.fetch.mock.calls.find(([, o]) => o?.method === 'PATCH')
      expect(JSON.parse(patch[1].body)).toEqual(
        expect.objectContaining({ reason: 'too_many_emails', passedForRole: 'yes', satTest: true }),
      )
    })
  })

  it('reports a bad link rather than pretending to unsubscribe', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ message: 'nope' }) }))
    renderAt(`/survey/${TOKEN}/opt-out`)
    expect(await screen.findByTestId('optout-error')).toBeInTheDocument()
  })
})

describe('SurveyOptOut — the /survey/preview/opt-out demo', () => {
  it('shows the page without unsubscribing anybody', async () => {
    renderAt('/survey/preview/opt-out')

    expect(await screen.findByTestId('optout-page')).toBeInTheDocument()
    expect(screen.getByTestId('optout-preview-banner')).toBeInTheDocument()
    // The whole risk of previewing this page is that it acts on load. It must not.
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('accepts the optional answers without sending them', async () => {
    renderAt('/survey/preview/opt-out')
    await screen.findByTestId('optout-extras')

    fireEvent.click(screen.getByTestId('optout-reason-other'))
    fireEvent.click(screen.getByTestId('optout-submit'))

    expect(await screen.findByTestId('optout-thanks')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
