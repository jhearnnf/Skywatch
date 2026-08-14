import { readFileSync } from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The CBAT guide is a static document outside the build (public/cbat-guide.html),
// so nothing in the app's module graph imports it and no other test would catch
// a regression in its behaviour. This file boots the real document — its markup
// and both of its inline scripts — in jsdom and drives it.
//
// What it guards is one thing: the browser's back button must leave the guide
// and return the reader to wherever they came from (/cbat, the chat rail, a
// search result) on the first press. Two things on this page used to quietly
// stack up history entries and bury that, and both are easy to reintroduce.

const html = readFileSync('public/cbat-guide.html', 'utf8')

// Collects every IntersectionObserver the guide creates so a test can drive one
// directly. The guide makes three and they are told apart by rootMargin: the
// scrollspy, the "coming into view" loader, and the "well out of view" unloader.
class FakeObserver {
  constructor(cb, opts) {
    this.cb = cb
    this.rootMargin = opts?.rootMargin
    this.observed = new Set()
    FakeObserver.instances.push(this)
  }
  observe(el) { this.observed.add(el) }
  unobserve(el) { this.observed.delete(el) }
  disconnect() { this.observed.clear() }
  // Hand the callback an entry the way a real observer would.
  fire(target, isIntersecting) { this.cb([{ target, isIntersecting }], this) }
  static instances = []
  static withMargin(m) { return FakeObserver.instances.find(o => o.rootMargin === m) }
}

function bootGuide() {
  FakeObserver.instances = []
  const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))
  // Scripts injected as innerHTML never execute, so the DOM lands inert and the
  // two body scripts are run afterwards, in order, sharing one scope as they do
  // on the page (the first declares TESTS, the second renders from it).
  document.body.innerHTML = body
  const scripts = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
  new Function(scripts.join('\n;\n'))()
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  // jsdom has no scrollIntoView; the shared setup stubs it on
  // HTMLElement.prototype, so spy on that same prototype — a spy one level up
  // on Element.prototype would sit behind the stub and never be called.
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
  history.replaceState(null, '', '/cbat-guide')
  bootGuide()
})

describe('the CBAT guide contents rail', () => {
  it('jumps to a section without adding a history entry', () => {
    const push    = vi.spyOn(history, 'pushState')
    const replace = vi.spyOn(history, 'replaceState')
    const link    = document.querySelector('#tocbody a[href^="#"]')
    expect(link).toBeTruthy()

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(ev)

    // The default action of a fragment link IS a history push. Twenty-two
    // sections in the rail means a reader who jumps around a few times can no
    // longer get back out of the guide, so the handler has to take it over.
    expect(ev.defaultPrevented).toBe(true)
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
    expect(replace).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    // Still a copyable, linkable URL — replaced, not pushed.
    expect(location.hash).toBe(link.getAttribute('href'))
  })

  it('closes the narrow-screen contents drawer after a jump', () => {
    const toc = document.getElementById('toc')
    toc.classList.add('open')
    document.querySelector('#tocbody a[href^="#"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(toc.classList.contains('open')).toBe(false)
  })
})

describe('the CBAT guide simulation frames', () => {
  const near = () => FakeObserver.withMargin('100% 0px')
  const far  = () => FakeObserver.withMargin('200% 0px')

  it('loads a frame only once it comes into view', () => {
    const frame = document.querySelector('.simbox iframe')
    expect(frame.getAttribute('src')).toBe(null)
    near().fire(frame, true)
    expect(frame.getAttribute('src')).toBe(frame.dataset.src)
  })

  it('unloads a departed frame by replacing it, never by navigating it', () => {
    const before = document.querySelectorAll('.simbox iframe').length
    const frame  = document.querySelector('.simbox iframe')
    near().fire(frame, true)
    far().fire(frame, false)

    // Pointing the old frame at about:blank would free its WebGL context but
    // append a session-history entry to the PARENT document — ten frames
    // cycling as the reader scrolls is what buried the back button. The old
    // node is discarded whole instead.
    expect(frame.isConnected).toBe(false)
    expect(frame.getAttribute('src')).not.toBe('about:blank')

    const fresh = document.querySelector('.simbox iframe')
    expect(document.querySelectorAll('.simbox iframe').length).toBe(before)
    expect(fresh).not.toBe(frame)
    expect(fresh.getAttribute('src')).toBe(null)   // never navigated, so re-loading it replaces
    expect(fresh.dataset.src).toBe(frame.dataset.src)
  })

  it('keeps watching the replacement, so scrolling back re-boots the game', () => {
    const frame = document.querySelector('.simbox iframe')
    near().fire(frame, true)
    far().fire(frame, false)

    const fresh = document.querySelector('.simbox iframe')
    expect(near().observed.has(fresh)).toBe(true)
    expect(far().observed.has(fresh)).toBe(true)
    expect(near().observed.has(frame)).toBe(false)

    near().fire(fresh, true)
    expect(fresh.getAttribute('src')).toBe(fresh.dataset.src)
  })
})

describe('the CBAT guide masthead', () => {
  it('links back to the site, for readers who arrived with no history to go back to', () => {
    const link = document.querySelector('.masthead .kicker a')
    expect(link).toBeTruthy()
    // The landing page, not /cbat: a reader arriving cold from search has never
    // seen the site, so the introduction is a better first stop than the games.
    expect(link.getAttribute('href')).toBe('/')
    expect(link.textContent).toContain('SkyWatch Academy')
  })

  it('dates the guide in the kicker, leaving the headline clean', () => {
    // The year belongs on the small line above the headline, where it reads as
    // a freshness stamp. In the <h1> it turns the title into a product name.
    expect(document.querySelector('.masthead .kicker').textContent).toMatch(/\b20\d{2}\b/)
    expect(document.querySelector('.masthead h1').textContent).not.toMatch(/\b20\d{2}\b/)
  })
})
