import { describe, it, expect, beforeEach } from 'vitest'
import { applyUiTheme, resolveUiTheme, UI_THEMES, DEFAULT_UI_THEME, THEME_ATTR } from '../uiTheme'

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
