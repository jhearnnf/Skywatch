import { describe, it, expect, beforeEach } from 'vitest'
import { applyUiTheme, currentUiTheme, resolveUiTheme, UI_THEMES, DEFAULT_UI_THEME, THEME_ATTR, UI_THEME_LABELS, UI_THEME_TAGLINES } from '../uiTheme'

// The theme lives on <html> as one attribute so main.css can key every override
// off it. The default theme must leave NO attribute behind: the base tokens are
// the SkyWatch look, and a stale attribute would keep the Real CBAT overrides
// alive after switching back.

describe('resolveUiTheme', () => {
  it('defaults to the SkyWatch theme for a guest or an account with nothing saved', () => {
    expect(resolveUiTheme(null)).toBe('skywatch')
    expect(resolveUiTheme({})).toBe('skywatch')
    expect(DEFAULT_UI_THEME).toBe('skywatch')
  })

  it('returns the saved theme when it is one we know', () => {
    expect(resolveUiTheme({ uiTheme: 'cbat' })).toBe('cbat')
  })

  it('falls back to the default for a theme it does not recognise', () => {
    expect(resolveUiTheme({ uiTheme: 'neon' })).toBe('skywatch')
  })

  it('offers exactly the two themes the account can store', () => {
    expect(UI_THEMES).toEqual(['skywatch', 'cbat'])
  })

  it('gives every theme a name and a one-line tagline, with no em dashes on screen', () => {
    for (const theme of UI_THEMES) {
      expect(UI_THEME_LABELS[theme]).toMatch(/\S/)
      expect(UI_THEME_TAGLINES[theme]).toMatch(/\S/)
      expect(UI_THEME_TAGLINES[theme]).not.toMatch(/\n|—/)
    }
  })
})

describe('applyUiTheme', () => {
  beforeEach(() => document.documentElement.removeAttribute(THEME_ATTR))

  it('stamps the Real CBAT theme on <html>', () => {
    applyUiTheme('cbat')
    expect(document.documentElement.getAttribute(THEME_ATTR)).toBe('cbat')
  })

  it('removes the attribute for the default theme instead of stamping it', () => {
    applyUiTheme('cbat')
    applyUiTheme('skywatch')
    expect(document.documentElement.hasAttribute(THEME_ATTR)).toBe(false)
  })

  it('treats an unknown theme as the default', () => {
    applyUiTheme('cbat')
    expect(applyUiTheme('neon')).toBe('skywatch')
    expect(document.documentElement.hasAttribute(THEME_ATTR)).toBe(false)
  })
})

// What a score gets stamped with (lib/cbatOutbox.js): the look on screen at
// game end, read back off <html>, so it is what the player actually saw.
describe('currentUiTheme', () => {
  beforeEach(() => document.documentElement.removeAttribute(THEME_ATTR))

  it('reads the theme applyUiTheme stamped', () => {
    applyUiTheme('cbat')
    expect(currentUiTheme()).toBe('cbat')
  })

  it('is the default with no attribute on <html>', () => {
    expect(currentUiTheme()).toBe(DEFAULT_UI_THEME)
  })

  it('is the default for an attribute value it does not recognise, or no document at all', () => {
    document.documentElement.setAttribute(THEME_ATTR, 'neon')
    expect(currentUiTheme()).toBe(DEFAULT_UI_THEME)
    expect(currentUiTheme(null)).toBe(DEFAULT_UI_THEME)
  })
})
