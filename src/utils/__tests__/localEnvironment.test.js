import { describe, it, expect } from 'vitest'
import { isLocalEnvironment } from '../localEnvironment'

// Clipper's nav entry and page are gated on this. Getting it wrong in the
// permissive direction offers a tool whose main buttons cannot work; getting it
// wrong the other way hides the tool on the one machine that can run it.
describe('isLocalEnvironment', () => {
  it.each(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])(
    'treats %s as local', (host) => expect(isLocalEnvironment(host)).toBe(true),
  )

  it.each([
    'skywatch.academy',
    'www.skywatch.academy',
    'skywatch.vercel.app',
    'skywatch-production.up.railway.app',
  ])('treats %s as remote', (host) => expect(isLocalEnvironment(host)).toBe(false))

  it('accepts a LAN address, so a second device on the desk still counts', () => {
    expect(isLocalEnvironment('192.168.1.42')).toBe(true)
    expect(isLocalEnvironment('10.0.0.5')).toBe(true)
    expect(isLocalEnvironment('172.16.4.1')).toBe(true)
    expect(isLocalEnvironment('172.31.255.255')).toBe(true)
  })

  it('does not mistake public addresses that merely start with similar octets', () => {
    // 172.15/172.32 sit outside the private block, and 1.10.x is not 10.x.
    expect(isLocalEnvironment('172.15.0.1')).toBe(false)
    expect(isLocalEnvironment('172.32.0.1')).toBe(false)
    expect(isLocalEnvironment('1.10.0.1')).toBe(false)
  })

  it('accepts an mDNS .local name', () => {
    expect(isLocalEnvironment('jamespc.local')).toBe(true)
  })

  it('is case insensitive', () => {
    expect(isLocalEnvironment('LOCALHOST')).toBe(true)
  })

  it('is not fooled by a hostname that merely contains localhost', () => {
    expect(isLocalEnvironment('localhost.evil.com')).toBe(false)
    expect(isLocalEnvironment('notlocalhost')).toBe(false)
  })

  it('treats an explicit empty hostname as not local', () => {
    // Deliberately not a fallback to window: a caller passing a value that
    // happened to be blank must not get the answer for a different host.
    expect(isLocalEnvironment('')).toBe(false)
  })

  it('falls back to the current window when given nothing', () => {
    // jsdom serves these tests from localhost, so both forms read as local.
    expect(isLocalEnvironment()).toBe(true)
    expect(isLocalEnvironment(null)).toBe(true)
  })
})
