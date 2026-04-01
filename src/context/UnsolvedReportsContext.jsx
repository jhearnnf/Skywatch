import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useAuth } from './AuthContext'

const UnsolvedReportsContext = createContext({ unsolvedCount: 0, refresh: () => {} })

const POLL_MS = 60_000

export function UnsolvedReportsProvider({ children }) {
  const { user, API } = useAuth()
  const [unsolvedCount, setUnsolvedCount] = useState(0)

  const fetchCount = useCallback(() => {
    if (!user?.isAdmin) return
    fetch(`${API}/api/admin/problems/count`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setUnsolvedCount(d.data?.unsolvedCount ?? 0))
      .catch(() => {})
  }, [user?.isAdmin, API])

  useEffect(() => {
    if (!user?.isAdmin) { setUnsolvedCount(0); return }
    fetchCount()
    const id = setInterval(fetchCount, POLL_MS)
    return () => clearInterval(id)
  }, [user?.isAdmin, fetchCount])

  return (
    <UnsolvedReportsContext.Provider value={{ unsolvedCount, refresh: fetchCount }}>
      {children}
    </UnsolvedReportsContext.Provider>
  )
}

export const useUnsolvedReports = () => useContext(UnsolvedReportsContext)
