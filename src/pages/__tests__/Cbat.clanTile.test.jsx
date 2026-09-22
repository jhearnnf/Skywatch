import { render, fireEvent, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
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

// `(hover: none)` is what the tile asks to know whether a tap has to stand in
// for hover; flipped to true by the touch tests below.
let touchDevice = false
window.matchMedia = (query) => ({
  media: query, matches: query === '(hover: none)' ? touchDevice : false,
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
    const halves = [...card.querySelectorAll('[data-tile-half]')]
    expect(halves.map(h => h.getAttribute('data-tile-half'))).toEqual(['flag', 'clan'])
    fireEvent.click(halves[1])
    expect(mockNavigate).toHaveBeenCalledWith('/cbat/clan')
    fireEvent.click(halves[0])
    expect(mockNavigate).toHaveBeenCalledWith('/cbat/flag')
    // Different pages, so nothing is written for a mode hook to read back.
    expect(localStorage.getItem('cbat:flag:mode')).toBeNull()
  })

  it('badges each half with the flag of the country whose battery sits it', () => {
    renderHub()
    const halves = [...flagCard().querySelectorAll('[data-tile-half]')]
    expect(halves[0].querySelector('[data-flag]').getAttribute('data-flag')).toBe('GB')
    expect(halves[1].querySelector('[data-flag]').getAttribute('data-flag')).toBe('CA')
    // Drawn, not an emoji: Windows renders flag emoji as two letters in a box.
    expect(halves[1].querySelector('svg[data-flag]')).toBeTruthy()
  })

  it('captions each half with whose battery sits it, swiping in from the left on hover', () => {
    renderHub()
    const hints = [...flagCard().querySelectorAll('[data-tile-hint]')]
    expect(hints.map(h => [...h.querySelectorAll('span')].find(el => el.className.includes('sm:inline')).textContent))
      .toEqual(['Sat in the UK: RAF and Royal Navy', 'Sat in Canada on CFAST'])
    // The phone tile is 83px wide, so it gets the same in fewer characters.
    expect(hints.map(h => [...h.querySelectorAll('span')].find(el => el.className === 'sm:hidden').textContent)).toEqual(['UK: RAF and RN', 'Canada: CFAST'])
    // Parked off the left edge until the half is hovered, then it slides
    // across into place. The half clips it, so it enters from the edge.
    for (const h of hints) {
      expect(h.className).toContain('sm:opacity-0')
      expect(h.className).toContain('sm:-translate-x-[130%]')
      expect(h.className).toContain('sm:group-hover/half:opacity-100')
      expect(h.className).toContain('sm:group-hover/half:translate-x-0')
      expect(h.className).toContain('sm:transition-all')
      // Unhurried, and held back a beat so a pointer crossing the tile on its
      // way somewhere else never sets it off.
      expect(h.className).toContain('sm:duration-[550ms]')
      expect(h.className).toContain('sm:delay-[120ms]')
      expect(h.className).not.toContain('translate-y')
    }
    const half = flagCard().querySelector('[data-tile-half]')
    expect(half.className).toContain('sm:overflow-hidden')
  })

  it('right-clicking a half opens that test\'s own all-time board', () => {
    renderHub()
    const halves = [...flagCard().querySelectorAll('[data-tile-half]')]
    fireEvent.contextMenu(halves[1])
    expect(mockNavigate).toHaveBeenCalledWith('/cbat/clan/leaderboard?period=all-time')
  })

  it('describes both tests on the desktop card and states both run lengths', () => {
    renderHub()
    expect(flagCard().textContent).toContain('Colours, Letters and Numbers')
    expect(within(flagCard()).getByTestId('est-time-flag').textContent).toBe('⏱ 1–1.5 min')
  })
})

describe('the FLAG | CLAN tile on a touch screen', () => {
  beforeEach(() => { vi.clearAllMocks(); mockClanOffered.mockReturnValue(true); touchDevice = true })
  afterEach(() => { touchDevice = false })

  it('opens the chooser on a tap instead of going straight to FLAG, and a second tap picks', () => {
    renderHub()
    const card = flagCard()
    const chooser = card.querySelector('[data-testid="tile-chooser-flag"]')
    expect(chooser.className).toContain('opacity-0')
    // Laid out for the phone grid: the halves stack, not sit side by side.
    expect(chooser.className).toContain('flex-col')
    expect(chooser.className).not.toContain('hidden')

    fireEvent.click(card.querySelector('a'))
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(chooser.className).toContain('opacity-100')
    expect(chooser.className).toContain('pointer-events-auto')

    fireEvent.click(card.querySelector('[data-tile-half="clan"]'))
    expect(mockNavigate).toHaveBeenCalledWith('/cbat/clan')
  })

  it('closes the chooser on a tap elsewhere', () => {
    renderHub()
    const card = flagCard()
    fireEvent.click(card.querySelector('a'))
    expect(card.querySelector('[data-testid="tile-chooser-flag"]').className).toContain('opacity-100')
    fireEvent.pointerDown(document.body)
    expect(card.querySelector('[data-testid="tile-chooser-flag"]').className).toContain('opacity-0')
  })

  it('leaves the Visualisation tile tapping straight through, as before', () => {
    renderHub()
    const vis = document.querySelector('[data-cbat-card="visualisation"]')
    expect(vis.querySelector('[data-testid="tile-chooser-visualisation"]').className).toContain('hidden')
    expect(vis.querySelector('a').getAttribute('href')).toBe('/cbat/visualisation')
  })
})
