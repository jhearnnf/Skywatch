import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runDemoDriver, press } from '../demoDriver'

function mount(html) {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}

describe('press', () => {
  it('fires both click and pointerdown, so either binding style responds', () => {
    const root = mount('<button id="b">go</button>')
    const el = root.querySelector('#b')
    const onClick = vi.fn()
    const onPointerDown = vi.fn()
    el.addEventListener('click', onClick)
    el.addEventListener('pointerdown', onPointerDown)

    press(el)

    expect(onClick).toHaveBeenCalled()
    expect(onPointerDown).toHaveBeenCalled()
  })

  it('is a no-op on a missing element', () => {
    expect(press(null)).toBe(false)
  })
})

describe('runDemoDriver', () => {
  let stop
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    stop?.()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('presses the start control once it appears', () => {
    const root = mount('<div></div>')
    const onStart = vi.fn()
    stop = runDemoDriver(root, { onStart })

    // Start control shows up late, the way an aircraft roster does.
    vi.advanceTimersByTime(600)
    const btn = document.createElement('button')
    btn.setAttribute('data-demo-start', '')
    const clicked = vi.fn()
    btn.addEventListener('click', clicked)
    root.appendChild(btn)

    vi.advanceTimersByTime(400)
    expect(clicked).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000)
    expect(onStart).toHaveBeenCalled()
  })

  it('ignores a disabled start control until it is enabled', () => {
    const root = mount('<button data-demo-start disabled>Start</button>')
    const clicked = vi.fn()
    root.querySelector('button').addEventListener('click', clicked)
    stop = runDemoDriver(root, {})

    vi.advanceTimersByTime(1000)
    expect(clicked).not.toHaveBeenCalled()

    root.querySelector('button').disabled = false
    vi.advanceTimersByTime(400)
    expect(clicked).toHaveBeenCalled()
  })

  it('keeps pressing answer controls for games that wait on input', () => {
    const root = mount(`
      <button data-demo-start>Start</button>
      <button data-demo-answer>A</button>
      <button data-demo-answer>B</button>
    `)
    const answered = vi.fn()
    for (const el of root.querySelectorAll('[data-demo-answer]')) {
      el.addEventListener('click', answered)
    }
    stop = runDemoDriver(root, { answerIntervalMs: 500 })

    vi.advanceTimersByTime(200 + 900 + 1600)
    expect(answered.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('reports failure when no start control ever appears', () => {
    const root = mount('<div>nothing to press</div>')
    const onFail = vi.fn()
    stop = runDemoDriver(root, { onFail, startTimeoutMs: 1000 })

    vi.advanceTimersByTime(1400)
    expect(onFail).toHaveBeenCalledWith('no-start')
  })

  it('reports failure when a started game stops changing', () => {
    const root = mount('<button data-demo-start>Start</button>')
    const onFail = vi.fn()
    stop = runDemoDriver(root, { onFail, stallTimeoutMs: 1000 })

    // Start press lands, then nothing in the card ever mutates again.
    vi.advanceTimersByTime(200 + 900)
    vi.advanceTimersByTime(2500)
    expect(onFail).toHaveBeenCalledWith('stalled')
  })

  it('stops touching the card once cancelled', () => {
    const root = mount('<button data-demo-start>Start</button>')
    const clicked = vi.fn()
    root.querySelector('button').addEventListener('click', clicked)

    const cancel = runDemoDriver(root, {})
    cancel()
    vi.advanceTimersByTime(3000)
    expect(clicked).not.toHaveBeenCalled()
  })
})

describe('runDemoDriver — a hidden tab is not a broken card', () => {
  // Backgrounding the tab stops rAF and throttles timers, so a healthy card
  // stops mutating and stops making progress. Retiring it to its poster for
  // that would leave the whole wall dead when the visitor came back.
  function setHidden(hidden) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  }
  let stop
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    stop?.()
    setHidden(false)
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('does not give up hunting for a start control while hidden', () => {
    const root = mount('<div>no start control here</div>')
    const onFail = vi.fn()
    setHidden(true)
    stop = runDemoDriver(root, { startTimeoutMs: 1000, stallTimeoutMs: 0, onFail })

    vi.advanceTimersByTime(5000)
    expect(onFail).not.toHaveBeenCalled()

    // Back on screen, the deadline runs again from now.
    setHidden(false)
    vi.advanceTimersByTime(5000)
    expect(onFail).toHaveBeenCalledWith('no-start')
  })

  it('does not call a hidden card stalled', () => {
    const root = mount('<button data-demo-start>Start</button>')
    const onFail = vi.fn()
    setHidden(true)
    stop = runDemoDriver(root, { stallTimeoutMs: 1000, startTimeoutMs: 0, onFail })

    vi.advanceTimersByTime(5000)
    expect(onFail).not.toHaveBeenCalled()
  })
})
