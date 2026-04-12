import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { buildCumulativeThresholds } from '../utils/subscription'

const Ctx = createContext(null)
const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export function AppSettingsProvider({ children }) {
  const [settings,        setSettings]        = useState(null)
  const [levels,          setLevels]          = useState(null)
  const [levelThresholds, setLevelThresholds] = useState(null)
  const [loading, setLoading]                 = useState(true)

  const fetchSettings = useCallback(() => {
    return Promise.all([
      fetch(`${API}/api/settings`).then(r => r.ok ? r.json() : null),
      fetch(`${API}/api/users/levels`).then(r => r.ok ? r.json() : null),
    ])
      .then(([settingsData, levelsData]) => {
        setSettings(settingsData ?? {})
        const rawLevels = levelsData?.data?.levels ?? []
        setLevels(rawLevels)
        setLevelThresholds(buildCumulativeThresholds(rawLevels))
      })
      .catch(() => {
        setSettings({})
        setLevels(null)
        setLevelThresholds(null)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  return <Ctx.Provider value={{ settings, levels, levelThresholds, loading, refreshSettings: fetchSettings }}>{children}</Ctx.Provider>
}

export const useAppSettings = () => useContext(Ctx)
