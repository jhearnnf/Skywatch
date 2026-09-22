import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preparePublicPagePreview, finishPublicPagePreview, publicPageInitial } from '../utils/publicPagePreview'

let frames
beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', callback => { frames.push(callback); return frames.length })
  document.body.innerHTML = '<div id="public-page-preview">Existing intro</div><div id="root"></div>'
  const style = document.createElement('style')
  style.id = 'public-page-preview-style'
  document.head.append(style)
})
afterEach(() => {
  finishPublicPagePreview()
  frames.forEach(callback => callback())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('public intro handover', () => {
  it('keeps the preview until commit and avoids replaying its entrance fade', () => {
    const entrance = { opacity: 0, y: 10 }
    preparePublicPagePreview()
    expect(document.getElementById('public-page-preview')).not.toBeNull()
    expect(publicPageInitial(entrance)).toBe(false)
    finishPublicPagePreview()
    expect(document.getElementById('public-page-preview')).toBeNull()
    expect(document.getElementById('public-page-preview-style')).toBeNull()
    frames.forEach(callback => callback())
    expect(publicPageInitial(entrance)).toBe(entrance)
  })

  it('preserves normal startup for returning players and non-prerendered routes', () => {
    const entrance = { opacity: 0 }
    document.documentElement.setAttribute('data-skip-public-preview', '')
    preparePublicPagePreview()
    expect(publicPageInitial(entrance)).toBe(entrance)
    finishPublicPagePreview()
    expect(document.documentElement.hasAttribute('data-skip-public-preview')).toBe(false)
    preparePublicPagePreview()
    expect(publicPageInitial(entrance)).toBe(entrance)
  })
})
