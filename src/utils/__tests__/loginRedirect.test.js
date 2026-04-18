import { describe, it, expect, beforeEach } from 'vitest'
import { captureLoginReturn, resolveLoginDest } from '../loginRedirect'
import { POST_LOGIN_DEST_KEY } from '../storageKeys'

beforeEach(() => {
  sessionStorage.clear()
})

describe('captureLoginReturn', () => {
  it('stores pathname + search for a shareable deep link', () => {
    captureLoginReturn({ pathname: '/cbat', search: '' })
    expect(sessionStorage.getItem(POST_LOGIN_DEST_KEY)).toBe('/cbat')
  })

  it('preserves query string', () => {
    captureLoginReturn({ pathname: '/share', search: '?briefId=abc' })
    expect(sessionStorage.getItem(POST_LOGIN_DEST_KEY)).toBe('/share?briefId=abc')
  })

  it('ignores root path', () => {
    captureLoginReturn({ pathname: '/', search: '' })
    expect(sessionStorage.getItem(POST_LOGIN_DEST_KEY)).toBeNull()
  })

  it('ignores /login itself to avoid loops', () => {
    captureLoginReturn({ pathname: '/login', search: '?tab=register' })
    expect(sessionStorage.getItem(POST_LOGIN_DEST_KEY)).toBeNull()
  })

  it('ignores null / missing location gracefully', () => {
    captureLoginReturn(null)
    captureLoginReturn({})
    expect(sessionStorage.getItem(POST_LOGIN_DEST_KEY)).toBeNull()
  })
})

describe('resolveLoginDest', () => {
  it('returns /brief/:id when briefId provided (highest priority)', () => {
    sessionStorage.setItem(POST_LOGIN_DEST_KEY, '/cbat')
    expect(resolveLoginDest('abc123')).toBe('/brief/abc123')
  })

  it('returns stored destination when no briefId', () => {
    sessionStorage.setItem(POST_LOGIN_DEST_KEY, '/cbat/plane-turn')
    expect(resolveLoginDest()).toBe('/cbat/plane-turn')
  })

  it('preserves query string on stored destination', () => {
    sessionStorage.setItem(POST_LOGIN_DEST_KEY, '/share?briefId=xyz')
    expect(resolveLoginDest()).toBe('/share?briefId=xyz')
  })

  it('falls back to /home when storage empty', () => {
    expect(resolveLoginDest()).toBe('/home')
  })

  it('falls back to /home when stored path is /login', () => {
    sessionStorage.setItem(POST_LOGIN_DEST_KEY, '/login?tab=register')
    expect(resolveLoginDest()).toBe('/home')
  })

  it('falls back to /home when stored path is /', () => {
    sessionStorage.setItem(POST_LOGIN_DEST_KEY, '/')
    expect(resolveLoginDest()).toBe('/home')
  })
})
