import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DeleteAccountModal from '../DeleteAccountModal'

const apiFetchMock = vi.fn()
const setUserMock  = vi.fn()

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    API:      'http://api.test',
    apiFetch: (...args) => apiFetchMock(...args),
    setUser:  setUserMock,
  }),
}))

// jsdom has no navigation; the modal calls replace() on success.
const replaceMock = vi.fn()
beforeEach(() => {
  apiFetchMock.mockReset()
  setUserMock.mockReset()
  replaceMock.mockReset()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { replace: replaceMock },
  })
})

const okResponse = { ok: true, json: async () => ({ status: 'success' }) }

function typeConfirm(value) {
  fireEvent.change(screen.getByLabelText(/Type/i), { target: { value } })
}

describe('DeleteAccountModal', () => {
  it('keeps the delete button disabled until DELETE is typed', () => {
    render(<DeleteAccountModal onClose={() => {}} />)
    const btn = screen.getByRole('button', { name: /Delete forever/i })

    expect(btn).toBeDisabled()

    typeConfirm('delete me')
    expect(btn).toBeDisabled()

    typeConfirm('DELETE')
    expect(btn).toBeEnabled()
  })

  it('accepts the confirm word case-insensitively', () => {
    render(<DeleteAccountModal onClose={() => {}} />)
    typeConfirm('delete')
    expect(screen.getByRole('button', { name: /Delete forever/i })).toBeEnabled()
  })

  it('does not call the API when the word is wrong', () => {
    render(<DeleteAccountModal onClose={() => {}} />)
    typeConfirm('DELET')
    fireEvent.click(screen.getByRole('button', { name: /Delete forever/i }))
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('DELETEs /api/users/me and sends the user home on success', async () => {
    apiFetchMock.mockResolvedValue(okResponse)
    render(<DeleteAccountModal onClose={() => {}} />)

    typeConfirm('DELETE')
    fireEvent.click(screen.getByRole('button', { name: /Delete forever/i }))

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith(
      'http://api.test/api/users/me',
      { method: 'DELETE' },
    ))
    await waitFor(() => expect(setUserMock).toHaveBeenCalledWith(null))
    expect(replaceMock).toHaveBeenCalledWith('/')
  })

  it('surfaces a server error and keeps the user signed in', async () => {
    apiFetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Admin accounts cannot be self-deleted.' }),
    })
    render(<DeleteAccountModal onClose={() => {}} />)

    typeConfirm('DELETE')
    fireEvent.click(screen.getByRole('button', { name: /Delete forever/i }))

    expect(await screen.findByText(/Admin accounts cannot be self-deleted/i)).toBeInTheDocument()
    expect(setUserMock).not.toHaveBeenCalled()
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('surfaces a network failure without wiping local session state', async () => {
    apiFetchMock.mockRejectedValue(new Error('offline'))
    render(<DeleteAccountModal onClose={() => {}} />)

    typeConfirm('DELETE')
    fireEvent.click(screen.getByRole('button', { name: /Delete forever/i }))

    expect(await screen.findByText(/Could not reach the server/i)).toBeInTheDocument()
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('closes on cancel without calling the API', () => {
    const onClose = vi.fn()
    render(<DeleteAccountModal onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('tells the user the deletion is irreversible', () => {
    render(<DeleteAccountModal onClose={() => {}} />)
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()
  })
})
