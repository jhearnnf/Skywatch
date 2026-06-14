import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import renderBodyWithLinks from '../renderBodyWithLinks'

function renderBody(body) {
  return render(<p>{renderBodyWithLinks(body)}</p>)
}

describe('renderBodyWithLinks', () => {
  it('returns null for empty body', () => {
    expect(renderBodyWithLinks('')).toBeNull()
    expect(renderBodyWithLinks(null)).toBeNull()
  })

  it('renders plain text unchanged', () => {
    renderBody('Just a normal update.')
    expect(screen.getByText('Just a normal update.')).toBeInTheDocument()
    expect(document.querySelector('a')).toBeFalsy()
  })

  it('auto-links a bare URL', () => {
    renderBody('See https://example.com/page now')
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://example.com/page')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveTextContent('https://example.com/page')
  })

  it('does not include trailing punctuation in a bare URL', () => {
    renderBody('Read more at https://example.com/page.')
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com/page')
  })

  it('renders a markdown link with its label', () => {
    renderBody('Check the [release notes](https://example.com/notes) today')
    const link = screen.getByRole('link', { name: 'release notes' })
    expect(link).toHaveAttribute('href', 'https://example.com/notes')
  })

  it('handles both a markdown link and a bare URL together', () => {
    renderBody('[docs](https://a.test/d) and also https://b.test/x here')
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', 'https://a.test/d')
    expect(links[1]).toHaveAttribute('href', 'https://b.test/x')
  })

  it('ignores non-http schemes (no javascript: links)', () => {
    renderBody('javascript:alert(1) is not linked')
    expect(document.querySelector('a')).toBeFalsy()
  })
})
