import { describe, it, expect } from 'vitest'
import { tokenize, clampWpm } from '../rsvp'

// ── tokenize ──────────────────────────────────────────────────────────────

describe('tokenize — list marker stripping', () => {
  it('strips "- " bullet prefix from each line', () => {
    expect(tokenize('- Red Arrows\n- Blue Eagles').map(t => t.word))
      .toEqual(['Red', 'Arrows', 'Blue', 'Eagles'])
  })

  it('strips "* " bullet prefix', () => {
    expect(tokenize('* foo\n* bar').map(t => t.word)).toEqual(['foo', 'bar'])
  })

  it('strips "• " bullet prefix', () => {
    expect(tokenize('• foo\n• bar').map(t => t.word)).toEqual(['foo', 'bar'])
  })

  it('strips numbered list prefixes', () => {
    expect(tokenize('1. First\n2. Second').map(t => t.word)).toEqual(['First', 'Second'])
  })

  it('does not strip mid-word hyphens', () => {
    expect(tokenize('F-35 is fast').map(t => t.word)).toEqual(['F-35', 'is', 'fast'])
  })
})

describe('tokenize — bold stripping', () => {
  it('strips **bold** markers and keeps inner text', () => {
    const tokens = tokenize('**foo** bar')
    expect(tokens.map(t => t.word)).toEqual(['foo', 'bar'])
  })

  it('strips multiple bold spans', () => {
    const tokens = tokenize('**alpha** bravo **charlie**')
    expect(tokens.map(t => t.word)).toEqual(['alpha', 'bravo', 'charlie'])
  })
})

describe('tokenize — whitespace splitting', () => {
  it('splits on single spaces', () => {
    expect(tokenize('one two three').map(t => t.word)).toEqual(['one', 'two', 'three'])
  })

  it('collapses multiple spaces', () => {
    expect(tokenize('one  two   three').map(t => t.word)).toEqual(['one', 'two', 'three'])
  })

  it('ignores leading and trailing whitespace', () => {
    expect(tokenize('  hello world  ').map(t => t.word)).toEqual(['hello', 'world'])
  })

  it('returns [] for empty string', () => {
    expect(tokenize('')).toEqual([])
  })

  it('returns [] for null', () => {
    expect(tokenize(null)).toEqual([])
  })

  it('returns [] for whitespace-only string', () => {
    expect(tokenize('   ')).toEqual([])
  })
})

describe('tokenize — dwellMultiplier', () => {
  it('plain word → 1', () => {
    expect(tokenize('hello')[0].dwellMultiplier).toBe(1)
  })

  it('word ending in . → 1.6', () => {
    expect(tokenize('sentence.')[0].dwellMultiplier).toBe(1.6)
  })

  it('word ending in ! → 1.6', () => {
    expect(tokenize('alert!')[0].dwellMultiplier).toBe(1.6)
  })

  it('word ending in ? → 1.6', () => {
    expect(tokenize('question?')[0].dwellMultiplier).toBe(1.6)
  })

  it('word ending in ; → 1.6', () => {
    expect(tokenize('pause;')[0].dwellMultiplier).toBe(1.6)
  })

  it('word ending in , → 1.25', () => {
    expect(tokenize('comma,')[0].dwellMultiplier).toBe(1.25)
  })
})

describe('tokenize — focalIndex', () => {
  it('length 1 → focalIndex 0', () => {
    expect(tokenize('a')[0].focalIndex).toBe(0)
  })

  it('length 2 → focalIndex 0', () => {
    expect(tokenize('ab')[0].focalIndex).toBe(0)
  })

  it('length 5 → focalIndex 1', () => {
    // floor((5-1)/2.5) = floor(1.6) = 1
    expect(tokenize('hello')[0].focalIndex).toBe(1)
  })

  it('length 10 → focalIndex 3', () => {
    // floor((10-1)/2.5) = floor(3.6) = 3
    expect(tokenize('abcdefghij')[0].focalIndex).toBe(3)
  })

  it('length 20 → focalIndex clamped to 4', () => {
    // floor((20-1)/2.5) = floor(7.6) = 7, clamped to 4
    expect(tokenize('abcdefghijklmnopqrst')[0].focalIndex).toBe(4)
  })
})

// ── clampWpm ──────────────────────────────────────────────────────────────

describe('clampWpm', () => {
  it('clamps below minimum to 100', () => {
    expect(clampWpm(0)).toBe(100)
    expect(clampWpm(99)).toBe(100)
  })

  it('passes through values in range', () => {
    expect(clampWpm(100)).toBe(100)
    expect(clampWpm(250)).toBe(250)
    expect(clampWpm(800)).toBe(800)
  })

  it('clamps above maximum to 800', () => {
    expect(clampWpm(801)).toBe(800)
    expect(clampWpm(9999)).toBe(800)
  })

  it('passes through boundary values exactly', () => {
    expect(clampWpm(100)).toBe(100)
    expect(clampWpm(800)).toBe(800)
  })
})
