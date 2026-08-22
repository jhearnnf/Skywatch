import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { NATIVE_APP } from '../utils/appMode'

const ChatUnreadContext = createContext({
  hasAnyOpenChat: false,
  hasUnread: false,
  totalUnread: 0,
  totalUnreadConversations: 0,
  badgeCount: 0,
  muted: false,
  refresh: () => {},
})

const POLL_MS = 30_000

export function ChatUnreadProvider({ children }) {
  const { user, API } = useAuth()
  const [hasAnyOpenChat, setHasAnyOpenChat] = useState(false)
  const [hasUnread,      setHasUnread]      = useState(false)
  const [totalUnread,    setTotalUnread]    = useState(0)
  const [personalUnread, setPersonalUnread] = useState(0)
  const [adminUnread,    setAdminUnread]    = useState(0)

  const fetchUnread = useCallback(() => {
    // No chat in the native app, so no reason to poll for its badge.
    if (!user || NATIVE_APP) return

    const get = (path) =>
      fetch(`${API}${path}`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)

    // Admins need both: their own channels and DMs (/unread/me) AND the shared
    // support queue (/unread/admin). Querying only the queue, as this used to,
    // would leave an admin with no badge for a DM sent directly to them.
    Promise.all([
      get('/api/chat/unread/me'),
      user.isAdmin ? get('/api/chat/unread/admin') : Promise.resolve(null),
    ]).then(([mine, admin]) => {
      const mineUnread  = mine?.data?.totalUnread ?? 0
      const queueUnread = admin?.data?.totalUnreadConversations ?? 0

      setHasAnyOpenChat(Boolean(mine?.data?.hasAnyOpenChat) || Boolean(admin?.data?.hasAnyOpenChat))
      setHasUnread(mineUnread > 0 || queueUnread > 0)
      setTotalUnread(mineUnread)
      setPersonalUnread(mine?.data?.personalUnread ?? 0)
      setAdminUnread(queueUnread)
    })
  }, [user, API])

  // The server already zeroes the counts for a muted user, but reading the
  // preference off `user` as well means toggling it in Profile clears the dot
  // on the spot rather than at the next 30s poll.
  const muted = user?.communityNotificationsEnabled === false

  useEffect(() => {
    if (!user || NATIVE_APP) {
      setHasAnyOpenChat(false); setHasUnread(false); setTotalUnread(0)
      setPersonalUnread(0); setAdminUnread(0)
      return
    }
    fetchUnread()
    // The tick skips hidden tabs rather than the fetch itself, so an explicit
    // refresh() from the chat page still works while the poll stays idle.
    const id = setInterval(() => { if (!document.hidden) fetchUnread() }, POLL_MS)
    // A tab left open for hours shouldn't come back showing a stale badge, and
    // a backgrounded tab shouldn't keep polling.
    const onVisible = () => { if (!document.hidden) fetchUnread() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [user, fetchUnread])

  return (
    <ChatUnreadContext.Provider value={{
      hasAnyOpenChat,
      // The admin support queue is a moderation duty, not a social
      // notification, so the Community mute does not silence it.
      hasUnread:   muted ? adminUnread > 0 : hasUnread,
      totalUnread: muted ? 0 : totalUnread,
      totalUnreadConversations: adminUnread,
      // What the navbar puts a NUMBER on: things waiting for you personally —
      // mentions, replies to you, DM and support messages, plus the admin
      // support queue, which is a job of work rather than channel chatter.
      // Everything else stays a plain dot. A number that counted every message
      // in every channel would be large, permanent and therefore ignored.
      badgeCount: (muted ? 0 : personalUnread) + adminUnread,
      muted,
      refresh: fetchUnread,
    }}>
      {children}
    </ChatUnreadContext.Provider>
  )
}

export const useChatUnread = () => useContext(ChatUnreadContext)
