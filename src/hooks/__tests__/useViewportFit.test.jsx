import { describe, it, expect, afterEach } from 'vitest'
import { trailingSpace } from '../useViewportFit'

// trailingSpace is what keeps a fitted game from scrolling: everything that
// still has to sit under the stage once it reaches the bottom of the window.
// jsdom has no layout, so offsetHeight is stubbed per element.

function el(tag, style = {}, height = 0) {
  const n = document.createElement(tag)
  Object.assign(n.style, style)
  Object.defineProperty(n, 'offsetHeight', { value: height })
  return n
}

afterEach(() => { document.body.innerHTML = '' })

describe('trailingSpace', () => {
  it('adds every ancestor\'s bottom padding and the siblings after the stage', () => {
    const main    = el('main', { paddingBottom: '80px' })
    const content = el('div', { paddingBottom: '24px' })
    const stage   = el('div')
    const after   = el('div', { marginTop: '8px' }, 50)
    content.append(stage, after)
    main.append(content)
    document.body.append(main)
    expect(trailingSpace(stage)).toBe(80 + 24 + 50 + 8)
  })

  it('skips siblings beside the stage in a row and ones taken out of flow', () => {
    const row   = el('div', { display: 'flex', flexDirection: 'row' })
    const stage = el('div')
    row.append(stage, el('div', {}, 400))
    const col = el('div')
    col.append(row, el('div', { position: 'fixed' }, 300), el('div', { display: 'none' }, 300))
    document.body.append(col)
    expect(trailingSpace(stage)).toBe(0)
  })
})

describe('useViewportFit', () => {
  it('measures again when a shell transition ends', async () => {
    const { render, act } = await import('@testing-library/react')
    const { useRef } = await import('react')
    const { useViewportFit } = await import('../useViewportFit')
    let seen = null
    function Probe() {
      const ref = useRef(null)
      seen = useViewportFit(ref, true)
      return <div ref={ref} />
    }
    const main = document.createElement('main')
    main.style.paddingBottom = '80px'
    document.body.append(main)
    render(<Probe />, { container: main })
    const first = seen.height
    // The shell's padding eases away; the body does not resize, the
    // transition's end is the only signal.
    main.style.paddingBottom = '0px'
    act(() => { document.dispatchEvent(new Event('transitionend')) })
    expect(seen.height).toBe(first + 80)
  })
})
