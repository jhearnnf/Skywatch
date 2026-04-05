import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useAuth } from './AuthContext'

const UnsolvedReportsContext = createContext({ unsolvedCount: 0, unresolvedSystemLogs: 0, refresh: () => {} })

const POLL_MS = 60_000

export function UnsolvedReportsProvider({ children }) {
  const { user, API } = useAuth()
  const [unsolvedCount,        setUnsolvedCount]        = useState(0)
  const [unresolvedSystemLogs, setUnresolvedSystemLogs] = useState(0)

  const fetchCount = useCallback(() => {
    if (!user?.isAdmin) return
    Promise.all([
      fetch(`${API}/api/admin/problems/count`,     { credentials: 'include' }).then(r => r.json()),
      fetch(`${API}/api/admin/system-logs/count`,  { credentials: 'include' }).then(r => r.json()),
    ])
      .then(([problems, syslogs]) => {
        setUnsolvedCount(problems.data?.unsolvedCount ?? 0)
        setUnresolvedSystemLogs(syslogs.data?.unresolvedCount ?? 0)
      })
      .catch(() => {})
  }, [user?.isAdmin, API])

  useEffect(() => {
    if (!user?.isAdmin) { setUnsolvedCount(0); setUnresolvedSystemLogs(0); return }
    fetchCount()
    const id = setInterval(fetchCount, POLL_MS)
    return () => clearInterval(id)
  }, [user?.isAdmin, fetchCount])

  return (
    <UnsolvedReportsContext.Provider value={{ unsolvedCount, unresolvedSystemLogs, refresh: fetchCount }}>
      {children}
    </UnsolvedReportsContext.Provider>
  )
}

export const useUnsolvedReports = () => useContext(UnsolvedReportsContext)
