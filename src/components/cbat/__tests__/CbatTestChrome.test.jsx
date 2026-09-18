import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const authRef = vi.hoisted(() => ({ user: null }))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: authRef.user }),
}))

import { CbatGameHeader, CbatFooterStrip, CbatKeyCap, testBarTitle } from '../CbatTestChrome'

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('testBarTitle', () => {
  it('formats the real title bar wording', () => {
    expect(testBarTitle('Angles', { stage: 'Testing', item: 3, total: 20 })).toBe('Angles - Testing (3 of 20)')
    expect(testBarTitle('Angles', { stage: 'Practice', item: 1, total: 3 })).toBe('Angles - Practice (1 of 3)')
    expect(testBarTitle('Angles', { stage: 'Instructions' })).toBe('Angles - Instructions')
  })
})

describe('CbatGameHeader', () => {
  beforeEach(() => { authRef.user = null })

  it('SkyWatch theme: renders the plain header row even while a test is running', () => {
    wrap(<CbatGameHeader title="Angles" onQuit={() => {}} test={{ stage: 'Testing', item: 3, total: 20 }} />)
    expect(screen.getByRole('heading')).toHaveTextContent('Angles')
    expect(screen.queryByTestId('cbat-testbar')).toBeNull()
    expect(screen.getByText('← Instructions')).toBeInTheDocument()
  })

  it('shows the back link on the intro screen', () => {
    wrap(<CbatGameHeader title="Angles" intro />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/cbat')
  })

  it('Real CBAT theme: becomes the title bar while a test is running', () => {
    authRef.user = { _id: 'u1', uiTheme: 'cbat' }
    wrap(<CbatGameHeader title="Angles" fullTitle="Angles, Bearings and Degrees" onQuit={() => {}} test={{ stage: 'Testing', item: 3, total: 20, timeFrac: 0.5, progressFrac: 0.15 }} />)
    expect(screen.getByTestId('cbat-testbar')).toBeInTheDocument()
    expect(screen.getByRole('heading')).toHaveTextContent('Angles, Bearings and Degrees - Testing (3 of 20)')
    expect(screen.getByText('Time')).toBeInTheDocument()
    expect(screen.getByText('Progress')).toBeInTheDocument()
  })

  it('Real CBAT theme: still the plain row outside a test', () => {
    authRef.user = { _id: 'u1', uiTheme: 'cbat' }
    wrap(<CbatGameHeader title="Angles" intro />)
    expect(screen.queryByTestId('cbat-testbar')).toBeNull()
    expect(screen.getByRole('heading')).toHaveTextContent('Angles')
  })

  it('omits unavailable time meters while keeping a countdown at zero visible', () => {
    authRef.user = { _id: 'u1', uiTheme: 'cbat' }
    const header = (timeFrac) => <MemoryRouter><CbatGameHeader title="ACT" test={{ timeFrac, progressFrac: 0.2 }} /></MemoryRouter>
    const { rerender, container } = render(header(undefined))
    expect(screen.queryByText('Time')).toBeNull()
    expect(container.querySelector('.cbat-testbar-progress')).toHaveStyle({ width: '20%' })
    rerender(header(null))
    expect(screen.queryByText('Time')).toBeNull()
    rerender(header(0.5))
    expect(container.querySelector('.cbat-testbar-time')).toHaveStyle({ width: '50%' })
    rerender(header(0))
    expect(screen.getByText('Time')).toBeInTheDocument()
    expect(container.querySelector('.cbat-testbar-time')).toHaveStyle({ width: '0%' })
  })
})

describe('CbatFooterStrip and CbatKeyCap', () => {
  beforeEach(() => { authRef.user = null })

  it('render nothing under the SkyWatch theme', () => {
    const { container } = render(<><CbatFooterStrip answer={null} onSubmit={() => {}} /><CbatKeyCap label="1" /></>)
    expect(container).toBeEmptyDOMElement()
  })

  it('Real CBAT theme: show the answer readout and a tappable arrow key', () => {
    authRef.user = { _id: 'u1', uiTheme: 'cbat' }
    const onSubmit = vi.fn()
    render(<CbatFooterStrip answer="3" onSubmit={onSubmit} />)
    expect(screen.getByTestId('cbat-footer-strip')).toHaveTextContent('Your Answer [ 3 ]')
    expect(screen.getByTestId('cbat-footer-strip')).toHaveTextContent('Enter or change your answer, then press')
    fireEvent.click(screen.getByTestId('cbat-footer-submit'))
    expect(onSubmit).toHaveBeenCalled()
  })

  it('Real CBAT theme: the key cap carries its label', () => {
    authRef.user = { _id: 'u1', uiTheme: 'cbat' }
    render(<CbatKeyCap label="A" />)
    expect(screen.getByText('A')).toHaveClass('cbat-keycap')
  })
})
