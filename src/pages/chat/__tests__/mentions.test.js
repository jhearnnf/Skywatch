import { describe, it, expect } from 'vitest'
import { splitMentions, mentionsMe, activeMention } from '../mentions'

const FALCON = { _id: 'u1', displayName: 'Falcon' }
const BOT    = { _id: 'b1', displayName: 'Guide Bot' }
const GUIDE  = { _id: 'u2', displayName: 'Guide' }

const runs = (body, users) => splitMentions(body, users)
const marked = (body, users) => runs(body, users).filter(r => r.user).map(r => r.text)

describe('splitMentions', () => {
  it('picks the mention out of the surrounding text', () => {
    expect(runs('hey @Falcon look', [FALCON])).toEqual([
      { text: 'hey ',   user: null },
      { text: '@Falcon', user: FALCON },
      { text: ' look',  user: null },
    ])
  })

  it('handles a name with a space in it', () => {
    // Display names may contain spaces, so "@Guide Bot" is one mention rather
    // than a mention of "Guide" followed by the word "Bot".
    expect(marked('@Guide Bot what is FLAG?', [BOT])).toEqual(['@Guide Bot'])
  })

  it('prefers the longer name when both exist', () => {
    expect(marked('@Guide Bot hello', [BOT, GUIDE])).toEqual(['@Guide Bot'])
  })

  it('still matches the shorter name when that is what was written', () => {
    expect(marked('@Guide hello', [BOT, GUIDE])).toEqual(['@Guide'])
  })

  it('does not light up a name nobody actually mentioned', () => {
    // Driven by the resolved mention list, not by a bare /@\w+/ — otherwise
    // any @word in a message would render as a ping.
    expect(marked('@nobody at all', [FALCON])).toEqual([])
  })

  it('leaves an email address alone', () => {
    expect(marked('write to falcon@example.com', [FALCON])).toEqual([])
  })

  it('does not match a longer name as a shorter one', () => {
    const sam = { _id: 'u3', displayName: 'Sam' }
    expect(marked('@Samantha said so', [sam])).toEqual([])
  })

  it('marks every occurrence', () => {
    expect(marked('@Falcon and @Falcon again', [FALCON])).toEqual(['@Falcon', '@Falcon'])
  })

  it('returns the body untouched when nothing was mentioned', () => {
    expect(runs('plain text', [])).toEqual([{ text: 'plain text', user: null }])
  })
})

describe('mentionsMe', () => {
  it('is true only for a message that names you', () => {
    expect(mentionsMe({ mentions: ['u1', 'u2'] }, 'u2')).toBe(true)
    expect(mentionsMe({ mentions: ['u1'] },       'u2')).toBe(false)
    expect(mentionsMe({ mentions: [] },           'u2')).toBe(false)
    expect(mentionsMe({},                         'u2')).toBe(false)
  })
})

describe('activeMention', () => {
  const at = (text) => activeMention(text, text.length)

  it('opens on @ and tracks what has been typed', () => {
    expect(at('hello @fal')).toEqual({ start: 6, query: 'fal' })
    expect(at('@')).toEqual({ start: 0, query: '' })
  })

  it('stays open across a space, so a two-word name can be typed', () => {
    expect(at('@Guide B')).toEqual({ start: 0, query: 'Guide B' })
  })

  it('does not open mid-word, so an email is not a mention', () => {
    expect(at('james@example')).toBeNull()
  })

  it('closes once the sentence has clearly moved on', () => {
    expect(at('@Falcon said we should all go home now')).toBeNull()
    expect(at(`@${'x'.repeat(25)}`)).toBeNull()
  })

  it('closes on a character a display name cannot contain', () => {
    expect(at('@what?')).toBeNull()
  })

  it('reads from the caret, not the end of the line', () => {
    const text = '@fal and more text here'
    expect(activeMention(text, 4)).toEqual({ start: 0, query: 'fal' })
  })
})
