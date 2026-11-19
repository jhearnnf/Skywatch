import { render, screen, act, fireEvent } from '@testing-library/react'
import { useEffect } from 'react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter, useNavigate, useLocation } from 'react-router-dom'
import InAppPushNotice from '../InAppPushNotice'
import { canShowInAppNotice } from '../../utils/inAppNoticeRoutes'

const listener = vi.hoisted(() => ({ handler: null }))
const chrome = vi.hoisted(() => ({ immersive: false }))

vi.mock('../../lib/pushNotifications', () => ({
  listenForForeground: (fn) => { listener.handler = fn; return () => {} },
}))
vi.mock('../../context/GameChromeContext', () => ({
  useGameChrome: () => ({ immersive: chrome.immersive }),
}))
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => children,
  motion: {
    div: ({ children, ...props }) => {
      const rest = Object.fromEntries(Object.entries(props).filter(([k]) => !['initial', 'animate', 'exit'].includes(k)))
      return <div {...rest}>{children}</div>
    },
  },
}))

const router = { nav: null, where: null }
function Harness() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  useEffect(() => { router.nav = navigate; router.where = pathname })
  return <InAppPushNotice />
}

function setup(path) {
  return render(<MemoryRouter initialEntries={[path]}><Harness /></MemoryRouter>)
}

const push = (over = {}) => act(() => {
  listener.handler({
    title: 'Falcon', body: 'Fancy a round?', url: '/chat/abc', tag: 'chat-abc', kind: 'dms', ...over,
  })
})

const banner = () => screen.queryByTestId('in-app-push-notice')

beforeEach(() => {
  listener.handler = null
  chrome.immersive = false
})

describe('InAppPushNotice', () => {
  it('shows a message that arrives on the CBAT hub, and opens it on tap', () => {
    setup('/cbat')
    push()
    expect(banner()).toHaveTextContent('Falcon')
    expect(banner()).toHaveTextContent('Fancy a round?')
    fireEvent.click(screen.getByText('Falcon'))
    expect(router.where).toBe('/chat/abc')
    expect(banner()).toBeNull()
  })

  it('says nothing when they are already on that chat', () => {
    setup('/chat/abc')
    push()
    expect(banner()).toBeNull()
  })

  it('still shows a message from a different chat', () => {
    setup('/chat/other')
    push()
    expect(banner()).not.toBeNull()
  })

  it('holds a message during a game and shows it back on the menu', () => {
    setup('/cbat/vigilance')
    push()
    expect(banner()).toBeNull()
    act(() => router.nav('/cbat'))
    expect(banner()).toHaveTextContent('Falcon')
  })

  it('never shows while immersive, even on an allowed screen', () => {
    chrome.immersive = true
    const { rerender } = setup('/cbat')
    push()
    expect(banner()).toBeNull()
    chrome.immersive = false
    rerender(<MemoryRouter initialEntries={['/cbat']}><Harness /></MemoryRouter>)
    expect(banner()).not.toBeNull()
  })

  it('collapses several held messages into the newest plus a count', () => {
    setup('/cbat/flag')
    push({ title: 'Falcon', tag: 'chat-1', url: '/chat/1' })
    push({ title: 'Falcon', body: 'newer', tag: 'chat-1', url: '/chat/1' })   // same chat: replaces
    push({ title: 'Viper', tag: 'chat-2', url: '/chat/2' })
    act(() => router.nav('/profile'))
    expect(banner()).toHaveTextContent('Viper')
    expect(banner()).toHaveTextContent('and 1 more')
  })

  it('drops a held message once they open its chat', () => {
    setup('/cbat/flag')
    push()
    act(() => router.nav('/chat/abc'))
    act(() => router.nav('/cbat'))
    expect(banner()).toBeNull()
  })

  it('leaves lounge messages to the lounge dot on CBAT pages', () => {
    setup('/cbat')
    push({ kind: 'lounge', tag: 'chat-lounge', url: '/chat/lounge' })
    expect(banner()).toBeNull()
  })

  it('dismisses', () => {
    setup('/home')
    push()
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(banner()).toBeNull()
  })
})

describe('canShowInAppNotice', () => {
  it('is an allowlist: games, the mock and unknown routes are off', () => {
    for (const p of ['/cbat/ant', '/cbat/mock', '/cbat/mock/123', '/quiz/1', '/some-new-route']) {
      expect(canShowInAppNotice(p)).toBe(false)
    }
    for (const p of ['/cbat', '/home', '/chat/x', '/cbat/ant/leaderboard', '/agent/7']) {
      expect(canShowInAppNotice(p)).toBe(true)
    }
  })
})
