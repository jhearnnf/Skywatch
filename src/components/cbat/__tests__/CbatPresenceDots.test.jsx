import { render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

// framer-motion, flattened: the springs are the feature but they are not what
// is testable here. What is: that a person's dot is one element keyed by them,
// so it can move rather than be replaced, and that the x/y it is asked to
// animate to is the tile it belongs to.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => <>{children}</>,
  motion: {
    span: ({ children, className, style, animate, ...rest }) => (
      <span
        className={className}
        style={style}
        data-x={animate?.x}
        data-y={animate?.y}
        {...rest}
      >{children}</span>
    ),
  },
}))

import CbatPresenceDots from '../CbatPresenceDots'
import { DOT, GAP, INSET, MAX_DOTS, presenceSlots } from '../cbatPresenceSlots'

const agent = (id, cbatCard) => ({ _id: id, displayName: `Agent ${id}`, cbatCard })

// The tiles as the hub lays them out, with the geometry jsdom will not give us:
// offsetLeft/offsetTop/offsetWidth are all 0 there, so they are defined per
// card here and read back through the same properties the component uses.
const TILES = {
  target: { left: 0,   top: 0,   width: 120 },
  act:    { left: 140, top: 0,   width: 120 },
  flag:   { left: 0,   top: 200, width: 120 },
}

function Harness({ online }) {
  const ref = useRef(null)
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {Object.keys(TILES).map(key => (
        <div key={key} data-cbat-card={key} ref={(node) => {
          if (!node) return
          const box = TILES[key]
          Object.defineProperties(node, {
            offsetLeft:  { configurable: true, get: () => box.left },
            offsetTop:   { configurable: true, get: () => box.top },
            offsetWidth: { configurable: true, get: () => box.width },
          })
        }} />
      ))}
      <CbatPresenceDots containerRef={ref} online={online} />
    </div>
  )
}

const dots = () => Array.from(document.querySelectorAll('[data-cbat-dot]'))
const dotFor = (card) => dots().filter(d => d.dataset.cbatDot === card)

describe('presenceSlots', () => {
  it('gives one slot per person, on the tile they are on', () => {
    const slots = presenceSlots([agent('a', 'target'), agent('b', 'act')])
    expect(slots.map(s => [s.card, s.index])).toEqual([['target', 0], ['act', 0]])
  })

  it('ignores anyone who is not on a game page', () => {
    // Most people online are somewhere else entirely — reading a brief, in
    // Community, on the hub itself — and the endpoint reports null for them.
    expect(presenceSlots([agent('a', null), agent('b', undefined), agent('c', 'act')]))
      .toHaveLength(1)
  })

  it('stacks several people on one tile, newest nearest the corner', () => {
    // The endpoint sorts most-recently-seen first, so slot 0 is whoever just
    // arrived.
    const slots = presenceSlots([agent('new', 'act'), agent('older', 'act')])
    expect(slots.map(s => s.key)).toEqual(['agent:new', 'agent:older'])
    expect(slots.map(s => s.index)).toEqual([0, 1])
  })

  it('turns a crowd past the cap into a "+n" mark', () => {
    const crowd = Array.from({ length: MAX_DOTS + 3 }, (_, i) => agent(`u${i}`, 'flag'))
    const slots = presenceSlots(crowd)

    expect(slots.filter(s => s.kind === 'dot')).toHaveLength(MAX_DOTS)
    const more = slots.find(s => s.kind === 'more')
    expect(more).toMatchObject({ card: 'flag', index: MAX_DOTS, count: 3 })
    // Not keyed by any of the people it stands for — otherwise it would slide
    // across the grid when the crowd changed.
    expect(more.key).toBe('more:flag')
  })

  it('keys a dot by the person, so the same element survives a move', () => {
    const before = presenceSlots([agent('a', 'target')])
    const after  = presenceSlots([agent('a', 'act')])

    expect(before[0].key).toBe(after[0].key)
    expect([before[0].card, after[0].card]).toEqual(['target', 'act'])
  })
})

describe('CbatPresenceDots', () => {
  it('draws a dot in the top-right corner of the tile its player is on', async () => {
    render(<Harness online={[agent('a', 'act')]} />)

    await waitFor(() => expect(dots()).toHaveLength(1))
    const dot = dotFor('act')[0]
    expect(Number(dot.dataset.x)).toBe(TILES.act.left + TILES.act.width - INSET - DOT)
    expect(Number(dot.dataset.y)).toBe(TILES.act.top + INSET)
  })

  it('moves the same dot to the new tile when its player switches game', async () => {
    const { rerender } = render(<Harness online={[agent('a', 'target')]} />)
    await waitFor(() => expect(dotFor('target')).toHaveLength(1))

    rerender(<Harness online={[agent('a', 'act')]} />)

    await waitFor(() => expect(dotFor('act')).toHaveLength(1))
    expect(dotFor('target')).toHaveLength(0)
    // One dot, not two: the move is a new position for the element that was
    // already there, which is what makes it slide instead of blink.
    expect(dots()).toHaveLength(1)
  })

  it('offsets the second person on a tile along its top edge', async () => {
    render(<Harness online={[agent('a', 'flag'), agent('b', 'flag')]} />)

    await waitFor(() => expect(dotFor('flag')).toHaveLength(2))
    const [first, second] = dotFor('flag').map(d => Number(d.dataset.x))
    expect(first - second).toBe(GAP)
  })

  it('draws nothing for a game with no tile on the hub', async () => {
    // A hidden game still has an admin in it, and there is no card to mark.
    render(<Harness online={[agent('a', 'not-on-the-hub'), agent('b', 'target')]} />)

    await waitFor(() => expect(dots()).toHaveLength(1))
    expect(dotFor('target')).toHaveLength(1)
  })

  it('draws nothing at all when nobody is in a game', async () => {
    render(<Harness online={[agent('a', null)]} />)

    // The layer is still there — it is what the next arrival appears in.
    expect(screen.getByTestId('cbat-presence-dots')).toBeTruthy()
    await waitFor(() => expect(dots()).toHaveLength(0))
  })

  it('never takes a tap from the tile underneath', async () => {
    render(<Harness online={[agent('a', 'act')]} />)

    await waitFor(() => expect(dots()).toHaveLength(1))
    // The overlay covers every tile, including the two whose mode split opens
    // on hover, so it has to be inert.
    expect(screen.getByTestId('cbat-presence-dots').className)
      .toContain('pointer-events-none')
  })
})
