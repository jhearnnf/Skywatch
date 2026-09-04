// The highlighter behind the post-answer review. It runs over a tab's own prose
// with the quotes a wrong answer wants marked, and the one thing it must never
// do is lose or duplicate text — the player is reading the tab, not a rendering
// of it.

import { describe, it, expect } from 'vitest'
import { markUpTabText } from '../vltHighlight'

const TEXT = 'Calder has a mean tidal range of 5.2 metres and a working depth of 14 metres. Fenwick has a mean tidal range of 6.8 metres.'

const rebuilt = parts => parts.map(p => p.text).join('')

describe('markUpTabText', () => {
  it('marks a quote and leaves the rest of the prose alone', () => {
    const parts = markUpTabText(TEXT, [{ quote: 'a working depth of 14 metres', kind: 'answer' }])
    expect(rebuilt(parts)).toBe(TEXT)
    expect(parts.filter(p => p.kind)).toEqual([{ text: 'a working depth of 14 metres', kind: 'answer' }])
  })

  it('marks several quotes in one tab, in the order they appear', () => {
    const parts = markUpTabText(TEXT, [
      { quote: 'Fenwick has a mean tidal range of 6.8 metres', kind: 'answer' },
      { quote: 'Calder has a mean tidal range of 5.2 metres', kind: 'answer' },
    ])
    expect(rebuilt(parts)).toBe(TEXT)
    expect(parts.filter(p => p.kind).map(p => p.text)).toEqual([
      'Calder has a mean tidal range of 5.2 metres',
      'Fenwick has a mean tidal range of 6.8 metres',
    ])
  })

  it('drops an overlapping quote rather than nesting one mark inside another', () => {
    // An answer quote and a trap quote sharing a sentence is legal in the packs;
    // what is not legal is rendering the shared words twice.
    const parts = markUpTabText(TEXT, [
      { quote: 'Calder has a mean tidal range of 5.2 metres', kind: 'answer' },
      { quote: 'mean tidal range of 5.2 metres and a working depth', kind: 'trap' },
    ])
    expect(rebuilt(parts)).toBe(TEXT)
    expect(parts.filter(p => p.kind).map(p => p.kind)).toEqual(['answer'])
  })

  it('keeps the trap mark when it sits clear of the answer quote', () => {
    const parts = markUpTabText(TEXT, [
      { quote: 'Calder has a mean tidal range of 5.2 metres', kind: 'answer' },
      { quote: 'Fenwick has a mean tidal range of 6.8 metres', kind: 'trap' },
    ])
    expect(parts.filter(p => p.kind).map(p => p.kind)).toEqual(['answer', 'trap'])
  })

  it('ignores a quote that no longer matches the tab, without losing text', () => {
    // Belt to the pack test's braces: if a tab is reworded, the review loses a
    // highlight rather than the player losing a paragraph.
    const parts = markUpTabText(TEXT, [{ quote: 'a sentence that was edited away', kind: 'answer' }])
    expect(rebuilt(parts)).toBe(TEXT)
    expect(parts.filter(p => p.kind)).toEqual([])
  })
})
