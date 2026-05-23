import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Drives the in-app Update Notification modal.
// Fetches the "current" notification each time the user lands on a new authed
// path. The server enforces the selection rule (newest unseen-in-scope, no
// fallback to older), so this hook just hands the result to the UI.
//
// Returns:
//   notification : the doc the user should see right now, or null
//   history      : all currently-active notifications, newest first (for prev/next)
//   dismiss(id)  : marks `id` as seen for this user and refetches "current"
export default function useUpdateNotification() {
  const { user, apiFetch } = useAuth()
  const location = useLocation()

  const [notification, setNotification] = useState(null)
  const [history,      setHistory]      = useState([])

  const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'

  const fetchCurrent = useCallback(async (path) => {
    if (!user) {
      setNotification(null)
      return
    }
    try {
      const res = await apiFetch(
        `${API}/api/update-notifications/current?path=${encodeURIComponent(path)}`,
        { credentials: 'include' }
      )
      const data = await res.json()
      setNotification(data?.data?.notification ?? null)
    } catch {
      setNotification(null)
    }
  }, [API, apiFetch, user])

  const fetchHistory = useCallback(async () => {
    if (!user) return
    try {
      const res = await apiFetch(`${API}/api/update-notifications/history`, { credentials: 'include' })
      const data = await res.json()
      setHistory(data?.data?.notifications ?? [])
    } catch {
      setHistory([])
    }
  }, [API, apiFetch, user])

  useEffect(() => {
    if (!user) {
      setNotification(null)
      setHistory([])
      return
    }
    fetchCurrent(location.pathname)
  }, [user?._id, location.pathname, fetchCurrent])

  // Lazy-load history the first time we have a notification to display.
  useEffect(() => {
    if (notification && history.length === 0) {
      fetchHistory()
    }
  }, [notification, history.length, fetchHistory])

  const dismiss = useCallback(async (id, response = '') => {
    if (!id) return
    try {
      await apiFetch(`${API}/api/update-notifications/${id}/acknowledge`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response ? { response } : {}),
      })
    } catch { /* ignore */ }
    setNotification(null)
  }, [API, apiFetch])

  return { notification, history, dismiss }
}
