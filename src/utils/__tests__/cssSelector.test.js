/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { generateSelector } from '../cssSelector'

describe('generateSelector', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('prefers data-tutorial-target over everything else', () => {
    document.body.innerHTML = `
      <div id="outer" class="card foo">
        <button data-tutorial-target="play-grid" class="primary">Click</button>
      </div>
    `
    const btn = document.querySelector('button')
    expect(generateSelector(btn)).toBe('[data-tutorial-target="play-grid"]')
  })

  it('falls back to a unique #id when no data attr', () => {
    document.body.innerHTML = `<section id="hero">hi</section>`
    const sec = document.querySelector('#hero')
    expect(generateSelector(sec)).toBe('#hero')
  })

  it('builds a class + nth-of-type chain when no id and no data attr', () => {
    document.body.innerHTML = `
      <div class="grid">
        <button class="card">A</button>
        <button class="card">B</button>
        <button class="card">C</button>
      </div>
    `
    const second = document.querySelectorAll('button.card')[1]
    const sel    = generateSelector(second)
    expect(sel).toBeTruthy()
    expect(document.querySelectorAll(sel)).toHaveLength(1)
    expect(document.querySelector(sel)).toBe(second)
  })

  it('returns a selector that uniquely matches the chosen element', () => {
    document.body.innerHTML = `
      <main>
        <div class="row"><span>a</span><span>b</span></div>
        <div class="row"><span>c</span></div>
      </main>
    `
    const target = document.querySelectorAll('.row')[1].querySelector('span')
    const sel    = generateSelector(target)
    expect(sel).toBeTruthy()
    expect(document.querySelectorAll(sel)).toHaveLength(1)
    expect(document.querySelector(sel)).toBe(target)
  })

  it('returns null for non-element input', () => {
    expect(generateSelector(null)).toBeNull()
    expect(generateSelector(document.createTextNode('hi'))).toBeNull()
  })

  it('skips data-tutorial-target if a duplicate exists (defends stale attrs)', () => {
    document.body.innerHTML = `
      <button data-tutorial-target="dupe">A</button>
      <button data-tutorial-target="dupe">B</button>
    `
    const first = document.querySelectorAll('button')[0]
    const sel   = generateSelector(first)
    // Should not return the bare attribute selector since it matches both
    expect(sel).not.toBe('[data-tutorial-target="dupe"]')
    expect(sel).toBeTruthy()
    expect(document.querySelectorAll(sel)).toHaveLength(1)
  })
})
