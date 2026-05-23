import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import UpdateNotificationModal from '../UpdateNotificationModal'

const useHookMock = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useUpdateNotification', () => ({
  default: () => useHookMock(),
}))

function setup({ notification, history = [] } = {}) {
  const dismiss = vi.fn()
  useHookMock.mockReturnValue({
    notification,
    history: history.length ? history : (notification ? [notification] : []),
    dismiss,
  })
  return { dismiss }
}

beforeEach(() => useHookMock.mockReset())

describe('UpdateNotificationModal', () => {
  it('renders nothing when no notification', () => {
    setup({ notification: null })
    render(<UpdateNotificationModal />)
    expect(document.querySelector('[data-testid="update-notification-overlay"]')).toBeFalsy()
  })

  it('renders title, body, and Got it button', () => {
    setup({
      notification: { _id: 'a', title: 'Hello', body: 'World', imageMode: 'none' },
    })
    render(<UpdateNotificationModal />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('World')).toBeInTheDocument()
    expect(screen.getByText('Got it')).toBeInTheDocument()
  })

  it('omits image when imageMode is none', () => {
    setup({
      notification: { _id: 'a', title: 't', body: 'b', imageMode: 'none' },
    })
    render(<UpdateNotificationModal />)
    // Overlay portals into document.body — query the whole document
    expect(document.querySelector('[data-testid="update-notification-overlay"] img')).toBeFalsy()
  })

  it('renders placeholder image when imageMode is placeholder', () => {
    setup({
      notification: { _id: 'a', title: 't', body: 'b', imageMode: 'placeholder' },
    })
    render(<UpdateNotificationModal />)
    const img = document.querySelector('[data-testid="update-notification-overlay"] img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe('/images/placeholder-brief.svg')
  })

  it('renders custom URL when imageMode is custom', () => {
    setup({
      notification: { _id: 'a', title: 't', body: 'b', imageMode: 'custom', imageUrl: 'https://x.test/img.png' },
    })
    render(<UpdateNotificationModal />)
    const img = document.querySelector('[data-testid="update-notification-overlay"] img')
    expect(img.getAttribute('src')).toBe('https://x.test/img.png')
  })

  it('renders uploaded image when imageMode is upload', () => {
    setup({
      notification: { _id: 'a', title: 't', body: 'b', imageMode: 'upload', imageUrl: 'https://cdn.test/uploaded.png' },
    })
    render(<UpdateNotificationModal />)
    const img = document.querySelector('[data-testid="update-notification-overlay"] img')
    expect(img.getAttribute('src')).toBe('https://cdn.test/uploaded.png')
  })

  it('fires dismiss with the current id when Got it is clicked', () => {
    const { dismiss } = setup({
      notification: { _id: 'current-id', title: 't', body: 'b', imageMode: 'none' },
    })
    render(<UpdateNotificationModal />)
    fireEvent.click(screen.getByText('Got it'))
    expect(dismiss).toHaveBeenCalledWith('current-id', '')
  })

  it('omits the response textarea when responsesEnabled is false', () => {
    setup({
      notification: { _id: 'a', title: 't', body: 'b', imageMode: 'none', responsesEnabled: false },
    })
    render(<UpdateNotificationModal />)
    expect(document.querySelector('[data-testid="update-notification-response"]')).toBeFalsy()
  })

  it('shows the response textarea when responsesEnabled is true', () => {
    setup({
      notification: { _id: 'a', title: 't', body: 'b', imageMode: 'none', responsesEnabled: true },
    })
    render(<UpdateNotificationModal />)
    expect(document.querySelector('[data-testid="update-notification-response"]')).toBeTruthy()
  })

  it('passes the typed response to dismiss when submitted', () => {
    const { dismiss } = setup({
      notification: { _id: 'cur', title: 't', body: 'b', imageMode: 'none', responsesEnabled: true },
    })
    render(<UpdateNotificationModal />)
    const textarea = document.querySelector('[data-testid="update-notification-response"]')
    fireEvent.change(textarea, { target: { value: '  My thoughts  ' } })
    // Submit label flips when text is typed
    fireEvent.click(screen.getByText('Submit & close'))
    expect(dismiss).toHaveBeenCalledWith('cur', 'My thoughts')
  })

  it('hides the response textarea while browsing older notifications', () => {
    const current = { _id: 'c', title: 'Newest', body: 'n', imageMode: 'none', responsesEnabled: true }
    const older   = { _id: 'b', title: 'Older',  body: 'o', imageMode: 'none', responsesEnabled: true }
    setup({ notification: current, history: [current, older] })

    render(<UpdateNotificationModal />)
    expect(document.querySelector('[data-testid="update-notification-response"]')).toBeTruthy()

    fireEvent.click(screen.getByText(/Previous/))
    // Browsing an older item: input must disappear (responses are current-only)
    expect(document.querySelector('[data-testid="update-notification-response"]')).toBeFalsy()
  })

  it('hides prev/next when history has only one item', () => {
    setup({
      notification: { _id: 'a', title: 't', body: 'b', imageMode: 'none' },
    })
    render(<UpdateNotificationModal />)
    expect(screen.queryByText(/Previous/)).toBeNull()
    expect(screen.queryByText(/Next/)).toBeNull()
  })

  it('shows prev/next and steps backwards through history', () => {
    const current = { _id: 'c', title: 'Newest', body: 'n', imageMode: 'none' }
    const older   = { _id: 'b', title: 'Middle', body: 'm', imageMode: 'none' }
    const oldest  = { _id: 'a', title: 'Oldest', body: 'o', imageMode: 'none' }
    setup({ notification: current, history: [current, older, oldest] })

    render(<UpdateNotificationModal />)
    expect(screen.getByText('Newest')).toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()

    fireEvent.click(screen.getByText(/Previous/))
    expect(screen.getByText('Middle')).toBeInTheDocument()
    expect(screen.getByText('2 / 3')).toBeInTheDocument()

    fireEvent.click(screen.getByText(/Previous/))
    expect(screen.getByText('Oldest')).toBeInTheDocument()

    // Going back forward
    fireEvent.click(screen.getByText(/Next/))
    expect(screen.getByText('Middle')).toBeInTheDocument()
  })
})
