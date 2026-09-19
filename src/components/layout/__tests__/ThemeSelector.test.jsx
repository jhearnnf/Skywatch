import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Behaviour under test: the two themes are offered, the current one reads as
// pressed, a click re-skins immediately (optimistic setUser) and saves to the
// account, and a failed save puts the previous theme back.

const auth = vi.hoisted(() => ({
  user: null,
  setUser: vi.fn(),
  apiFetch: vi.fn(),
  API: 'http://api.test',
}))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => auth,
}))
const inProgress = vi.hoisted(() => ({ value: false }))
vi.mock('../../../hooks/useCbatGameInProgress', () => ({
  useCbatGameInProgress: () => inProgress.value,
}))

import ThemeSelector, { LOCKED_TITLE } from '../ThemeSelector'

// setUser is called with updater functions; apply them to a copy of the user
// so the test can read what the optimistic state would have been.
const lastUserState = () => {
  let u = auth.user
  for (const call of auth.setUser.mock.calls) {
    const arg = call[0]
    u = typeof arg === 'function' ? arg(u) : arg
  }
  return u
}

const ok = (user) => Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { user } }) })

describe('ThemeSelector', () => {
  beforeEach(() => {
    localStorage.clear()
    auth.user = { _id: 'u1', uiTheme: 'skywatch' }
    auth.setUser.mockReset()
    auth.apiFetch.mockReset()
    inProgress.value = false
  })

  it('lets a guest choose a theme and stores it on this device', async () => {
    auth.user = null
    render(<ThemeSelector />)
    fireEvent.click(screen.getByRole('button', { name: 'Real CBAT' }))
    await waitFor(() => expect(localStorage.getItem('skywatch.guestUiTheme')).toBe('cbat'))
    expect(auth.apiFetch).not.toHaveBeenCalled()
    expect(auth.setUser).not.toHaveBeenCalled()
  })

  it('offers SkyWatch and Real CBAT, with the saved theme pressed', () => {
    render(<ThemeSelector />)
    const sky  = screen.getByRole('button', { name: 'SkyWatch' })
    const cbat = screen.getByRole('button', { name: 'Real CBAT' })
    expect(sky.getAttribute('aria-pressed')).toBe('true')
    expect(cbat.getAttribute('aria-pressed')).toBe('false')
  })

  it('marks Real CBAT pressed when that is what the account saved', () => {
    auth.user = { _id: 'u1', uiTheme: 'cbat' }
    render(<ThemeSelector />)
    expect(screen.getByRole('button', { name: 'Real CBAT' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('flips the theme locally at once and saves it to the account', async () => {
    const saved = { _id: 'u1', uiTheme: 'cbat', totalAirstars: 5 }
    auth.apiFetch.mockImplementation(() => ok(saved))
    render(<ThemeSelector />)

    fireEvent.click(screen.getByRole('button', { name: 'Real CBAT' }))

    // Optimistic: the first setUser already carries the new theme.
    expect(auth.setUser).toHaveBeenCalled()
    expect(lastUserState().uiTheme).toBe('cbat')

    await waitFor(() => expect(auth.apiFetch).toHaveBeenCalledTimes(1))
    const [url, opts] = auth.apiFetch.mock.calls[0]
    expect(url).toBe('http://api.test/api/users/me/theme')
    expect(opts.method).toBe('PATCH')
    expect(JSON.parse(opts.body)).toEqual({ theme: 'cbat' })

    // The server's copy of the user replaces the optimistic one.
    await waitFor(() => expect(lastUserState()).toEqual(saved))
  })

  it('puts the previous theme back when the save fails', async () => {
    auth.apiFetch.mockImplementation(() => Promise.reject(new Error('offline')))
    render(<ThemeSelector />)

    fireEvent.click(screen.getByRole('button', { name: 'Real CBAT' }))
    expect(lastUserState().uiTheme).toBe('cbat')

    await waitFor(() => expect(lastUserState().uiTheme).toBe('skywatch'))
  })

  it('puts the previous theme back when the server rejects it', async () => {
    auth.apiFetch.mockImplementation(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ message: 'Unknown theme' }) }))
    render(<ThemeSelector />)

    fireEvent.click(screen.getByRole('button', { name: 'Real CBAT' }))
    await waitFor(() => expect(lastUserState().uiTheme).toBe('skywatch'))
  })

  it('does nothing when the current theme is clicked again', () => {
    render(<ThemeSelector />)
    fireEvent.click(screen.getByRole('button', { name: 'SkyWatch' }))
    expect(auth.apiFetch).not.toHaveBeenCalled()
    expect(auth.setUser).not.toHaveBeenCalled()
  })

  describe('while a CBAT test is running', () => {
    beforeEach(() => { inProgress.value = true })

    it('locks both options and says why', () => {
      render(<ThemeSelector />)
      const sky  = screen.getByRole('button', { name: 'SkyWatch' })
      const cbat = screen.getByRole('button', { name: 'Real CBAT' })
      expect(sky).toBeDisabled()
      expect(cbat).toBeDisabled()
      expect(cbat.getAttribute('title')).toBe(LOCKED_TITLE)
      expect(screen.getByRole('group', { name: 'Theme' }).getAttribute('aria-disabled')).toBe('true')
      // The current theme still reads as the pressed one
      expect(sky.getAttribute('aria-pressed')).toBe('true')
    })

    it('neither reskins nor saves on a click', async () => {
      render(<ThemeSelector />)
      fireEvent.click(screen.getByRole('button', { name: 'Real CBAT' }))
      await Promise.resolve()
      expect(auth.setUser).not.toHaveBeenCalled()
      expect(auth.apiFetch).not.toHaveBeenCalled()
    })
  })
})
