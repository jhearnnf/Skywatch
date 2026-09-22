import { render, fireEvent, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import Cbat from '../Cbat'

// The FLAG tile also holds CLAN, the test the RAF replaced with FLAG in 2021
// and that Canada's CFAST still sits. It reads FLAG | CLAN with a rule between
// the two and fans out into the two games on hover, the way the Visualisation
// 2D/3D tile does. Only the admin toggle takes CLAN off it again.

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())
const mockClanOffered = vi.hoisted(() => vi.fn(() => false))
const mockLocation = vi.hoisted(() => ({ pathname: '/cbat', search: '', state: null }))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { cbatGameEnabled: {} } }),
}))
vi.mock('../../components/SEO', () => ({ default: () => null }))
vi.mock('../../utils/cbat/clanOffer', () => ({ useClanOffered: mockClanOffered }))
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => <>{children}</>,
  motion: {
    // `rest` carries data-cbat-card, which the tests find the FLAG tile by.
    div: ({ children, className, style, ...rest }) => (
      <div className={className} style={style} {...dataOnly(rest)}>{children}</div>
    ),
    span: ({ children, className, style, ...rest }) => (
      <span className={className} style={style} {...dataOnly(rest)}>{children}</span>
    ),
  },
  useScroll:    () => ({ scrollY: 0 }),
  useTransform: () => 0,
}))

// Motion props are objects React would warn about on a DOM node, so only the
// data-* attributes are forwarded.
function dataOnly(props) {
  return Object.fromEntries(Object.entries(props).filter(([k]) => k.startsWith('data-')))
}

window.matchMedia = (query) => ({
  media: query, matches: false,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
})

function renderHub() {
  const apiFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'success', data: { recent: [] } }) })
  mockUseAuth.mockReturnValue({ user: { _id: '1', name: 'Test' }, API: '', apiFetch })
  return render(<Cbat />)
}

const flagCard = () => document.querySelector('[data-cbat-card="flag"]')

describe('the FLAG tile with CLAN switched off', () => {
  beforeEach(() => { vi.clearAllMocks(); mockClanOffered.mockReturnValue(false) })

  it('is a plain FLAG link with no split and no mention of CLAN', () => {
    renderHub()
    const card = flagCard()
    expect(within(card).getByText('FLAG')).toBeInTheDocument()
    expect(within(card).queryByText('CLAN')).toBeNull()
    expect(within(card).queryByTestId('tile-title-split-flag')).toBeNull()
    expect(card.querySelector('a').getAttribute('href')).toBe('/cbat/flag')
  })
})

describe('the FLAG tile with CLAN on offer', () => {
  beforeEach(() => { vi.clearAllMocks(); mockClanOffered.mockReturnValue(true) })

  it('reads FLAG | CLAN with a rule down the middle', () => {
    renderHub()
    const title = within(flagCard()).getByTestId('tile-title-split-flag')
    const parts = [...title.querySelectorAll('span')].filter(s => s.textContent)
    expect(parts.map(s => s.textContent)).toEqual(['FLAG', 'CLAN'])
    // The divider sits between them.
    const divider = title.querySelector('[aria-hidden="true"]')
    expect(divider).toBeTruthy()
    expect(divider.className).toContain('w-px')
    expect(parts[0].compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(divider.compareDocumentPosition(parts[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('still taps through to FLAG on the base link, for touch', () => {
    renderHub()
    expect(flagCard().querySelector('a').getAttribute('href')).toBe('/cbat/flag')
  })

  it('fans out into FLAG and CLAN on hover, each opening its own page', () => {
    renderHub()
    const card = flagCard()
    // The overlay's two halves, distinct from the title's two spans.
    const halves = [...card.querySelectorAll('.cursor-pointer.select-none')]
    expect(halves.map(h => h.textContent)).toEqual(['FLAG', 'CLAN'])
    fireEvent.click(halves[1])
    expect(mockNavigate).toHaveBeenCalledWith('/cbat/clan')
    fireEvent.click(halves[0])
    expect(mockNavigate).toHaveBeenCalledWith('/cbat/flag')
    // Different pages, so nothing is written for a mode hook to read back.
    expect(localStorage.getItem('cbat:flag:mode')).toBeNull()
  })

  it('badges each half with the flag of the country whose battery sits it', () => {
    renderHub()
    const halves = [...flagCard().querySelectorAll('.cursor-pointer.select-none')]
    expect(halves[0].querySelector('[data-flag]').getAttribute('data-flag')).toBe('GB')
    expect(halves[1].querySelector('[data-flag]').getAttribute('data-flag')).toBe('CA')
    // Drawn, not an emoji: Windows renders flag emoji as two letters in a box.
    expect(halves[1].querySelector('svg[data-flag]')).toBeTruthy()
    expect(halves[1].textContent).toBe('CLAN')
  })

  it('right-clicking a half opens that test\'s own all-time board', () => {
    renderHub()
    const halves = [...flagCard().querySelectorAll('.cursor-pointer.select-none')]
    fireEvent.contextMenu(halves[1])
    expect(mockNavigate).toHaveBeenCalledWith('/cbat/clan/leaderboard?period=all-time')
  })

  it('describes both tests on the desktop card and states both run lengths', () => {
    renderHub()
    expect(flagCard().textContent).toContain('Colours, Letters and Numbers')
    expect(within(flagCard()).getByTestId('est-time-flag').textContent).toBe('⏱ 1–1.5 min')
  })
})
