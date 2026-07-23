import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import renderNotificationBody from '../renderNotificationBody'

function renderBody(body) {
  return render(<p>{renderNotificationBody(body)}</p>)
}

describe('renderNotificationBody', () => {
  it('renders rich HTML formatting', () => {
    renderBody('<b>bold</b> and <i>italic</i>')
    expect(document.querySelector('b')).toHaveTextContent('bold')
    expect(document.querySelector('i')).toHaveTextContent('italic')
  })

  it('renders a coloured span from rich HTML', () => {
    renderBody('<span style="color: red">warn</span>')
    const span = screen.getByText('warn')
    expect(span.tagName).toBe('SPAN')
    expect(span.style.color).toBe('red')
  })

  it('sanitizes dangerous tags out of rich HTML before rendering', () => {
    renderBody('<b>safe</b><img src=x onerror=alert(1)><script>alert(1)</script>')
    expect(document.querySelector('img')).toBeFalsy()
    expect(document.querySelector('script')).toBeFalsy()
    expect(screen.getByText('safe').tagName).toBe('B')
  })

  it('falls back to the plain-text linkifier for non-HTML bodies', () => {
    renderBody('See https://example.com now')
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')
  })
})
