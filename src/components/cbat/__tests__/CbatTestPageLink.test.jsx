import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../utils/isNative', () => ({ isNative: false }))

import CbatTestPageLink from '../CbatTestPageLink'
import { setActiveMock } from '../../../lib/cbatMockSession'

afterEach(() => setActiveMock(null, { remember: false }))

describe('CbatTestPageLink', () => {
  it('links a game’s instructions card to its public test page as a document', () => {
    render(<CbatTestPageLink test="dpt" />)
    const link = screen.getByTestId('cbat-test-page-link')
    // A plain anchor with a server-rewritten URL, not an in-app route.
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/cbat-tests/dpt-dynamic-projection-test')
    expect(link.textContent).toMatch(/real DPT/)
  })

  it('renders nothing for a test without a page', () => {
    const { container } = render(<CbatTestPageLink test="not-a-test" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('stays hidden during a Mock Assessment', () => {
    setActiveMock({ _id: 'm1', userId: 'u1', status: 'active' }, { remember: false })
    const { container } = render(<CbatTestPageLink test="flag" />)
    expect(container).toBeEmptyDOMElement()
  })
})
