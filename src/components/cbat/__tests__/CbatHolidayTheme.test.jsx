import { act, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

// framer-motion flattened to plain elements: the settling animation is not
// what is testable here, where the caps land and that nothing is clickable is.
vi.mock('framer-motion', () => {
  const ANIMATION_PROPS = ['initial', 'animate', 'transition', 'onAnimationComplete']
  const strip = (props) => {
    const rest = { ...props }
    for (const k of ANIMATION_PROPS) delete rest[k]
    return rest
  }
  return {
    motion: {
      svg:    ({ children, ...p }) => <svg {...strip(p)}>{children}</svg>,
      canvas: (p) => <canvas {...strip(p)} />,
      div:    ({ children, ...p }) => <div {...strip(p)}>{children}</div>,
      path: (p) => <path {...strip(p)} />,
      ellipse: (p) => <ellipse {...strip(p)} />,
      g: ({ children, ...p }) => <g {...strip(p)}>{children}</g>,
    },
  }
})

import CbatHolidayTheme from '../CbatHolidayTheme'
import {
  EGG_COLOUR_COUNT, HOLIDAY_THEMES, christmasTreeFor, easterEggFor, hasSnowCap, isHolidayThemeLive,
  jackOLanternFor, spiderWebFor,
} from '../../../data/holidayThemes'

// jsdom has no layout, so each tile's offsets are defined by hand.
const KEYS = ['target', 'ant', 'symbols', 'code-duplicates', 'angles', 'instruments', 'flag', 'act', 'dpt', 'sat']

function Harness({ theme }) {
  const page = useRef(null)
  const area = useRef(null)
  const wrap = useRef(null)
  return (
    <div ref={page}>
      <div ref={area}>
        <div ref={(n) => {
          wrap.current = n
          if (n) Object.defineProperty(n, 'offsetWidth', { configurable: true, get: () => 620 })
        }} style={{ position: 'relative' }}>
          {KEYS.map((key, i) => (
            <div key={key} data-cbat-card={key} ref={(node) => {
              if (!node) return
              Object.defineProperties(node, {
                offsetLeft:  { configurable: true, get: () => (i % 2) * 320 },
                offsetTop:   { configurable: true, get: () => Math.floor(i / 2) * 160 },
                offsetWidth: { configurable: true, get: () => 300 },
                offsetHeight: { configurable: true, get: () => 130 },
              })
            }} />
          ))}
          <CbatHolidayTheme theme={theme} pageRef={page} areaRef={area} containerRef={wrap} />
        </div>
      </div>
    </div>
  )
}

describe('holidayThemes', () => {
  it('lists Off, Christmas, Easter and Halloween, with all three built', () => {
    expect(HOLIDAY_THEMES.map(t => t.key)).toEqual(['none', 'christmas', 'easter', 'halloween'])
    expect(isHolidayThemeLive('christmas')).toBe(true)
    expect(isHolidayThemeLive('easter')).toBe(true)
    expect(isHolidayThemeLive('none')).toBe(false)
    expect(isHolidayThemeLive('halloween')).toBe(true)
    expect(isHolidayThemeLive(undefined)).toBe(false)
    expect(isHolidayThemeLive('bogus')).toBe(false)
  })

  it('puts eggs on a handful of tiles: mostly clusters, the odd lone egg', () => {
    const all = ['target', 'ant', 'symbols', 'code-duplicates', 'angles', 'instruments', 'plane-turn', 'flag',
      'visualisation', 'dpt', 'act', 'numerical-ops', 'dad', 'cut', 'sat', 'rtt', 'sit', 'slt', 'vlt', 'matf', 'vigilance', 'sma']
    const spots = all.map(easterEggFor).filter(Boolean)
    expect(spots.length).toBeGreaterThanOrEqual(4)
    expect(spots.length).toBeLessThanOrEqual(9)

    const lone     = spots.filter(s => s.eggs.length === 1)
    const clusters = spots.filter(s => s.eggs.length > 1)
    expect(lone.length).toBeGreaterThanOrEqual(1)
    expect(clusters.length).toBeGreaterThan(lone.length)

    for (const s of spots) {
      expect(s.along).toBeGreaterThanOrEqual(0)
      expect(s.along).toBeLessThan(1)
      expect(s.eggs.length).toBeLessThanOrEqual(4)
      // One full-size egg per spot, the rest smaller.
      expect(s.eggs.filter(e => e.scale === 1)).toHaveLength(1)
      s.eggs.forEach((e, i) => {
        expect(e.scale).toBeGreaterThanOrEqual(0.55)
        expect(Math.abs(e.tilt)).toBeLessThanOrEqual(15)
        expect(e.colour).toBeGreaterThanOrEqual(0)
        expect(e.colour).toBeLessThan(EGG_COLOUR_COUNT)
        if (i > 0) expect(e.colour).not.toBe(s.eggs[i - 1].colour)
      })
    }
    // Stable: same eggs every visit.
    expect(all.map(easterEggFor)).toEqual(all.map(easterEggFor))
  })

  it('christmas: trees on a few tiles', () => {
    const all = ['target', 'ant', 'symbols', 'code-duplicates', 'angles', 'instruments', 'plane-turn', 'flag',
      'visualisation', 'dpt', 'act', 'numerical-ops', 'dad', 'cut', 'sat', 'rtt', 'sit', 'slt', 'vlt', 'matf', 'vigilance', 'sma']
    const trees  = all.filter(christmasTreeFor)
    expect(trees.length).toBeGreaterThanOrEqual(2)
    expect(trees.length).toBeLessThanOrEqual(6)
  })

  it('caps some tiles but not all, and always the same ones', () => {
    const capped = KEYS.filter(hasSnowCap)
    expect(capped.length).toBeGreaterThan(0)
    expect(capped.length).toBeLessThan(KEYS.length)
    expect(KEYS.filter(hasSnowCap)).toEqual(capped)
  })
})

describe('CbatHolidayTheme', () => {
  it.each(['none', 'bogus', undefined])('draws nothing for %s', (theme) => {
    render(<Harness theme={theme} />)
    expect(screen.queryByTestId('cbat-holiday-snow')).toBeNull()
    expect(screen.queryByTestId('cbat-holiday-snowcaps')).toBeNull()
    expect(screen.queryByTestId('cbat-holiday-eggs')).toBeNull()
    expect(screen.queryByTestId('cbat-holiday-bunny-layer')).toBeNull()
  })

  it('christmas: snow and snow caps, none of it clickable', async () => {
    render(<Harness theme="christmas" />)

    const snow = screen.getByTestId('cbat-holiday-snow')
    const caps = screen.getByTestId('cbat-holiday-snowcaps')
    for (const layer of [snow, caps]) {
      expect(layer.className).toContain('pointer-events-none')
      expect(layer.getAttribute('aria-hidden')).toBe('true')
    }

    const expected = KEYS.filter(hasSnowCap)
    await waitFor(() => {
      expect(Array.from(caps.querySelectorAll('[data-snowcap]')).map(n => n.dataset.snowcap)).toEqual(expected)
    })
  })

  it('christmas: trees on their tiles, not clickable', async () => {
    render(<Harness theme="christmas" />)
    const trees  = screen.getByTestId('cbat-holiday-trees')
    expect(trees.className).toContain('pointer-events-none')
    expect(trees.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByTestId('cbat-holiday-tinsel')).toBeNull()
    await waitFor(() => {
      expect(Array.from(trees.querySelectorAll('[data-christmas-tree]')).map(n => n.dataset.christmasTree))
        .toEqual(KEYS.filter(christmasTreeFor))
    })
  })

  it('easter: no Christmas pieces', () => {
    render(<Harness theme="easter" />)
    expect(screen.queryByTestId('cbat-holiday-trees')).toBeNull()
  })

  it('christmas: a cap sits on the top edge of its own tile', async () => {
    render(<Harness theme="christmas" />)
    const key = KEYS.find(hasSnowCap)
    const i = KEYS.indexOf(key)
    await waitFor(() => expect(document.querySelector(`[data-snowcap="${key}"]`)).not.toBeNull())
    const cap = document.querySelector(`[data-snowcap="${key}"]`)
    const tileTop = Math.floor(i / 2) * 160
    const top = parseFloat(cap.style.top)
    const height = parseFloat(cap.style.height)
    // Straddles the edge: starts above the tile, ends below its top.
    expect(top).toBeLessThan(tileTop)
    expect(top + height).toBeGreaterThan(tileTop)
    // Narrower than the tile and centred on it.
    const left = parseFloat(cap.style.left)
    const width = parseFloat(cap.style.width)
    expect(left).toBeGreaterThan((i % 2) * 320)
    expect(left + width).toBeLessThan((i % 2) * 320 + 300)
  })

  it('easter: eggs on their tiles and no snow, none of it clickable', async () => {
    render(<Harness theme="easter" />)
    expect(screen.queryByTestId('cbat-holiday-snow')).toBeNull()
    expect(screen.queryByTestId('cbat-holiday-snowcaps')).toBeNull()

    const eggs  = screen.getByTestId('cbat-holiday-eggs')
    const bunny = screen.getByTestId('cbat-holiday-bunny-layer')
    for (const layer of [eggs, bunny]) {
      expect(layer.className).toContain('pointer-events-none')
      expect(layer.getAttribute('aria-hidden')).toBe('true')
    }
    // The bunny's layer clips it to the game column.
    expect(bunny.className).toContain('overflow-hidden')

    const expected = KEYS.filter(easterEggFor)
    await waitFor(() => {
      expect(Array.from(eggs.querySelectorAll('[data-easter-egg]')).map(n => n.dataset.easterEgg)).toEqual(expected)
    })
    // Each spot draws its whole group.
    for (const key of expected) {
      const spot = eggs.querySelector(`[data-easter-egg="${key}"]`)
      expect(spot.querySelectorAll('svg')).toHaveLength(easterEggFor(key).eggs.length)
    }
  })

  it('easter: the bunny turns up a few seconds in, on top of a row of tiles', async () => {
    vi.useFakeTimers()
    try {
      render(<Harness theme="easter" />)
      act(() => { vi.advanceTimersByTime(100) })   // first measurement
      expect(document.querySelector('[data-easter-bunny]')).toBeNull()

      act(() => { vi.advanceTimersByTime(3000) })
      const hop = document.querySelector('[data-easter-bunny]')
      expect(hop).not.toBeNull()
      expect(hop.dataset.easterBunny).toBe('right')
      // Feet on a row's top edge: tiles sit at multiples of 160, never the top row.
      const top = parseFloat(hop.style.top)
      const size = parseFloat(hop.style.height)
      expect((top + size) % 160).toBe(0)
      expect(top + size).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('halloween: a couple of webs and lanterns, never on the same tile', () => {
    const all = ['target', 'ant', 'symbols', 'code-duplicates', 'angles', 'instruments', 'plane-turn', 'flag',
      'visualisation', 'dpt', 'act', 'numerical-ops', 'dad', 'cut', 'sat', 'rtt', 'sit', 'slt', 'vlt', 'matf', 'vigilance', 'sma']
    const webs = all.filter(spiderWebFor)
    const jacks = all.filter(jackOLanternFor)
    expect(webs.length).toBeGreaterThanOrEqual(1)
    expect(webs.length).toBeLessThanOrEqual(3)
    expect(jacks.length).toBeGreaterThanOrEqual(1)
    expect(jacks.length).toBeLessThanOrEqual(3)
    expect(webs.filter(k => jacks.includes(k))).toEqual([])
    for (const k of webs) expect(['tl', 'tr', 'bl', 'br']).toContain(spiderWebFor(k).corner)
  })

  it('halloween: webs and lanterns on their tiles, nothing from the other themes, none of it clickable', async () => {
    render(<Harness theme="halloween" />)
    for (const id of ['cbat-holiday-snow', 'cbat-holiday-snowcaps', 'cbat-holiday-trees', 'cbat-holiday-eggs', 'cbat-holiday-bunny-layer']) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
    const webs     = screen.getByTestId('cbat-holiday-webs')
    const lanterns = screen.getByTestId('cbat-holiday-lanterns')
    const spider   = screen.getByTestId('cbat-holiday-spider-layer')
    for (const layer of [webs, lanterns, spider]) {
      expect(layer.className).toContain('pointer-events-none')
      expect(layer.getAttribute('aria-hidden')).toBe('true')
    }
    await waitFor(() => {
      expect(Array.from(webs.querySelectorAll('[data-spider-web]')).map(n => n.dataset.spiderWeb))
        .toEqual(KEYS.filter(spiderWebFor))
      expect(Array.from(lanterns.querySelectorAll('[data-jack-o-lantern]')).map(n => n.dataset.jackOLantern))
        .toEqual(KEYS.filter(jackOLanternFor))
    })
  })

  it('halloween: the spider peeks up from behind a tile, never one with a lantern', () => {
    vi.useFakeTimers()
    try {
      render(<Harness theme="halloween" />)
      act(() => { vi.advanceTimersByTime(100) })   // first measurement
      expect(document.querySelector('[data-peeking-spider]')).toBeNull()

      act(() => { vi.advanceTimersByTime(4000) })
      const peek = document.querySelector('[data-peeking-spider]')
      expect(peek).not.toBeNull()
      const key = peek.dataset.peekingSpider
      expect(jackOLanternFor(key)).toBeNull()
      // Clipped so it ends exactly on that tile's top edge: below it, the tile hides the spider.
      expect(peek.className).toContain('overflow-hidden')
      const i = KEYS.indexOf(key)
      expect(parseFloat(peek.style.top) + parseFloat(peek.style.height)).toBe(Math.floor(i / 2) * 160)
    } finally {
      vi.useRealTimers()
    }
  })
})
