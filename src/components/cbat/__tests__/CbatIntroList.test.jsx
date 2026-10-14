import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CbatIntroList from '../CbatIntroList'

// jsdom has no layout, so the measurements the list reads are stubbed: a
// window of `innerHeight`, the list starting `top` px down, and content
// `content` px tall shown in whatever `clientHeight` the max-height allows.
function stubLayout({ lg, innerHeight = 900, top = 400, content = 800 }) {
  window.matchMedia = vi.fn().mockImplementation(q => ({
    matches: lg, media: q, addEventListener: () => {}, removeEventListener: () => {},
  }))
  window.innerHeight = innerHeight
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return { top: this.dataset.testid === 'cbat-intro-list' ? top : 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() { return this.dataset.testid === 'cbat-intro-list' ? content : 0 },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      if (this.dataset.testid !== 'cbat-intro-list') return 0
      const max = parseFloat(this.style.maxHeight)
      return Number.isFinite(max) ? Math.min(max, content) : content
    },
  })
}

describe('CbatIntroList', () => {
  const realMatch = window.matchMedia
  const realInner = window.innerHeight
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => {
    window.matchMedia = realMatch
    window.innerHeight = realInner
    delete HTMLElement.prototype.scrollHeight
    delete HTMLElement.prototype.clientHeight
    vi.restoreAllMocks()
  })

  it('on desktop, caps the list at the room left in the window and says there is more', () => {
    stubLayout({ lg: true, innerHeight: 900, top: 400, content: 800 })
    render(<CbatIntroList className="p-4"><p>Rule one</p></CbatIntroList>)
    const list = screen.getByTestId('cbat-intro-list')
    expect(list.style.overflowY).toBe('auto')
    expect(parseFloat(list.style.maxHeight)).toBeLessThanOrEqual(500)
    expect(screen.getByText(/scroll for more/i).parentElement.parentElement.className).toMatch(/opacity-100/)
  })

  it('hides the cue once scrolled to the end', () => {
    stubLayout({ lg: true, innerHeight: 900, top: 400, content: 800 })
    render(<CbatIntroList><p>Rule one</p></CbatIntroList>)
    const list = screen.getByTestId('cbat-intro-list')
    list.scrollTop = 800
    fireEvent.scroll(list)
    expect(screen.getByText(/scroll for more/i).parentElement.parentElement.className).toMatch(/opacity-0/)
  })

  it('never squeezes the list below a readable height', () => {
    stubLayout({ lg: true, innerHeight: 500, top: 450, content: 800 })
    render(<CbatIntroList><p>Rule one</p></CbatIntroList>)
    expect(screen.getByTestId('cbat-intro-list').style.maxHeight).toBe('160px')
  })

  it('leaves the list alone on a phone, where the page scrolls instead', () => {
    stubLayout({ lg: false, content: 800 })
    render(<CbatIntroList><p>Rule one</p></CbatIntroList>)
    const list = screen.getByTestId('cbat-intro-list')
    expect(list.style.maxHeight).toBe('')
    expect(list.style.overflowY).toBe('')
  })
})
