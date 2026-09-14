import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import CbatAngles from '../CbatAngles'

// The Real CBAT theme turns Angles into the real screen flow: three unscored
// practice items ("Practice 1 of 3"), then "Testing (n of 20)" with no
// right/wrong shown, answered by number key + Enter. The SkyWatch theme is
// untouched apart from number keys answering.

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ enterImmersive: vi.fn(), exitImmersive: vi.fn() }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../utils/cbat/recordStart', () => ({ recordCbatStart: vi.fn() }))
vi.mock('../../lib/cbatOutbox', () => ({ submitCbatResult: vi.fn(() => Promise.resolve({ synced: true })) }))
vi.mock('../../components/CbatGameOver', () => ({ default: ({ score }) => <div data-testid="game-over">score {score}</div> }))
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style }) => <div className={className} style={style}>{children}</div>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

function setupUser(uiTheme) {
  mockUseAuth.mockReturnValue({
    user: { _id: 'u1', email: 'a@b.com', uiTheme },
    API: '',
    apiFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: null }) }),
  })
}

const press = (key) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
const optionButtons = () => screen.getAllByRole('button').filter(b => /°$/.test(b.textContent))

describe('CbatAngles under the Real CBAT theme', () => {
  beforeEach(() => { vi.useRealTimers(); setupUser('cbat') })

  it('runs three practice items with feedback, then the scored test without', () => {
    render(<CbatAngles />)
    fireEvent.click(screen.getByText('Start'))

    // Practice first, labelled in the real title bar
    expect(screen.getByTestId('cbat-testbar')).toHaveTextContent('Angles, Bearings and Degrees - Practice (1 of 3)')
    expect(screen.getByTestId('cbat-footer-strip')).toHaveTextContent('Your Answer [ ]')

    // Number key marks, footer shows it, Enter commits; practice shows the answer
    press('2')
    expect(screen.getByTestId('cbat-footer-strip')).toHaveTextContent('Your Answer [ 2 ]')
    expect(optionButtons()[1]).toHaveClass('cbat-option-pending')
    press('Enter')
    expect(screen.getByText(/Correct|It was/)).toBeInTheDocument()
    press('Enter') // Next
    expect(screen.getByTestId('cbat-testbar')).toHaveTextContent('Practice (2 of 3)')

    // Esc is "Go": straight to the test
    press('Escape')
    expect(screen.getByTestId('cbat-testbar')).toHaveTextContent('Testing (1 of 20)')

    // A scored item: no feedback, straight on to the next
    press('1')
    press('Enter')
    expect(screen.queryByText(/Correct|It was/)).toBeNull()
    expect(screen.getByTestId('cbat-testbar')).toHaveTextContent('Testing (2 of 20)')
  })

  it('clicking an option only marks it until Enter or the arrow key', () => {
    render(<CbatAngles />)
    fireEvent.click(screen.getByText('Start'))
    fireEvent.click(screen.getByText('Skip practice and begin the test'))
    expect(screen.getByTestId('cbat-testbar')).toHaveTextContent('Testing (1 of 20)')
    fireEvent.click(optionButtons()[3])
    expect(screen.getByTestId('cbat-testbar')).toHaveTextContent('Testing (1 of 20)')
    expect(screen.getByTestId('cbat-footer-strip')).toHaveTextContent('Your Answer [ 4 ]')
    fireEvent.click(screen.getByTestId('cbat-footer-submit'))
    expect(screen.getByTestId('cbat-testbar')).toHaveTextContent('Testing (2 of 20)')
  })
})

describe('CbatAngles under the SkyWatch theme', () => {
  beforeEach(() => { setupUser('skywatch') })

  it('has no practice, keeps feedback, and a number key answers at once', () => {
    render(<CbatAngles />)
    fireEvent.click(screen.getByText('Start'))
    expect(screen.queryByTestId('cbat-testbar')).toBeNull()
    expect(screen.queryByTestId('cbat-footer-strip')).toBeNull()
    expect(screen.getByText(/Overall/)).toBeInTheDocument()
    press('3')
    expect(screen.getByText(/Correct|It was/)).toBeInTheDocument()
    expect(screen.getByText('Next Angle')).toBeInTheDocument()
  })
})
