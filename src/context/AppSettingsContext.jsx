import { createContext, useContext, useState, useEffect } from 'react'

const Ctx = createContext(null)
const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export function AppSettingsProvider({ children }) {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    fetch(`${API}/api/settings`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setSettings(d ?? {}))
      .catch(() => setSettings({}))
      .finally(() => setLoading(false))
  }, [])

  return <Ctx.Provider value={{ settings, loading }}>{children}</Ctx.Provider>
}

export const useAppSettings = () => useContext(Ctx)
