import { describe, it, expect } from 'vitest'
import {
  ORDER_COLOURS,
  ORDER_NUMBERS,
  ORDER_CHUNK,
  DUE_SECOND_MIN,
  DUE_SECOND_MAX,
  IMMEDIATE_WINDOW_S,
  DELAYED_WINDOW_S,
  dueSecondChunks,
  buildOrderSequence,
  randomBallState,
  pickOrderValue,
  resolveDueSecond,
  armImmediateOrder,
  armDelayedOrder,
  applyBallChange,
  expireOrders,
  settleOrdersAtRoundEnd,
  findWordSplit,
} from '../actOrders'

describe('order wording', () => {
  it('says a due second as tens then units', () => {
    expect(dueSecondChunks(45)).toEqual(['order_40', 'order_5'])
  })

  it('says a round ten as one word', () => {
    expect(dueSecondChunks(60)).toEqual(['order_60'])
  })

  it('only ever needs the recorded number clips across the due range', () => {
    const recorded = new Set([...ORDER_NUMBERS, 20, 30, 40, 50, 60, 70, 80].map(n => `order_${n}`))
    for (let n = DUE_SECOND_MIN; n <= DUE_SECOND_MAX; n++) {
      for (const chunk of dueSecondChunks(n)) expect(recorded.has(chunk)).toBe(true)
    }
  })

  it('builds an immediate colour order', () => {
    expect(buildOrderSequence(['bravo', 'echo'], { attr: 'colour', value: 'red' }))
      .toEqual(['bravo', 'echo', ORDER_CHUNK.changeColour, 'order_red'])
  })

  it('builds a delayed number order', () => {
    expect(buildOrderSequence(['alpha', 'charlie', 'echo'], { attr: 'number', value: 7, dueS: 45 }))
      .toEqual(['alpha', 'charlie', 'echo', ORDER_CHUNK.changeNumber, 'order_7', ORDER_CHUNK.at, 'order_40', 'order_5', ORDER_CHUNK.seconds])
  })
})

describe('order values', () => {
  it('starts the ball on a valid colour and number', () => {
    for (let i = 0; i < 50; i++) {
      const s = randomBallState()
      expect(ORDER_COLOURS).toContain(s.colour)
      expect(ORDER_NUMBERS).toContain(s.number)
    }
  })

  it('always asks for a different value from the current one', () => {
    for (let i = 0; i < 100; i++) {
      expect(pickOrderValue('colour', 'red')).not.toBe('red')
      expect(pickOrderValue('number', 4)).not.toBe(4)
    }
  })

  it('puts the due second after the voice and the lead', () => {
    expect(resolveDueSecond(24.2, 5.6, 12)).toBe(42)
  })

  it('never says a second below the recorded range', () => {
    expect(resolveDueSecond(1, 2, 3)).toBe(DUE_SECOND_MIN)
  })

  it('drops an order whose second would be past the recorded range', () => {
    expect(resolveDueSecond(80, 5, 10)).toBeNull()
  })
})

describe('order scoring', () => {
  it('obeys an immediate order inside its window', () => {
    const orders = [armImmediateOrder('colour', 'red', 30, 3)]
    expect(applyBallChange(orders, 'colour', 'red', 34)).toBe('obeyed')
    expect(orders[0].status).toBe('obeyed')
  })

  it('misses an immediate order once its window shuts', () => {
    const orders = [armImmediateOrder('number', 3, 30, 3)]
    expect(expireOrders(orders, 30 + 3 + IMMEDIATE_WINDOW_S - 0.01)).toBe(0)
    expect(expireOrders(orders, 30 + 3 + IMMEDIATE_WINDOW_S)).toBe(1)
    // A late change then answers nothing.
    expect(applyBallChange(orders, 'number', 3, 40)).toBe('false')
  })

  it('counts the wrong value as a false change and leaves the order open', () => {
    const orders = [armImmediateOrder('colour', 'red', 30, 3)]
    expect(applyBallChange(orders, 'colour', 'green', 31)).toBe('false')
    expect(orders[0].status).toBe('pending')
  })

  it('obeys a delayed order on its second and the two after', () => {
    for (const t of [45, 46.5, 45 + DELAYED_WINDOW_S - 0.01]) {
      const orders = [armDelayedOrder('number', 7, 45)]
      expect(applyBallChange(orders, 'number', 7, t)).toBe('obeyed')
    }
  })

  it('spends a delayed order done early', () => {
    const orders = [armDelayedOrder('number', 7, 45)]
    expect(applyBallChange(orders, 'number', 7, 40)).toBe('early')
    expect(orders[0].status).toBe('missed')
    // Done again on time, it no longer counts.
    expect(applyBallChange(orders, 'number', 7, 45)).toBe('false')
  })

  it('treats any change with nothing armed as false (a fake obeyed)', () => {
    expect(applyBallChange([], 'colour', 'yellow', 20)).toBe('false')
  })

  it('at round end, misses open orders and drops ones whose second never came', () => {
    const open = armImmediateOrder('colour', 'red', 60, 3)
    const future = armDelayedOrder('number', 2, 70)
    expect(settleOrdersAtRoundEnd([open, future], 64)).toBe(1)
    expect(open.status).toBe('missed')
    expect(future.status).toBe('dropped')
  })
})

describe('findWordSplit', () => {
  // "at", a short closure, then "seconds": loud, quiet, loud.
  function twoWords({ sr = 1000, lead = 50, first = 100, gap = 60, second = 300, tail = 50 } = {}) {
    const out = new Float32Array(lead + first + gap + second + tail)
    const fill = (from, len, amp) => { for (let i = from; i < from + len; i++) out[i] = (i % 2 ? amp : -amp) }
    fill(lead, first, 0.5)
    fill(lead + first, gap, 0.002)
    fill(lead + first + gap, second, 0.4)
    return { samples: out, sr, gapStart: lead + first, gapEnd: lead + first + gap }
  }

  it('cuts inside the gap between the two words', () => {
    const { samples, sr, gapStart, gapEnd } = twoWords()
    const cut = findWordSplit(samples, sr)
    expect(cut).toBeGreaterThanOrEqual(gapStart)
    expect(cut).toBeLessThan(gapEnd)
  })

  it('ignores a dip too short to be a gap', () => {
    const { samples, sr } = twoWords({ gap: 15 })
    expect(findWordSplit(samples, sr)).toBeNull()
  })

  it('returns null for one continuous word', () => {
    const { samples, sr } = twoWords({ gap: 0 })
    expect(findWordSplit(samples, sr)).toBeNull()
  })

  it('returns null for silence', () => {
    expect(findWordSplit(new Float32Array(500), 1000)).toBeNull()
  })
})
