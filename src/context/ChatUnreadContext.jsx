import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useAuth } from './AuthContext'

const ChatUnreadContext = createContext({
  hasAnyOpenChat: false,
  hasUnread: false,
  totalUnreadConversations: 0,
  refresh: () => {},
})

const POLL_MS = 60_000

export function ChatUnreadProvider({ children }) {
  const { user, API } = useAuth()
  const [hasAnyOpenChat, setHasAnyOpenChat] = useState(false)
  const [hasUnread,      setHasUnread]      = useState(false)
  const [totalUnread,    setTotalUnread]    = useState(0)

  const fetchUnread = useCallback(() => {
    if (!user) return
    const url = user.isAdmin ? `${API}/api/chat/unread/admin` : `${API}/api/chat/unread/me`
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.data) return
        setHasAnyOpenChat(Boolean(d.data.hasAnyOpenChat))
        setHasUnread(Boolean(d.data.hasUnread))
        setTotalUnread(d.data.totalUnreadConversations ?? 0)
      })
      .catch(() => {})
  }, [user, API])

  useEffect(() => {
    if (!user) {
      setHasAnyOpenChat(false); setHasUnread(false); setTotalUnread(0)
      return
    }
    fetchUnread()
    const id = setInterval(fetchUnread, POLL_MS)
    return () => clearInterval(id)
  }, [user, fetchUnread])

  return (
    <ChatUnreadContext.Provider value={{
      hasAnyOpenChat, hasUnread, totalUnreadConversations: totalUnread, refresh: fetchUnread,
    }}>
      {children}
    </ChatUnreadContext.Provider>
  )
}

export const useChatUnread = () => useContext(ChatUnreadContext)
